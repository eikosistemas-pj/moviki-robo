// api/exclusoes.js  (repo: moviki-robo)
// Painel do dono → Exclusões. Dois modos (campo "action"):
//   - "listar":  devolve os pedidos de exclusão pendentes (status 'solicitado').
//   - "excluir": APAGA DE VERDADE a conta do uid informado — cancela a assinatura
//                no Asaas, apaga os dados no Firestore e remove a conta de acesso.
//
// Segurança: só um ADMIN (documento em /admins/{uid}) consegue — a permissão é
// conferida AQUI no servidor (Admin SDK). O app do lojista NÃO tem acesso a isto.
//
// Envs (já existentes no projeto moviki-robo):
//   FIREBASE_SERVICE_ACCOUNT (Admin SDK) · ASAAS_API_KEY / ASAAS_BASE_URL (cancelar assinatura)

const { admin, db } = require('../lib/firebase');
const { asaas } = require('../lib/asaas');

const ORIGIN_OK = 'https://app.moviki.com.br';

// Apaga todos os docs de uma consulta, em lotes (Firestore aceita até 500/lote).
async function apagarDaConsulta(query) {
  const snap = await query.get();
  const docs = snap.docs;
  let n = 0;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    docs.slice(i, i + 400).forEach((d) => { batch.delete(d.ref); n++; });
    await batch.commit();
  }
  return n;
}

// Apaga uma subcoleção inteira (ex.: negocios/{uid}/avaliacoes).
async function apagarSubcolecao(parentRef, sub) {
  return apagarDaConsulta(parentRef.collection(sub));
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_OK);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ ok: false }); return; }

  try {
    const body    = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const idToken = String(body.idToken || '');
    const action  = String(body.action || '');
    if (!idToken) { res.status(400).json({ ok: false, erro: 'faltam dados' }); return; }

    // Gate de admin (server-side).
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(idToken); }
    catch (_) { res.status(401).json({ ok: false, erro: 'sessao invalida' }); return; }
    const adminDoc = await db.collection('admins').doc(decoded.uid).get();
    if (!adminDoc.exists) { res.status(403).json({ ok: false, erro: 'sem permissao' }); return; }

    // ---- LISTAR ----
    if (action === 'listar') {
      const q = await db.collection('exclusoes').where('status', '==', 'solicitado').get();
      const itens = q.docs.map((d) => {
        const x = d.data() || {};
        const ms = (x.solicitadoEm && typeof x.solicitadoEm.toMillis === 'function') ? x.solicitadoEm.toMillis() : null;
        return { uid: d.id, nome: x.nome || '', email: x.email || '', solicitadoEm: ms };
      });
      itens.sort((a, b) => (a.solicitadoEm || 0) - (b.solicitadoEm || 0)); // mais antigo primeiro
      res.status(200).json({ ok: true, itens });
      return;
    }

    // ---- EXCLUIR (definitivo) ----
    if (action === 'excluir') {
      const uid = String(body.uid || '').replace(/[^a-zA-Z0-9]/g, '');
      if (!uid) { res.status(400).json({ ok: false, erro: 'uid invalido' }); return; }

      const resumo = { assinaturaCancelada: false, avaliacoes: 0, comissoes: 0, saques: 0, parceiro: false, authRemovido: false };

      // 1) Cancela a assinatura no Asaas (se houver) — antes de apagar o faturamento.
      try {
        const fat = await db.collection('faturamento').doc(uid).get();
        const subId = fat.exists ? (fat.data() || {}).asaasSubscriptionId : null;
        if (subId) {
          try { await asaas('/subscriptions/' + subId, 'DELETE'); resumo.assinaturaCancelada = true; }
          catch (e) { resumo.assinaturaErro = e.message || 'falha ao cancelar'; }
        }
      } catch (_) {}

      // 2) Apaga os dados do negócio (+ subcoleção de avaliações) e os docs ligados ao uid.
      const negRef = db.collection('negocios').doc(uid);
      try { resumo.avaliacoes = await apagarSubcolecao(negRef, 'avaliacoes'); } catch (_) {}
      await negRef.delete().catch(() => {});
      await db.collection('assinaturas').doc(uid).delete().catch(() => {});
      await db.collection('faturamento').doc(uid).delete().catch(() => {});
      await db.collection('indicacoes').doc(uid).delete().catch(() => {});

      // 3) Se também for parceiro: libera o apelido e apaga parceiro + comissões/saques dele.
      try {
        const parcRef = db.collection('parceiros').doc(uid);
        const parc = await parcRef.get();
        if (parc.exists) {
          resumo.parceiro = true;
          const slug = (parc.data() || {}).slug;
          if (slug) { await db.collection('parceiro_slugs').doc(String(slug)).delete().catch(() => {}); }
          resumo.comissoes = await apagarDaConsulta(db.collection('comissoes').where('parceiroUid', '==', uid));
          resumo.saques    = await apagarDaConsulta(db.collection('saques').where('parceiroUid', '==', uid));
          await parcRef.delete().catch(() => {});
        }
      } catch (e) { resumo.parceiroErro = e.message || 'falha'; }

      // 4) Remove a conta de acesso (Auth).
      try { await admin.auth().deleteUser(uid); resumo.authRemovido = true; }
      catch (e) { resumo.authErro = (e && e.message) || 'falha'; }

      // 5) Fecha o pedido guardando um registro mínimo (sem dados pessoais).
      await db.collection('exclusoes').doc(uid).set({
        status: 'excluido',
        excluidoEm: admin.firestore.FieldValue.serverTimestamp(),
        excluidoPor: decoded.uid,
        nome:  admin.firestore.FieldValue.delete(),
        email: admin.firestore.FieldValue.delete(),
      }, { merge: true });

      res.status(200).json({ ok: true, resumo });
      return;
    }

    res.status(400).json({ ok: false, erro: 'acao invalida' });
  } catch (e) {
    console.error('exclusoes erro:', e);
    res.status(500).json({ ok: false, erro: 'erro interno' });
  }
};
