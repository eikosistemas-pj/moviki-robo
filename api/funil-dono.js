// api/funil-dono.js | versao 2026-10-20-panfletos (acao panfleto_email: o dono manda o PDF do panfleto com o QR da Eiko por e-mail, lib/panfletoEmail.js) | antes 2026-10-17-seguir (fila Lojistas para seguir: acoes seguir_lista e seguir_feito) | antes 2026-10-09-origem (funil por origem do cadastro) | antes 2026-10-08-confirma1 (lista mostra os lembretes de confirmar o e-mail) | antes 2026-10-07-funil  (repo: moviki-robo)
// FUNIL DO LOJISTA — P75, fase 1 (peca B5), 07/10/2026.
//
// O painel do dono (cartao "Funil do lojista", na Visao geral) mostra, semana
// a semana, onde o lojista trava entre o cadastro e o primeiro pagamento. A
// metrica-norte da fase 1 do P75 e "lojista que fez a 1a live em ate 48 h do
// cadastro" — meta: 30% ou mais.
//
// SO ADMIN, e so com sessao do Google (lib/admin.js, igual aos outros
// endpoints de dono). Freio de 30 chamadas por hora por conta.
//
// O QUE LE (Admin SDK, tudo no servidor; o navegador nao alcanca nenhuma
// destas colecoes de forma ampla):
//   avisos_cliente  — o cadastro (gravado pelo api/novo-cliente.js: avisadoEm,
//                     origemAnuncio, email, nome). Consulta SO por avisadoEm
//                     (um campo so => indice automatico, sem indice composto).
//   negocios        — nome e apelido do negocio (para a lista e para tirar as
//                     contas de teste do Paulo).
//   marcos_lojista  — primeiraLiveEm, primeiroEnsaioEm, ensaios,
//                     primeiraVendaLiveEm (gravado por OUTRA frente; aqui so
//                     leitura; ausente = "nao fez").
//   live_cota / live_sessoes — reforco para conta antiga: usadas > 0 ou sessao
//                     existente = "ja fez live" (sem data confiavel, entao NAO
//                     conta como "em 48 h").
//   assinaturas     — pagante (mesma regra do painel do dono desde 23/09:
//                     ativo, dentro do vencimento, fora do teste, plano pago).
//   Auth (getUsers, ate 100 por chamada) — e-mail confirmado. Reserva: se o
//                     Auth falhar, "entrou no teste" = existe assinaturas/{uid}.
//
// O QUE SAI: so numeros por semana e a lista dos 20 cadastros mais recentes
// com nome do negocio, apelido, data, e-mail MASCARADO ("ab***@dominio") e os
// marcos. Nenhum e-mail inteiro, nenhum uid na tela alem do necessario para o
// dono achar a conta (o uid vai, porque o painel do dono ja o mostra em
// Negocios e em Exclusoes).
//
// 09/10/2026 — POR ORIGEM: cada cadastro traz o canal gravado pelo
// api/novo-cliente.js (avisos_cliente/{uid}.origem, lib/origem.js). O cartao
// ganha a tabela "De onde vem o lojista": cadastros, teste, 1a live e pagante
// por canal, nas mesmas 6 semanas. Cadastro antigo sem o campo vira "Anuncio
// Meta" (se tinha origemAnuncio) ou "Antes de 09/10 (sem registro)".
//
// CUSTO: 1 consulta (cadastros dos ultimos 60 dias, teto 1.500) + 5 leituras
// por cadastro em lote (db.getAll em blocos de 100) + a lista de admins.

const { admin, db } = require('../lib/firebase');
const { conferirAdmin } = require('../lib/admin');
const { freioUid } = require('../lib/freio');
const { origemDoAviso } = require('../lib/origem');
const seguir = require('../lib/seguirLojista');
const panfletoEmail = require('../lib/panfletoEmail');

const VERSAO = '2026-10-17-seguir';
const ORIGIN_OK = 'https://app.moviki.com.br';

/* ----------------------------------------------------------------------
   CONTAS DE TESTE DO PAULO — fora do funil. Lista facil de editar.
   Alem destas, qualquer uid que esteja em admins/{uid} fica de fora.
   Compara sem acento, sem maiuscula e sem espaco/hifen.
   (CLAUDE.md, decisao de 25/09/2026: Fabio Suplementos, Caldeirao
   Nordestino/karina e Hamburguer Master sao contas de teste.)
   ---------------------------------------------------------------------- */
const TESTE_UIDS = [
  // 'cole-aqui-o-uid-de-uma-conta-de-teste',
];
const TESTE_APELIDOS = ['karina', 'caldeiraonordestino', 'hamburguermaster', 'fabiosuplementos'];
const TESTE_NOMES = ['caldeiraonordestino', 'hamburguermaster', 'fabiosuplementos'];

const DIA = 86400000;
const H48 = 48 * 3600000;
const JANELA_DIAS = 60;       // so le cadastros dos ultimos 60 dias
const SEMANAS = 6;            // o cartao mostra as ultimas 6 semanas
const TETO_CADASTROS = 1500;  // teto de leitura; se bater, a resposta avisa
const META_NORTE = 0.30;      // P75 fase 1: >= 30% com 1a live em 48 h
// Brasil sem horario de verao desde 2019: America/Sao_Paulo = UTC-3 fixo.
const FUSO_MS = 3 * 3600000;

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function msDe(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'number') return v;
  if (v._seconds) return v._seconds * 1000;
  if (v.seconds) return v.seconds * 1000;
  if (v instanceof Date) return v.getTime();
  return 0;
}
// mesmo padrao do mascara() de api/lembrete-trial.js
function mascara(e) {
  const [u, dom] = String(e || '').split('@'); if (!dom) return '';
  return (u.slice(0, 2) + '***') + '@' + dom;
}
function txt(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }

// Segunda-feira 00:00 (hora de Brasilia) da semana do instante, em ms UTC.
function inicioSemana(ms) {
  const d = new Date(ms - FUSO_MS);
  const recuo = (d.getUTCDay() + 6) % 7; // 0 = segunda
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - recuo * DIA + FUSO_MS;
}
function rotulo(ms) {
  const d = new Date(ms - FUSO_MS);
  return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

const PLANOS_PAGOS = ['pro', 'premium', 'enterprise'];
// Mesma regra do painel do dono (carregarNegocios, 23/09 rodada 3).
function ehPagante(a, agora) {
  if (!a) return false;
  const vence = msDe(a.vence_em);
  const vivo = a.ativo === true && (!vence || vence > agora);
  if (!vivo || a.periodo === 'trial') return false;
  return PLANOS_PAGOS.indexOf(String(a.plano || '').toLowerCase().trim()) >= 0;
}

function ehContaTeste(c, admins) {
  if (admins.has(c.uid) || TESTE_UIDS.indexOf(c.uid) >= 0) return true;
  const ap = norm(c.slug);
  if (ap && TESTE_APELIDOS.indexOf(ap) >= 0) return true;
  const nm = norm(c.nomeNegocio || c.nomeAviso);
  return !!nm && TESTE_NOMES.indexOf(nm) >= 0;
}

/* Monta o funil a partir das contas ja lidas. Funcao pura (testavel).
   conta = { uid, cadastroEm, anuncio, email, nomeAviso, nomeNegocio, slug,
             emailVerificado (true/false/null), marcos, cota, temSessao, assinatura } */
function montarFunil(contas, admins, agora) {
  const semIni = inicioSemana(agora) - (SEMANAS - 1) * 7 * DIA;
  const vazio = () => ({ cadastros: 0, anuncio: 0, teste: 0, ensaio: 0, live: 0, live48: 0, venda: 0, pagante: 0, maduros: 0, live48Maduros: 0 });
  const semanas = [];
  for (let i = 0; i < SEMANAS; i++) {
    const ini = semIni + i * 7 * DIA;
    semanas.push(Object.assign({ inicio: ini, rotulo: rotulo(ini) + ' a ' + rotulo(ini + 6 * DIA) }, vazio()));
  }
  const total = vazio();
  const porCanal = {};   // 09/10: canal -> { canal, rotulo, cadastros, teste, live, live48, pagante }
  let fora = 0, liveSemData = 0;
  const linhas = [];

  for (const c of contas) {
    if (!c.cadastroEm) continue;
    if (ehContaTeste(c, admins)) { fora++; continue; }
    const m = c.marcos || {};
    const a = c.assinatura || null;
    const liveEm = msDe(m.primeiraLiveEm);
    const ensaioEm = msDe(m.primeiroEnsaioEm);
    const vendaEm = msDe(m.primeiraVendaLiveEm);
    const fezEnsaio = !!ensaioEm || Number(m.ensaios) > 0;
    const fezLive = !!liveEm || (c.cota && Number(c.cota.usadas) > 0) || !!c.temSessao;
    const live48 = !!liveEm && (liveEm - c.cadastroEm) <= H48;
    const teste = c.emailVerificado === true || (c.emailVerificado == null && !!a) || (c.emailVerificado === false && !!a && a.periodo === 'trial');
    const pagante = ehPagante(a, agora);
    // "maduro" = ja correram as 48 h desde o cadastro (ou ja fez a live em 48 h).
    const maduro = (agora - c.cadastroEm) >= H48 || live48;

    const r = {
      uid: c.uid,
      nome: txt(c.nomeNegocio || c.nomeAviso || '', 60),
      slug: txt(c.slug || '', 40),
      email: mascara(c.email),
      cadastroEm: c.cadastroEm,
      anuncio: c.anuncio === true,
      origem: c.origem || { canal: 'sem_registro', rotulo: 'Antes de 09/10 (sem registro)', campaign: '' },
      emailConfirmado: c.emailVerificado == null ? null : c.emailVerificado === true,
      lembretesConfirma: Number(c.lembretesConfirma) || 0,   // 08/10: lembretes de confirmar o e-mail ja enviados (0 a 2)
      teste,
      ensaios: Number(m.ensaios) || (fezEnsaio ? 1 : 0),
      ensaioEm: ensaioEm || null,
      live: fezLive,
      liveEm: liveEm || null,
      horasAteLive: liveEm ? Math.round((liveEm - c.cadastroEm) / 3600000) : null,
      live48,
      venda: !!vendaEm,
      pagante,
      plano: pagante ? String(a.plano).toLowerCase().trim() : (a && a.periodo === 'trial' && a.ativo === true && msDe(a.vence_em) > agora ? 'teste' : ''),
    };
    linhas.push(r);

    if (c.cadastroEm < semIni) continue; // fora das 6 semanas: so entra na lista
    if (fezLive && !liveEm) liveSemData++;
    const k = Math.min(SEMANAS - 1, Math.floor((c.cadastroEm - semIni) / (7 * DIA)));
    for (const alvo of [semanas[k], total]) {
      alvo.cadastros++;
      if (r.anuncio) alvo.anuncio++;
      if (teste) alvo.teste++;
      if (fezEnsaio) alvo.ensaio++;
      if (fezLive) alvo.live++;
      if (live48) alvo.live48++;
      if (r.venda) alvo.venda++;
      if (pagante) alvo.pagante++;
      if (maduro) { alvo.maduros++; if (live48) alvo.live48Maduros++; }
    }
    const o = r.origem;
    const pc = porCanal[o.canal] || (porCanal[o.canal] = { canal: o.canal, rotulo: o.rotulo, cadastros: 0, teste: 0, live: 0, live48: 0, pagante: 0 });
    pc.cadastros++;
    if (teste) pc.teste++;
    if (fezLive) pc.live++;
    if (live48) pc.live48++;
    if (pagante) pc.pagante++;
  }

  linhas.sort((x, y) => y.cadastroEm - x.cadastroEm);
  const taxa = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : null);
  return {
    semanas,
    total,
    norte: {
      live48: total.live48, cadastros: total.cadastros, taxa: taxa(total.live48, total.cadastros),
      // a semana corrente tem cadastro que ainda nao teve 48 h: a taxa "justa"
      // so conta quem ja teve a chance inteira
      maduros: total.maduros, live48Maduros: total.live48Maduros, taxaMaduros: taxa(total.live48Maduros, total.maduros),
      meta: META_NORTE,
    },
    porOrigem: Object.keys(porCanal).map((k) => porCanal[k]).sort((a, b) => (b.cadastros - a.cadastros) || (b.pagante - a.pagante)),
    recentes: linhas.slice(0, 20),
    contasTesteFora: fora,
    liveSemData,
  };
}

async function lerEmLote(colecao, uids) {
  const out = {};
  for (let i = 0; i < uids.length; i += 100) {
    const refs = uids.slice(i, i + 100).map((u) => db.collection(colecao).doc(u));
    if (!refs.length) continue;
    const snaps = await db.getAll(...refs);
    snaps.forEach((s) => { if (s.exists) out[s.id] = s.data() || {}; });
  }
  return out;
}

async function emailsConfirmados(uids) {
  const out = {};
  try {
    for (let i = 0; i < uids.length; i += 100) {
      const r = await admin.auth().getUsers(uids.slice(i, i + 100).map((uid) => ({ uid })));
      (r.users || []).forEach((u) => { out[u.uid] = u.emailVerified === true; });
    }
    return { ok: true, mapa: out };
  } catch (e) {
    console.error('[funil-dono] auth:', (e && e.message) || e);
    return { ok: false, mapa: {} };
  }
}

async function gerar(agora) {
  const desde = admin.firestore.Timestamp.fromMillis(agora - JANELA_DIAS * DIA);
  const qs = await db.collection('avisos_cliente').where('avisadoEm', '>=', desde)
    .orderBy('avisadoEm', 'desc').limit(TETO_CADASTROS).get();
  const base = [];
  qs.forEach((d) => {
    const x = d.data() || {};
    base.push({ uid: d.id, cadastroEm: msDe(x.avisadoEm), anuncio: x.origemAnuncio === true, origem: origemDoAviso(x), email: x.email || '', nomeAviso: x.nome || '',
      lembretesConfirma: Object.keys(x.confirmaLembretes || {}).length });
  });
  const uids = base.map((b) => b.uid);

  const [neg, marcos, assin, cota, sess, conf, admSnap] = await Promise.all([
    lerEmLote('negocios', uids),
    lerEmLote('marcos_lojista', uids),
    lerEmLote('assinaturas', uids),
    lerEmLote('live_cota', uids),
    lerEmLote('live_sessoes', uids),
    emailsConfirmados(uids),
    db.collection('admins').get(),
  ]);
  const admins = new Set();
  admSnap.forEach((d) => admins.add(d.id));

  const contas = base.map((b) => Object.assign(b, {
    nomeNegocio: (neg[b.uid] || {}).nome || '',
    slug: (neg[b.uid] || {}).slug || '',
    marcos: marcos[b.uid] || null,
    assinatura: assin[b.uid] || null,
    cota: cota[b.uid] || null,
    temSessao: !!sess[b.uid],
    emailVerificado: conf.ok ? (b.uid in conf.mapa ? conf.mapa[b.uid] : false) : null,
  }));

  const f = montarFunil(contas, admins, agora);
  return Object.assign({ ok: true, versao: VERSAO, geradoEm: agora, janelaDias: JANELA_DIAS,
    cortado: base.length >= TETO_CADASTROS, authOk: conf.ok }, f);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_OK);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    let dec;
    try { dec = await admin.auth().verifyIdToken(String(body.idToken || ''), true); }
    catch (_) { res.status(401).json({ ok: false, erro: 'sessao' }); return; }
    const adm = await conferirAdmin(db, dec);
    if (!adm.ok) { res.status(adm.status).json({ ok: false, erro: adm.erro, mensagem: adm.mensagem }); return; }
    /* 17/10/2026: fila "Lojistas para seguir" (lib/seguirLojista.js). Freio
       proprio, mais largo: cada "Ja segui" e um clique. */
    const acao = String(body.acao || '');
    if (acao === 'seguir_lista' || acao === 'seguir_feito') {
      if (!(await freioUid(admin, db, 'seguirdono', dec.uid, 200, 3600000))) {
        res.status(429).json({ ok: false, erro: 'freio', mensagem: 'Muitas consultas seguidas. Tente de novo em alguns minutos.' }); return;
      }
      const r = acao === 'seguir_lista' ? await seguir.listar() : await seguir.marcarSeguido(String(body.uid || ''), dec.uid);
      res.status(r.ok ? 200 : (r.erro === 'uid' ? 400 : r.erro === 'nao_encontrado' ? 404 : 500)).json(r);
      return;
    }
    /* 20/10/2026: PDF do panfleto com o QR da Eiko por e-mail (aba Panfletos
       com QR do painel do dono). So admin, freio proprio de 20 envios por hora. */
    if (acao === 'panfleto_email') {
      if (!(await freioUid(admin, db, 'panfemail', dec.uid, 20, 3600000))) {
        res.status(429).json({ ok: false, erro: 'freio', mensagem: 'Muitos envios seguidos. Tente de novo em alguns minutos.' }); return;
      }
      const r = await panfletoEmail.enviar(body, { email: dec.email });
      res.status(r.ok ? 200 : (r.erro === 'para' || r.erro === 'pdf' ? 400 : 502)).json(r);
      return;
    }
    if (!(await freioUid(admin, db, 'funildono', dec.uid, 30, 3600000))) {
      res.status(429).json({ ok: false, erro: 'freio', mensagem: 'Muitas consultas seguidas. Tente de novo em alguns minutos.' }); return;
    }
    res.status(200).json(await gerar(Date.now()));
  } catch (e) {
    console.error('[funil-dono]', (e && e.message) || e);
    res.status(500).json({ ok: false, erro: 'interno' });
  }
};

module.exports._t = { montarFunil, inicioSemana, ehPagante, ehContaTeste, mascara, gerar };
