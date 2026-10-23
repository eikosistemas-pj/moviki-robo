// lib/registroAcesso.js | versao 2026-10-22-marcocivil  (repo: moviki-robo)
//
// GUARDA DOS REGISTROS DE ACESSO — Marco Civil da Internet (Lei 12.965/2014),
// art. 15 e Decreto 8.771/2016. 22/10/2026.
//
// O Moviki e provedor de aplicacao constituido como pessoa juridica, com fins
// economicos. A lei manda guardar, sob sigilo e em ambiente seguro, por 6
// meses, o "registro de acesso": data e hora de uso a partir de um endereco IP.
// Ate hoje o sistema nao guardava nada disso (a Guarda anticlonagem grava o IP
// ABREVIADO, que nao serve para identificar ninguem numa ordem judicial).
//
// O que se guarda (e so isso — minimizacao da LGPD):
//   uid (ou null, para visitante sem login), ip COMPLETO, porta de origem
//   (quando a hospedagem informar; a Vercel hoje nao informa — ver abaixo),
//   data e hora em UTC, de onde (painel/parceiro/live/pagina) e o evento.
//   Nada de conteudo, navegador, localizacao ou impressao do aparelho.
//
// PORTA LOGICA: o STJ ja exigiu a porta de origem quando o IP e compartilhado
// (CGNAT). A Vercel nao entrega a porta do cliente em nenhum cabecalho. O
// campo existe e fica null; se um dia a hospedagem mandar x-forwarded-port ou
// x-client-port, passa a ser gravado sem mudar nada. Limitacao registrada na
// Politica de Privacidade e no mapa.
//
// Onde fica: colecao `registros_acesso` — sem regra no Firestore = negada ao
// navegador; so o Admin SDK alcanca. `apagarEm` = 6 meses + 1 dia: a TTL do
// Firestore pode apagar sozinha (politica opcional no console) e, de todo
// modo, a varredura `varrer()` roda dentro do cron /api/pedidos-confere.
// Guardar MAIS que 6 meses sem ordem judicial fere a LGPD (necessidade);
// guardar MENOS fere o Marco Civil. Por isso o prazo e um so.
//
// Excecao legal: ordem cautelar de autoridade (art. 15 §2º) pede guarda por
// mais tempo de um registro especifico — `reter(ids, ate)` marca `retido`
// e a varredura nao apaga.
//
// Nunca derruba quem chamou: tudo em try/catch, devolve booleano.

'use strict';

const crypto = require('crypto');

const COLECAO = 'registros_acesso';
const DIA_MS = 86400000;
const GUARDA_MS = 184 * DIA_MS;           // 6 meses (183 dias) + 1 de folga
const JANELA_SESSAO_MS = 30 * 60 * 1000;  // painel aberto: 1 registro por 30 min por IP
const APPS = ['painel', 'parceiro', 'live', 'criador', 'dono', 'pagina', 'checkout', 'avaliacao', 'agenda', 'outro'];
const EVENTOS = ['sessao', 'login', 'avaliacao', 'pedido', 'agendamento', 'chat', 'denuncia', 'cadastro', 'outro'];

function limpaIp(s) {
  const v = String(s || '').trim().replace(/^::ffff:/i, '');
  if (!v || v.length > 64) return '';
  // IPv4 ou IPv6 (letras hex, dois-pontos e ponto). Nada mais passa.
  return /^[0-9a-fA-F:.]+$/.test(v) ? v : '';
}

/* IP do cliente. A Vercel sobrescreve x-forwarded-for com o IP de quem
   conectou (nao repassa IP externo, para impedir falsificacao), e manda o
   mesmo valor em x-real-ip e x-vercel-forwarded-for. Ordem: o que a Vercel
   garante primeiro. */
function ipDe(req) {
  const h = (req && req.headers) || {};
  const cands = [h['x-vercel-forwarded-for'], h['x-real-ip'], String(h['x-forwarded-for'] || '').split(',')[0]];
  for (const c of cands) { const ip = limpaIp(String(c || '').split(',')[0]); if (ip) return ip; }
  return limpaIp(req && req.socket && req.socket.remoteAddress);
}

function portaDe(req) {
  const h = (req && req.headers) || {};
  const p = Number(String(h['x-client-port'] || h['x-forwarded-port'] || '').split(',')[0].trim());
  // 443/80 e a porta do SERVIDOR, nao a do cliente: nao serve, nao grava.
  if (!Number.isInteger(p) || p < 1 || p > 65535 || p === 443 || p === 80) return null;
  return p;
}

function hash(s) { return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 40); }

/* Grava um registro. opcoes: { uid, app, evento, alvo, dedup }
   dedup = true junta acessos do mesmo uid+ip+app numa janela de 30 min (painel
   aberto manda sinal de tempos em tempos; um registro por janela basta para o
   "data e hora de uso"). Eventos (avaliacao, pedido) nao deduplicam. */
async function registrar(admin, db, req, opcoes) {
  try {
    const o = opcoes || {};
    const ip = ipDe(req);
    if (!ip) return false;
    const uid = typeof o.uid === 'string' && /^[A-Za-z0-9]{10,128}$/.test(o.uid) ? o.uid : null;
    const app = APPS.indexOf(o.app) >= 0 ? o.app : 'outro';
    const evento = EVENTOS.indexOf(o.evento) >= 0 ? o.evento : 'outro';
    const alvo = typeof o.alvo === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(o.alvo) ? o.alvo : null;
    const agora = Date.now();
    const TS = admin.firestore.Timestamp;
    const doc = {
      uid, ip, porta: portaDe(req), app, evento, alvo,
      em: TS.fromMillis(agora),
      emIso: new Date(agora).toISOString(),   // UTC explicito (Decreto 8.771: data, hora e fuso)
      fuso: 'UTC',
      apagarEm: TS.fromMillis(agora + GUARDA_MS),
    };
    const col = db.collection(COLECAO);
    if (o.dedup === true) {
      const id = 's_' + hash([uid || '-', ip, app, Math.floor(agora / JANELA_SESSAO_MS)].join('|'));
      try { await col.doc(id).create(doc); }
      catch (e) { if (!(e && (e.code === 6 || /ALREADY_EXISTS/i.test(String(e.message || ''))))) throw e; }
      return true;
    }
    await col.add(doc);
    return true;
  } catch (e) {
    console.error('[registroAcesso] nao gravou:', (e && e.message) || e);
    return false;
  }
}

/* Consulta para atender ordem judicial ou requisicao legal (so o dono chama,
   pelo api/acesso.js, depois de conferirAdmin). Por uid OU por ip, num periodo. */
async function consultar(db, filtro) {
  const f = filtro || {};
  const de = Number(f.deMs) || 0, ate = Number(f.ateMs) || Date.now();
  let q = db.collection(COLECAO), campo, valor;
  if (f.uid && /^[A-Za-z0-9]{10,128}$/.test(String(f.uid))) { campo = 'uid'; valor = String(f.uid); }
  else if (f.ip && limpaIp(f.ip)) { campo = 'ip'; valor = limpaIp(f.ip); }
  else return { erro: 'filtro' };
  q = q.where(campo, '==', valor);
  const s = await q.limit(1000).get();
  const lista = [];
  s.forEach((d) => {
    const x = d.data() || {};
    if (x[campo] !== valor) return;   // confere de novo: resposta de ordem judicial nao pode trazer registro de outra pessoa
    const ms = x.em && typeof x.em.toMillis === 'function' ? x.em.toMillis() : 0;
    if (ms < de || ms > ate) return;
    lista.push({ id: d.id, uid: x.uid || null, ip: x.ip, porta: x.porta || null, emIso: x.emIso, app: x.app, evento: x.evento, alvo: x.alvo || null, retido: !!x.retido });
  });
  lista.sort((a, b) => String(a.emIso).localeCompare(String(b.emIso)));
  return { ok: true, total: lista.length, registros: lista.slice(0, 500) };
}

/* Ordem cautelar (Marco Civil art. 15 §2º): segura os registros alem dos 6
   meses ate a data informada. */
async function reter(admin, db, ids, ateMs, motivo) {
  const TS = admin.firestore.Timestamp;
  const ate = Number(ateMs);
  if (!Array.isArray(ids) || !ids.length || !(ate > Date.now())) return { erro: 'dados' };
  let n = 0;
  for (const id of ids.slice(0, 500)) {
    if (!/^[A-Za-z0-9_-]{5,80}$/.test(String(id))) continue;
    try {
      await db.collection(COLECAO).doc(String(id)).update({ retido: true, apagarEm: TS.fromMillis(ate), retidoMotivo: String(motivo || '').slice(0, 200) });
      n++;
    } catch (_) {}
  }
  return { ok: true, retidos: n };
}

/* Apaga o que venceu. Chamado pelo cron de 5 em 5 min; segura a si mesmo em
   1 passagem por hora (marca manutencao/registros_acesso). */
async function varrer(admin, db, max) {
  const lim = Math.min(Number(max) || 300, 450);
  const marca = db.collection('manutencao').doc('registros_acesso');
  const agora = Date.now();
  try {
    const m = await marca.get();
    const ult = m.exists ? Number((m.data() || {}).ultimaMs || 0) : 0;
    if (agora - ult < 3600000) return { pulado: true };
    await marca.set({ ultimaMs: agora }, { merge: true });
  } catch (_) { /* sem marca, segue: apagar o vencido nunca e errado */ }
  const TS = admin.firestore.Timestamp;
  const s = await db.collection(COLECAO).where('apagarEm', '<=', TS.fromMillis(agora)).limit(lim).get();
  let apagados = 0;
  const docs = s.docs || [];
  for (const d of docs) {
    const x = d.data() || {};
    if (x.retido === true && x.apagarEm && x.apagarEm.toMillis && x.apagarEm.toMillis() > agora) continue;
    try { await d.ref.delete(); apagados++; } catch (_) {}
  }
  return { apagados };
}

module.exports = { registrar, consultar, reter, varrer, ipDe, portaDe, COLECAO, GUARDA_MS, _t: { limpaIp, hash } };
