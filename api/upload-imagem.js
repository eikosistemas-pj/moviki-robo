// api/upload-imagem.js  (repo: moviki-robo)
// Recebe uma imagem (base64) do painel do lojista e sobe no Firebase Storage.
// Dois modos:
//   - tipo 'logo' (padrão): grava a URL em negocios/{uid}.markerLogo (logo do pino).
//   - tipo 'produto': NÃO grava nada; só devolve a URL. Quem guarda a URL no item
//     do cardápio é o painel, na hora de salvar (a foto vive dentro do array
//     negocios/{uid}.cardapio, então não passa por aqui pra gravar).
// Segurança: o idToken identifica o lojista; ele só mexe nos dados DELE.
// O upload usa Admin SDK (service account) — bypassa regras do Storage/Firestore.
//
// Env necessária no Vercel (projeto moviki-robo): FIREBASE_SERVICE_ACCOUNT
// (IMGBB_API_KEY não é mais necessária — removida)

const { db, admin } = require('../lib/firebase');

const ORIGIN_OK = 'https://app.moviki.com.br';
const MAX_B64 = 2800000; // ~2 MB de base64 (imagem já vem comprimida do navegador)

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_OK);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ ok: false }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const idToken = String(body.idToken || '');
    const imagemBase64 = String(body.imagemBase64 || '');
    const tipo = String(body.tipo || 'logo'); // 'logo' | 'produto'
    if (!idToken || !imagemBase64) { res.status(400).json({ ok: false, erro: 'faltam dados' }); return; }
    if (imagemBase64.length > MAX_B64) { res.status(413).json({ ok: false, erro: 'imagem muito grande' }); return; }

    // Quem é o lojista?
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(idToken); }
    catch (_) { res.status(401).json({ ok: false, erro: 'sessao invalida' }); return; }

    // tira o prefixo "data:image/...;base64," se vier
    const b64 = imagemBase64.includes(',') ? imagemBase64.split(',').pop() : imagemBase64;

    const ehProduto = tipo === 'produto';
    const pasta = ehProduto ? 'produtos' : 'logos';
    const fileName = `${pasta}/${decoded.uid}/${Date.now()}.jpg`;

    // Upload para Firebase Storage via Admin SDK
    const bucket = admin.storage().bucket();
    const buffer = Buffer.from(b64, 'base64');
    const file = bucket.file(fileName);

    await file.save(buffer, {
      metadata: {
        contentType: 'image/jpeg',
        cacheControl: 'public,max-age=31536000', // 1 ano
      },
      public: true, // torna o arquivo público (qualquer um com a URL acessa)
    });

    // URL pública do Firebase Storage
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(fileName)}?alt=media`;

    if (ehProduto) {
      // foto de produto: só devolve a URL (o painel guarda dentro do cardapio ao salvar)
      res.status(200).json({ ok: true, url });
      return;
    }

    // logo do pino: grava no doc do próprio lojista (Admin SDK -- não depende das regras)
    await db.collection('negocios').doc(decoded.uid).set({ markerLogo: url }, { merge: true });
    res.status(200).json({ ok: true, url });
  } catch (e) {
    console.error('upload-imagem erro:', e);
    res.status(500).json({ ok: false, erro: 'erro interno' });
  }
};