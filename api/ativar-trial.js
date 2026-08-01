// POST /api/ativar-trial
// Da 30 dias de Pro gratis pro lojista que acabou de se cadastrar.
// So concede UMA vez por conta (se ja existe registro em assinaturas, nao repete).

const { admin, db } = require('../lib/firebase');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://moviki.com.br');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Metodo nao permitido' });

  try {
    // Confirma quem e pelo token do Firebase (nao aceita uid solto).
    const authz = req.headers.authorization || '';
    const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : null;
    if (!idToken) return res.status(401).json({ erro: 'Faca login.' });
    const { uid } = await admin.auth().verifyIdToken(idToken);

    const ref = db.collection('assinaturas').doc(uid);
    const snap = await ref.get();
    // Trial so uma vez: se ja existe qualquer registro, nao concede de novo.
    if (snap.exists) return res.status(200).json({ ok: true, jaExiste: true });

    const vence = new Date();
    vence.setDate(vence.getDate() + 30);
    await ref.set({
      plano: 'pro',
      periodo: 'trial',
      ativo: true,
      origem: 'trial',
      vence_em: admin.firestore.Timestamp.fromDate(vence),
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.status(200).json({ ok: true, trial: true });
  } catch (e) {
    return res.status(500).json({ erro: e.message || 'Erro ao ativar trial' });
  }
};
