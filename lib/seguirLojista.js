/*!
 * MOVIKI lib/seguirLojista.js | versao 2026-10-17-seguir (aviso de seguir o lojista no Instagram) | repo: moviki-robo
 *
 * 17/10/2026 — PEDIDO DO PAULO: quando o lojista deixa a loja COMPLETA, o
 * Moviki segue o Instagram dele. O gesto e o reconhecimento: o lojista ve que
 * a empresa reparou no negocio dele.
 *
 * POR QUE NAO E O ROBO QUE SEGUE
 *   A API oficial da Meta nao tem a acao "seguir". So robo nao oficial faria
 *   isso, e isso viola os termos do Instagram e poe em risco o @moviki.oficial
 *   (anuncios, ManyChat, funis). Seguir em serie e o padrao que o Instagram
 *   mais pune. Entao o robo AVISA e o Paulo segue a mao: toque humano, so em
 *   lojista que ja montou a loja.
 *
 * "LOJA COMPLETA" (criterio escolhido pelo Paulo em 17/10/2026)
 *   1. ramo escolhido            negocios/{uid}.segmento
 *   2. 3 produtos com foto propria negocios/{uid}.cardapio[].produtos[].fotos[0]
 *      (o cardapio de exemplo do quiz NAO tem foto — por isso foto prova que a
 *      loja e de verdade)
 *   3. @ do Instagram informado   lojista_instagram/{uid}.arroba
 *
 * COLECOES (sem regra no Firestore = o navegador nao le nem escreve; so o
 * Admin SDK deste robo alcanca)
 *   lojista_instagram/{uid}  { arroba, achou, igNome, naFila, atualizadoEm }
 *      gravado pela acao loja_instagram (api/financeiro.js). O @ NAO entra em
 *      negocios/{uid}: o hasOnly da regra recusaria o campo e nada aqui precisa
 *      ser publico.
 *   seguir_lojista/{uid}     { arroba, nome, slug, segmento, criadoEm,
 *                              seguido, seguidoEm, seguidoPor, avisos }
 *      a fila do painel do dono (api/funil-dono.js, acoes seguir_*).
 *   sistema/seguir_lembrete  { em } — ultimo lembrete de pendentes no Telegram.
 *
 * QUANDO CONFERE
 *   - na hora em que o lojista salva o @ (acao loja_instagram);
 *   - na varredura do api/lembrete-trial.js (2x por dia), que pega quem pos
 *     as fotos DEPOIS de salvar o @. So olha quem tem o @ e ainda nao entrou
 *     na fila (naFila == false), entao custa pouco.
 *
 * AVISO NO TELEGRAM, UMA VEZ POR @
 *   A entrada na fila e por TRANSACAO: so a chamada que criou o item avisa.
 *   Lojista que troca o @ antes de ser seguido: o item muda e avisa de novo.
 *   Trocou depois de seguido: volta para pendente (o @ novo ainda nao foi
 *   seguido). Pendente ha mais de 24 h volta num lembrete unico por dia.
 *
 * NADA AQUI DERRUBA O PAINEL NEM O CRON: toda funcao exportada engole o
 * proprio erro e devolve um resultado. Telegram com teto de 2,5 s.
 */
'use strict';

const { admin, db } = require('./firebase');
const { buscarPerfil, limparArroba } = require('./instagram');

const FV = admin.firestore.FieldValue;
const COL_IG = 'lojista_instagram';
const COL_FILA = 'seguir_lojista';
const MIN_FOTOS = 3;
const TELEGRAM_TETO_MS = 2500;
const LEMBRETE_DEPOIS_MS = 24 * 3600000;
const LEMBRETE_INTERVALO_MS = 20 * 3600000;
const VARRER_TETO = 200;
const LISTA_TETO = 100;

function uidOk(uid) { return /^[A-Za-z0-9]{10,128}$/.test(String(uid || '')); }
function txt(s, n) { return String(s == null ? '' : s).replace(/[\x00-\x1f\x7f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }
function ms(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'number') return v;
  return 0;
}

/* Foto propria de produto: URL https do nosso Storage ou do ibb (o mesmo
   filtro do painel, fotoUrlOk). Exemplo do quiz nao tem foto nenhuma. */
function fotoOk(u) {
  return typeof u === 'string' && /^https:\/\/[a-z0-9.-]*(ibb\.co|firebasestorage\.googleapis\.com|firebasestorage\.app)\//i.test(u);
}

function produtosComFoto(cardapio) {
  let n = 0;
  if (!Array.isArray(cardapio)) return 0;
  for (const cat of cardapio) {
    const ps = cat && Array.isArray(cat.produtos) ? cat.produtos : [];
    for (const p of ps) {
      if (p && Array.isArray(p.fotos) && p.fotos.some(fotoOk)) n++;
    }
  }
  return n;
}

/* O que falta para a loja contar como completa. Puro, sem banco. */
function avaliar(neg, ig) {
  const n = neg || {};
  const ramo = typeof n.segmento === 'string' && n.segmento.trim() !== '';
  const fotos = produtosComFoto(n.cardapio);
  const arroba = !!(ig && ig.arroba);
  const falta = [];
  if (!ramo) falta.push('ramo');
  if (fotos < MIN_FOTOS) falta.push('fotos');
  if (!arroba) falta.push('instagram');
  return { completa: falta.length === 0, ramo, fotos, minFotos: MIN_FOTOS, instagram: arroba, falta };
}

/* Telegram com botao que abre o perfil. Devolve 'enviado' | 'sem_config' |
   'falhou'. Nunca lanca. */
async function telegram(texto, botao) {
  const TOKEN = process.env.TELEGRAM_TOKEN;
  const CHAT = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT) return 'sem_config';
  const corpo = { chat_id: CHAT, text: texto, disable_web_page_preview: true };
  if (botao && botao.url) corpo.reply_markup = { inline_keyboard: [[{ text: botao.texto, url: botao.url }]] };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TELEGRAM_TETO_MS);
  try {
    const r = await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    clearTimeout(t);
    return (r && r.ok) ? 'enviado' : 'falhou';
  } catch (_) { clearTimeout(t); return 'falhou'; }
}

function linkPerfil(arroba) { return 'https://www.instagram.com/' + encodeURIComponent(arroba) + '/'; }

function montarAviso(item, motivo) {
  const linhas = [];
  linhas.push(motivo === 'troca'
    ? '🔁 Lojista trocou o Instagram — seguir o @ novo'
    : '👋 Loja completa no Moviki — hora de seguir');
  linhas.push('Negócio: ' + (txt(item.nome, 80) || '(sem nome)'));
  if (item.segmento) linhas.push('Ramo: ' + txt(item.segmento, 40));
  linhas.push('Instagram: @' + item.arroba + (item.achou === false ? ' (não achei como conta profissional — confira)' : ''));
  if (item.slug) linhas.push('Página: moviki.com.br/' + txt(item.slug, 40));
  linhas.push('');
  linhas.push('Siga, curta 1 post recente e, se fizer sentido, responda um story. Depois marque "Já segui" no painel do dono.');
  return linhas.join('\n');
}

/* -------------------------------------------------------------- leitura */
async function lerIg(uid) {
  try { const s = await db.collection(COL_IG).doc(uid).get(); return s.exists ? (s.data() || {}) : null; }
  catch (_) { return null; }
}

async function lerNeg(uid) {
  try { const s = await db.collection('negocios').doc(uid).get(); return s.exists ? (s.data() || {}) : null; }
  catch (_) { return null; }
}

/* --------------------------------------------------- conferir e enfileirar
   Devolve { ok, completa, falta, fotos, entrou, aviso }. `entrou` so e true na
   chamada que criou (ou trocou o @ de) o item da fila. */
async function conferir(uid, cache) {
  if (!uidOk(uid)) return { ok: false, erro: 'uid' };
  try {
    const c = cache || {};
    const ig = c.ig !== undefined ? c.ig : await lerIg(uid);
    const neg = c.neg !== undefined ? c.neg : await lerNeg(uid);
    const av = avaliar(neg, ig);
    if (!av.completa) return Object.assign({ ok: true, entrou: false }, av);

    const arroba = ig.arroba;
    const refFila = db.collection(COL_FILA).doc(uid);
    const refIg = db.collection(COL_IG).doc(uid);
    const base = {
      arroba,
      achou: ig.achou === true ? true : (ig.achou === false ? false : null),
      nome: txt(neg.nome, 80),
      slug: txt(neg.slug, 40),
      segmento: txt(neg.segmento, 40),
    };

    const motivo = await db.runTransaction(async (tx) => {
      const s = await tx.get(refFila);
      if (!s.exists) {
        tx.set(refFila, Object.assign({}, base, { criadoEm: FV.serverTimestamp(), seguido: false, avisos: 1 }));
        tx.set(refIg, { naFila: true }, { merge: true });
        return 'nova';
      }
      const d = s.data() || {};
      if (d.arroba === arroba) {
        tx.set(refIg, { naFila: true }, { merge: true });
        return '';
      }
      tx.update(refFila, Object.assign({}, base, {
        arrobaAnterior: d.arroba || '', trocouEm: FV.serverTimestamp(),
        seguido: false, seguidoEm: FV.delete(), seguidoPor: FV.delete(),
        avisos: FV.increment(1),
      }));
      tx.set(refIg, { naFila: true }, { merge: true });
      return 'troca';
    });

    if (!motivo) return Object.assign({ ok: true, entrou: false }, av);
    const aviso = await telegram(montarAviso(base, motivo), { texto: 'Abrir @' + arroba + ' no Instagram', url: linkPerfil(arroba) });
    return Object.assign({ ok: true, entrou: true, motivo, aviso }, av);
  } catch (e) {
    console.error('[seguirLojista] conferir', uid, (e && e.message) || e);
    return { ok: false, erro: 'interno' };
  }
}

/* ------------------------------------------------ acao do lojista (painel)
   body.arroba vazio = so ler o estado. Devolve o @ salvo e o que falta.
   O freio por conta fica em quem chama (api/financeiro.js). */
async function tratarLoja(uid, body) {
  if (!uidOk(uid)) return { status: 400, json: { ok: false, erro: 'uid' } };
  const b = body || {};
  const ler = b.ler === true || b.arroba === undefined;

  if (ler) {
    const ig = await lerIg(uid);
    const neg = await lerNeg(uid);
    const av = avaliar(neg, ig);
    /* O painel le o estado depois de "Salvar tudo": se a 3a foto acabou de
       entrar e o @ ja estava salvo, entra na fila na hora (sem esperar o cron). */
    if (av.completa && ig && ig.naFila !== true) { try { await conferir(uid, { ig, neg }); } catch (_) {} }
    return { status: 200, json: Object.assign({ ok: true, arroba: ig && ig.arroba ? ig.arroba : '', achou: ig ? ig.achou : null }, av) };
  }

  const arroba = limparArroba(b.arroba);
  if (!arroba) return { status: 400, json: { ok: false, erro: 'arroba_invalido', mensagem: 'Esse @ não parece um Instagram. Confira e tente de novo.' } };

  /* Busca oficial (business_discovery) so para saber se a conta e
     profissional e trazer o nome. Conta pessoal vale do mesmo jeito. */
  let achou = null, igNome = '', canonico = arroba;
  try {
    const p = await buscarPerfil(admin, db, arroba, { semFoto: true });
    if (p && p.ok) {
      achou = p.achou === true;
      if (p.achou) { igNome = txt(p.nome, 80); if (p.arroba) canonico = limparArroba(p.arroba) || arroba; }
    }
  } catch (_) { /* sem busca: guarda o @ digitado */ }

  try {
    const ref = db.collection(COL_IG).doc(uid);
    const atual = await ref.get();
    const antes = atual.exists ? (atual.data() || {}) : {};
    const mudou = antes.arroba !== canonico;
    await ref.set({
      arroba: canonico, achou, igNome,
      naFila: mudou ? false : (antes.naFila === true),
      atualizadoEm: FV.serverTimestamp(),
      criadoEm: antes.criadoEm || FV.serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    console.error('[seguirLojista] salvar', uid, (e && e.message) || e);
    return { status: 500, json: { ok: false, erro: 'interno' } };
  }

  const ig = { arroba: canonico, achou };
  const r = await conferir(uid, { ig });
  const av = r && r.ok ? r : avaliar(await lerNeg(uid), ig);
  return { status: 200, json: { ok: true, arroba: canonico, achou, completa: !!av.completa, falta: av.falta || [], fotos: av.fotos || 0, minFotos: MIN_FOTOS } };
}

/* -------------------------------------------- varredura do cron (2x/dia) */
async function varrer(agora, enviarDeVerdade) {
  const r = { analisados: 0, entraram: 0, lembrete: 'nao' };
  try {
    const qs = await db.collection(COL_IG).where('naFila', '==', false).limit(VARRER_TETO).get();
    for (const d of qs.docs) {
      r.analisados++;
      if (!enviarDeVerdade) continue;
      const x = await conferir(d.id, { ig: d.data() || {} });
      if (x && x.entrou) r.entraram++;
    }
    if (enviarDeVerdade) r.lembrete = await lembrarPendentes(agora || Date.now());
  } catch (e) {
    console.error('[seguirLojista] varrer', (e && e.message) || e);
    r.erro = true;
  }
  return r;
}

/* Um lembrete por dia com quem esta pendente ha mais de 24 h. */
async function lembrarPendentes(agora) {
  try {
    const qs = await db.collection(COL_FILA).where('seguido', '==', false).limit(LISTA_TETO).get();
    const velhos = qs.docs.map((d) => d.data() || {})
      .filter((d) => { const c = ms(d.trocouEm) || ms(d.criadoEm); return c && agora - c >= LEMBRETE_DEPOIS_MS; });
    if (!velhos.length) return 'nenhum';
    const refL = db.collection('sistema').doc('seguir_lembrete');
    const pode = await db.runTransaction(async (tx) => {
      const s = await tx.get(refL);
      const ult = s.exists ? ms((s.data() || {}).em) : 0;
      if (ult && agora - ult < LEMBRETE_INTERVALO_MS) return false;
      tx.set(refL, { em: admin.firestore.Timestamp.fromMillis(agora), qtd: velhos.length });
      return true;
    });
    if (!pode) return 'ja_lembrado';
    const lista = velhos.slice(0, 15).map((d) => '• @' + d.arroba + (d.nome ? ' — ' + txt(d.nome, 40) : '')).join('\n');
    const texto = '⏳ Ainda falta seguir ' + velhos.length + (velhos.length === 1 ? ' lojista' : ' lojistas') +
      ' (mais de 24 h):\n' + lista + (velhos.length > 15 ? '\n…' : '') +
      '\n\nA lista com os botões está no painel do dono, cartão "Lojistas para seguir".';
    return await telegram(texto);
  } catch (e) {
    console.error('[seguirLojista] lembrete', (e && e.message) || e);
    return 'falhou';
  }
}

/* ------------------------------------------------- painel do dono (admin) */
async function listar() {
  try {
    const qs = await db.collection(COL_FILA).where('seguido', '==', false).limit(LISTA_TETO).get();
    const itens = qs.docs.map((d) => {
      const x = d.data() || {};
      return {
        uid: d.id, arroba: x.arroba || '', achou: x.achou, nome: x.nome || '', slug: x.slug || '',
        segmento: x.segmento || '', desde: ms(x.trocouEm) || ms(x.criadoEm), troca: !!x.arrobaAnterior,
        link: x.arroba ? linkPerfil(x.arroba) : '',
      };
    }).sort((a, b) => a.desde - b.desde);
    return { ok: true, pendentes: itens, cortado: qs.size >= LISTA_TETO };
  } catch (e) {
    console.error('[seguirLojista] listar', (e && e.message) || e);
    return { ok: false, erro: 'interno' };
  }
}

async function marcarSeguido(uid, porUid) {
  if (!uidOk(uid)) return { ok: false, erro: 'uid' };
  try {
    const ref = db.collection(COL_FILA).doc(uid);
    const s = await ref.get();
    if (!s.exists) return { ok: false, erro: 'nao_encontrado' };
    await ref.update({ seguido: true, seguidoEm: FV.serverTimestamp(), seguidoPor: String(porUid || '').slice(0, 128) });
    return { ok: true };
  } catch (e) {
    console.error('[seguirLojista] marcar', uid, (e && e.message) || e);
    return { ok: false, erro: 'interno' };
  }
}

module.exports = { tratarLoja, conferir, varrer, listar, marcarSeguido, avaliar,
  _t: { produtosComFoto, avaliar, montarAviso, lembrarPendentes, MIN_FOTOS } };
