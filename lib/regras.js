// lib/regras.js | versao 2026-10-03-regras1  (repo: moviki-robo)
// REGRAS NO AR — 03/10/2026, a pedido do Paulo.
//
// Le, pela API oficial do Firebase (Admin SDK, securityRules), o texto das
// regras PUBLICADAS no Console — Firestore e Storage — e compara com o que o
// repositorio diz que deveria estar no ar (lib/regrasEsperadas.js).
//
// Por que existe: publicar regra e passo manual no Console. Entre o Merge e a
// publicacao, ou depois de um engano no Console, ninguem sabia qual versao
// estava valendo sem abrir o Console e comparar 1.700 linhas a olho.
//
// Guarda o ultimo estado em regras_no_ar/estado (sem regra no Firestore = so
// o Admin SDK le). Quando o estado MUDA, avisa no Telegram e por e-mail para
// eikosistemas@gmail.com — o e-mail e o registro que o Claude consegue ler.

const crypto = require('crypto');
const { admin, db } = require('./firebase');
const ESPERADAS = require('./regrasEsperadas');

const BUCKET = 'moviki-app.firebasestorage.app';
const EMAIL_FROM = 'Moviki <suporte@moviki.com.br>';
const PAINEL = 'https://app.moviki.com.br/eikoadm01.html';

function normalizar(t) {
  return String(t || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n')
    .split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').replace(/\n+$/, '');
}
function hash(t) { return crypto.createHash('sha256').update(normalizar(t), 'utf8').digest('hex'); }

function marcaFirestore(t) {
  const m = /\/\/\s*(v\d+)\s*[—–-]/.exec(String(t || ''));
  return m ? m[1] : '';
}
function marcaStorage(t) {
  let melhor = '';
  const re = /\/\/\s*(\d{2})\/(\d{2})\/(\d{4}):/g;
  let m;
  while ((m = re.exec(String(t || '')))) {
    const k = m[3] + m[2] + m[1];
    if (!melhor || k > melhor.k) melhor = { k, txt: m[1] + '/' + m[2] + '/' + m[3] };
  }
  return melhor ? melhor.txt : '';
}

async function lerUm(tipo, sr) {
  const esp = ESPERADAS[tipo];
  try {
    const rs = tipo === 'firestore' ? await sr.getFirestoreRuleset() : await sr.getStorageRuleset(BUCKET);
    const fonte = ((rs && rs.source) || []).map((f) => f.content || '').join('\n');
    const h = hash(fonte);
    return {
      ok: h === esp.sha256,
      versaoNoAr: tipo === 'firestore' ? marcaFirestore(fonte) : marcaStorage(fonte),
      versaoEsperada: esp.versao,
      publicadaEm: (rs && rs.createTime) || '',
      noAr: h.slice(0, 12),
      esperado: esp.sha256.slice(0, 12),
    };
  } catch (e) {
    const txt = String((e && e.code) || '') + ' ' + String((e && e.message) || '');
    return {
      ok: false,
      erro: /permission|PERMISSION|403|insufficient/i.test(txt) ? 'sem_permissao' : 'falha_leitura',
      detalhe: String((e && e.code) || '').slice(0, 60),
      versaoEsperada: esp.versao,
    };
  }
}

async function conferirRegras(sr) {
  const s = sr || admin.securityRules();
  const [firestore, storage] = await Promise.all([lerUm('firestore', s), lerUm('storage', s)]);
  return { firestore, storage, tudoOk: !!(firestore.ok && storage.ok), conferidoEm: new Date().toISOString() };
}

/* Assinatura do estado: muda quando muda o que importa (ok, versao, texto). */
function assinatura(r) {
  const p = (x) => [x.ok ? 1 : 0, x.versaoNoAr || '', x.noAr || '', x.erro || ''].join('|');
  return p(r.firestore) + '#' + p(r.storage);
}

function linha(nome, x) {
  if (x.erro === 'sem_permissao') return nome + ': NAO CONSEGUI LER (a conta do robo precisa do papel "Leitor de regras do Firebase")';
  if (x.erro) return nome + ': NAO CONSEGUI LER (' + (x.detalhe || x.erro) + ')';
  return nome + ': ' + (x.ok ? 'OK' : 'DIFERENTE do repositorio') + ' - no ar ' + (x.versaoNoAr || '?') +
    ' (publicada ' + (x.publicadaEm || '?') + '), esperado ' + x.versaoEsperada;
}

async function avisar(r) {
  const titulo = r.tudoOk
    ? 'Moviki - regras no ar: OK (Firestore ' + r.firestore.versaoNoAr + ' / Storage ' + r.storage.versaoNoAr + ')'
    : 'Moviki - ATENCAO: regras no ar diferentes do repositorio';
  const corpo = [linha('Firestore', r.firestore), linha('Storage', r.storage), '', 'Conferido em ' + r.conferidoEm, PAINEL].join('\n');
  const TOKEN = process.env.TELEGRAM_TOKEN, CHAT = process.env.TELEGRAM_CHAT_ID;
  if (TOKEN && CHAT) {
    try {
      await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: CHAT, text: (r.tudoOk ? '✅ ' : '⚠️ ') + titulo + '\n\n' + corpo, disable_web_page_preview: true }),
      });
    } catch (_) {}
  }
  const KEY = process.env.RESEND_API_KEY;
  const para = String(process.env.REGRAS_EMAIL || 'eikosistemas@gmail.com');
  if (KEY) {
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: EMAIL_FROM, to: [para], subject: titulo, text: corpo }),
      });
    } catch (_) {}
  }
}

/* Confere, guarda e avisa SO quando o estado muda (inclusive a 1a vez). */
async function conferirEGuardar(sr) {
  const r = await conferirRegras(sr);
  const ref = db.collection('regras_no_ar').doc('estado');
  let anterior = '';
  try { const s = await ref.get(); anterior = s.exists ? String((s.data() || {}).assinatura || '') : ''; } catch (_) {}
  const atual = assinatura(r);
  const mudou = atual !== anterior;
  try {
    const dados = Object.assign({}, r, { assinatura: atual });
    if (mudou) dados.mudouEm = admin.firestore.FieldValue.serverTimestamp();
    await ref.set(dados, { merge: true });
  } catch (e) { console.error('[regras] guardar', e && e.message); }
  if (mudou) await avisar(r);
  return Object.assign({ mudou }, r);
}

module.exports = { conferirRegras, conferirEGuardar, normalizar, hash, marcaFirestore, marcaStorage };
