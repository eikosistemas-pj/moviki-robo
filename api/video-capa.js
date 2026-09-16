// api/video-capa.js  (repo: moviki-robo)   ***ARQUIVO NOVO***
//
// ------------------------------------------------------------------
// PARA QUE SERVE
// ------------------------------------------------------------------
// Busca a capa de um video do TikTok e a RE-HOSPEDA no nosso Storage,
// devolvendo a URL final para o painel gravar em `videos[].capa`.
//
// POR QUE ISTO EXISTE
// O cartao de video do Instagram e do TikTok nascia sem imagem na pagina
// publica: nenhuma das duas redes entrega miniatura para fora do aplicativo
// delas. O Instagram nao tem saida publica (o oEmbed aberto acabou). O TikTok
// ainda tem: o endpoint oembed responde sem token nenhum e traz thumbnail_url.
//
// POR QUE RE-HOSPEDAR, E NAO GUARDAR O ENDERECO DO TIKTOK
//   1. O endereco que eles devolvem e ASSINADO e temporario. Guardado como
//      esta, funcionaria hoje e sumiria em algumas semanas — e o lojista nunca
//      saberia por que a capa dele evaporou.
//   2. A CSP das paginas publicas nao precisa abrir para mais um dominio.
//   3. A validacao fotoOk() das duas pontas continua como esta: so
//      firebasestorage e ibb.co.
//
// FALHA FECHADA, SEMPRE
// Qualquer tropeço — TikTok fora do ar, formato mudado, imagem estranha —
// responde `ok:false` e o painel simplesmente nao poe capa nenhuma. O lojista
// escolhe a dele na mao, como ja fazia. Nenhum caminho novo pode quebrar o que
// ja funciona.
//
// Env: FIREBASE_SERVICE_ACCOUNT (a mesma do upload-imagem.js).

const { admin } = require('../lib/firebase');

const ORIGIN_OK = 'https://app.moviki.com.br';
const STORAGE_BUCKET = 'moviki-app.firebasestorage.app';
const TEMPO_LIMITE_MS = 6000;      // o painel espera; nao pode pendurar
const MAX_IMG = 3000000;           // 3 MB de miniatura ja e exagero

/* So TikTok. O Instagram nao entra aqui de proposito: nao existe caminho
   publico, e prometer que existe so geraria chamada que sempre falha. */
function urlTikTok(cru) {
  const u = String(cru || '').trim().split('#')[0].split('?')[0];
  if (!/^https:\/\//i.test(u)) return '';
  return /^https:\/\/(?:www\.|vm\.|vt\.)?tiktok\.com\/[A-Za-z0-9@._\/-]{3,120}$/i.test(u) ? u : '';
}

/* A miniatura tem que vir do proprio TikTok. Sem esta trava, um oembed
   adulterado mandaria o robo baixar qualquer endereco da internet — e o
   servidor faria a busca com a credencial dele (SSRF). */
function cdnDoTikTok(cru) {
  try {
    const u = new URL(String(cru || ''));
    if (u.protocol !== 'https:') return '';
    const h = u.hostname.toLowerCase();
    const ok = /(^|\.)(tiktokcdn[a-z0-9-]*\.com|tiktokcdn\.com|ttwstatic\.com|byteimg\.com|tiktok\.com)$/.test(h);
    return ok ? u.href : '';
  } catch (_) { return ''; }
}

async function buscar(url, tipo) {
  const ctrl = new AbortController();
  const t = setTimeout(function () { ctrl.abort(); }, TEMPO_LIMITE_MS);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MovikiBot/1.0; +https://www.moviki.com.br)' },
    });
    if (!r.ok) return null;
    return tipo === 'json' ? await r.json() : Buffer.from(await r.arrayBuffer());
  } catch (_) { return null; }
  finally { clearTimeout(t); }
}

/* Confere pelos BYTES, nao pelo que o servidor diz que mandou. */
function tipoDaImagem(buf) {
  if (!buf || buf.length < 500 || buf.length > MAX_IMG) return '';
  if (buf[0] === 0xFF && buf[1] === 0xD8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  return '';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_OK);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ ok: false }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const idToken = String(body.idToken || '');
    const alvo = urlTikTok(body.url);
    if (!idToken) { res.status(400).json({ ok: false, erro: 'faltam dados' }); return; }
    if (!alvo)    { res.status(400).json({ ok: false, erro: 'rede_sem_capa' }); return; }

    let decoded;
    try { decoded = await admin.auth().verifyIdToken(idToken); }
    catch (_) { res.status(401).json({ ok: false, erro: 'sessao invalida' }); return; }

    const j = await buscar('https://www.tiktok.com/oembed?url=' + encodeURIComponent(alvo), 'json');
    const thumb = j && cdnDoTikTok(j.thumbnail_url);
    if (!thumb) { res.status(200).json({ ok: false, erro: 'sem_capa' }); return; }

    const buf = await buscar(thumb, 'bin');
    const contentType = tipoDaImagem(buf);
    if (!contentType) { res.status(200).json({ ok: false, erro: 'sem_capa' }); return; }

    const ext = contentType === 'image/png' ? 'png' : (contentType === 'image/webp' ? 'webp' : 'jpg');
    const fileName = 'capas/' + decoded.uid + '/' + Date.now() + '.' + ext;
    const bucket = admin.storage().bucket(STORAGE_BUCKET);
    await bucket.file(fileName).save(buf, {
      metadata: { contentType, cacheControl: 'public,max-age=31536000' },
      public: true,
    });

    const url = 'https://firebasestorage.googleapis.com/v0/b/' +
                encodeURIComponent(bucket.name) + '/o/' + encodeURIComponent(fileName) + '?alt=media';
    res.status(200).json({ ok: true, url });
  } catch (e) {
    console.error('video-capa ERRO:', { message: e && e.message, code: e && e.code });
    /* 200 de proposito: para o painel isto nao e erro, e "nao veio capa".
       Erro vermelho na tela por causa de uma capa automatica seria pior que
       a ausencia dela. */
    res.status(200).json({ ok: false, erro: 'sem_capa' });
  }
};
