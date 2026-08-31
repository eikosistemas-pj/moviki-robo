// api/endereco.js  (repo: moviki-robo)
// Autocomplete de endereço para QUALQUER plano (Google Places New).
// O mesmo recurso já existia em api/pontos.js, mas atrás da trava ehEnterprise().
// Aqui exige apenas idToken válido. NÃO grava nada: só busca e converte em lat/lng.
// Ações (POST body.acao): 'sugestoes' | 'detalhe'

const { admin } = require('../lib/firebase');

const ORIGIN_OK = 'https://app.moviki.com.br';
const GKEY = process.env.GOOGLE_MAPS_KEY;

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

    if (!GKEY) { res.status(500).json({ ok: false, erro: 'busca de lugares não configurada' }); return; }

    // ---- SUGESTÕES (o lojista digitando) ----
    if (acao === 'sugestoes') {
      const texto = String(body.texto || '').trim().slice(0, 120);
      if (texto.length < 3) { res.status(200).json({ ok: true, sugestoes: [] }); return; }
      const r = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GKEY },
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

    // ---- DETALHE (sugestão escolhida -> endereço formatado + lat/lng) ----
    if (acao === 'detalhe') {
      const placeId = String(body.placeId || '').slice(0, 300);
      if (!placeId) { res.status(400).json({ ok: false, erro: 'faltam dados' }); return; }
      const r = await fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(placeId) + '?languageCode=pt-BR', {
        headers: { 'X-Goog-Api-Key': GKEY, 'X-Goog-FieldMask': 'location,formattedAddress' },
      });
      const j = await r.json().catch(() => ({}));
      const loc = j.location || {};
      if (typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') {
        res.status(200).json({ ok: false, erro: 'lugar_sem_local' });
        return;
      }
      res.status(200).json({ ok: true, lat: loc.latitude, lng: loc.longitude, endereco: j.formattedAddress || '' });
      return;
    }

    res.status(400).json({ ok: false, erro: 'ação inválida' });
  } catch (e) {
    console.error('endereco erro:', (e && e.message) || e);
    res.status(500).json({ ok: false, erro: 'falha na busca de endereço' });
  }
};
