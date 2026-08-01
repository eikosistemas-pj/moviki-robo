// POST /api/webhook
// O Asaas chama isso sozinho toda vez que um pagamento muda de status.
// Aqui a gente LIGA o plano quando o pagamento entra e DESLIGA quando vence
// ou e cancelado — e o corte automatico do inadimplente.

const { admin, db } = require('../lib/firebase');
const { PLANOS } = require('../lib/asaas');

// Pagamento entrou -> liga o plano
const LIGA = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'];
// Venceu / apagado / estornado / chargeback -> desliga (cai pra Basico)
const DESLIGA = ['PAYMENT_OVERDUE', 'PAYMENT_DELETED', 'PAYMENT_REFUNDED', 'PAYMENT_CHARGEBACK_REQUESTED'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();

  // 1) Confirma que a chamada veio MESMO do Asaas: o token que a gente configura
  //    no painel do Asaas vem no header abaixo. Sem ele bater, ignora.
  const token = req.headers['asaas-access-token'];
  if (!process.env.ASAAS_WEBHOOK_TOKEN || token !== process.env.ASAAS_WEBHOOK_TOKEN) {
    return res.status(401).end();
  }

  try {
    const evento = req.body || {};
    const tipo = evento.event;
    const pay = evento.payment || {};
    const uid = pay.externalReference; // gravamos o uid na assinatura -> volta aqui

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
    } else {
      await ref.set({
        ativo: false,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    // Devolve 500 pro Asaas tentar de novo (nao perder ativacao por erro nosso).
    console.error('webhook erro:', e);
    return res.status(500).json({ erro: e.message });
  }
};
