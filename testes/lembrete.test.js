'use strict';
// Lembretes do robo (08/10/2026): confirmacao de e-mail, novidade do ensaio,
// convite de volta e a sequencia da primeira live. Sem internet e sem Firebase:
// cd moviki-robo && node testes/lembrete.test.js
process.env.CRON_SECRET = 'segredo-de-teste-123456';
process.env.RESEND_API_KEY = 're_teste';
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'x', filename: 'x', loaded: true, exports: { admin: fake.admin, db: fake.db } };
const { store, Timestamp } = fake;

const enviados = [];
global.fetch = async (url, op) => {
  if (/api\.resend\.com/.test(String(url))) { enviados.push(JSON.parse(op.body)); return { ok: true, status: 200, text: async () => '' }; }
  return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
};
const usuarios = {};
fake.admin.auth = () => ({
  getUser: async (uid) => { if (!usuarios[uid]) throw new Error('nao'); return usuarios[uid]; },
  getUsers: async (ids) => ({ users: ids.map(i => usuarios[i.uid]).filter(Boolean) }),
  generateEmailVerificationLink: async (email, cfg) => 'https://moviki-app.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=ABC&continueUrl=' + encodeURIComponent((cfg && cfg.url) || ''),
});

const L = require(path.join(ROBO, 'api/lembrete-trial.js'));
const T = L._t;
let falhas = 0, ok = 0;
function conf(c, msg) { if (c) ok++; else { falhas++; console.log('FALHOU:', msg); } }
const DIA = 86400000, H = 3600000;
const AGORA = Date.UTC(2026, 9, 9, 15, 0, 0);
const ts = (ms) => Timestamp.fromMillis(ms);
const trial = (diasRestantes, extra) => Object.assign({ ativo: true, periodo: 'trial', plano: 'pro', vence_em: ts(AGORA + diasRestantes * DIA - H) }, extra || {});

// ---- decidirFlag ----
const f = (d) => { const r = T.decidirFlag(d, AGORA); return r && r.flag; };
conf(f(trial(25)) === 'ativ3', 'dia 5 sem ativ3 recebe o ativ3 (que agora e o do ensaio)');
conf(f(trial(25, { lembretes: { ativ3: 'x' } })) === 'novEnsaio', 'teste antigo que ja recebeu o ativ3 velho recebe a novidade');
conf(f(trial(22, { lembretes: { ativ7: 'x' } })) === 'novEnsaio', 'dia 8 sem e-mail da sequencia recebe a novidade');
conf(f(trial(25, { lembretes: { novEnsaio: 'x', ativ3: 'x' } })) === null, 'novidade so 1 vez');
conf(f(trial(25, { dicasParar: true, lembretes: { ativ3: 'x' } })) === null, 'descadastrado nao recebe novidade');
conf(f(trial(30)) === 'ativ0', 'dia 0 recebe ativ0');
conf(f(trial(29)) === 'ativ1', 'dia 1 recebe ativ1');
conf(f(trial(26)) === 'ativ3', 'dia 3 recebe ativ3 (ensaio)');
conf(f(trial(5)) === 'd7', 'perto do fim recebe d7');
conf(f(trial(1)) === 'd2', 'd2');
conf(f(trial(0)) === 'fim', 'fim');
conf(f(trial(-1, { lembretes: { fim: 'x' } })) === null, 'venceu ontem: nada (o fim ja saiu)');
conf(f(trial(-3)) === 'volta', 'venceu ha 3 dias: volta');
conf(f(trial(-3, { ativo: false })) === 'volta', 'volta tambem com ativo false');
conf(f(trial(-3, { lembretes: { volta: 'x' } })) === null, 'volta so 1 vez');
conf(f(trial(-3, { dicasParar: true })) === null, 'descadastrado nao recebe volta');
conf(f(trial(-60, { lembretes: { fim: 'x' } })) === null, 'venceu ha 60 dias: nada');
// teste que comeca depois do corte nao recebe a novidade (ja recebe o ativ3 novo)
const novo = { ativo: true, periodo: 'trial', vence_em: ts(T.CORTE_NOVIDADE + 26 * DIA + 5 * DIA) };
conf(T.decidirFlag(novo, T.CORTE_NOVIDADE + 5 * DIA) === null || T.decidirFlag(novo, T.CORTE_NOVIDADE + 5 * DIA).flag === 'ativ3', 'teste novo nao recebe novidade');
const pago = (plano, extra) => Object.assign({ ativo: true, periodo: 'mensal', plano, vence_em: ts(AGORA + 20 * DIA) }, extra || {});
conf(f(pago('premium')) === 'novEnsaio', 'premium sem live recebe novidade');
conf(f(pago('enterprise')) === 'novEnsaio', 'enterprise recebe novidade');
conf(f(pago('pro')) === null, 'pro nao recebe (nao tem live)');
conf(f(Object.assign(pago('premium'), { vence_em: ts(AGORA + 3 * DIA) })) === 'pago', 'aviso de vencimento tem prioridade');
conf(f(Object.assign(pago('premium'), { gateway: 'paddle' })) === null, 'paddle fora');

// ---- decidirConfirma ----
const c = (horas, l) => T.decidirConfirma({ avisadoEm: ts(AGORA - horas * H), confirmaLembretes: l }, AGORA);
conf(c(1) === null, '1 h: cedo demais');
conf(c(4) === 'c1', '4 h: primeiro lembrete');
conf(c(4, { c1: ts(AGORA - H) }) === null, 'c1 ja enviado');
conf(c(30) === 'c2', '30 h sem nenhum: vai direto o c2');
conf(c(30, { c1: ts(AGORA - 2 * H) }) === null, 'c1 ha 2 h: espera');
conf(c(30, { c1: ts(AGORA - 20 * H) }) === 'c2', 'c1 ha 20 h: c2');
conf(c(50, { c1: ts(AGORA - 40 * H), c2: ts(AGORA - 10 * H) }) === null, 'nunca mais de 2');
conf(c(8 * 24) === null, 'depois de 7 dias: nada');
conf(T.decidirConfirma({}, AGORA) === null, 'sem data: nada');

// ---- textos ----
const proibidas = /trial|garant|venda certa|vai vender|venda mais/i;
for (const t of ['ativ0', 'ativ1', 'ativ3', 'ativ7', 'ativ10', 'novEnsaio', 'volta']) {
  const m = T.montarAtivacao(t, 'Loja <b>X</b>', 'https://x/parar', 12, 'loja-x', false);
  conf(!proibidas.test(m.subject + m.text), 'texto limpo: ' + t);
  conf(m.html.indexOf('<b>X</b>') < 0, 'nome escapado: ' + t);
  conf(m.html.indexOf('Não quero mais receber dicas') > 0, 'descadastro em ' + t);
}
conf(/não gasta as 2 lives/.test(T.montarAtivacao('novEnsaio', 'A', '', 0, '', false).text), 'novidade no teste fala das 2 lives');
conf(!/2 lives/.test(T.montarAtivacao('novEnsaio', 'A', '', 0, '', true).text), 'novidade no plano pago nao fala de 2 lives');
conf(/Premium/.test(T.montarAtivacao('volta', 'A', '', 0, '', false).text), 'volta aponta o Premium');
for (const e of ['c1', 'c2']) {
  const m = T.montarConfirmacao(e, 'Loja', 'https://moviki-app.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=A&x=1');
  conf(!proibidas.test(m.subject + m.text), 'confirmacao limpa ' + e);
  conf(m.html.indexOf('oobCode=A&amp;x=1') > 0, 'link escapado no html ' + e);
  conf(m.text.indexOf('oobCode=A&x=1') > 0, 'link inteiro no texto ' + e);
}

// ---- rodada completa (fake) ----
(async () => {
  const put = (p, v) => store.set(p, v);
  usuarios.u_nc = { uid: 'u_nc', email: 'naoconf@ex.com', emailVerified: false };
  usuarios.u_ok = { uid: 'u_ok', email: 'conf@ex.com', emailVerified: true };
  usuarios.u_tr = { uid: 'u_tr', email: 'teste@ex.com', emailVerified: true };
  put('avisos_cliente/u_nc', { email: 'naoconf@ex.com', avisadoEm: ts(Date.now() - 5 * H) });
  put('avisos_cliente/u_ok', { email: 'conf@ex.com', avisadoEm: ts(Date.now() - 5 * H) });
  put('negocios/u_nc', { nome: 'Loja NC' });
  put('assinaturas/u_tr', { ativo: true, periodo: 'trial', vence_em: ts(Date.now() + 25 * DIA) });
  put('negocios/u_tr', { nome: 'Loja TR', slug: 'loja-tr' });
  const req = { method: 'GET', query: {}, headers: { authorization: 'Bearer ' + process.env.CRON_SECRET } };
  let corpo = null;
  const res = { status() { return this; }, json(j) { corpo = j; return this; }, setHeader() {}, send() {} };
  await L(req, res);
  conf(corpo && corpo.ok === true, 'rodada ok');
  const para = enviados.map(e => e.to[0]);
  conf(para.indexOf('naoconf@ex.com') >= 0, 'nao confirmado recebeu lembrete');
  conf(para.indexOf('conf@ex.com') < 0, 'confirmado nao recebeu lembrete');
  const lc = store.get('avisos_cliente/u_nc');
  conf(lc && lc.confirmaLembretes && lc.confirmaLembretes.c1, 'marca c1 gravada');
  const ehNovidade = enviados.find(e => e.to[0] === 'teste@ex.com');
  if (Date.now() < T.CORTE_NOVIDADE) conf(ehNovidade && /ensaie/i.test(ehNovidade.subject), 'teste antigo recebeu a novidade');
  const conf1 = enviados.find(e => e.to[0] === 'naoconf@ex.com');
  conf(conf1 && /confirmado=1/.test(decodeURIComponent(conf1.text)), 'link volta ao painel com ?confirmado=1');
  // segunda rodada: ninguem recebe de novo
  const antes = enviados.length;
  await L(req, res);
  conf(enviados.length === antes, 'segunda rodada nao repete nada');
  console.log(falhas ? ('FALHAS: ' + falhas + ' (ok ' + ok + ')') : ('TUDO OK (' + ok + ' conferencias)'));
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
