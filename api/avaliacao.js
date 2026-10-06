// api/avaliacao.js | versao 2026-10-06-avalrobo  (repo: moviki-robo)
//
// AVALIACAO PASSA PELO ROBO (plano de seguranca 2.2, decidido pelo Paulo em
// 06/10/2026: continua SEM login do cliente).
//
// Antes, a pagina publica gravava a avaliacao direto no Firestore. A regra
// validava formato, mas nao havia limite POR PESSOA: um concorrente com um
// navegador automatizado afogava uma loja em notas 1, e o lojista nao podia
// apagar. Agora a avaliacao entra por aqui, e a regra v34 fecha o create no
// navegador.
//
// Barreiras de 'criar' (visitante, sem login):
//   1. App Check valido (header X-Firebase-AppCheck) — a mesma exigencia que o
//      Firestore ja fazia, entao a barra nao sobe para o cliente de verdade;
//   2. freio por APARELHO: 1 avaliacao por negocio a cada 30 dias
//      (id aleatorio que a pagina guarda no localStorage, hasheado aqui);
//   3. freio por IP: 5 por hora, qualquer negocio;
//   4. freio por NEGOCIO: 60 por hora somando todo mundo (contador global,
//      falha aberta porque disputa a mesma linha; o por-IP fechado segura);
//   5. filtro dos termos graves (o mesmo do chat da live e dos pedidos).
//   Nada de IP ou aparelho em claro no banco: so hash truncado (LGPD).
//
// 'denunciar' (lojista logado): marca a avaliacao do PROPRIO negocio para o
// dono olhar. Vai para denuncias_avaliacao/{negocioUid}_{avId} e avisa no
// Telegram. 20 por dia por lojista.
//
// 'adm_lista' / 'adm_apagar' / 'adm_manter' / 'adm_recalcular' (dono, so com
// sessao do Google): a fila de denuncias e a moderacao. APAGAR RECALCULA O
// RESUMO (n e soma) a partir das avaliacoes que sobraram — era a pendencia da
// P68 "admin apagou avaliacao e o resumo nao desconta".
//
// Regras v34 (publicar DEPOIS deste arquivo e das paginas): avaliacoes create
// e delete so pelo Admin SDK; resumo so admin; denuncias_avaliacao lidas pelo
// dono do negocio (consulta por negocioUid) e pelo admin.

const crypto = require('crypto');
const { admin, db } = require('../lib/firebase');
const { freioUid } = require('../lib/freio');
const { conferirAdmin } = require('../lib/admin');
const checkout = require('../lib/checkout');

const ORIGENS_OK = ['https://moviki.com.br', 'https://www.moviki.com.br', 'https://app.moviki.com.br'];
const FV = admin.firestore.FieldValue;
const UID_RE = /^[A-Za-z0-9]{20,36}$/;
const AV_RE = /^[A-Za-z0-9]{20}$/;
const MOTIVOS = ['falsa', 'ofensiva', 'concorrente', 'spam', 'outro'];

function hash(s) { return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 40); }
function txt(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }
function ipDe(req) {
  return String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'sem-ip';
}
async function telegram(texto) {
  const T = process.env.TELEGRAM_TOKEN, C = process.env.TELEGRAM_CHAT_ID;
  if (!T || !C) return;
  try {
    await fetch('https://api.telegram.org/bot' + T + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: C, text: texto, disable_web_page_preview: true }),
    });
  } catch (_) {}
}

/* App Check: token do header. Falha FECHADA: sem token valido, nao grava. E a
   mesma barra que o Firestore imposto ja cobrava da pagina. */
async function appCheckOk(req) {
  const t = String(req.headers['x-firebase-appcheck'] || '');
  if (!t || t.length > 4096) return false;
  try { const r = await admin.appCheck().verifyToken(t); return !!(r && r.appId); }
  catch (e) { console.warn('[avaliacao] appcheck recusado:', e && e.code); return false; }
}

/* Recalcula resumo/avaliacoes a partir do que existe. Negocio com milhares de
   avaliacoes paginaria; hoje o maior tem dezenas. */
async function recalcularResumo(negocioUid) {
  const qs = await db.collection('negocios').doc(negocioUid).collection('avaliacoes').get();
  let n = 0, soma = 0;
  qs.forEach((d) => { const v = Number((d.data() || {}).nota || 0); if (v >= 1 && v <= 5) { n++; soma += v; } });
  const ref = db.collection('negocios').doc(negocioUid).collection('resumo').doc('avaliacoes');
  if (n === 0) await ref.delete().catch(() => {});
  else await ref.set({ n, soma, recalculadoEm: FV.serverTimestamp() }, { merge: true });
  return { n, soma };
}

/* ------------------------------------------------------------ criar */
async function criar(req, body) {
  const negocioUid = String(body.negocio || '');
  if (!UID_RE.test(negocioUid)) return { status: 400, corpo: { ok: false, erro: 'negocio' } };
  const nota = Number(body.nota);
  if (!Number.isInteger(nota) || nota < 1 || nota > 5) return { status: 400, corpo: { ok: false, erro: 'nota' } };
  let nome = txt(body.nome, 40); if (nome.length < 2) nome = 'Cliente';
  const comentario = txt(body.comentario, 300);

  if (!(await appCheckOk(req))) return { status: 401, corpo: { ok: false, erro: 'appcheck', mensagem: 'Não deu pra confirmar seu navegador. Recarregue a página e tente de novo.' } };

  const neg = await db.collection('negocios').doc(negocioUid).get();
  if (!neg.exists) return { status: 404, corpo: { ok: false, erro: 'negocio' } };

  const ip = ipDe(req);
  const aparelhoBruto = String(body.aparelho || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
  const aparelho = aparelhoBruto || ('ipua_' + hash(ip + '|' + String(req.headers['user-agent'] || '')));
  const apHash = hash(aparelho + '|' + negocioUid);

  // 1 por aparelho por negocio a cada 30 dias
  if (!(await freioUid(admin, db, 'avalap', apHash, 1, 30 * 86400000)))
    return { status: 429, corpo: { ok: false, erro: 'ja_avaliou', mensagem: 'Você já avaliou este negócio. Obrigado!' } };
  // 5 por IP por hora
  if (!(await freioUid(admin, db, 'avalip', hash(ip), 5, 3600000)))
    return { status: 429, corpo: { ok: false, erro: 'freio', mensagem: 'Muitas avaliações seguidas desta rede. Tente mais tarde.' } };
  // 60 por negocio por hora (global, falha aberta — o por-IP fechado segura)
  if (!(await freioUid(admin, db, 'avalneg', negocioUid, 60, 3600000, { falhaAberta: true })))
    return { status: 429, corpo: { ok: false, erro: 'freio', mensagem: 'Este negócio recebeu muitas avaliações agora. Tente mais tarde.' } };

  const proibido = checkout._t.mvProibido(nome + ' ' + comentario);
  if (proibido) return { status: 400, corpo: { ok: false, erro: 'termo', mensagem: 'Seu comentário tem um termo que não pode ficar na página. Reescreva, por favor.' } };

  const avRef = db.collection('negocios').doc(negocioUid).collection('avaliacoes').doc();
  const rsRef = db.collection('negocios').doc(negocioUid).collection('resumo').doc('avaliacoes');
  await db.runTransaction(async (tx) => {
    const rs = await tx.get(rsRef);
    tx.set(avRef, { nota, nome, comentario, criadoEm: FV.serverTimestamp(), apHash });
    if (rs.exists) tx.update(rsRef, { n: FV.increment(1), soma: FV.increment(nota), ultimaAv: avRef.id });
    else tx.set(rsRef, { n: 1, soma: nota, ultimaAv: avRef.id });
  });
  return { status: 200, corpo: { ok: true, id: avRef.id } };
}

/* -------------------------------------------------------- denunciar */
async function denunciar(body) {
  let dec;
  try { dec = await admin.auth().verifyIdToken(String(body.idToken || '')); }
  catch (_) { return { status: 401, corpo: { ok: false, erro: 'sessao' } }; }
  const avId = String(body.avId || '');
  if (!AV_RE.test(avId)) return { status: 400, corpo: { ok: false, erro: 'avId' } };
  const motivo = MOTIVOS.indexOf(String(body.motivo || '')) >= 0 ? String(body.motivo) : 'outro';
  const detalhe = txt(body.detalhe, 200);
  if (!(await freioUid(admin, db, 'denuncia', dec.uid, 20, 86400000)))
    return { status: 429, corpo: { ok: false, erro: 'freio', mensagem: 'Muitas denúncias hoje. Tente amanhã.' } };

  const avRef = db.collection('negocios').doc(dec.uid).collection('avaliacoes').doc(avId);
  const av = await avRef.get();
  if (!av.exists) return { status: 404, corpo: { ok: false, erro: 'avaliacao' } };
  const a = av.data() || {};
  const id = dec.uid + '_' + avId;
  const dRef = db.collection('denuncias_avaliacao').doc(id);
  const existente = await dRef.get();
  if (existente.exists && (existente.data() || {}).status === 'aberta') return { status: 200, corpo: { ok: true, ja: true, status: 'aberta' } };

  let slug = '';
  try { const n = await db.collection('negocios').doc(dec.uid).get(); slug = String((n.data() || {}).slug || ''); } catch (_) {}
  await dRef.set({
    negocioUid: dec.uid, avId, slug, motivo, detalhe, status: 'aberta',
    nota: Number(a.nota || 0), nome: txt(a.nome, 40), comentario: txt(a.comentario, 300),
    em: FV.serverTimestamp(),
  });
  await telegram('🚩 Avaliação denunciada por lojista\nNegócio: ' + (slug || dec.uid) + '\nMotivo: ' + motivo + (detalhe ? ' — ' + detalhe : '') +
    '\nNota ' + a.nota + ' · ' + txt(a.nome, 40) + ': ' + txt(a.comentario, 120) + '\nPainel do dono > Configurações > Avaliações denunciadas.');
  return { status: 200, corpo: { ok: true, status: 'aberta' } };
}

/* ------------------------------------------------------------- dono */
async function dono(body) {
  let dec;
  try { dec = await admin.auth().verifyIdToken(String(body.idToken || ''), true); }
  catch (_) { return { status: 401, corpo: { ok: false, erro: 'sessao' } }; }
  const adm = await conferirAdmin(db, dec);
  if (!adm.ok) return { status: adm.status, corpo: { ok: false, erro: adm.erro, mensagem: adm.mensagem } };
  const acao = String(body.acao || '');

  if (acao === 'adm_lista') {
    const qs = await db.collection('denuncias_avaliacao').where('status', '==', 'aberta').limit(50).get();
    const itens = [];
    qs.forEach((d) => { const x = d.data() || {}; itens.push({ id: d.id, negocioUid: x.negocioUid, avId: x.avId, slug: x.slug || '', motivo: x.motivo, detalhe: x.detalhe || '', nota: x.nota, nome: x.nome, comentario: x.comentario, em: x.em && x.em.toMillis ? x.em.toMillis() : null }); });
    itens.sort((a, b) => (a.em || 0) - (b.em || 0));
    return { status: 200, corpo: { ok: true, itens } };
  }

  const negocioUid = String(body.negocioUid || '');
  if (!UID_RE.test(negocioUid)) return { status: 400, corpo: { ok: false, erro: 'negocio' } };

  if (acao === 'adm_recalcular') {
    const r = await recalcularResumo(negocioUid);
    return { status: 200, corpo: { ok: true, resumo: r } };
  }

  const avId = String(body.avId || '');
  if (!AV_RE.test(avId)) return { status: 400, corpo: { ok: false, erro: 'avId' } };
  const dRef = db.collection('denuncias_avaliacao').doc(negocioUid + '_' + avId);

  if (acao === 'adm_manter') {
    await dRef.set({ status: 'mantida', decididoEm: FV.serverTimestamp(), decididoPor: dec.uid }, { merge: true });
    return { status: 200, corpo: { ok: true, status: 'mantida' } };
  }
  if (acao === 'adm_apagar') {
    await db.collection('negocios').doc(negocioUid).collection('avaliacoes').doc(avId).delete();
    const r = await recalcularResumo(negocioUid);
    await dRef.set({ status: 'apagada', decididoEm: FV.serverTimestamp(), decididoPor: dec.uid }, { merge: true });
    return { status: 200, corpo: { ok: true, status: 'apagada', resumo: r } };
  }
  return { status: 400, corpo: { ok: false, erro: 'acao' } };
}

module.exports = async (req, res) => {
  const orig = String(req.headers.origin || '');
  res.setHeader('Access-Control-Allow-Origin', ORIGENS_OK.indexOf(orig) >= 0 ? orig : ORIGENS_OK[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Firebase-AppCheck');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const acao = String(body.acao || '');
    let r;
    if (acao === 'criar') r = await criar(req, body);
    else if (acao === 'denunciar') r = await denunciar(body);
    else if (acao.indexOf('adm_') === 0) r = await dono(body);
    else r = { status: 400, corpo: { ok: false, erro: 'acao' } };
    res.status(r.status).json(r.corpo);
  } catch (e) {
    console.error('[avaliacao]', e && e.message);
    res.status(500).json({ ok: false, erro: 'interno' });
  }
};

module.exports._t = { criar, denunciar, dono, recalcularResumo, hash };
