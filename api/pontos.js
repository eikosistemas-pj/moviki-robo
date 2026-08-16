// api/pontos.js  (repo: moviki-robo)
// Gerencia os PONTOS de um negócio Enterprise (multi-ponto).
// O negócio principal já É 1 ponto. Dos 3 inclusos, sobram 2 na subcoleção sem
// cobrança. O 3º adicional (4º no total) cria uma assinatura recorrente de
// R$19,90 (PONTO_EXTRA) e só fica ATIVO quando o pagamento confirmar (webhook).
// Remover um ponto pago cancela a assinatura. Tudo via Admin SDK (regras write:false).
//
// Ações (POST body.acao): 'listar' | 'criar' | 'editar' | 'remover'

const { db, admin } = require('../lib/firebase');
const { asaas, PONTO_EXTRA, PONTOS_INCLUSOS } = require('../lib/asaas');

const ORIGIN_OK = 'https://app.moviki.com.br';
const GKEY = process.env.GOOGLE_MAPS_KEY; // autocomplete de endereço (Google Places)
const FieldValue = admin.firestore.FieldValue;
const EXTRAS_INCLUSOS = Math.max(0, PONTOS_INCLUSOS - 1); // principal ocupa 1

function limpaSlug(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
}
function ehNum(v) { return typeof v === 'number' && isFinite(v); }

async function ehEnterprise(uid) {
  const a = await db.collection('assinaturas').doc(uid).get();
  const d = a.exists ? a.data() : null;
  const venceOk = !d || !d.vence_em || (d.vence_em.toMillis && d.vence_em.toMillis() > Date.now());
  return !!(d && d.ativo === true && d.plano === 'enterprise' && venceOk);
}

async function pegarInvoiceUrl(subId) {
  let url = null;
  for (let i = 0; i < 3 && !url; i++) {
    const pays = await asaas('/subscriptions/' + subId + '/payments', 'GET');
    if (pays.data && pays.data[0]) url = pays.data[0].invoiceUrl;
    else await new Promise((r) => setTimeout(r, 1500));
  }
  return url;
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
    const acao = String(body.acao || '');
    if (!idToken) { res.status(400).json({ ok: false, erro: 'faltam dados' }); return; }

    let decoded;
    try { decoded = await admin.auth().verifyIdToken(idToken); }
    catch (_) { res.status(401).json({ ok: false, erro: 'sessao invalida' }); return; }
    const uid = decoded.uid;

    if (!(await ehEnterprise(uid))) {
      res.status(403).json({ ok: false, erro: 'recurso do plano Enterprise', motivo: 'nao_enterprise' });
      return;
    }

    const col = db.collection('pontos');

    if (acao === 'listar') {
      const qs = await col.where('ownerUid', '==', uid).get();
      const pontos = qs.docs.map(d => {
        const x = d.data();
        return { id: d.id, nome: x.nome || '', lat: x.lat, lng: x.lng, slug: x.slug || '', ativo: x.ativo === true, cobranca: !!x.cobrancaId };
      });
      res.status(200).json({ ok: true, pontos, inclusos: PONTOS_INCLUSOS, extrasInclusos: EXTRAS_INCLUSOS });
      return;
    }

    // ---- AUTOCOMPLETE DE ENDEREÇO (Google Places New) ----
    if (acao === 'sugestoes') {
      if (!GKEY) { res.status(500).json({ ok: false, erro: 'busca de lugares não configurada' }); return; }
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
    if (acao === 'detalhe') {
      if (!GKEY) { res.status(500).json({ ok: false, erro: 'busca de lugares não configurada' }); return; }
      const placeId = String(body.placeId || '').slice(0, 300);
      if (!placeId) { res.status(400).json({ ok: false, erro: 'faltam dados' }); return; }
      const r = await fetch('https://places.googleapis.com/v1/places/' + encodeURIComponent(placeId) + '?languageCode=pt-BR', {
        headers: { 'X-Goog-Api-Key': GKEY, 'X-Goog-FieldMask': 'location,formattedAddress' },
      });
      const j = await r.json().catch(() => ({}));
      const loc = j.location || {};
      if (typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') { res.status(200).json({ ok: false, erro: 'lugar_sem_local' }); return; }
      res.status(200).json({ ok: true, lat: loc.latitude, lng: loc.longitude, endereco: j.formattedAddress || '' });
      return;
    }

    if (acao === 'criar') {
      const nome = String(body.nome || '').trim().slice(0, 80);
      const slug = limpaSlug(body.slug);
      const lat = Number(body.lat), lng = Number(body.lng);
      if (!nome)                      { res.status(400).json({ ok: false, erro: 'informe o nome do ponto' }); return; }
      if (slug.length < 3)            { res.status(400).json({ ok: false, erro: 'apelido precisa de ao menos 3 letras' }); return; }
      if (!ehNum(lat) || !ehNum(lng)) { res.status(400).json({ ok: false, erro: 'marque a localização do ponto' }); return; }

      const jaTem = (await col.where('ownerUid', '==', uid).get()).size;
      const extra = jaTem >= EXTRAS_INCLUSOS;

      let customerId = null;
      if (extra) {
        const fat = await db.collection('faturamento').doc(uid).get();
        customerId = fat.exists ? fat.data().asaasCustomerId : null;
        if (!customerId) {
          res.status(400).json({ ok: false, erro: 'Assine o Enterprise pra liberar pontos extras.', motivo: 'sem_cliente' });
          return;
        }
      }

      let pid = '';
      try {
        await db.runTransaction(async (tx) => {
          const refP = db.collection('ponto_slugs').doc(slug);
          const refL = db.collection('slugs').doc(slug);
          const [sp, sl] = await Promise.all([tx.get(refP), tx.get(refL)]);
          if (sp.exists || sl.exists) throw new Error('APELIDO_EM_USO');
          const ref = col.doc();
          tx.set(ref, {
            ownerUid: uid, nome, lat, lng, slug, ativo: !extra,
            criadoEm: FieldValue.serverTimestamp(), atualizadoEm: FieldValue.serverTimestamp(),
          });
          tx.set(refP, { ownerUid: uid, pid: ref.id });
          pid = ref.id;
        });
      } catch (e) {
        if (String(e.message).includes('APELIDO_EM_USO')) {
          res.status(409).json({ ok: false, erro: 'esse apelido já está em uso', motivo: 'apelido_em_uso' });
          return;
        }
        throw e;
      }

      if (!extra) { res.status(200).json({ ok: true, id: pid, ativo: true }); return; }

      try {
        const hoje = new Date().toISOString().slice(0, 10);
        const assin = await asaas('/subscriptions', 'POST', {
          customer: customerId,
          billingType: 'UNDEFINED',
          value: PONTO_EXTRA.value,
          nextDueDate: hoje,
          cycle: PONTO_EXTRA.cycle,
          description: 'Moviki - ponto extra (' + slug + ')',
          externalReference: 'ponto:' + pid,
        });
        await col.doc(pid).update({ cobrancaId: assin.id, atualizadoEm: FieldValue.serverTimestamp() });
        const invoiceUrl = await pegarInvoiceUrl(assin.id);
        res.status(200).json({ ok: true, id: pid, ativo: false, cobranca: true, invoiceUrl });
      } catch (e) {
        try { await col.doc(pid).delete(); } catch (_) {}
        try { await db.collection('ponto_slugs').doc(slug).delete(); } catch (_) {}
        console.error('cobranca ponto erro:', e?.message || e);
        res.status(502).json({ ok: false, erro: 'Não consegui gerar a cobrança do ponto. Tente de novo.' });
      }
      return;
    }

    if (acao === 'editar') {
      const pid = String(body.pid || '');
      if (!pid) { res.status(400).json({ ok: false, erro: 'faltam dados' }); return; }
      const ref = col.doc(pid);
      const snap = await ref.get();
      if (!snap.exists || snap.data().ownerUid !== uid) { res.status(404).json({ ok: false, erro: 'ponto não encontrado' }); return; }

      const patch = { atualizadoEm: FieldValue.serverTimestamp() };
      if (body.nome !== undefined) {
        const nome = String(body.nome || '').trim().slice(0, 80);
        if (!nome) { res.status(400).json({ ok: false, erro: 'informe o nome do ponto' }); return; }
        patch.nome = nome;
      }
      if (body.lat !== undefined || body.lng !== undefined) {
        const lat = Number(body.lat), lng = Number(body.lng);
        if (!ehNum(lat) || !ehNum(lng)) { res.status(400).json({ ok: false, erro: 'localização inválida' }); return; }
        patch.lat = lat; patch.lng = lng;
      }
      await ref.update(patch);
      res.status(200).json({ ok: true });
      return;
    }

    if (acao === 'remover') {
      const pid = String(body.pid || '');
      if (!pid) { res.status(400).json({ ok: false, erro: 'faltam dados' }); return; }
      const ref = col.doc(pid);
      const snap = await ref.get();
      if (!snap.exists || snap.data().ownerUid !== uid) { res.status(404).json({ ok: false, erro: 'ponto não encontrado' }); return; }
      const d = snap.data();
      if (d.cobrancaId) { try { await asaas('/subscriptions/' + d.cobrancaId, 'DELETE'); } catch (_) {} }
      await ref.delete();
      if (d.slug) { try { await db.collection('ponto_slugs').doc(d.slug).delete(); } catch (_) {} }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ ok: false, erro: 'ação inválida' });
  } catch (e) {
    console.error('pontos ERRO:', e?.message || e);
    res.status(500).json({ ok: false, erro: 'erro interno' });
  }
};
