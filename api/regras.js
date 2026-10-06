// api/regras.js | versao 2026-10-03-regras1  (repo: moviki-robo)
// REGRAS DO FIREBASE NO AR — confere se o Firestore e o Storage publicados no
// Console batem com o repositorio (ver lib/regras.js).
//
//   GET  com Authorization: Bearer CRON_SECRET -> cron de hora em hora
//        (vercel.json). Avisa no Telegram e por e-mail quando o estado muda.
//   POST { idToken } -> painel do dono (Configuracoes > Regras no ar).
//        So dono, com sessao do Google (lib/admin.js).
//
// Env (ja existem): FIREBASE_SERVICE_ACCOUNT, CRON_SECRET, TELEGRAM_TOKEN,
// TELEGRAM_CHAT_ID, RESEND_API_KEY. Opcional: REGRAS_EMAIL.

const { admin, db } = require('../lib/firebase');
const { conferirAdmin } = require('../lib/admin');
const { bearerConfere } = require('../lib/segredo');
const { conferirEGuardar } = require('../lib/regras');

const ORIGENS = ['https://app.moviki.com.br'];

module.exports = async (req, res) => {
  const origem = String(req.headers.origin || '');
  if (ORIGENS.includes(origem)) res.setHeader('Access-Control-Allow-Origin', origem);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    if (req.method === 'GET') {
      if (!bearerConfere(req, process.env.CRON_SECRET)) { res.status(401).json({ ok: false, erro: 'nao_autorizado' }); return; }
      const r = await conferirEGuardar();
      res.status(200).json(Object.assign({ ok: true }, r));
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    let decoded;
    /* 06/10 (plano 2.3): checkRevoked=true. Sessao cancelada (senha trocada, conta desativada pela Guarda, revogada no console) e recusada na hora, em vez de valer ate 1 h. Custa 1 leitura do Auth por chamada; so nas portas de dinheiro e de dono. */
    try { decoded = await admin.auth().verifyIdToken(String(body.idToken || ''), true); }
    catch (_) { res.status(401).json({ ok: false, erro: 'sessao' }); return; }
    const adm = await conferirAdmin(db, decoded);
    if (!adm.ok) { res.status(adm.status).json({ ok: false, erro: adm.erro, mensagem: adm.mensagem }); return; }

    const r = await conferirEGuardar();
    res.status(200).json(Object.assign({ ok: true }, r));
  } catch (e) {
    console.error('regras erro:', e && e.message);
    res.status(200).json({ ok: false, erro: 'falha_interna' });
  }
};
