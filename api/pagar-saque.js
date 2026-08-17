// api/pagar-saque.js  (repo: moviki-robo)
// Marca um pedido de saque como PAGO. Só um ADMIN (documento em /admins/{uid})
// consegue — a permissão é verificada AQUI no servidor, não dá pra burlar pelo app.
// Usa o Admin SDK: confere o ID token, confirma que é admin, quita as comissões
// cobertas por aquele saque (as não pagas / não estornadas até a data do pedido)
// e grava o saque como pago, com comprovante opcional.

const { admin, db } = require('../lib/firebase');

const ORIGIN_OK = 'https://app.moviki.com.br';

module.exports = async (req, res) => {
  // CORS (o painel roda em app.moviki.com.br)
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_OK);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ ok: false }); return; }

  try {
    const body        = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const idToken     = String(body.idToken || '');
    const saqueId     = String(body.saqueId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const comprovante = String(body.comprovante || '').slice(0, 200);
    if (!idToken || !saqueId) { res.status(400).json({ ok: false, erro: 'faltam dados' }); return; }

    // 1) Quem está chamando? E é admin de verdade?
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(idToken); }
    catch (_) { res.status(401).json({ ok: false, erro: 'sessao invalida' }); return; }
    const adminDoc = await db.collection('admins').doc(decoded.uid).get();
    if (!adminDoc.exists) { res.status(403).json({ ok: false, erro: 'sem permissao' }); return; }

    // 2) Carrega o saque.
    const saqueRef  = db.collection('saques').doc(saqueId);
    const saqueSnap = await saqueRef.get();
    if (!saqueSnap.exists) { res.status(404).json({ ok: false, erro: 'saque nao encontrado' }); return; }
    const saque = saqueSnap.data();
    if (saque.status === 'pago') { res.status(200).json({ ok: true, jaPago: true, valorPago: saque.valorPago || 0 }); return; }

    const parceiroUid = saque.parceiroUid;
    const limiteMs = (saque.pedidoEm && typeof saque.pedidoEm.toMillis === 'function') ? saque.pedidoEm.toMillis() : null;

    // 3) Quita as comissões desse parceiro: não pagas, não estornadas, criadas
    //    até a data do pedido de saque (as que vierem depois ficam pro próximo).
    const cs = await db.collection('comissoes').where('parceiroUid', '==', parceiroUid).get();
    const batch = db.batch();
    let valorPago = 0, qtd = 0;
    cs.forEach((d) => {
      const c = d.data();
      if (c.pago || c.estornada) return;
      const cMs = (c.criadoEm && typeof c.criadoEm.toMillis === 'function') ? c.criadoEm.toMillis() : null;
      if (limiteMs && cMs && cMs > limiteMs) return;
      // Comissão ainda em retenção quando o saque foi pedido não entra (liberaEm ausente = já liberada).
      const libMs = (c.liberaEm && typeof c.liberaEm.toMillis === 'function') ? c.liberaEm.toMillis() : null;
      if (limiteMs && libMs && libMs > limiteMs) return;
      batch.update(d.ref, {
        pago: true,
        pagoEm: admin.firestore.FieldValue.serverTimestamp(),
        saqueId: saqueId,
      });
      valorPago += Number(c.valor) || 0;
      qtd++;
    });
    valorPago = Math.round(valorPago * 100) / 100;

    batch.update(saqueRef, {
      status: 'pago',
      pagoEm: admin.firestore.FieldValue.serverTimestamp(),
      valorPago: valorPago,
      comissoesQuitadas: qtd,
      comprovante: comprovante || null,
      pagoPor: decoded.uid,
    });
    await batch.commit();

    res.status(200).json({ ok: true, valorPago, qtd });
  } catch (e) {
    console.error('pagar-saque erro:', e);
    res.status(500).json({ ok: false, erro: 'erro interno' });
  }
};
