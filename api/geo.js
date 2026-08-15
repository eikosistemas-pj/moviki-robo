// api/geo.js  (repo: moviki-robo)
// Converte um endereço em texto -> latitude/longitude, usando o Nominatim
// (OpenStreetMap). Feito pelo robô porque o CSP do painel não libera chamar
// o Nominatim direto do navegador, e o Nominatim pede um User-Agent próprio.
//
// POST { idToken, endereco } -> { ok, lat, lng, endereco } | { ok:false, erro }

const { admin } = require('../lib/firebase');

const ORIGIN_OK = 'https://app.moviki.com.br';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_OK);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ ok: false }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const idToken = String(body.idToken || '');
    const endereco = String(body.endereco || '').trim().slice(0, 200);
    if (!idToken || !endereco) { res.status(400).json({ ok: false, erro: 'faltam dados' }); return; }

    try { await admin.auth().verifyIdToken(idToken); }
    catch (_) { res.status(401).json({ ok: false, erro: 'sessao invalida' }); return; }

    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=' + encodeURIComponent(endereco);
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Moviki/1.0 (suporte@moviki.com.br)', 'Accept-Language': 'pt-BR' },
    });
    const arr = await r.json().catch(() => []);
    if (!Array.isArray(arr) || !arr.length) { res.status(200).json({ ok: false, erro: 'endereco_nao_encontrado' }); return; }

    const g = arr[0];
    const lat = Number(g.lat), lng = Number(g.lon);
    if (!isFinite(lat) || !isFinite(lng)) { res.status(200).json({ ok: false, erro: 'endereco_nao_encontrado' }); return; }

    res.status(200).json({ ok: true, lat, lng, endereco: g.display_name || endereco });
  } catch (e) {
    console.error('geo ERRO:', e?.message || e);
    res.status(500).json({ ok: false, erro: 'erro interno' });
  }
};
