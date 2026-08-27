// api/exclusoes.js  (repo: moviki-robo)
// Painel do dono → Exclusões. Dois modos (campo "action"):
//   - "listar":  devolve os pedidos de exclusão pendentes (status 'solicitado').
//   - "excluir": APAGA DE VERDADE a conta do uid informado — cancela a assinatura
//                no Asaas, apaga os dados no Firestore e no Storage, e remove a
//                conta de acesso. NAO exige pedido aberto: o dono pode excluir
//                qualquer conta (cadastro de teste, duplicata, abandono).
//
// Segurança: só um ADMIN (documento em /admins/{uid}) consegue — a permissão é
// conferida AQUI no servidor (Admin SDK). O app do lojista NÃO tem acesso a isto.
//
// Envs (já existentes no projeto moviki-robo):
//   FIREBASE_SERVICE_ACCOUNT (Admin SDK) · ASAAS_API_KEY / ASAAS_BASE_URL (cancelar assinatura)

const { admin, db } = require('../lib/firebase');
const { asaas } = require('../lib/asaas');

const ORIGIN_OK = 'https://app.moviki.com.br';
const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'moviki-app.firebasestorage.app';

// Apaga os arquivos do usuario no Storage. Sem isto a foto e o documento dele
// continuavam no balde depois da conta apagada — o que contraria a promessa do
// painel ("os dados somem definitivamente") e a propria LGPD.
async function apagarArquivos(uid, resumo) {
  const alvos = ['logos/' + uid, 'produtos/' + uid + '/', 'documentos/' + uid + '/'];
  for (const prefix of alvos) {
    try {
      await admin.storage().bucket(BUCKET).deleteFiles({ prefix: prefix, force: true });
      resumo.arquivos = true;
    } catch (e) {
      resumo.arquivosErro = (e && e.message) || 'falha';
    }
  }
}

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

      // Nao deixa o dono apagar a si mesmo nem outro admin por engano.
      if (uid === decoded.uid) { res.status(400).json({ ok: false, erro: 'nao da pra excluir a propria conta' }); return; }
      try {
        const alvoAdmin = await db.collection('admins').doc(uid).get();
        if (alvoAdmin.exists) { res.status(400).json({ ok: false, erro: 'essa conta e de um admin' }); return; }
      } catch (_) {}

      const resumo = {
        assinaturaCancelada: false, avaliacoes: 0, comissoes: 0, saques: 0,
        parceiro: false, authRemovido: false, apelidoLiberado: '', pontos: 0,
        metricas: 0, mensagens: 0, arquivos: false,
      };

      // 1) Cancela a assinatura no Asaas (se houver) — antes de apagar o faturamento.
      try {
        const fat = await db.collection('faturamento').doc(uid).get();
        const subId = fat.exists ? (fat.data() || {}).asaasSubscriptionId : null;
        if (subId) {
          try { await asaas('/subscriptions/' + subId, 'DELETE'); resumo.assinaturaCancelada = true; }
          catch (e) { resumo.assinaturaErro = e.message || 'falha ao cancelar'; }
        }
      } catch (_) {}

      // 2) Apaga os dados do negócio. O documento e LIDO ANTES de sumir: e dele
      //    que sai o apelido, e sem liberar o apelido ele fica reservado pra
      //    sempre e ninguem mais consegue usar aquele endereco.
      const negRef = db.collection('negocios').doc(uid);
      let slugNeg = '';
      try {
        const neg = await negRef.get();
        if (neg.exists) slugNeg = String((neg.data() || {}).slug || '');
      } catch (_) {}

      try { resumo.avaliacoes = await apagarSubcolecao(negRef, 'avaliacoes'); } catch (_) {}
      try { await apagarSubcolecao(negRef, 'resumo'); } catch (_) {}   // {n, soma} das avaliacoes
      await negRef.delete().catch(() => {});

      if (slugNeg) {
        await db.collection('slugs').doc(slugNeg).delete().catch(() => {});
        resumo.apelidoLiberado = slugNeg;
      }

      // Unidades Enterprise do dono (colecao de topo) + os apelidos delas.
      try {
        const pts = await db.collection('pontos').where('ownerUid', '==', uid).get();
        for (const d of pts.docs) {
          const sp = String((d.data() || {}).slug || '');
          if (sp) await db.collection('ponto_slugs').doc(sp).delete().catch(() => {});
          await d.ref.delete().catch(() => {});
          resumo.pontos++;
        }
      } catch (_) {}

      // Contador de desempenho (metricas/{uid}/dias) — colecao de topo.
      try {
        const mref = db.collection('metricas').doc(uid);
        resumo.metricas = await apagarSubcolecao(mref, 'dias');
        await mref.delete().catch(() => {});
      } catch (_) {}

      // Caixa de mensagens: as mensagens sao subcolecao e nao somem com o pai.
      try {
        const cref = db.collection('conversas').doc(uid);
        resumo.mensagens = await apagarSubcolecao(cref, 'mensagens');
        await cref.delete().catch(() => {});
      } catch (_) {}

      await db.collection('assinaturas').doc(uid).delete().catch(() => {});

      // faturamento tem a subcolecao ga/{payId} (trava de dedup do purchase).
      try {
        const fref = db.collection('faturamento').doc(uid);
        await apagarSubcolecao(fref, 'ga');
        await fref.delete().catch(() => {});
      } catch (_) {}

      await db.collection('indicacoes').doc(uid).delete().catch(() => {});
      await db.collection('avisos_cliente').doc(uid).delete().catch(() => {});

      // 2b) Arquivos no Storage (logo do pino, fotos de produto, anexos).
      await apagarArquivos(uid, resumo);

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
