// api/comissao-teste.js  (repo: moviki-robo)
// Cria UMA comissão de teste para um parceiro, só para ensaiar o pagamento por
// Pix sem depender de um lojista pagar de verdade.
//
// Só ADMIN (documento em /admins/{uid}) — conferido aqui no servidor.
// Guardas: valor entre R$ 0,01 e R$ 10,00; o parceiro tem que existir; o
// documento nasce marcado com teste:true (fácil de achar e apagar depois).
//
// A comissão nasce SEM o campo liberaEm, ou seja, já liberada para saque
// (as comissões de verdade ficam 7 dias retidas — isso não muda nada aqui).

const { admin, db } = require('../lib/firebase');

const ORIGIN_OK = 'https://app.moviki.com.br';
const VALOR_MAX = 10;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_OK);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ ok: false }); return; }

  try {
    const body        = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const idToken     = String(body.idToken || '');
    const parceiroUid = String(body.parceiroUid || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const valor       = Math.round((Number(body.valor) || 0) * 100) / 100;
    if (!idToken || !parceiroUid) { res.status(400).json({ ok: false, erro: 'faltam dados' }); return; }

    let decoded;
    try { decoded = await admin.auth().verifyIdToken(idToken); }
    catch (_) { res.status(401).json({ ok: false, erro: 'sessao invalida' }); return; }
    const adminDoc = await db.collection('admins').doc(decoded.uid).get();
    if (!adminDoc.exists) { res.status(403).json({ ok: false, erro: 'sem permissao' }); return; }

    if (!(valor > 0) || valor > VALOR_MAX) {
      res.status(422).json({ ok: false, erro: 'valor_invalido',
        mensagem: 'Use um valor entre R$ 0,01 e R$ ' + VALOR_MAX + ',00 para o teste.' });
      return;
    }

    const parcSnap = await db.collection('parceiros').doc(parceiroUid).get();
    if (!parcSnap.exists) { res.status(404).json({ ok: false, erro: 'parceiro nao encontrado' }); return; }
    const parceiro = parcSnap.data();

    const agora = new Date();
    const competencia = agora.getUTCFullYear() + '-' + String(agora.getUTCMonth() + 1).padStart(2, '0');
    const marca = 'TESTE_' + Date.now();

    const ref = db.collection('comissoes').doc(marca + '_n1');
    await ref.create({
      parceiroUid: parceiroUid,
      parceiroSlug: parceiro.slug || null,
      lojistaUid: 'TESTE',
      nivel: 1,
      base: valor,
      percentual: 100,
      valor: valor,
      payId: marca,
      competencia: competencia,
      pago: false,
      estornada: false,
      teste: true,
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),
      criadaPor: decoded.uid,
    });

    res.status(200).json({ ok: true, id: ref.id, valor: valor, parceiro: parceiro.nome || '' });
  } catch (e) {
    console.error('comissao-teste erro:', e);
    res.status(500).json({ ok: false, erro: 'erro interno' });
  }
};
