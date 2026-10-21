'use strict';
// Parceiro que vira lojista: a comissao segue durante o teste gratis do negocio (20/10/2026, opcao B).
// Roda sem internet e sem Firebase:
//   cd moviki-robo && node testes/parceiro-lojista.test.js
process.env.CRON_SECRET = 'segredo-de-teste-123456';
process.env.RESEND_API_KEY = 're_teste';
process.env.TELEGRAM_TOKEN = 'tg'; process.env.TELEGRAM_CHAT_ID = '1';
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
const { store, Timestamp } = fake;

require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'f', filename: 'f', loaded: true, exports: { admin: fake.admin, db: fake.db } };
const real = require(path.join(ROBO, 'lib/asaas.js'));
let pagamentos = {};
async function asaasFalso(p) {
  const m = /^\/payments\/([^/]+)$/.exec(p);
  if (m && pagamentos[m[1]]) return pagamentos[m[1]];
  return {};
}
require.cache[require.resolve(path.join(ROBO, 'lib/asaas.js'))] = { id: 'a', filename: 'a', loaded: true, exports: Object.assign({}, real, { asaas: asaasFalso }) };
const vazio = { purchase: async () => {}, uidPorTokenWebhook: async () => '', webhookPedido: async () => ({}) };
['lib/ga.js', 'lib/meta.js', 'lib/checkout.js'].forEach((f) => {
  require.cache[require.resolve(path.join(ROBO, f))] = { id: f, filename: f, loaded: true, exports: vazio };
});
const emails = [], telegram = [];
global.fetch = async (url, op) => {
  if (/api\.resend\.com/.test(String(url))) emails.push(JSON.parse(op.body));
  if (/telegram/.test(String(url))) telegram.push(String((op && op.body) || ''));
  return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
};
fake.admin.auth = () => ({ getUser: async (u) => ({ email: u.toLowerCase() + '@exemplo.com', emailVerified: true, metadata: { creationTime: new Date(Date.now() - 2 * 86400000).toUTCString() } }) });

const realNow = Date.now; let desloc = 0; Date.now = () => realNow() + desloc;
const R = require(path.join(ROBO, 'lib/comissaoRetida.js'));
const wh = require(path.join(ROBO, 'api/webhook.js'));
const L = require(path.join(ROBO, 'api/lembrete-trial.js'));
const T = L._t;

let falhas = 0, ok = 0;
function conf(c, msg) { if (c) ok++; else { falhas++; console.log('FALHOU:', msg); } }
const DIA = 86400000;
const d = (p) => store.get(p);
const hojeBR = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const somaDias = (iso, n) => new Date(Date.parse(iso + 'T12:00:00-03:00') + n * DIA).toISOString().slice(0, 10);
const ts = (ms) => Timestamp.fromMillis(ms);

function cenario() {
  store.clear(); pagamentos = {}; emails.length = 0; telegram.length = 0; desloc = 0;
  store.set('parceiro_slugs/pj', { uid: 'P' });
  store.set('parceiros/P', { status: 'aprovado', nome: 'Carlos Mendes' });
  store.set('negocios/P', { nome: 'Loja do Carlos' });
  store.set('assinaturas/P', { plano: 'premium', periodo: 'mensal', ativo: true, vence_em: ts(Date.now() + 2 * DIA) });
  store.set('faturamento/P', { asaasSubscriptionId: 'subP', assinaturasAsaas: { subP: { plano: 'premium', periodo: 'mensal' } } });
  store.set('indicacoes/L', { ref: 'pj' });
  store.set('faturamento/L', { asaasSubscriptionId: 'subL', assinaturasAsaas: { subL: { plano: 'premium', periodo: 'mensal' } } });
}
async function evento(tipo, payId, uid, sub, extra) {
  const pay = Object.assign({ id: payId, externalReference: uid, subscription: sub, value: 69.9, status: 'RECEIVED', billingType: 'PIX', dueDate: hojeBR() }, extra || {});
  if (tipo !== 'PAYMENT_OVERDUE') pagamentos[payId] = pay;
  return wh.processarEvento({ event: tipo, payment: pay });
}
const cron = async () => T.avisarAtrasoParceiros(await fake.db.collection('assinaturas').get(), true, 're_teste', Date.now());

/* P = parceiro aprovado que abriu um negocio. parceiroAntes=true: a conta de
   parceiro nasceu 60 dias antes do negocio (createTime). L = lojista indicado. */
function cenarioPL(trialVenceMs, parceiroAntes) {
  cenario(); fake.criados.clear();
  const agora = Date.now();
  fake.criado('parceiros/P', parceiroAntes ? agora - 90 * DIA : agora - 5 * DIA);
  fake.criado('negocios/P', parceiroAntes ? agora - 30 * DIA : agora - 60 * DIA);
  store.set('assinaturas/P', { plano: 'pro', periodo: 'trial', ativo: true, vence_em: ts(trialVenceMs) });
}

(async () => {
  // ---------- funcoes puras ----------
  const AG = Date.UTC(2026, 9, 20, 15);
  const B = { parceiroAntes: true, negocioMs: AG - 10 * DIA };
  let s = R.avaliarSituacao(true, { periodo: 'trial', ativo: true, vence_em: ts(AG + 5 * DIA) }, AG, B);
  conf(s.ok === true && s.motivo === 'parceiro_em_teste', 'B: parceiro que virou lojista ganha durante o teste');
  s = R.avaliarSituacao(true, { periodo: 'trial', ativo: true, vence_em: ts(AG - 5 * DIA) }, AG, B);
  conf(s.carencia === true && s.motivo === 'fim_teste' && s.inicioMs === AG - 5 * DIA && s.prazoMs === AG + 25 * DIA, 'B: teste acabou ha 5 dias = carencia ate 30 dias do fim do teste');
  s = R.avaliarSituacao(true, { periodo: 'trial', ativo: false, vence_em: ts(AG - 31 * DIA) }, AG, B);
  conf(s.ok === false && s.carencia !== true, 'B: teste acabou ha 31 dias no Basico = nao ganha');
  conf(R.avaliarSituacao(true, null, AG, { parceiroAntes: true, negocioMs: AG - 10 * DIA }).ok === true, 'B: negocio sem assinatura ainda (10 dias) = ganha');
  s = R.avaliarSituacao(true, null, AG, { parceiroAntes: true, negocioMs: AG - 40 * DIA });
  conf(s.carencia === true && s.motivo === 'fim_teste', 'B: negocio sem assinatura ha 40 dias = carencia');
  conf(R.avaliarSituacao(true, { periodo: 'mensal', ativo: true, vence_em: ts(AG + DIA) }, AG, B).motivo === 'pagante', 'B: pagou = regra de pagante');
  s = R.avaliarSituacao(true, { periodo: 'mensal', ativo: false, atrasoDesde: ts(AG - 3 * DIA) }, AG, B);
  conf(s.carencia === true && s.motivo === 'carencia', 'B: pagou e atrasou = carencia do atraso de sempre');
  conf(R.avaliarSituacao(true, { periodo: 'trial', ativo: true, vence_em: ts(AG + 5 * DIA) }, AG, { parceiroAntes: false, negocioMs: AG - 10 * DIA }).ok === false, 'lojista que virou parceiro: teste continua sem comissao (regra antiga)');
  conf(R.avaliarSituacao(true, { periodo: 'trial', ativo: true, vence_em: ts(AG + 5 * DIA) }, AG).ok === false, 'sem a informacao de quem nasceu antes: regra antiga');

  // ---------- 1. parceiro que virou lojista, em teste: comissao normal ----------
  cenarioPL(Date.now() + 10 * DIA, true);
  await evento('PAYMENT_RECEIVED', 'payL1', 'L', 'subL');
  conf(d('comissoes/payL1_n1') && d('comissoes/payL1_n1').valor === 10.49, '1. em teste, recebe a comissao normal');
  conf(!d('comissoes_retidas/payL1_n1'), '1. nada retido');

  // ---------- 2. lojista que virou parceiro, em teste: regra antiga ----------
  cenarioPL(Date.now() + 10 * DIA, false);
  await evento('PAYMENT_RECEIVED', 'payL2', 'L', 'subL');
  conf(!d('comissoes/payL2_n1') && !d('comissoes_retidas/payL2_n1'), '2. lojista primeiro, em teste: sem comissao (como antes)');

  // ---------- 3. teste acabou: retida, e-mail do teste, assinou: liberada ----------
  cenarioPL(Date.now() - 2 * DIA, true);
  const fimTeste = d('assinaturas/P').vence_em.toMillis();
  await evento('PAYMENT_RECEIVED', 'payL3', 'L', 'subL');
  conf(!d('comissoes/payL3_n1'), '3. teste acabou: comissao nao entra no saldo');
  const ret = d('comissoes_retidas/payL3_n1');
  conf(ret && ret.status === 'retida' && ret.motivo === 'fim_teste' && ret.prazoMs === fimTeste + 30 * DIA, '3. retida com motivo fim_teste e prazo de 30 dias do fim do teste');
  const esp = d('parceiros/P').retidoAtraso;
  conf(esp && esp.motivo === 'fim_teste' && esp.valor === 10.49, '3. espelho do painel com motivo fim_teste');
  emails.length = 0;
  let r = await cron();
  const e1 = emails[0] || {};
  conf(r.enviados === 1 && /teste grátis terminou/.test(e1.subject || ''), '3. e-mail proprio do fim do teste: ' + e1.subject);
  const html = String(e1.html || '');
  conf(/Escolher meu plano/.test(html) && !/mensalidade em atraso/i.test(html) && /Básico/.test(html), '3. texto do teste, sem falar de atraso, explica o Basico');
  conf(html.indexOf('Contagem regressiva') > html.indexOf('Escolher meu plano'), '3. contagem regressiva no fim');
  conf(!/ganh|renda|garantid/i.test(html + e1.text), '3. sem promessa de ganho');
  conf(d('assinaturas/P').lembretes.atrasoParc.id === 'teste' + fimTeste, '3. marca propria do fim do teste');
  r = await cron();
  conf(r.enviados === 0, '3. mesma etapa nao reenvia');
  telegram.length = 0;
  await evento('PAYMENT_RECEIVED', 'payP1', 'P', 'subP', { dueDate: hojeBR() });
  conf(d('comissoes/payL3_n1') && d('comissoes_retidas/payL3_n1').status === 'liberada', '3. assinou no prazo: comissao liberada');
  conf(!('retidoAtraso' in d('parceiros/P')), '3. espelho some do painel');
  await evento('PAYMENT_RECEIVED', 'payL3b', 'L', 'subL', { dueDate: hojeBR() });
  conf(d('comissoes/payL3b_n1'), '3. pagante: comissao seguinte entra direto');

  // ---------- 4. teste acabou e passou dos 30 dias: perdida com texto do teste ----------
  cenarioPL(Date.now() - 2 * DIA, true);
  await evento('PAYMENT_RECEIVED', 'payL4', 'L', 'subL');
  desloc = 29 * DIA;
  emails.length = 0;
  await cron();
  conf(d('comissoes_retidas/payL4_n1').status === 'perdida', '4. 30 dias depois do fim do teste: perdida');
  conf(emails.some((e) => /perdidas/.test(e.subject) && /fim do teste grátis/.test(e.html)), '4. aviso de perda fala do teste');
  desloc = 0;

  // ---------- 5. auto-indicacao continua barrada no parceiro que virou lojista ----------
  cenarioPL(Date.now() + 10 * DIA, true);
  store.set('indicacoes/P', { ref: 'pj' });
  await evento('PAYMENT_RECEIVED', 'payP5', 'P', 'subP', { dueDate: hojeBR() });
  conf(!d('comissoes/payP5_n1') && !d('comissoes_retidas/payP5_n1'), '5. sem comissao sobre a propria assinatura');

  console.log(falhas ? ('FALHAS ' + falhas + ' / OK ' + ok) : ('TUDO OK (' + ok + ' conferencias)'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
