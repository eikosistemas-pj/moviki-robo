// POST /api/webhook
// O Asaas chama isso sozinho toda vez que um pagamento muda de status.
// Aqui a gente LIGA o plano quando o pagamento entra e DESLIGA quando vence
// ou e cancelado — e o corte automatico do inadimplente.

const { admin, db } = require('../lib/firebase');
const { PLANOS } = require('../lib/asaas');
const crypto = require('crypto');

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
  if (p1 && p1.data.status === 'aprovado') {
    await creditarComissao({ parceiroUid: p1.uid, parceiroSlug: slug1, lojistaUid, nivel: 1, base, pct: 0.15, payId, competencia });
    creditados.add(p1.uid);
  }

  // Níveis 2 e 3 (bônus único, só no 1º pagamento)
  if (primeiro) {
    const slug2 = p1 ? (p1.data.indicadoPor || '') : '';
    const p2 = slug2 ? await resolverParceiro(slug2) : null;
    if (p2 && p2.data.status === 'aprovado' && !creditados.has(p2.uid)) {
      await creditarComissao({ parceiroUid: p2.uid, parceiroSlug: slug2, lojistaUid, nivel: 2, base, pct: 0.075, payId, competencia });
      creditados.add(p2.uid);
    }
    const slug3 = p2 ? (p2.data.indicadoPor || '') : '';
    const p3 = slug3 ? await resolverParceiro(slug3) : null;
    if (p3 && p3.data.status === 'aprovado' && !creditados.has(p3.uid)) {
      await creditarComissao({ parceiroUid: p3.uid, parceiroSlug: slug3, lojistaUid, nivel: 3, base, pct: 0.05, payId, competencia });
      creditados.add(p3.uid);
    }
  }
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

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  // 1) Confirma que a chamada veio MESMO do Asaas: o token que a gente configura
  //    no painel do Asaas vem no header abaixo. Sem ele bater, ignora.
  // Comparacao em tempo constante pra nao vazar o token por medicao de tempo.
  const token = String(req.headers['asaas-access-token'] || '');
  const esperado = process.env.ASAAS_WEBHOOK_TOKEN || '';
  const tBuf = Buffer.from(token), eBuf = Buffer.from(esperado);
  const tokenOk = esperado.length > 0 && tBuf.length === eBuf.length && crypto.timingSafeEqual(tBuf, eBuf);
  if (!tokenOk) return res.status(401).end();

  try {
    const evento = req.body || {};
    const tipo = evento.event;
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
