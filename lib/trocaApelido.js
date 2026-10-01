'use strict';
// lib/trocaApelido.js  (repo: moviki-robo) — versao 2026-10-01-apelido
//
// TROCA DO APELIDO (e do nome exibido) DE UM PARCEIRO, feita pelo dono no
// painel eikoadm01.html (botao "Trocar apelido"). Quem chama:
//   api/parceiro-aprovado.js  -> acao 'trocar_apelido' (so admin)
//   api/lembrete-trial.js     -> normalizarApelidos(), 1x por dia
//
// POR QUE NAO E SO TROCAR O CAMPO `slug`: o apelido e a CHAVE do dinheiro.
//   - indicacoes/{lojista}.ref guarda o apelido de quem indicou;
//   - parceiros/{uid}.indicadoPor guarda o apelido do parceiro de cima;
//   - o webhook acha o dono da comissao por parceiro_slugs/{apelido}.uid;
//   - links impressos e cookies (mv_ref, 90 dias) continuam com o apelido velho.
// Trocar so o campo deixava o parceiro sem os indicados dele no painel e,
// pior, liberava o apelido velho para outro herdar a carteira.
//
// O QUE ACONTECE NA TROCA
//   1. parceiro_slugs/{novo} = {uid}                 (reserva o novo)
//   2. parceiro_slugs/{antigo} = {uid, movidoPara}    (o velho NUNCA fica livre
//      e continua apontando para o mesmo dono: link antigo segue contando)
//   3. parceiros/{uid}: slug novo, nome (se mudou), slugsAnteriores
//   4. indicacoes e parceiros de baixo com o apelido velho passam para o novo
//      (o createTime do documento nao muda: a trava "indicacao anterior ao
//      parceiro" do webhook continua valendo igual)
//   5. espelho publico: /v/{novo} com o nome novo; /v/{antigo} vira so um
//      ponteiro {movidoPara, ativo:false}, sem nome nem foto (o v.html
//      redireciona). Cracha impresso continua abrindo.
// Indicacao que chegar DEPOIS pelo link velho e corrigida por
// normalizarApelidos() no cron diario. A comissao nao depende disso (o
// apelido velho resolve para o mesmo uid); so a lista do painel depende.

const RESERVADOS = ['index', 'mapa', '404', 'assets', 'www', 'painel', 'login', 'moviki', 'aovivo',
  'live', 'regras-da-live', 'criadores', 'live-shop', 'guia', 'fundador', 'api', 'termos',
  'privacidade', 'enterprise', 'premium', 'parceiros', 'comerciantes', 'regulamento',
  'descadastro', 'admin', 'suporte', 'equipe', 'oficial'];
const APELIDO_OK = /^[a-z0-9][a-z0-9_-]{2,39}$/;
const LOTE = 400;

function limparApelido(v) {
  return String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '')
    .replace(/-+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 40);
}

function limparNome(v) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

class ErroTroca extends Error { constructor(codigo) { super(codigo); this.codigo = codigo; } }

// Troca o valor de um campo em todos os documentos de uma consulta, em lotes.
async function trocarEmLote(db, colecao, campo, de, para) {
  if (!de || de === para) return 0;
  const snap = await db.collection(colecao).where(campo, '==', de).get();
  let n = 0;
  for (let i = 0; i < snap.docs.length; i += LOTE) {
    const b = db.batch();
    snap.docs.slice(i, i + LOTE).forEach((d) => { b.update(d.ref, { [campo]: para }); n++; });
    await b.commit();
  }
  return n;
}

// Apelidos antigos deste parceiro (documentos de parceiro_slugs com o uid dele,
// menos o atual).
async function apelidosDoParceiro(db, uid) {
  const snap = await db.collection('parceiro_slugs').where('uid', '==', uid).get();
  return snap.docs.map((d) => d.id);
}

async function trocarApelido({ admin, db, uid, novo, nome, porUid, gravarEspelho }) {
  const FV = admin.firestore.FieldValue;
  const pRef = db.collection('parceiros').doc(String(uid || ''));
  const pSnap = await pRef.get();
  if (!pSnap.exists) return { ok: false, erro: 'sem_parceiro' };
  const p = pSnap.data() || {};
  const antigo = String(p.slug || '').trim();

  const alvo = limparApelido(novo == null || novo === '' ? antigo : novo);
  if (!APELIDO_OK.test(alvo)) return { ok: false, erro: 'apelido_invalido' };
  if (RESERVADOS.indexOf(alvo) !== -1) return { ok: false, erro: 'reservado' };

  const nomeNovo = nome == null ? String(p.nome || '') : limparNome(nome);
  if (nomeNovo.length < 2) return { ok: false, erro: 'nome_curto' };

  const trocaSlug = alvo !== antigo;
  const trocaNome = nomeNovo !== String(p.nome || '');
  if (!trocaSlug && !trocaNome) return { ok: false, erro: 'nada_mudou' };

  const marca = { apelidoTrocadoEm: FV.serverTimestamp(), apelidoTrocadoPor: String(porUid || '') };

  // 1-3) Reserva e cadastro numa transacao so: ou troca tudo, ou nada.
  try {
    await db.runTransaction(async (tx) => {
      const atual = await tx.get(pRef);
      if (!atual.exists) throw new ErroTroca('sem_parceiro');
      if (String((atual.data() || {}).slug || '').trim() !== antigo) throw new ErroTroca('mudou_agora');
      if (trocaSlug) {
        const sRef = db.collection('parceiro_slugs').doc(alvo);
        const s = await tx.get(sRef);
        // Ocupado = de outro parceiro OU lapide de parceiro excluido (sem uid).
        if (s.exists && (s.data() || {}).uid !== uid) throw new ErroTroca('ocupado');
        tx.set(sRef, { uid });
        if (antigo) {
          tx.set(db.collection('parceiro_slugs').doc(antigo),
            { uid, movidoPara: alvo, movidoEm: FV.serverTimestamp() });
        }
        const upd = Object.assign({ slug: alvo, nome: nomeNovo }, marca);
        if (antigo) upd.slugsAnteriores = FV.arrayUnion(antigo);
        tx.update(pRef, upd);
      } else {
        tx.update(pRef, Object.assign({ nome: nomeNovo }, marca));
      }
    });
  } catch (e) {
    if (e instanceof ErroTroca) return { ok: false, erro: e.codigo };
    throw e;
  }

  const res = { ok: true, antigo, novo: alvo, nome: nomeNovo, indicacoes: 0, parceiros: 0, espelho: '' };

  // 4) Tudo o que guarda um apelido velho deste parceiro passa para o novo.
  let velhos = [];
  if (trocaSlug) {
    velhos = (await apelidosDoParceiro(db, uid)).filter((s) => s !== alvo);
    if (antigo && velhos.indexOf(antigo) === -1) velhos.push(antigo);
    for (const v of velhos) {
      // Achata a corrente: apelido de duas trocas atras aponta direto para o atual.
      if (v !== antigo) {
        await db.collection('parceiro_slugs').doc(v)
          .set({ uid, movidoPara: alvo, movidoEm: FV.serverTimestamp() }).catch(() => {});
      }
      res.indicacoes += await trocarEmLote(db, 'indicacoes', 'ref', v, alvo);
      res.parceiros += await trocarEmLote(db, 'parceiros', 'indicadoPor', v, alvo);
    }
  }

  // 5) Espelho publico /v/. Mesma regra do resto do robo: parceiro nao aprovado
  //    e sem espelho nao ganha um (nao expoe nome de recusado).
  if (typeof gravarEspelho === 'function') {
    const pubAntigo = antigo ? await db.collection('parceiros_publicos').doc(antigo).get() : null;
    const temEspelho = !!(pubAntigo && pubAntigo.exists);
    if (p.status === 'aprovado' || temEspelho) {
      const r = await gravarEspelho(admin, db, Object.assign({}, p, { slug: alvo, nome: nomeNovo }));
      res.espelho = r && r.ok ? 'gravado' : 'falhou';
    } else {
      res.espelho = 'sem_espelho';
    }
    if (trocaSlug) {
      for (const v of velhos) {
        const ref = db.collection('parceiros_publicos').doc(v);
        const ex = v === antigo ? pubAntigo : await ref.get();
        if (ex && ex.exists) {
          await ref.set({ slug: v, movidoPara: alvo, ativo: false, movidoEm: FV.serverTimestamp() }).catch(() => {});
        }
      }
    }
  }
  return res;
}

// Cron diario: indicacao ou parceiro novo que chegou pelo link VELHO depois da
// troca ainda grava o apelido velho. A comissao sai certa (o velho resolve para
// o mesmo uid), mas o painel do parceiro lista indicacoes pelo apelido atual.
async function normalizarApelidos({ db, limite }) {
  const out = { apelidos: 0, indicacoes: 0, parceiros: 0 };
  const snap = await db.collection('parceiro_slugs').where('movidoPara', '>', '').limit(limite || 50).get();
  for (const d of snap.docs) {
    const para = String((d.data() || {}).movidoPara || '');
    if (!APELIDO_OK.test(para) || para === d.id) continue;
    out.apelidos++;
    out.indicacoes += await trocarEmLote(db, 'indicacoes', 'ref', d.id, para);
    out.parceiros += await trocarEmLote(db, 'parceiros', 'indicadoPor', d.id, para);
  }
  return out;
}

module.exports = { trocarApelido, normalizarApelidos, limparApelido, RESERVADOS };
