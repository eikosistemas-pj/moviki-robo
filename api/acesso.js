// api/acesso.js | versao 2026-10-22-marcocivil  (repo: moviki-robo)
//
// REGISTRO DE ACESSO (Marco Civil, art. 15) — 22/10/2026.
//
// Quem chama:
//   - mvguarda.js (moviki-app), carregado em todo painel logado de
//     app.moviki.com.br (lojista, parceiro, criador, estudio da live), direto
//     para ca — NAO pelo atalho /api/guarda do app: a Vercel sobrescreve o IP
//     em cada salto e, passando pelo app, o robo veria o IP da propria Vercel.
//   - o painel do dono (acoes adm_*), com sessao do Google.
//
// Acoes:
//   sessao        -> grava 1 registro por uid+ip+painel a cada 30 min
//   adm_consulta  -> registros de um uid ou de um ip num periodo (ordem judicial)
//   adm_reter     -> segura registros alem dos 6 meses (ordem cautelar, art. 15 §2º)
//
// SEGURANCA
// - O uid sai SEMPRE do idToken verificado, nunca do corpo.
// - Sessao nao confere checkRevoked (custa 1 leitura do Auth por chamada e o
//   painel chama a cada 30 min): conta travada perde o login na hora certa
//   pela Guarda; o registro de quem ainda tem token vivo e justamente o que a
//   lei quer.
// - adm_* exige admins/{uid} + login do Google (lib/admin.js) + sessao viva.
// - Nenhuma regra nova no Firestore: registros_acesso sem regra = negada ao app.

'use strict';

const { admin, db } = require('../lib/firebase');
const { conferirAdmin } = require('../lib/admin');
const RA = require('../lib/registroAcesso');

const ORIGENS_OK = ['https://app.moviki.com.br', 'https://moviki.com.br', 'https://www.moviki.com.br'];
const PAINEIS = { '/index': 'painel', '/': 'painel', '/parceiro': 'parceiro', '/criador': 'criador', '/live': 'live', '/seja-parceiro': 'parceiro' };

function painelDe(p) {
  const s = String(p || '').toLowerCase().replace(/\.html$/, '').replace(/\/+$/, '') || '/';
  return PAINEIS[s] || 'outro';
}

module.exports = async (req, res) => {
  const orig = String(req.headers.origin || '');
  res.setHeader('Access-Control-Allow-Origin', ORIGENS_OK.indexOf(orig) >= 0 ? orig : ORIGENS_OK[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const acao = String(body.acao || 'sessao');
    const t = typeof body.t === 'string' ? body.t : '';
    if (!t || t.length > 4096) { res.status(401).json({ ok: false, erro: 'sessao' }); return; }

    if (acao === 'sessao') {
      let dec;
      try { dec = await admin.auth().verifyIdToken(t); } catch (_) { res.status(401).json({ ok: false, erro: 'sessao' }); return; }
      const ok = await RA.registrar(admin, db, req, { uid: dec.uid, app: painelDe(body.painel), evento: 'sessao', dedup: true });
      res.status(200).json({ ok });
      return;
    }

    if (acao === 'adm_consulta' || acao === 'adm_reter') {
      let dec;
      try { dec = await admin.auth().verifyIdToken(t, true); } catch (_) { res.status(401).json({ ok: false, erro: 'sessao' }); return; }
      const adm = await conferirAdmin(db, dec);
      if (!adm.ok) { res.status(adm.status).json({ ok: false, erro: adm.erro, mensagem: adm.mensagem }); return; }
      const d = body.dados || {};
      const r = acao === 'adm_consulta'
        ? await RA.consultar(db, { uid: d.uid, ip: d.ip, deMs: d.deMs, ateMs: d.ateMs })
        : await RA.reter(admin, db, d.ids, d.ateMs, d.motivo);
      // Toda consulta fica registrada (quem viu o que, quando): trilha exigida
      // pelo dever de sigilo do art. 10 do Marco Civil.
      try {
        await db.collection('registros_acesso_trilha').add({
          por: dec.uid, acao, uid: d.uid || null, ip: d.ip || null,
          em: admin.firestore.FieldValue.serverTimestamp(),
          apagarEm: admin.firestore.Timestamp.fromMillis(Date.now() + 5 * 365 * 86400000),
        });
      } catch (_) {}
      res.status(r.erro ? 400 : 200).json(r.erro ? Object.assign({ ok: false }, r) : r);
      return;
    }

    res.status(400).json({ ok: false, erro: 'acao' });
  } catch (e) {
    console.error('[acesso]', e && e.message);
    res.status(500).json({ ok: false, erro: 'interno' });
  }
};

module.exports._t = { painelDe };
