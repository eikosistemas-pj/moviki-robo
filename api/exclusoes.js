// api/exclusoes.js | versao 2026-09-23-exclusao4  (repo: moviki-robo)
// 2026-09-23: apaga criadores/, capas/, criador_pecas e comprovantes; cancela todas as assinaturas registradas; apelido de parceiro vira lapide (nao reaproveita)
// Painel do dono -> Exclusoes. Dois modos (campo "action"):
//   - "listar":  devolve os pedidos de exclusao pendentes (status 'solicitado').
//   - "excluir": APAGA DE VERDADE a conta do uid informado — cancela a assinatura
//                no Asaas, apaga os dados no Firestore e no Storage, e remove a
//                conta de acesso. NAO exige pedido aberto: o dono pode excluir
//                qualquer conta (cadastro de teste, duplicata, abandono).
//
// Seguranca: so um ADMIN (documento em /admins/{uid}) consegue — a permissao e
// conferida AQUI no servidor (Admin SDK). O app do lojista NAO tem acesso a isto.
//
// Envs: FIREBASE_SERVICE_ACCOUNT (Admin SDK) · ASAAS_API_KEY / ASAAS_BASE_URL.
//
// ===================================================================
// O QUE MUDOU EM 16/09/2026 (exclusao2) — tres buracos de dinheiro e um de LGPD
// ===================================================================
//
// 1) ASSINATURA VIVA E SEM RASTRO (falha aberta).
//    A versao anterior tentava cancelar no Asaas e, se falhasse, apenas anotava
//    `assinaturaErro` no resumo e SEGUIA APAGANDO — inclusive `faturamento/{uid}`,
//    o unico lugar onde mora o `asaasSubscriptionId`. Resultado: assinatura
//    cobrando todo mes, conta apagada, e nenhum jeito de descobrir qual
//    assinatura era. Agora a etapa 1 e FALHA FECHADA: sem confirmacao de que a
//    assinatura morreu, NADA e apagado e o endpoint devolve 409 com o id.
//    Falha de rede no DELETE nao e prova de que nao cancelou — por isso, quando
//    o DELETE falha, o robo CONFERE com um GET antes de barrar. 404 (nao existe)
//    e `deleted:true` contam como cancelada.
//
// 2) COMISSAO ORFA POR `lojistaUid` — dinheiro sacavel por Pix.
//    A limpeza so removia comissoes por `parceiroUid` (as QUE O EXCLUIDO
//    RECEBERIA). As comissoes que ELE GEROU, na carteira do parceiro que o
//    indicou, ficavam intactas e sacaveis. Excluir um lojista de teste pagava
//    comissao de verdade sobre uma assinatura que nunca existiu.
//    Agora as comissoes com `lojistaUid == uid` sao tratadas ANTES de qualquer
//    delete: as nao pagas viram `estornada:true` (o `pagar-saque.js` e o
//    `parceiro.html` ja ignoram estornada) e as JA PAGAS sao apenas marcadas com
//    `lojistaExcluido:true` — apagar historico de dinheiro que saiu quebraria a
//    conferencia com o Asaas. Estorno, nao delete: fica rastro.
//
// 3) O MODO LIVE E O CHECKOUT NASCERAM DEPOIS DESTE ARQUIVO.
//    Sobreviviam a exclusao: `live_sessoes`, `live_cota`, `live_throttle`,
//    `live_bloqueios`, `checkout_publico`, `checkout_contas` (dados da conta
//    de recebimento do lojista), `recebimento`, `vik_memoria`, e os `pedidos`,
//    `lives`, `denuncias` e `moderacao` daquele lojista. `checkout_contas`
//    sozinho ja e incidente de LGPD.
//
// 4) SUBCOLECAO ORFA. Apagar `negocios/{uid}` NAO apaga as subcolecoes. A versao
//    anterior listava `avaliacoes` e `resumo` na mao — `estado` (com
//    `estado/live`), `livechat` e `livepresenca` ficavam no banco para sempre.
//    Agora o robo usa `listCollections()`: apaga o que existe hoje e o que for
//    criado amanha, sem precisar voltar aqui.
//
// 5) AUTH QUE NAO APAGA. Se `deleteUser` falhar, a conta de acesso continua de
//    pe e o dono consegue logar num app sem dados. Agora ha plano B: desativar
//    a conta (`disabled:true`), que impede o login mesmo com a sessao antiga.

const { admin, db } = require('../lib/firebase');
const { asaas } = require('../lib/asaas');

const ORIGIN_OK = 'https://app.moviki.com.br';
const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'moviki-app.firebasestorage.app';

// Documentos de topo cuja CHAVE e o uid do lojista.
// `trial_negado` fica de fora de proposito: e registro anti-abuso: apagar
// devolveria o teste gratis para quem ja usou.
const DOCS_POR_UID = [
  'assinaturas', 'indicacoes', 'avisos_cliente', 'recebimento',
  'live_sessoes', 'live_cota', 'live_throttle', 'live_bloqueios',
  'checkout_publico', 'checkout_contas', 'vik_memoria',
];

// Colecoes de topo que guardam o uid do lojista num CAMPO.
const COLECOES_POR_CAMPO = [
  { colecao: 'pedidos',   campo: 'lojistaUid' },
  { colecao: 'lives',     campo: 'lojistaUid' },
  { colecao: 'denuncias', campo: 'lojistaUid' },
  { colecao: 'moderacao', campo: 'lojistaUid' },
  // 23/09 (rodada 3): pecas do criador (o documento aponta para os arquivos apagados acima)
  { colecao: 'criador_pecas', campo: 'uid' },
];

const LOTE = 400;   // Firestore aceita ate 500 operacoes por batch.

// Apaga os arquivos do usuario no Storage.
async function apagarArquivos(uid, resumo) {
  // 23/09 (rodada 3): + criadores/ (fotos e videos do criador, com o rosto dele) e capas/ (capa de video).
  const alvos = ['logos/' + uid, 'produtos/' + uid + '/', 'documentos/' + uid + '/', 'criadores/' + uid + '/', 'capas/' + uid + '/'];
  for (const prefix of alvos) {
    try {
      await admin.storage().bucket(BUCKET).deleteFiles({ prefix: prefix, force: true });
      resumo.arquivos = true;
    } catch (e) {
      resumo.arquivosErro = (e && e.message) || 'falha';
    }
  }
}

// Apaga todos os docs de uma consulta, em lotes.
async function apagarDaConsulta(query) {
  const snap = await query.get();
  const docs = snap.docs;
  let n = 0;
  for (let i = 0; i < docs.length; i += LOTE) {
    const batch = db.batch();
    docs.slice(i, i + LOTE).forEach((d) => { batch.delete(d.ref); n++; });
    await batch.commit();
  }
  return n;
}

/* Apaga TODAS as subcolecoes de um documento, incluindo as que ainda nao
   existiam quando este arquivo foi escrito. `listCollections()` so existe no
   Admin SDK — e a razao de esta limpeza morar no robo e nao no app. */
async function apagarTodasSubcolecoes(parentRef) {
  let n = 0;
  let subs = [];
  try { subs = await parentRef.listCollections(); } catch (_) { return 0; }
  for (const sub of subs) {
    try { n += await apagarDaConsulta(sub); } catch (_) {}
  }
  return n;
}

/* ETAPA 1 — cancelar a assinatura, com CONFIRMACAO.
   Devolve { ok:true } so quando a assinatura comprovadamente nao cobra mais.
   Erro de rede no DELETE nao e prova de nada: por isso o GET de conferencia. */
async function cancelarAssinatura(subId) {
  try {
    await asaas('/subscriptions/' + subId, 'DELETE');
    return { ok: true, via: 'cancelada' };
  } catch (e) {
    if (Number(e && e.status) === 404) return { ok: true, via: 'inexistente' };
    try {
      const s = await asaas('/subscriptions/' + subId, 'GET');
      const st = String((s && s.status) || '').toUpperCase();
      if (s && (s.deleted === true || st === 'INACTIVE' || st === 'EXPIRED')) {
        return { ok: true, via: 'ja_estava_cancelada' };
      }
      return { ok: false, erro: 'a assinatura continua ' + (st || 'ativa') + ' no Asaas' };
    } catch (e2) {
      if (Number(e2 && e2.status) === 404) return { ok: true, via: 'inexistente' };
      return { ok: false, erro: (e && e.message) || 'falha ao cancelar' };
    }
  }
}

/* ETAPA 2 — comissoes GERADAS por este lojista, na carteira de terceiros.
   Nao pagas -> estornadas (somem do sacavel, sobra o rastro).
   Ja pagas   -> so marcadas: dinheiro que saiu nao se reescreve. */
async function tratarComissoesDoLojista(uid, resumo) {
  const snap = await db.collection('comissoes').where('lojistaUid', '==', uid).get();
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += LOTE) {
    const fatia = docs.slice(i, i + LOTE);
    const batch = db.batch();
    let escritas = 0;
    fatia.forEach((d) => {
      const c = d.data() || {};
      if (c.pago === true) {
        batch.update(d.ref, { lojistaExcluido: true });
        escritas++; resumo.comissoesGeradasMarcadas++;
        return;
      }
      if (c.estornada === true) { resumo.comissoesGeradasJaEstornadas++; return; }
      batch.update(d.ref, {
        estornada: true,
        estornoMotivo: 'lojista_excluido',
        estornadaEm: admin.firestore.FieldValue.serverTimestamp(),
        lojistaExcluido: true,
      });
      escritas++; resumo.comissoesGeradasEstornadas++;
    });
    if (escritas) await batch.commit();
  }
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
        assinaturaCancelada: false, assinaturaVia: '',
        comissoesGeradasEstornadas: 0, comissoesGeradasMarcadas: 0,
        comissoesGeradasJaEstornadas: 0,
        subcolecoes: 0, avaliacoes: 0, comissoes: 0, saques: 0,
        parceiro: false, espelhoParceiro: false, authRemovido: false, authDesativado: false,
        apelidoLiberado: '', pontos: 0, metricas: 0, mensagens: 0,
        docsPorUid: 0, pedidos: 0, lives: 0, denuncias: 0, moderacao: 0,
        arquivos: false,
      };

      /* ==========================================================
         1) ASSINATURA — FALHA FECHADA. Nada e apagado antes disto.
         ========================================================== */
      let subId = null;
      /* 23/09/2026: alem da assinatura ATUAL, cancela TODAS as que o
         criar-assinatura registrou em assinaturasAsaas e que nao constam como
         canceladas — uma sobra viva continuaria cobrando o ex-cliente todo mes
         depois de a conta sumir. */
      let subIds = [];
      try {
        const fat = await db.collection('faturamento').doc(uid).get();
        const fd = fat.exists ? (fat.data() || {}) : {};
        subId = fd.asaasSubscriptionId || null;
        const canceladas = Array.isArray(fd.assinaturasCanceladas) ? fd.assinaturasCanceladas.map(String) : [];
        const todas = [subId].concat(Object.keys(fd.assinaturasAsaas || {}));
        subIds = Array.from(new Set(todas.filter(Boolean).map(String)))
          .filter((id) => id === String(subId) || canceladas.indexOf(id) < 0);
      } catch (e) {
        res.status(502).json({ ok: false, erro: 'faturamento_ilegivel',
          mensagem: 'Nao consegui ler o faturamento desta conta para conferir a assinatura. ' +
                    'NADA foi apagado. Tente de novo em instantes.' });
        return;
      }
      for (const sid of subIds) {
        const r = await cancelarAssinatura(String(sid));
        if (!r.ok) {
          res.status(409).json({ ok: false, erro: 'assinatura_viva',
            asaasSubscriptionId: String(sid),
            mensagem: 'A assinatura ' + sid + ' NAO foi cancelada no Asaas (' + r.erro + '). ' +
                      'Nenhum dado foi apagado — se eu apagasse agora, a cobranca continuaria e o ' +
                      'id da assinatura sumiria junto com a conta. Cancele no painel do Asaas e ' +
                      'clique em excluir de novo.' });
          return;
        }
        resumo.assinaturaCancelada = true;
        resumo.assinaturaVia = r.via;
      }

      /* ==========================================================
         2) COMISSOES GERADAS POR ESTE LOJISTA (carteira de terceiros).
            Vem ANTES de qualquer delete: se o resto falhar no meio, o
            dinheiro ja esta fora do sacavel.
         ========================================================== */
      try { await tratarComissoesDoLojista(uid, resumo); }
      catch (e) {
        res.status(500).json({ ok: false, erro: 'comissoes_geradas',
          mensagem: 'Nao consegui estornar as comissoes geradas por esta conta. ' +
                    'NADA foi apagado — elas ficariam sacaveis por Pix. Tente de novo.' });
        return;
      }

      /* ==========================================================
         3) Negocio + TODAS as subcolecoes + apelido.
         ========================================================== */
      const negRef = db.collection('negocios').doc(uid);
      let slugNeg = '';
      try {
        const neg = await negRef.get();
        if (neg.exists) slugNeg = String((neg.data() || {}).slug || '');
      } catch (_) {}

      try { resumo.subcolecoes = await apagarTodasSubcolecoes(negRef); } catch (_) {}
      resumo.avaliacoes = resumo.subcolecoes;   // compatibilidade com o painel antigo
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

      // Contador de desempenho (metricas/{uid}/dias).
      try {
        const mref = db.collection('metricas').doc(uid);
        resumo.metricas = await apagarTodasSubcolecoes(mref);
        await mref.delete().catch(() => {});
      } catch (_) {}

      // Caixa de mensagens: as mensagens sao subcolecao e nao somem com o pai.
      try {
        const cref = db.collection('conversas').doc(uid);
        resumo.mensagens = await apagarTodasSubcolecoes(cref);
        await cref.delete().catch(() => {});
      } catch (_) {}

      // faturamento tem a subcolecao ga/{payId} (trava de dedup do purchase).
      try {
        const fref = db.collection('faturamento').doc(uid);
        await apagarTodasSubcolecoes(fref);
        await fref.delete().catch(() => {});
      } catch (_) {}

      /* ==========================================================
         4) Documentos de topo com o uid na chave (Live, checkout, etc.).
         ========================================================== */
      for (const col of DOCS_POR_UID) {
        try { await db.collection(col).doc(uid).delete(); resumo.docsPorUid++; } catch (_) {}
      }

      /* ==========================================================
         5) Colecoes de topo com o uid num CAMPO.
         ========================================================== */
      /* 23/09 (rodada 3): comprovantes Pix dos compradores. O pedido some logo
         abaixo e o arquivo ficava orfao no Storage, com CPF/nome de terceiro. */
      try {
        const pq = await db.collection('pedidos').where('lojistaUid', '==', uid).get();
        for (const d of pq.docs) {
          const c = (d.data() || {}).comprovante;
          if (typeof c === 'string' && c.indexOf('comprovantes/') === 0) {
            try { await admin.storage().bucket(BUCKET).file(c).delete(); resumo.comprovantes = (resumo.comprovantes || 0) + 1; } catch (_) {}
          }
        }
      } catch (_) {}

      for (const alvo of COLECOES_POR_CAMPO) {
        try {
          resumo[alvo.colecao] = await apagarDaConsulta(
            db.collection(alvo.colecao).where(alvo.campo, '==', uid)
          );
        } catch (_) {}
      }

      // 6) Arquivos no Storage (logo do pino, fotos de produto, anexos).
      await apagarArquivos(uid, resumo);

      /* ==========================================================
         7) Se tambem for parceiro: apelido, ESPELHO PUBLICO, comissoes e saques.
            O espelho `parceiros_publicos/{slug}` e `read: true` — ficava no ar
            com o nome de um parceiro que nao existe mais.
         ========================================================== */
      try {
        const parcRef = db.collection('parceiros').doc(uid);
        const parc = await parcRef.get();
        if (parc.exists) {
          resumo.parceiro = true;
          const slug = (parc.data() || {}).slug;
          if (slug) {
            /* 23/09/2026: o apelido NAO volta a ficar livre. Antes ele era
               apagado, e quem registrasse o mesmo apelido herdava a carteira:
               os lojistas indicados guardam so o apelido (indicacoes/{uid}.ref)
               e os parceiros de baixo guardam indicadoPor. O novo dono passava
               a receber 15% deles e os bonus de 2o/3o nivel eram pagos de novo.
               Fica uma lapide SEM uid: ninguem consegue criar (o documento
               existe) e o webhook nao acha dono (sem uid = sem comissao). */
            await db.collection('parceiro_slugs').doc(String(slug)).set({
              excluido: true,
              excluidoEm: admin.firestore.FieldValue.serverTimestamp(),
            }).catch(() => {});
            await db.collection('parceiros_publicos').doc(String(slug)).delete()
              .then(() => { resumo.espelhoParceiro = true; })
              .catch(() => {});
          }
          resumo.comissoes = await apagarDaConsulta(db.collection('comissoes').where('parceiroUid', '==', uid));
          resumo.saques    = await apagarDaConsulta(db.collection('saques').where('parceiroUid', '==', uid));
          await parcRef.delete().catch(() => {});
        }
      } catch (e) { resumo.parceiroErro = e.message || 'falha'; }

      /* ==========================================================
         8) Conta de acesso. Se nao apagar, ao menos DESATIVA.
         ========================================================== */
      try { await admin.auth().deleteUser(uid); resumo.authRemovido = true; }
      catch (e) {
        resumo.authErro = (e && e.message) || 'falha';
        try { await admin.auth().updateUser(uid, { disabled: true }); resumo.authDesativado = true; }
        catch (_) {}
      }

      // 9) Fecha o pedido guardando um registro minimo (sem dados pessoais).
      await db.collection('exclusoes').doc(uid).set({
        status: 'excluido',
        excluidoEm: admin.firestore.FieldValue.serverTimestamp(),
        excluidoPor: decoded.uid,
        assinaturaCancelada: resumo.assinaturaCancelada,
        comissoesEstornadas: resumo.comissoesGeradasEstornadas,
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
