// api/pontos.js  (repo: moviki-robo)
// Gerencia os PONTOS de um negócio Enterprise (multi-ponto).
// Cada ponto extra = um "carrinho" do mesmo dono, com localização e apelido
// próprios (a marca/cardápio vêm do negócio principal). Como o ponto extra
// mexe em dinheiro (cobrança), TUDO passa por aqui (Admin SDK) — o cliente
// nunca escreve ponto direto no banco. As regras do Firestore têm pontos e
// ponto_slugs como write:false justamente por isso.
//
// Contagem: o negócio principal (negocios/{uid}) já É 1 ponto. Então dos 3
// inclusos no plano, sobram 2 na subcoleção sem cobrança. O 3º adicional
// (4º no total) exige a cobrança de R$19,90 — isso entra na PARTE A2; por
// enquanto este endpoint recusa o ponto extra com motivo 'precisa_cobranca'.
//
// Env necessária no Vercel (projeto moviki-robo): FIREBASE_SERVICE_ACCOUNT
//
// Ações (POST body.acao): 'listar' | 'criar' | 'editar' | 'remover'

const { db, admin } = require('../lib/firebase');
const { PONTOS_INCLUSOS } = require('../lib/asaas');

const ORIGIN_OK = 'https://app.moviki.com.br';
const FieldValue = admin.firestore.FieldValue;

// o principal já ocupa 1 dos inclusos → quantos pontos EXTRAS cabem sem cobrança
const EXTRAS_INCLUSOS = Math.max(0, PONTOS_INCLUSOS - 1);

function limpaSlug(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // tira acento
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')                      // só a-z 0-9 _ -
    .slice(0, 40);
}

function ehNum(v) { return typeof v === 'number' && isFinite(v); }

async function ehEnterprise(uid) {
  const a = await db.collection('assinaturas').doc(uid).get();
  const d = a.exists ? a.data() : null;
  const venceOk = !d || !d.vence_em || (d.vence_em.toMillis && d.vence_em.toMillis() > Date.now());
  return !!(d && d.ativo === true && d.plano === 'enterprise' && venceOk);
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

    // quem é o dono?
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(idToken); }
    catch (_) { res.status(401).json({ ok: false, erro: 'sessao invalida' }); return; }
    const uid = decoded.uid;

    // trava: só Enterprise ativo mexe em pontos
    if (!(await ehEnterprise(uid))) {
      res.status(403).json({ ok: false, erro: 'recurso do plano Enterprise', motivo: 'nao_enterprise' });
      return;
    }

    const col = db.collection('pontos');

    // ---- LISTAR ----
    if (acao === 'listar') {
      const qs = await col.where('ownerUid', '==', uid).get();
      const pontos = qs.docs.map(d => {
        const x = d.data();
        return { id: d.id, nome: x.nome || '', lat: x.lat, lng: x.lng, slug: x.slug || '', ativo: x.ativo === true };
      });
      res.status(200).json({ ok: true, pontos, inclusos: PONTOS_INCLUSOS, extrasInclusos: EXTRAS_INCLUSOS });
      return;
    }

    // ---- CRIAR ----
    if (acao === 'criar') {
      const nome = String(body.nome || '').trim().slice(0, 80);
      const slug = limpaSlug(body.slug);
      const lat = Number(body.lat), lng = Number(body.lng);
      if (!nome)                 { res.status(400).json({ ok: false, erro: 'informe o nome do ponto' }); return; }
      if (slug.length < 3)       { res.status(400).json({ ok: false, erro: 'apelido precisa de ao menos 3 letras' }); return; }
      if (!ehNum(lat) || !ehNum(lng)) { res.status(400).json({ ok: false, erro: 'marque a localização do ponto' }); return; }

      // quantos pontos extras o dono já tem?
      const jaTem = (await col.where('ownerUid', '==', uid).get()).size;
      if (jaTem >= EXTRAS_INCLUSOS) {
        // 4º ponto (total) em diante = cobrança de R$19,90 → PARTE A2
        res.status(402).json({ ok: false, erro: 'ponto extra exige a mensalidade de R$19,90', motivo: 'precisa_cobranca' });
        return;
      }

      // reserva do apelido + criação do ponto, atômico (não pode colidir com
      // apelido de lojista nem de outro ponto)
      let pid = '';
      try {
        await db.runTransaction(async (tx) => {
          const refP = db.collection('ponto_slugs').doc(slug);
          const refL = db.collection('slugs').doc(slug);
          const [sp, sl] = await Promise.all([tx.get(refP), tx.get(refL)]);
          if (sp.exists || sl.exists) throw new Error('APELIDO_EM_USO');
          const ref = col.doc();
          tx.set(ref, {
            ownerUid: uid, nome, lat, lng, slug, ativo: true,
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
      res.status(200).json({ ok: true, id: pid, ativo: true });
      return;
    }

    // ---- EDITAR (nome/localização; apelido é imutável) ----
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

    // ---- REMOVER ----
    if (acao === 'remover') {
      const pid = String(body.pid || '');
      if (!pid) { res.status(400).json({ ok: false, erro: 'faltam dados' }); return; }
      const ref = col.doc(pid);
      const snap = await ref.get();
      if (!snap.exists || snap.data().ownerUid !== uid) { res.status(404).json({ ok: false, erro: 'ponto não encontrado' }); return; }
      const slug = snap.data().slug;
      // PARTE A2: se o ponto tiver cobrança (cobrancaId), cancelar a assinatura
      // no Asaas ANTES de apagar. (Nenhum ponto tem cobrança nesta fase.)
      await ref.delete();
      if (slug) { try { await db.collection('ponto_slugs').doc(slug).delete(); } catch (_) {} }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ ok: false, erro: 'ação inválida' });
  } catch (e) {
    console.error('pontos ERRO:', e?.message || e);
    res.status(500).json({ ok: false, erro: 'erro interno' });
  }
};
