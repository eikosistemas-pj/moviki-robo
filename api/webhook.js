// POST /api/webhook
// O Asaas chama isso sozinho toda vez que um pagamento muda de status.
// Aqui a gente LIGA o plano quando o pagamento entra e DESLIGA quando vence
// ou e cancelado — e o corte automatico do inadimplente.

const { admin, db } = require('../lib/firebase');
const { PLANOS } = require('../lib/asaas');
const crypto = require('crypto');
const ga = require('../lib/ga');
const meta = require('../lib/meta');

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
//  N1 = 15% recorrente (todo pagamento). N2 = 7,5% e N3 = 5%
//  SÓ no 1º pagamento do lojista (bônus único). Só acumula pra
//  parceiro APROVADO. Base = valor realmente pago.
// ==========================================================

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
  if (p1 && p1.data.status === 'aprovado' && await parceiroPodeGanhar(p1.uid)) {
    await creditarComissao({ parceiroUid: p1.uid, parceiroSlug: slug1, lojistaUid, nivel: 1, base, pct: 0.15, payId, competencia });
    creditados.add(p1.uid);
  }

  // Níveis 2 e 3 (bônus único, só no 1º pagamento)
  if (primeiro) {
    const slug2 = p1 ? (p1.data.indicadoPor || '') : '';
    const p2 = slug2 ? await resolverParceiro(slug2) : null;
    if (p2 && p2.data.status === 'aprovado' && !creditados.has(p2.uid) && await parceiroPodeGanhar(p2.uid)) {
      await creditarComissao({ parceiroUid: p2.uid, parceiroSlug: slug2, lojistaUid, nivel: 2, base, pct: 0.075, payId, competencia });
      creditados.add(p2.uid);
    }
    const slug3 = p2 ? (p2.data.indicadoPor || '') : '';
    const p3 = slug3 ? await resolverParceiro(slug3) : null;
    if (p3 && p3.data.status === 'aprovado' && !creditados.has(p3.uid) && await parceiroPodeGanhar(p3.uid)) {
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

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  // 1) Confirma que a chamada veio MESMO do Asaas: o token que a gente configura
  //    no painel do Asaas vem no header abaixo. Sem ele bater, ignora.
  // Comparacao em tempo constante pra nao vazar o token por medicao de tempo.
  // Aceita DOIS tokens: o de sempre (cobrancas) e um segundo, opcional, para o
  // webhook de transferencias. Assim da pra cadastrar um webhook novo no Asaas
  // com token proprio sem precisar descobrir nem trocar o token antigo.
  const token = String(req.headers['asaas-access-token'] || '');
  const aceitos = [process.env.ASAAS_WEBHOOK_TOKEN, process.env.ASAAS_WEBHOOK_TOKEN_TRANSFER]
    .filter(function (x) { return typeof x === 'string' && x.length > 0; });
  const tBuf = Buffer.from(token);
  const tokenOk = aceitos.some(function (esperado) {
    const eBuf = Buffer.from(esperado);
    return tBuf.length === eBuf.length && crypto.timingSafeEqual(tBuf, eBuf);
  });
  if (!tokenOk) return res.status(401).end();

  try {
    const evento = req.body || {};
    const tipo = evento.event;

    // Evento de TRANSFERÊNCIA (Pix de comissão saindo daqui) — trata e sai.
    if (evento.transfer || String(tipo || '').indexOf('TRANSFER_') === 0) {
      try {
        const r = await tratarTransferencia(tipo, evento.transfer || {});
        return res.status(200).json(Object.assign({ ok: true }, r));
      } catch (te) {
        console.error('transferencia webhook erro:', te);
        return res.status(500).json({ erro: te.message });
      }
    }

    const pay = evento.payment || {};
    const uid = pay.externalReference; // gravamos o uid na assinatura -> volta aqui

    // Ponto extra do Enterprise: externalReference = "ponto:<pid>".
    // Liga/desliga só o ponto (pontos/{pid}.ativo) — NÃO mexe em plano nem comissão.
    if (typeof uid === 'string' && uid.startsWith('ponto:')) {
      const pid = uid.slice(6);
      if (!pid || (!LIGA.includes(tipo) && !DESLIGA.includes(tipo))) {
        return res.status(200).json({ ok: true, ignorado: true });
      }
      const ativo = LIGA.includes(tipo);
      try {
        await db.collection('pontos').doc(pid).set({
          ativo,
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      } catch (e) { console.error('ponto webhook erro:', e); return res.status(500).json({ erro: e.message }); }
      return res.status(200).json({ ok: true, ponto: pid, ativo });
    }

    // Evento que nao interessa ou sem uid: responde OK e ignora.
    if (!uid || (!LIGA.includes(tipo) && !DESLIGA.includes(tipo))) {
      return res.status(200).json({ ok: true, ignorado: true });
    }

    const ref = db.collection('assinaturas').doc(uid);
    const snap = await ref.get();
    const periodo = (snap.exists && snap.data().periodo) || 'mensal';
    const plano = (snap.exists && snap.data().plano) || 'pro';

    if (LIGA.includes(tipo)) {
      const dias = (PLANOS[plano] && PLANOS[plano][periodo] && PLANOS[plano][periodo].dias) || 31;
      const vence = new Date();
      vence.setDate(vence.getDate() + dias + 3); // +3 dias de folga
      await ref.set({
        ativo: true,
        vence_em: admin.firestore.Timestamp.fromDate(vence),
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // Comissão do Programa de Parceiros. Roda depois da ativação e NUNCA a
      // derruba: se der erro no cálculo, o plano do lojista já ficou ativo.
      try { await acumularComissoes(uid, periodo, pay); }
      catch (ce) { console.error('comissao erro:', ce); }

      // GA4 + Meta: mede a venda (server-side, deduplicado). Nunca derruba o webhook.
      try { await registrarPurchase(uid, plano, periodo, pay); }
      catch (ge) { console.error('purchase medicao erro:', ge); }
    } else {
      await ref.set({
        ativo: false,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // Estorno ou chargeback -> anula a comissão daquele pagamento (clawback).
      // Vencimento/exclusão comum NÃO estornam comissão de meses já pagos.
      try {
        if (tipo === 'PAYMENT_REFUNDED' || tipo === 'PAYMENT_CHARGEBACK_REQUESTED') {
          await estornarComissoes(String(pay.id || ''));
        }
      } catch (ce) { console.error('estorno comissao erro:', ce); }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    // Devolve 500 pro Asaas tentar de novo (nao perder ativacao por erro nosso).
    console.error('webhook erro:', e);
    return res.status(500).json({ erro: e.message });
  }
};
