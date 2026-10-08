/*!
 * MOVIKI lib/marcos.js | versao 2026-10-07-ensaio (marcos do lojista: primeira live, ensaio, primeira venda na live) | repo: moviki-robo
 *
 * 07/10/2026 (P75 fase 1, parte da B5) — MARCOS DO LOJISTA.
 *   O funil do Moviki agora termina na PRIMEIRA LIVE, e ate hoje ninguem
 *   sabia QUANDO ela acontecia: o painel do dono via a cota do teste e as
 *   sessoes, mas nao "a primeira live desta conta". Este arquivo grava os
 *   marcos em `marcos_lojista/{uid}`:
 *     primeiraLiveEm       a primeira live REAL (nao ensaio) da conta
 *     primeiroEnsaioEm     o primeiro ensaio
 *     ensaios              quantos ensaios a conta ja fez (contador)
 *     ultimoEnsaioEm       o ensaio mais recente
 *     primeiraVendaLiveEm  o primeiro pedido de origem LIVE que virou pago
 *
 *   A colecao NAO tem regra no Firestore: sem regra, o navegador nao le nem
 *   escreve. So o Admin SDK (este robo) alcanca — que e o desejado.
 *
 * AVISO NO TELEGRAM, UMA VEZ SO
 *   A primeira live manda UM aviso ao dono. "Uma vez" e garantido por
 *   TRANSACAO: o campo primeiraLiveEm so e gravado se ainda nao existia, e o
 *   aviso so sai na chamada que gravou. Duas aberturas ao mesmo tempo nao
 *   avisam duas vezes: a segunda transacao ve o campo e desiste.
 *   Se o Telegram falhar, o marco fica gravado e o aviso NAO e repetido —
 *   repetir aviso de "primeira live" e pior que perder um.
 *
 * NADA AQUI DERRUBA A LIVE NEM A VENDA
 *   Toda funcao exportada engole o proprio erro e devolve um resultado. O
 *   Telegram tem teto de 2,5 s (AbortController). Quem chama pode usar
 *   `await` sem medo.
 *
 * CONTAS ANTIGAS
 *   Quem ja fazia live antes deste arquivo existir nao tem marco. Na proxima
 *   live, quem chama informa `jaTeveLive: true` (live_sessoes ja tinha inicio
 *   gravado) e o marco nasce como `primeiraLiveAprox: true`, com a data da
 *   live anterior conhecida, SEM aviso no Telegram — senao o dono receberia
 *   "Primeira live!" de quem ja transmitiu dez vezes.
 */
'use strict';

const { admin, db } = require('./firebase');

const FV = admin.firestore.FieldValue;
const COL = 'marcos_lojista';
const TELEGRAM_TETO_MS = 2500;

function ref(uid) { return db.collection(COL).doc(uid); }
function uidOk(uid) { return /^[A-Za-z0-9]{10,128}$/.test(String(uid || '')); }
function txt(s, n) { return String(s == null ? '' : s).replace(/[\x00-\x1f\x7f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }

/* Rotulo do plano para o aviso: "teste grátis", "Premium mensal"... */
function rotuloPlano(nivel, periodo) {
  if (periodo === 'trial') return 'teste grátis';
  const n = nivel === 'enterprise' ? 'Enterprise' : 'Premium';
  return periodo ? n + ' ' + txt(periodo, 20) : n;
}

/* Telegram com teto de tempo. Devolve 'enviado' | 'sem_config' | 'falhou'.
   Nunca lanca. */
async function telegram(texto) {
  const TOKEN = process.env.TELEGRAM_TOKEN;
  const CHAT = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT) return 'sem_config';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TELEGRAM_TETO_MS);
  try {
    const r = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text: texto, disable_web_page_preview: true }),
    });
    clearTimeout(t);
    return (r && r.ok) ? 'enviado' : 'falhou';
  } catch (_) { clearTimeout(t); return 'falhou'; }
}

/* ------------------------------------------------ primeira live REAL */
/* info = { nome, slug, nivel, periodo, sessaoId, jaTeveLive, liveAnteriorMs }
   Devolve { ok, marcou, aviso } — `marcou` so e true na chamada que gravou. */
async function primeiraLive(uid, info) {
  const i = info || {};
  if (!uidOk(uid)) return { ok: false, erro: 'uid' };
  let marcou = false, aprox = false;
  try {
    await db.runTransaction(async (tx) => {
      marcou = false; aprox = false;   // a transacao pode repetir
      const s = await tx.get(ref(uid));
      const d = s.exists ? (s.data() || {}) : {};
      if (d.primeiraLiveEm) return;
      const dados = { uid, primeiraLiveSessao: txt(i.sessaoId, 80) };
      if (i.jaTeveLive) {
        aprox = true;
        dados.primeiraLiveAprox = true;
        dados.primeiraLiveEm = (Number(i.liveAnteriorMs) > 0)
          ? admin.firestore.Timestamp.fromMillis(Number(i.liveAnteriorMs))
          : FV.serverTimestamp();
      } else {
        dados.primeiraLiveEm = FV.serverTimestamp();
        dados.primeiraLivePlano = rotuloPlano(i.nivel, i.periodo);
      }
      tx.set(ref(uid), dados, { merge: true });
      marcou = true;
    });
  } catch (e) {
    console.error('marcos: primeira live', uid, e && e.message);
    return { ok: false, erro: 'interno' };
  }
  if (!marcou) return { ok: true, marcou: false };
  if (aprox) return { ok: true, marcou: true, aviso: 'legado' };

  const slug = txt(i.slug, 40).replace(/[^a-z0-9-]/gi, '');
  const texto = '🔴 Primeira live no Moviki!\n\n' +
    'Negócio: ' + (txt(i.nome, 80) || '(sem nome)') +
    ' · plano ' + rotuloPlano(i.nivel, i.periodo) +
    (slug ? ' · https://moviki.com.br/live/' + slug : '');
  const aviso = await telegram(texto);
  try { await ref(uid).set({ primeiraLiveAviso: aviso }, { merge: true }); } catch (_) {}
  return { ok: true, marcou: true, aviso };
}

/* ------------------------------------------------------------ ensaio */
async function ensaio(uid) {
  if (!uidOk(uid)) return { ok: false, erro: 'uid' };
  try {
    let primeiro = false;
    await db.runTransaction(async (tx) => {
      const s = await tx.get(ref(uid));
      const d = s.exists ? (s.data() || {}) : {};
      primeiro = !d.primeiroEnsaioEm;
      const dados = { uid, ensaios: FV.increment(1), ultimoEnsaioEm: FV.serverTimestamp() };
      if (primeiro) dados.primeiroEnsaioEm = FV.serverTimestamp();
      tx.set(ref(uid), dados, { merge: true });
    });
    return { ok: true, primeiro };
  } catch (e) {
    console.error('marcos: ensaio', uid, e && e.message);
    return { ok: false, erro: 'interno' };
  }
}

/* --------------------------------------- primeira venda paga na live */
/* Chamado DEPOIS da transacao do dinheiro (lib/checkout.js, marcarPago),
   fora dela. So grava se ainda nao existia; nunca lanca. */
async function primeiraVendaLive(uid, pedidoId, confirmadoPor) {
  if (!uidOk(uid)) return { ok: false, erro: 'uid' };
  try {
    let marcou = false;
    await db.runTransaction(async (tx) => {
      marcou = false;
      const s = await tx.get(ref(uid));
      const d = s.exists ? (s.data() || {}) : {};
      if (d.primeiraVendaLiveEm) return;
      tx.set(ref(uid), {
        uid,
        primeiraVendaLiveEm: FV.serverTimestamp(),
        primeiraVendaLivePedido: txt(pedidoId, 60),
        /* 'gateway' = o banco confirmou; 'lojista' = o "Recebi" do lojista.
           Mesma separacao do marcarPago: quem le decide com a diferenca. */
        primeiraVendaLivePor: confirmadoPor === 'lojista' ? 'lojista' : 'gateway',
      }, { merge: true });
      marcou = true;
    });
    return { ok: true, marcou };
  } catch (e) {
    console.error('marcos: primeira venda live', uid, e && e.message);
    return { ok: false, erro: 'interno' };
  }
}

/* Espera `promessa` no maximo `tetoMs`; nunca lanca e limpa o relogio (um
   setTimeout esquecido seguraria a funcao da Vercel ate ele vencer). */
async function comTeto(promessa, tetoMs) {
  let t = null;
  try {
    return await Promise.race([
      Promise.resolve(promessa).catch(() => null),
      new Promise((ok) => { t = setTimeout(() => ok(null), tetoMs); }),
    ]);
  } catch (_) { return null; } finally { if (t) clearTimeout(t); }
}

module.exports = { primeiraLive, ensaio, primeiraVendaLive, comTeto, _t: { rotuloPlano, telegram, TELEGRAM_TETO_MS, COL } };
