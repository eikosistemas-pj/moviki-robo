// api/upload-imagem.js  (repo: moviki-robo)
// Recebe uma imagem (base64) do painel do lojista e sobe no provedor de imagens
// (imgbb). Dois modos:
//   - tipo 'logo' (padrão): grava a URL em negocios/{uid}.markerLogo (logo do pino).
//   - tipo 'produto': NÃO grava nada; só devolve a URL. Quem guarda a URL no item
//     do cardápio é o painel, na hora de salvar (a foto vive dentro do array
//     negocios/{uid}.cardapio, então não passa por aqui pra gravar).
// Segurança: o idToken identifica o lojista; ele só mexe nos dados DELE. A chave
// do provedor fica no servidor (env IMGBB_API_KEY), nunca no navegador.
//
// Env necessária no Vercel (projeto moviki-robo): IMGBB_API_KEY

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

    // Quem e o lojista?
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(idToken); }
    catch (_) { res.status(401).json({ ok: false, erro: 'sessao invalida' }); return; }

    const API_KEY = process.env.IMGBB_API_KEY;
    if (!API_KEY) { res.status(200).json({ ok: false, motivo: 'sem_config' }); return; }

    // tira o prefixo "data:image/...;base64," se vier
    const b64 = imagemBase64.includes(',') ? imagemBase64.split(',').pop() : imagemBase64;

    const ehProduto = tipo === 'produto';
    const nome = (ehProduto ? 'prod_' : 'logo_') + decoded.uid + '_' + Date.now();

    const form = new URLSearchParams();
    form.append('key', API_KEY);
    form.append('image', b64);
    form.append('name', nome);

    const r = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.success || !j.data) {
      console.error('imgbb erro:', r.status, j && j.error);
      res.status(502).json({ ok: false, erro: 'falha no upload' });
      return;
    }

    const url = j.data.url || j.data.display_url;

    if (ehProduto) {
      // foto de produto: so devolve a URL (o painel guarda dentro do cardapio ao salvar)
      res.status(200).json({ ok: true, url });
      return;
    }

    // logo do pino: grava no doc do proprio lojista (Admin SDK -- nao depende das regras)
    await db.collection('negocios').doc(decoded.uid).set({ markerLogo: url }, { merge: true });
    res.status(200).json({ ok: true, url });
  } catch (e) {
    console.error('upload-imagem erro:', e);
    res.status(500).json({ ok: false, erro: 'erro interno' });
  }
};
