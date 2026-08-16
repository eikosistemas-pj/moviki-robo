// api/lugares.js  (repo: moviki-robo)
// Autocomplete de endereços/lugares (ruas, empresas, parques...) via Google
// Places API (New). A chave fica só no servidor (env GOOGLE_MAPS_KEY).
//
// POST { idToken, acao:'sugestoes', texto }  -> { ok, sugestoes:[{id,texto}] }
// POST { idToken, acao:'detalhe', placeId }  -> { ok, lat, lng, endereco }

const { admin } = require('../lib/firebase');

const ORIGIN_OK = 'https://app.moviki.com.br';
const KEY = process.env.GOOGLE_MAPS_KEY;

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_OK);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ ok: false }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const idToken = String(body.idToken || '');
    const acao = String(body.acao || '');
    if (!idToken) { res.status(400).json({ ok: false, erro: 'faltam dados' }); return; }

    try { await admin.auth().verifyIdToken(idToken); }
    catch (_) { res.status(401).json({ ok: false, erro: 'sessao invalida' }); return; }

    if (!KEY) { res.status(500).json({ ok: false, erro: 'busca de lugares não configurada' }); return; }

    if (acao === 'sugestoes') {
      const texto = String(body.texto || '').trim().slice(0, 120);
      if (texto.length < 3) { res.status(200).json({ ok: true, sugestoes: [] }); return; }
      const r = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': KEY },
        body: JSON.stringify({ input: texto, languageCode: 'pt-BR', includedRegionCodes: ['br'] }),
      });
      const j = await r.json().catch(() => ({}));
      const sugestoes = ((j.suggestions) || [])
        .map(s => s.placePrediction).filter(Boolean)
        .map(p => ({ id: p.placeId, texto: (p.text && p.text.text) || '' }))
        .filter(x => x.id && x.texto).slice(0, 6);
      res.status(200).json({ ok: true, sugestoes });
      return;
    }

    if (acao === 'detalhe') {
      const placeId = String(body.placeId || '').slice(0, 300);
      if (!placeId) { res.status(400).json({ ok: false, erro: 'faltam dados' }); return; }
      const r = await fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(placeId) + '?languageCode=pt-BR', {
        headers: { 'X-Goog-Api-Key': KEY, 'X-Goog-FieldMask': 'location,formattedAddress' },
      });
      const j = await r.json().catch(() => ({}));
      const loc = j.location || {};
      if (typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') {
        res.status(200).json({ ok: false, erro: 'lugar_sem_local' }); return;
      }
      res.status(200).json({ ok: true, lat: loc.latitude, lng: loc.longitude, endereco: j.formattedAddress || '' });
      return;
    }

    res.status(400).json({ ok: false, erro: 'ação inválida' });
  } catch (e) {
    console.error('lugares ERRO:', e?.message || e);
    res.status(500).json({ ok: false, erro: 'erro interno' });
  }
};
