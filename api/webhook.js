// versao 2026-09-23-assinatura (plano sai da assinatura paga; aviso de assinatura antiga nao derruba; consulta falha reprocessa)
// anterior: 2026-09-15-escopo (token com escopo, valor reconferido no Asaas)
// POST /api/webhook
// O Asaas chama isso sozinho toda vez que um pagamento muda de status.
// Aqui a gente LIGA o plano quando o pagamento entra e DESLIGA quando vence
// ou e cancelado — e o corte automatico do inadimplente.

const { admin, db } = require('../lib/firebase');
const { PLANOS } = require('../lib/asaas');
const crypto = require('crypto');
const ga = require('../lib/ga');
const meta = require('../lib/meta');
// 11/09/2026: pedidos pagos na live (checkout Pix das subcontas Enterprise).
const checkout = require('../lib/checkout');
const { asaas } = require('../lib/asaas');

/* ===========================================================================
   15/09/2026 — ESCOPO DO TOKEN E VALOR RECONFERIDO NO ASAAS

   O DEFEITO, em duas partes que se somavam:

   1. O webhook de CADA subconta era registrado com o MESMO token
      (ASAAS_WEBHOOK_TOKEN_PEDIDOS), e a subconta e aberta com o e-mail do
      lojista — ele entra no Asaas e le esse token em Integracoes.
   2. Este endpoint aceitava QUALQUER um dos tres tokens para QUALQUER evento.

   Com o token na mao dava para postar, de qualquer lugar do mundo:
     { event:'PAYMENT_RECEIVED', payment:{ id:'x', externalReference:'<uid>',
       value: 99.90 } }
   e o plano daquele uid — o dele ou o de terceiros — ligava por 34 dias, de
   graca. Pior: acumularComissoes usava o `value` DO PAYLOAD, entao um evento
   com value 20000 gerava R$ 3.000 de comissao sacavel por Pix.

   O caminho de PEDIDO ja fazia o certo (confirmarNoAsaas, em lib/checkout.js,
   pergunta ao Asaas antes de marcar pago). O caminho da MENSALIDADE nao fazia.

   AGORA:
     a) o token define o ESCOPO de quem chamou:
          'mae'      -> ASAAS_WEBHOOK_TOKEN: tudo
          'transfer' -> ASAAS_WEBHOOK_TOKEN_TRANSFER: so TRANSFER_*
          'subconta' -> token proprio daquela subconta: so `pedido:` DELA
          'legado'   -> ASAAS_WEBHOOK_TOKEN_PEDIDOS: so `pedido:`, e some
                        assim que a env for apagada
     b) no ramo de assinatura, o pagamento e RECONFERIDO no Asaas com a chave
        MAE (GET /payments/{id}); valem `value`, `status` e `externalReference`
        que o Asaas devolver — o payload vira apenas um aviso de "va conferir".

   Recusa por escopo responde 200 e marca o evento como 'ok' de proposito: nao
   e falha nossa a reprocessar, e 200 evita que a fila do Asaas pause.
=========================================================================== */

/* Comparacao em tempo constante. Tamanho diferente sai antes — o tamanho de um
   token nao e segredo. */
function mesmoToken(a, b) {
  if (typeof b !== 'string' || !b.length || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch (_) { return false; }
}

async function escopoDoToken(token) {
  if (!token) return null;
  if (mesmoToken(token, process.env.ASAAS_WEBHOOK_TOKEN)) return { escopo: 'mae', uid: '' };
  if (mesmoToken(token, process.env.ASAAS_WEBHOOK_TOKEN_TRANSFER)) return { escopo: 'transfer', uid: '' };
  /* Token proprio de subconta: uma leitura direta pelo hash, sem varrer. */
  try {
    const uid = await checkout.uidPorTokenWebhook(token);
    if (uid) return { escopo: 'subconta', uid };
  } catch (_) {}
  /* Token compartilhado antigo. So sobrevive enquanto a env existir; apague-a
     depois de rotacionar as subcontas (adm_wh_rotacionar). */
  if (mesmoToken(token, process.env.ASAAS_WEBHOOK_TOKEN_PEDIDOS)) return { escopo: 'legado', uid: '' };
  return null;
}

/* Le o pagamento no Asaas com a chave MAE. Devolve o objeto do Asaas, ou null
   se nao der para confirmar. Falha FECHADA: sem confirmacao, nao liga plano. */
async function conferirPagamentoNaMae(payId) {
  const id = String(payId || '');
  if (!/^[A-Za-z0-9_-]{4,60}$/.test(id)) return null;
  try { return await asaas('/payments/' + id, 'GET'); }
  catch (e) {
    console.error('webhook: nao confirmou no Asaas', id, (e && e.message) || e);
    return null;
  }
}

// Pagamento entrou -> liga o plano
const LIGA = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'];
// Venceu / apagado / estornado / chargeback -> desliga (cai pra Basico)
const DESLIGA = ['PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED'];

// Janela de retenção da comissão: quantos dias a comissão fica "retida" antes
// de liberar pra saque. Cobre o arrependimento de 7 dias (CDC) — se o lojista
// pedir reembolso nesse período, o clawback zera a comissão ANTES de virar saque.
// Pode aumentar (ex.: 14) pra folga extra contra chargeback.
const DIAS_RETENCAO_COMISSAO = 7;

// ==========================================================
//  PROGRAMA DE PARCEIROS — cálculo de comissão
//  N1 = recorrente em TODO pagamento — 15% no Bronze/Prata, 16% no Ouro,
//  17% no Diamante e 18% no Esmeralda (ver NIVEIS_PARCEIRO). N2 = 7,5% e N3 = 5%
//  SÓ no 1º pagamento do lojista (bônus único). Só acumula pra
//  parceiro APROVADO. Base = valor realmente pago.
// ==========================================================

// ==========================================================
//  PLANO DE NÍVEIS DO PARCEIRO — 10/09/2026
//  O nível conta SÓ cliente direto (nível 1) que pagou a mensalidade no mês
//  corrente. Indireto não conta — contar rede seria classificar por tamanho
//  de downline, e não é isso que o programa é.
//  O nível é recalculado a cada pagamento: sobe quando o cliente paga e cai
//  sozinho no mês seguinte se o cliente parar de pagar.
//  A MESMA tabela existe em parceiro.html e no regulamento.html — mexeu aqui,
//  mexe nos dois.
// ==========================================================
const NIVEIS_PARCEIRO = [
  { chave: 'bronze',    nome: 'Bronze',    min: 1,   pct: 0.15, marco: 0   },
  { chave: 'prata',     nome: 'Prata',     min: 11,  pct: 0.15, marco: 25  },
  { chave: 'ouro',      nome: 'Ouro',      min: 26,  pct: 0.16, marco: 50  },
  { chave: 'diamante',  nome: 'Diamante',  min: 51,  pct: 0.17, marco: 150 },
  { chave: 'esmeralda', nome: 'Esmeralda', min: 101, pct: 0.18, marco: 300 },
];
const PCT_N1_BASE = 0.15;

function nivelPorAtivos(ativos) {
  let atual = null;
  for (const n of NIVEIS_PARCEIRO) { if (ativos >= n.min) atual = n; }
  return atual;
}

// Quantos clientes DIRETOS deste parceiro pagaram na competência (AAAA-MM),
// contando o lojista do pagamento em curso. Qualquer falha -> nível base:
// perder o degrau numa falha rara é melhor que travar o pagamento.
async function contarAtivosDoMes(parceiroUid, competencia, lojistaUidAtual) {
  const vistos = new Set();
  if (lojistaUidAtual) vistos.add(lojistaUidAtual);
  try {
    const r = await db.collection('comissoes')
      .where('parceiroUid', '==', parceiroUid)
      .where('competencia', '==', competencia)
      .limit(1000).get();
    r.forEach((d) => {
      const c = d.data() || {};
      if (Number(c.nivel) === 1 && !c.estornada && c.lojistaUid) vistos.add(c.lojistaUid);
    });
  } catch (e) {
    console.error('contarAtivosDoMes erro (usando nível base):', e);
  }
  return vistos.size;
}

// Bônus de marco: pago UMA vez, na primeira vez que o parceiro alcança o
// degrau. Id determinístico -> o .create() barra repetição para sempre,
// inclusive se ele cair de nível e voltar.
async function creditarMarco(parceiroUid, parceiroSlug, nivel, competencia) {
  if (!nivel || !(nivel.marco > 0)) return;
  const id = 'marco_' + parceiroUid + '_' + nivel.chave;
  try {
    await db.collection('comissoes').doc(id).create({
      parceiroUid: parceiroUid,
      parceiroSlug: parceiroSlug,
      lojistaUid: '',
      nivel: 0,                 // 0 = não é comissão de indicação; não conta pro nível
      tipo: 'marco',
      nivelParceiro: nivel.chave,
      base: 0,
      percentual: 0,
      valor: nivel.marco,
      payId: '',
      competencia: competencia,
      pago: false,
      estornada: false,
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),
      liberaEm: admin.firestore.Timestamp.fromMillis(Date.now() + DIAS_RETENCAO_COMISSAO * 86400000),
    });
  } catch (e) { /* já recebeu este marco -> ignora */ }
}

// Guarda o nível no cadastro do parceiro, pro painel do dono e pro crachá
// lerem sem precisar contar de novo. Falha aqui não afeta a comissão.
async function guardarNivel(parceiroUid, nivel, ativos) {
  try {
    await db.collection('parceiros').doc(parceiroUid).set({
      nivel: nivel ? nivel.chave : '',
      nivelNome: nivel ? nivel.nome : '',
      nivelAtivos: ativos,
      nivelAtualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (e) { console.error('guardarNivel erro:', e); }
}

// Resolve um apelido de parceiro (slug) -> { uid, data } do parceiro, ou null.
async function resolverParceiro(slug) {
  try {
    if (!slug) return null;
    const s = await db.collection('parceiro_slugs').doc(slug).get();
    if (!s.exists || !s.data().uid) return null;
    const puid = s.data().uid;
    const p = await db.collection('parceiros').doc(puid).get();
    if (!p.exists) return null;
    return { uid: puid, data: p.data() };
  } catch (e) { return null; }
}

// Trava anti "cadastro fantasma": um lojista só pode operar como parceiro (e
// receber comissão) enquanto for assinante pago (não trial, não Básico
// gratuito). Regra espelhada da mesma checagem do painel (ehPagante() em
// index.html) — aqui é a versão que decide de verdade se o dinheiro sai.
//
// Parceiro PURO (afiliado/influenciador via seja-parceiro.html) nunca teve
// negócio nem assinatura no Moviki -> não existe assinaturas/{puid} pra ele,
// e a regra de "pagante" simplesmente não se aplica (ele não é lojista).
async function parceiroPodeGanhar(puid) {
  try {
    // negocios/{puid} existe só pra quem já foi (ou é) lojista no Moviki.
    // Se não existe, é parceiro puro (afiliado/influenciador) -> regra não se aplica.
    const neg = await db.collection('negocios').doc(puid).get();
    if (!neg.exists) return true;

    // É lojista: só ganha comissão com assinatura ativa e paga (nunca trial).
    // Sem assinaturas/{puid} (nunca ativou nem o trial) conta como Básico -> nega.
    const a = await db.collection('assinaturas').doc(puid).get();
    if (!a.exists) return false;
    const d = a.data() || {};
    const dentroDoPrazo = !d.vence_em || d.vence_em.toMillis() > Date.now();
    return d.ativo === true && dentroDoPrazo && d.periodo !== 'trial';
  } catch (e) {
    // Erro ao checar -> nega por segurança (evita vazamento financeiro pra
    // quem não deveria ganhar; melhor perder uma comissão pontual por falha
    // técnica rara do que creditar quem não é pagante).
    console.error('parceiroPodeGanhar erro (negando por segurança):', e);
    return false;
  }
}

// Registra UMA comissão. O id é payId_nN (fixo): se o Asaas reenviar o mesmo
// pagamento, o .create() falha e a gente ignora -> nunca conta duas vezes.
async function creditarComissao(o) {
  const valor = Math.round(o.base * o.pct * 100) / 100;
  if (!(valor > 0)) return;
  const id = o.payId + '_n' + o.nivel;
  try {
    await db.collection('comissoes').doc(id).create({
      parceiroUid: o.parceiroUid,
      parceiroSlug: o.parceiroSlug,
      lojistaUid: o.lojistaUid,
      nivel: o.nivel,
      base: o.base,
      percentual: o.pct,
      valor: valor,
      payId: o.payId,
      competencia: o.competencia,
      pago: false,
      estornada: false,
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),
      // A comissão só entra no "disponível para saque" depois desta data.
      liberaEm: admin.firestore.Timestamp.fromMillis(Date.now() + DIAS_RETENCAO_COMISSAO * 86400000),
    });
  } catch (e) { /* já existe (reenvio do Asaas) -> ignora */ }
}

// Calcula e grava as comissões de um pagamento confirmado.
async function acumularComissoes(lojistaUid, periodo, pay) {
  const base = Number(pay.value) || 0;
  const payId = String(pay.id || '');
  // trial não passa pelo Asaas; ainda assim, dupla trava:
  if (base <= 0 || periodo === 'trial' || !payId) return;

  // de qual parceiro veio este lojista (nível 1)
  const ind = await db.collection('indicacoes').doc(lojistaUid).get();
  const slug1 = ind.exists ? (ind.data().ref || '') : '';
  if (!slug1) return;

  // é o 1º pagamento deste lojista? (existe comissão de OUTRO pagamento?)
  const antes = await db.collection('comissoes').where('lojistaUid', '==', lojistaUid).limit(10).get();
  let primeiro = true;
  antes.forEach((d) => { if (d.data().payId !== payId) primeiro = false; });

  // competência AAAA-MM (data do pagamento; se faltar, agora)
  const quando = pay.confirmedDate || pay.paymentDate || pay.dateCreated || null;
  const competencia = (quando ? new Date(quando) : new Date()).toISOString().slice(0, 7);

  const creditados = new Set(); // não paga o mesmo parceiro 2x no mesmo pagamento

  // Nível 1 (recorrente)
  const p1 = await resolverParceiro(slug1);
  /* AUTO-INDICACAO — 15/09/2026. A trava existia na cadeia de parceiros (a
     regra do Firestore recusa create de parceiro com indicadoPor == slug
     proprio) e NAO existia aqui. Sem ela, o parceiro aprovado abria a propria
     conta de lojista com ?ref=<slug dele> e recebia 15-18% da propria
     mensalidade, todo mes, para sempre — e o upline dele ainda levava N2 e N3
     no primeiro pagamento. Barra o pagamento inteiro, nao so o nivel 1: os
     niveis de cima so existem por causa de uma indicacao que nao vale. */
  if (p1 && p1.uid === lojistaUid) {
    console.warn('comissao: auto-indicacao barrada', lojistaUid, slug1);
    return;
  }
  if (p1 && p1.data.status === 'aprovado' && await parceiroPodeGanhar(p1.uid)) {
    // Nível do parceiro NESTE pagamento (conta o cliente que está pagando agora).
    // O percentual aplicado é o do nível no momento em que a mensalidade entra;
    // comissões já creditadas antes no mesmo mês não são recalculadas.
    const ativos = await contarAtivosDoMes(p1.uid, competencia, lojistaUid);
    const nv = nivelPorAtivos(ativos);
    const pct1 = nv ? nv.pct : PCT_N1_BASE;
    await creditarComissao({ parceiroUid: p1.uid, parceiroSlug: slug1, lojistaUid, nivel: 1, base, pct: pct1, payId, competencia });
    creditados.add(p1.uid);
    await creditarMarco(p1.uid, slug1, nv, competencia);
    await guardarNivel(p1.uid, nv, ativos);
  }

  // Níveis 2 e 3 (bônus único, só no 1º pagamento)
  if (primeiro) {
    const slug2 = p1 ? (p1.data.indicadoPor || '') : '';
    const p2 = slug2 ? await resolverParceiro(slug2) : null;
    if (p2 && p2.uid !== lojistaUid && p2.data.status === 'aprovado' && !creditados.has(p2.uid) && await parceiroPodeGanhar(p2.uid)) {
      await creditarComissao({ parceiroUid: p2.uid, parceiroSlug: slug2, lojistaUid, nivel: 2, base, pct: 0.075, payId, competencia });
      creditados.add(p2.uid);
    }
    const slug3 = p2 ? (p2.data.indicadoPor || '') : '';
    const p3 = slug3 ? await resolverParceiro(slug3) : null;
    if (p3 && p3.uid !== lojistaUid && p3.data.status === 'aprovado' && !creditados.has(p3.uid) && await parceiroPodeGanhar(p3.uid)) {
      await creditarComissao({ parceiroUid: p3.uid, parceiroSlug: slug3, lojistaUid, nivel: 3, base, pct: 0.05, payId, competencia });
      creditados.add(p3.uid);
    }
  }
}

// Mede a venda no GA4 (Measurement Protocol) e na Meta (Conversions API), do
// lado servidor. Deduplicado por faturamento/{uid}/ga/{payId}: o Asaas manda 2
// eventos por pagamento (RECEIVED e CONFIRMED) e reenvia em falha — o .create()
// so passa na 1a vez, entao a venda conta UMA vez nos DOIS.
// NUNCA derruba o webhook (best-effort nos dois lados).
//
// Meta pela CAPI e nao por pixel: o privacidade.html diz que o site nao usa
// cookie de publicidade. Aqui nao ha cookie nenhum — o robo manda o evento com
// o e-mail e o telefone criptografados em SHA-256.
async function registrarPurchase(uid, plano, periodo, pay) {
  const payId = String(pay.id || '');
  if (!payId) return;
  const valor = Number(pay.value) || 0;
  if (!(valor > 0) || periodo === 'trial') return; // trial nao e venda

  // Reserva o slot desta venda. Se ja existe, outro evento do mesmo pagamento
  // ja mediu -> sai sem contar de novo.
  const marcaRef = db.collection('faturamento').doc(uid).collection('ga').doc(payId);
  try {
    await marcaRef.create({ em: admin.firestore.FieldValue.serverTimestamp() });
  } catch (e) {
    return; // ja registrado
  }

  // Ids da sessao GA4 gravados pelo painel no checkout (criar-assinatura.js).
  let cid = '', sid = '';
  try {
    const fat = await db.collection('faturamento').doc(uid).get();
    const f = fat.exists ? (fat.data() || {}) : {};
    cid = f.gaClientId || '';
    sid = f.gaSessionId || '';
  } catch (_) {}

  await ga.purchase({ clientId: cid, sessionId: sid, transactionId: payId, value: valor, plano, periodo });

  // --- Meta (Conversions API) ---
  // Dados de correspondencia: e-mail vem do Auth (nao existe campo de e-mail em
  // negocios/{uid}) e telefone vem do whatsapp do negocio. Os dois sao opcionais:
  // sem nenhum dos dois o lib/meta.js ainda manda com o external_id do uid.
  let email = '', telefone = '';
  try { const u = await admin.auth().getUser(uid); email = (u && u.email) || ''; } catch (_) {}
  try {
    const neg = await db.collection('negocios').doc(uid).get();
    if (neg.exists) telefone = String((neg.data() || {}).whatsapp || '');
  } catch (_) {}

  try {
    await meta.purchase({
      pagamentoId: payId, uid, email, telefone,
      valor, plano, periodo,
    });
  } catch (me) { console.error('meta purchase erro:', me); }
}

// Estorno/chargeback: anula (marca estornada) as comissões daquele pagamento.
async function estornarComissoes(payId) {
  if (!payId) return;
  const qs = await db.collection('comissoes').where('payId', '==', payId).get();
  if (qs.empty) return;
  const bat = db.batch();
  qs.forEach((d) => bat.update(d.ref, {
    estornada: true,
    estornadaEm: admin.firestore.FieldValue.serverTimestamp(),
  }));
  await bat.commit();
}


// ==========================================================
//  TRANSFERÊNCIAS (Pix de comissão saindo da conta Asaas)
//  O Asaas avisa aqui quando o Pix REALMENTE cai (TRANSFER_DONE)
//  ou quando ele falha depois de enviado. Assim o painel fica
//  verdinho sozinho, sem ninguém precisar clicar de novo.
// ==========================================================

const TRANSFER_OK   = ['TRANSFER_DONE'];
const TRANSFER_RUIM = ['TRANSFER_FAILED', 'TRANSFER_CANCELLED', 'TRANSFER_BLOCKED'];

// Acha o saque daquela transferência: primeiro pelo id que gravamos no saque,
// depois pelo externalReference (que é o próprio id do documento de saque).
async function acharSaqueDaTransferencia(tr) {
  const id = String(tr.id || '');
  if (id) {
    const q = await db.collection('saques').where('transferenciaId', '==', id).limit(1).get();
    if (!q.empty) return q.docs[0];
  }
  const ext = String(tr.externalReference || '');
  if (ext) {
    const d = await db.collection('saques').doc(ext).get();
    if (d.exists) return d;
  }
  return null;
}

// Quita as comissões cobertas por um saque (mesma régua do pagar-saque.js:
// do parceiro, não pagas, não estornadas, criadas e liberadas até o pedido).
async function quitarComissoesDoSaque(saqueDoc) {
  const saque = saqueDoc.data() || {};
  const limiteMs = (saque.pedidoEm && typeof saque.pedidoEm.toMillis === 'function')
                     ? saque.pedidoEm.toMillis() : null;
  const cs = await db.collection('comissoes').where('parceiroUid', '==', saque.parceiroUid).get();
  const bat = db.batch();
  let valor = 0, qtd = 0;
  cs.forEach((d) => {
    const c = d.data();
    if (c.pago || c.estornada) return;
    const cMs = (c.criadoEm && typeof c.criadoEm.toMillis === 'function') ? c.criadoEm.toMillis() : null;
    if (limiteMs && cMs && cMs > limiteMs) return;
    const libMs = (c.liberaEm && typeof c.liberaEm.toMillis === 'function') ? c.liberaEm.toMillis() : null;
    if (limiteMs && libMs && libMs > limiteMs) return;
    bat.update(d.ref, {
      pago: true,
      pagoEm: admin.firestore.FieldValue.serverTimestamp(),
      saqueId: saqueDoc.id,
    });
    valor += Number(c.valor) || 0;
    qtd++;
  });
  await bat.commit();
  return { valor: Math.round(valor * 100) / 100, qtd };
}

// Desfaz a baixa: usado quando o Pix falha DEPOIS de já ter sido dado como pago.
async function reabrirComissoesDoSaque(saqueId) {
  const cs = await db.collection('comissoes').where('saqueId', '==', saqueId).get();
  if (cs.empty) return 0;
  const bat = db.batch();
  cs.forEach((d) => bat.update(d.ref, { pago: false, pagoEm: null, saqueId: null }));
  await bat.commit();
  return cs.size;
}

async function tratarTransferencia(tipo, tr) {
  const doc = await acharSaqueDaTransferencia(tr);
  if (!doc) return { ignorado: 'saque nao encontrado' };
  const saque = doc.data() || {};
  const st = String(tr.status || '').toUpperCase();
  const recibo = tr.transactionReceiptUrl || null;

  // Pix caiu de verdade.
  if (TRANSFER_OK.indexOf(tipo) > -1) {
    if (saque.status === 'pago') {
      await doc.ref.update({
        transferenciaStatus: st || 'DONE',
        comprovanteUrl: recibo,
        confirmadoEm: admin.firestore.FieldValue.serverTimestamp(),
      });
      return { jaEstavaPago: true };
    }
    const r = await quitarComissoesDoSaque(doc);
    await doc.ref.update({
      status: 'pago',
      pagoEm: admin.firestore.FieldValue.serverTimestamp(),
      valorPago: r.valor || Number(tr.value) || saque.valorSolicitado || 0,
      comissoesQuitadas: r.qtd,
      formaPagamento: saque.formaPagamento || 'pix_automatico',
      transferenciaId: saque.transferenciaId || String(tr.id || '') || null,
      transferenciaStatus: st || 'DONE',
      comprovante: saque.comprovante || ('Pix Asaas ' + String(tr.id || '')),
      comprovanteUrl: recibo,
      pagamentoEmCursoEm: null,
      confirmadoEm: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { quitado: r.qtd, valor: r.valor };
  }

  // Pix falhou / foi cancelado / bloqueado.
  if (TRANSFER_RUIM.indexOf(tipo) > -1) {
    let reabertas = 0;
    if (saque.status === 'pago') reabertas = await reabrirComissoesDoSaque(doc.id);
    await doc.ref.update({
      status: 'falhou',
      transferenciaStatus: st || tipo,
      ultimoErroPagamento: String(tr.failReason || tipo).slice(0, 200),
      ultimoErroEm: admin.firestore.FieldValue.serverTimestamp(),
      pagamentoEmCursoEm: null,
    });
    return { falhou: true, reabertas: reabertas };
  }

  // Ainda a caminho (criada / pendente / em processamento no banco).
  await doc.ref.update({ transferenciaStatus: st || tipo });
  return { emAndamento: true };
}

/* ===========================================================================
   ENTREGA "PELO MENOS UMA VEZ" E FILA QUE NAO PODE PAUSAR — 14/09/2026
   Doutrina de Seguranca Financeira, artigo 6.

   O Asaas entrega webhook em modelo at-least-once: o MESMO evento chega mais
   de uma vez, e isso e normal. Pior: ele considera falha TUDO que nao for 200
   e, depois de 15 falhas seguidas, PAUSA a fila daquele webhook. Fila pausada
   significa plano que nao liga, comissao que nao credita e pedido preso em
   "aguardando" — tudo calado, ate alguem reparar. Os eventos guardados somem
   em 14 dias.

   O desenho anterior devolvia 500 para o Asaas tentar de novo. Isso funciona
   para uma falha isolada e e exatamente o pior caminho para uma falha
   sistematica: 15 eventos seguidos com erro derrubam a fila inteira.

   Agora:
     1) o evento BRUTO e gravado primeiro, em webhook_eventos/{id}, com create;
     2) evento ja processado com sucesso responde 200 e sai — idempotencia de
        primeira camada, alem da que cada gravacao ja tem;
     3) o processamento roda; deu erro, o documento fica marcado como 'erro',
        o dono recebe aviso no Telegram na hora e a resposta continua sendo 200;
     4) quem tenta de novo e o NOSSO cron (api/webhook-reprocessa.js), de hora
        em hora, e nao o Asaas. A rede de seguranca passou a ser nossa e
        visivel, em vez de depender de uma fila que pausa em silencio.

   Token invalido continua respondendo 401: essa e a barreira, nao um erro de
   processamento.
=========================================================================== */

const EVENTOS_COL = 'webhook_eventos';
const RETOMAR_PROCESSANDO_MS = 3 * 60000;  // travado ha mais de 3 min -> tenta de novo

function idDoEvento(evento) {
  const bruto = String((evento && evento.id) || '').trim();
  if (bruto && /^[A-Za-z0-9:_.-]{6,200}$/.test(bruto)) return bruto;
  // Sem id utilizavel no payload: chave deterministica pelo conteudo, para que
  // o reenvio do mesmo evento caia no MESMO documento.
  const base = JSON.stringify({
    e: (evento && evento.event) || null,
    p: (evento && evento.payment && evento.payment.id) || null,
    t: (evento && evento.transfer && evento.transfer.id) || null,
    s: (evento && evento.payment && evento.payment.status) || null,
    d: (evento && evento.dateCreated) || null,
  });
  return 'h_' + crypto.createHash('sha256').update(base).digest('hex').slice(0, 40);
}

// Aviso imediato ao dono. Nunca derruba o webhook.
async function avisarDono(texto) {
  const TOKEN = process.env.TELEGRAM_TOKEN;
  const CHAT = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT) return;
  try {
    await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text: texto, disable_web_page_preview: true }),
    });
  } catch (_) {}
}

/* 23/09/2026 — De qual plano e o pagamento? Em ordem de confianca:
   1. o registro que o criar-assinatura gravou para AQUELA assinatura
      (faturamento/{uid}.assinaturasAsaas.{id});
   2. a propria assinatura no Asaas, casando valor + ciclo com a tabela PLANOS;
   3. (legado, assinatura criada antes de 23/09) o plano/periodo de
      assinaturas/{uid}, se for um periodo pago valido.
   Sem resposta confiavel devolve null — quem chamou lanca erro (reprocessa e
   avisa), em vez de liberar um plano no chute. */
function casarPlano(valor, ciclo) {
  const v = Math.round(Number(valor) * 100);
  const c = String(ciclo || '').toUpperCase();
  for (const pl of Object.keys(PLANOS)) {
    for (const pe of Object.keys(PLANOS[pl])) {
      const cfg = PLANOS[pl][pe];
      if (Math.round(cfg.value * 100) === v && (!c || cfg.cycle === c)) return { plano: pl, periodo: pe };
    }
  }
  return null;
}

async function planoDaAssinatura(uid, subId, fat, atualDoc, pay) {
  const valido = (pl, pe) => !!(pl && pe && PLANOS[pl] && PLANOS[pl][pe]);
  const mapa = (fat && fat.assinaturasAsaas) || {};
  if (subId && mapa[subId] && valido(mapa[subId].plano, mapa[subId].periodo)) {
    return { plano: mapa[subId].plano, periodo: mapa[subId].periodo, fonte: 'registro' };
  }
  if (subId) {
    try {
      const s = await asaas('/subscriptions/' + encodeURIComponent(subId), 'GET');
      if (s && String(s.externalReference || '') === String(uid)) {
        const m = casarPlano(s.value, s.cycle);
        if (m) return Object.assign(m, { fonte: 'asaas' });
      }
    } catch (e) { console.error('webhook: nao li a assinatura no Asaas', subId, (e && e.message) || e); }
  }
  if (atualDoc && valido(atualDoc.plano, atualDoc.periodo)) {
    return { plano: atualDoc.plano, periodo: atualDoc.periodo, fonte: 'legado' };
  }
  return null;
}

/* Miolo do webhook, isolado do req/res de proposito: o reprocessador chama
   esta mesma funcao. Erro aqui SOBE — quem decide o que fazer com ele e quem
   chamou. */
async function processarEvento(evento, ctx) {
  const tipo = evento.event;
  /* Sem ctx = chamada do reprocessador (api/webhook-reprocessa.js), que so
     mexe em evento ja autenticado e ja gravado. Evento recusado por escopo
     nunca chega la: ele e marcado 'ok', nao 'erro'. */
  const escopo = (ctx && ctx.escopo) || 'mae';
  const uidToken = (ctx && ctx.uid) || '';
  const soPedido = (escopo === 'subconta' || escopo === 'legado');

  // Evento de TRANSFERENCIA (Pix de comissao saindo daqui).
  if (evento.transfer || String(tipo || '').indexOf('TRANSFER_') === 0) {
    if (soPedido) return { ok: true, recusado: 'escopo', escopo, tratado: 'transferencia' };
    const r = await tratarTransferencia(tipo, evento.transfer || {});
    return Object.assign({ ok: true, tratado: 'transferencia' }, r);
  }

  /* 23/09/2026: o token de TRANSFERENCIA so fala de TRANSFER_*. Antes ele
     passava pelos ramos de assinatura, ponto e pedido — quem tivesse esse
     token cortava o plano de qualquer uid (os eventos de desligar nao sao
     reconferidos no Asaas). */
  if (escopo === 'transfer') return { ok: true, recusado: 'escopo', escopo };

  const pay = evento.payment || {};
  const uid = pay.externalReference; // gravamos o uid na assinatura -> volta aqui

  // PEDIDO (11/09/2026): externalReference = "pedido:<id>". Tem que ser tratado
  // AQUI, antes de tudo: sem este desvio, o codigo de baixo leria o "pedido:..."
  // como uid e gravaria uma assinatura falsa em assinaturas/{pedido:...}.
  if (typeof uid === 'string' && uid.startsWith('pedido:')) {
    /* Token de subconta so fala do pedido DAQUELA subconta. Confere o dono
       antes de deixar passar — senao um lojista com o proprio token mexeria no
       pedido de outro. O valor em si continua sendo reconferido no Asaas la
       dentro (confirmarNoAsaas). */
    if (escopo === 'subconta') {
      const pid = uid.slice(7);
      let dono = '';
      try {
        const s = await db.collection('pedidos').doc(String(pid).slice(0, 60)).get();
        dono = s.exists ? String((s.data() || {}).lojistaUid || '') : '';
      } catch (_) {}
      if (!dono || dono !== uidToken) {
        console.warn('webhook: pedido de outro lojista recusado', pid, uidToken);
        return { ok: true, recusado: 'dono', tratado: 'pedido' };
      }
    }
    const r = await checkout.webhookPedido(tipo, pay);
    return Object.assign({ ok: true, tratado: 'pedido' }, r);
  }

  /* Daqui para baixo e dinheiro do Moviki: assinatura, ponto extra e comissao.
     So o token da conta MAE fala aqui. */
  if (soPedido) return { ok: true, recusado: 'escopo', escopo };

  // Ponto extra do Enterprise: externalReference = "ponto:<pid>".
  // Liga/desliga so o ponto (pontos/{pid}.ativo) — NAO mexe em plano nem comissao.
  if (typeof uid === 'string' && uid.startsWith('ponto:')) {
    const pid = uid.slice(6);
    if (!pid || (!LIGA.includes(tipo) && !DESLIGA.includes(tipo))) {
      return { ok: true, ignorado: true };
    }
    const ativo = LIGA.includes(tipo);
    await db.collection('pontos').doc(pid).set({
      ativo,
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, ponto: pid, ativo };
  }

  // Evento que nao interessa ou sem uid.
  if (!uid || (!LIGA.includes(tipo) && !DESLIGA.includes(tipo))) {
    return { ok: true, ignorado: true };
  }

  /* RECONFERENCIA — 15/09/2026. Nada abaixo daqui usa numero vindo do corpo da
     requisicao. O Asaas e a fonte: valor, status e a que uid o pagamento
     pertence. Sem confirmacao, nao liga nada (falha fechada). */
  let payReal = pay;
  if (LIGA.includes(tipo)) {
    const conf = await conferirPagamentoNaMae(pay.id);
    /* 23/09/2026: antes devolvia {ok:false} e o evento era gravado como 'ok'
       — o reprocessador nunca tentava de novo. No Pix chega UM evento so: um
       soluco do Asaas na hora da consulta e o cliente pagava sem o plano ligar.
       Agora o erro SOBE: o evento fica 'erro', o Paulo e avisado no Telegram e
       o cron de hora em hora tenta de novo. Continua falhando FECHADO. */
    if (!conf) throw new Error('pagamento ' + String(pay.id || '?') + ' nao confirmado no Asaas (consulta falhou) — vai reprocessar');
    const st = String(conf.status || '').toUpperCase();
    if (st !== 'RECEIVED' && st !== 'CONFIRMED') {
      console.warn('webhook: evento de LIGA sem pagamento no Asaas', pay.id, st);
      return { ok: true, recusado: 'status_asaas', status: st, uid };
    }
    if (String(conf.externalReference || '') !== String(uid)) {
      console.warn('webhook: externalReference divergente', pay.id, conf.externalReference, uid);
      return { ok: true, recusado: 'referencia', uid };
    }
    payReal = conf;
  }

  const ref = db.collection('assinaturas').doc(uid);
  const snap = await ref.get();
  const atualDoc = snap.exists ? (snap.data() || {}) : {};

  /* 23/09/2026 — A ASSINATURA QUE FOI PAGA MANDA.
     Antes o plano liberado era o de assinaturas/{uid} (o ULTIMO clique), e
     qualquer aviso de qualquer assinatura do lojista ligava ou desligava tudo.
     Agora:
       - evento de DESLIGAR de uma assinatura que NAO e a atual (a abandonada,
         ou a que o proprio robo cancelou ao gerar a nova) nao corta nada;
       - evento de LIGAR libera o plano/periodo DAQUELA assinatura. */
  const subPaga = String((payReal && payReal.subscription) || (pay && pay.subscription) || '');
  let fat = {};
  try {
    const fs = await db.collection('faturamento').doc(uid).get();
    fat = fs.exists ? (fs.data() || {}) : {};
  } catch (_) { fat = {}; }
  const subAtual = String(fat.asaasSubscriptionId || '');
  const deOutraAssinatura = !!(subPaga && subAtual && subPaga !== subAtual);

  if (!LIGA.includes(tipo) && deOutraAssinatura) {
    // Estorno/chargeback de pagamento antigo ainda anula a comissao DELE,
    // mas nao derruba o plano pago pela assinatura atual.
    try {
      if (tipo === 'PAYMENT_REFUNDED' || tipo === 'PAYMENT_CHARGEBACK_REQUESTED') {
        await estornarComissoes(String(pay.id || ''));
      }
    } catch (ce) { console.error('estorno comissao erro:', ce); }
    return { ok: true, ignorado: 'assinatura_antiga', uid, tipo, sub: subPaga };
  }

  if (LIGA.includes(tipo)) {
    const pp = await planoDaAssinatura(uid, subPaga, fat, atualDoc, payReal);
    if (!pp) {
      throw new Error('pagamento ' + String(payReal.id || '?') + ' confirmado, mas nao consegui saber de qual plano (assinatura ' + (subPaga || '?') + ') — confira no Asaas');
    }
    const plano = pp.plano;
    const periodo = pp.periodo;
    if (deOutraAssinatura) {
      await avisarDono(
        '⚠️ Pagamento de assinatura ANTIGA\n\n' +
        'Lojista (uid): ' + uid + '\n' +
        'Assinatura paga: ' + subPaga + ' (' + plano + ' ' + periodo + ')\n' +
        'Assinatura atual: ' + subAtual + '\n\n' +
        'O plano foi liberado pelo que ele pagou. Confira no Asaas se a outra assinatura precisa ser cancelada, para nao cobrar em dobro.'
      );
    }

    const dias = (PLANOS[plano] && PLANOS[plano][periodo] && PLANOS[plano][periodo].dias) || 31;
    /* Quem paga DURANTE o teste gratis nao perde os dias que faltam: conta a
       partir do fim do teste. Nos demais casos, a partir de hoje (como antes). */
    let base = Date.now();
    const venceAtualMs = (atualDoc.vence_em && typeof atualDoc.vence_em.toMillis === 'function') ? atualDoc.vence_em.toMillis() : 0;
    if (atualDoc.periodo === 'trial' && atualDoc.ativo === true && venceAtualMs > base) base = venceAtualMs;
    const vence = new Date(base);
    vence.setDate(vence.getDate() + dias + 3); // +3 dias de folga
    await ref.set({
      plano,
      periodo,
      ativo: true,
      vence_em: admin.firestore.Timestamp.fromDate(vence),
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Comissao do Programa de Parceiros. Roda depois da ativacao e NUNCA a
    // derruba: se der erro no calculo, o plano do lojista ja ficou ativo.
    try { await acumularComissoes(uid, periodo, payReal); }
    catch (ce) { console.error('comissao erro:', ce); }

    // GA4 + Meta: mede a venda (server-side, deduplicado). Nunca derruba o webhook.
    try { await registrarPurchase(uid, plano, periodo, payReal); }
    catch (ge) { console.error('purchase medicao erro:', ge); }
  } else {
    await ref.set({
      ativo: false,
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Estorno ou chargeback -> anula a comissao daquele pagamento (clawback).
    // Vencimento/exclusao comum NAO estornam comissao de meses ja pagos.
    try {
      if (tipo === 'PAYMENT_REFUNDED' || tipo === 'PAYMENT_CHARGEBACK_REQUESTED') {
        await estornarComissoes(String(pay.id || ''));
      }
    } catch (ce) { console.error('estorno comissao erro:', ce); }
  }

  return { ok: true, tratado: 'assinatura', uid, tipo };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  // 1) Confirma que a chamada veio MESMO do Asaas E descobre COM QUE PODERES.
  //    O token nao e mais so um cracha de entrada: ele diz o que pode ser
  //    feito. Ver o bloco de comentario no topo do arquivo.
  const token = String(req.headers['asaas-access-token'] || '');
  const ctx = await escopoDoToken(token);
  if (!ctx) return res.status(401).end();

  const evento = req.body || {};
  const eid = idDoEvento(evento);
  const evRef = db.collection(EVENTOS_COL).doc(eid);
  const FV = admin.firestore.FieldValue;

  // 2) Persiste o evento BRUTO antes de qualquer regra de negocio. E a copia
  //    crua que permite pericia e reprocessamento depois de um incidente.
  let jaExiste = null;
  try {
    await evRef.create({
      evento: String(evento.event || ''),
      payload: evento,
      escopo: ctx.escopo,
      escopoUid: ctx.uid || '',
      status: 'processando',
      tentativas: 1,
      recebidoEm: FV.serverTimestamp(),
      atualizadoEm: FV.serverTimestamp(),
    });
  } catch (_) {
    try { const s = await evRef.get(); jaExiste = s.exists ? s.data() : null; } catch (__) {}
  }

  if (jaExiste) {
    // Ja processado com sucesso: nao repete nada e responde 200.
    if (jaExiste.status === 'ok') return res.status(200).json({ ok: true, repetido: true, id: eid });
    // Travado em 'processando' ha pouco tempo: outra execucao esta cuidando.
    const desde = jaExiste.atualizadoEm && jaExiste.atualizadoEm.toMillis ? jaExiste.atualizadoEm.toMillis() : 0;
    if (jaExiste.status === 'processando' && desde && (Date.now() - desde) < RETOMAR_PROCESSANDO_MS) {
      return res.status(200).json({ ok: true, emCurso: true, id: eid });
    }
    try {
      await evRef.update({ status: 'processando', tentativas: FV.increment(1), atualizadoEm: FV.serverTimestamp() });
    } catch (__) {}
  }

  // 3) Processa. Qualquer erro fica registrado e vira aviso — mas a resposta
  //    para o Asaas continua sendo 200, para a fila nunca pausar.
  try {
    const r = await processarEvento(evento, ctx);
    try { await evRef.update({ status: 'ok', resultado: r || null, concluidoEm: FV.serverTimestamp(), atualizadoEm: FV.serverTimestamp() }); } catch (_) {}
    return res.status(200).json(Object.assign({ ok: true, id: eid }, r || {}));
  } catch (e) {
    const msg = (e && e.message) ? String(e.message).slice(0, 400) : 'erro';
    console.error('webhook erro:', e);
    try { await evRef.update({ status: 'erro', erro: msg, atualizadoEm: FV.serverTimestamp() }); } catch (_) {}
    await avisarDono(
      '🚨 Webhook do Asaas falhou\n\n' +
      'Evento: ' + String(evento.event || '?') + '\n' +
      'Id: ' + eid + '\n' +
      'Erro: ' + msg + '\n\n' +
      'Guardado em webhook_eventos. O reprocessamento roda de hora em hora.'
    );
    // 200 de proposito: ver o bloco de comentario no topo desta secao.
    return res.status(200).json({ ok: false, guardado: true, id: eid });
  }
};

module.exports.processarEvento = processarEvento;
module.exports.EVENTOS_COL = EVENTOS_COL;
