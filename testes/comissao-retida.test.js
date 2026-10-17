'use strict';
// Carencia de 30 dias do lojista-parceiro em atraso (17/10/2026).
// Roda sem internet e sem Firebase:
//   cd moviki-robo && node testes/comissao-retida.test.js
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
const atrasar = (diasAtras) => evento('PAYMENT_OVERDUE', 'payP' + diasAtras, 'P', 'subP', { dueDate: somaDias(hojeBR(), -diasAtras), status: 'OVERDUE' });
const cron = async () => T.avisarAtrasoParceiros(await fake.db.collection('assinaturas').get(), true, 're_teste', Date.now());

(async () => {
  // ---------- funcoes puras ----------
  const AG = Date.UTC(2026, 9, 17, 15);
  conf(R.avaliarSituacao(false, null, AG).ok === true, 'parceiro puro sempre ganha');
  conf(R.avaliarSituacao(true, null, AG).ok === false, 'lojista sem assinatura nao ganha');
  conf(R.avaliarSituacao(true, { periodo: 'trial', ativo: true, vence_em: ts(AG + DIA) }, AG).ok === false, 'teste gratis nao ganha');
  conf(R.avaliarSituacao(true, { periodo: 'mensal', ativo: true, vence_em: ts(AG + DIA) }, AG).ok === true, 'pagante em dia ganha');
  let s = R.avaliarSituacao(true, { periodo: 'mensal', ativo: false, vence_em: ts(AG + DIA), atrasoDesde: ts(AG - 5 * DIA) }, AG);
  conf(s.carencia === true && s.prazoMs === AG + 25 * DIA, 'atraso de 5 dias = carencia ate o dia 30');
  conf(R.avaliarSituacao(true, { periodo: 'mensal', ativo: false, atrasoDesde: ts(AG - 31 * DIA) }, AG).carencia !== true, 'atraso de 31 dias = sem carencia');
  conf(R.avaliarSituacao(true, { periodo: 'mensal', ativo: false, vence_em: ts(AG - DIA) }, AG).carencia !== true, 'plano expirado sem atraso registrado (cancelou) = sem carencia');
  conf(R.etapaAtraso(AG + 29.5 * DIA, AG) === 1 && R.etapaAtraso(AG + 21 * DIA, AG) === 2 && R.etapaAtraso(AG + 7 * DIA, AG) === 4, 'etapas 30/21/7');
  conf(R.etapaAtraso(AG + 0.5 * DIA, AG) === 6 && R.etapaAtraso(AG - DIA, AG) === 0, 'ultimo dia = etapa 6; passou = 0');

  // ---------- 1. em dia: comissao normal ----------
  cenario();
  await evento('PAYMENT_RECEIVED', 'payL1', 'L', 'subL');
  conf(d('comissoes/payL1_n1') && d('comissoes/payL1_n1').valor === 10.49, '1. lojista-parceiro em dia recebe 15% (R$ 10,49)');
  conf(!d('comissoes_retidas/payL1_n1'), '1. nada retido');

  // ---------- 2. em atraso: retida, e-mail com contagem, pagou: liberada ----------
  cenario();
  await atrasar(1);
  const aP = d('assinaturas/P');
  conf(aP.ativo === false && aP.atrasoDesde && aP.atrasoDesde.toMillis() < Date.now(), '2. vencida grava atrasoDesde no vencimento');
  const ini = aP.atrasoDesde.toMillis();
  await atrasar(0);  // 2a cobranca vencida nao reinicia o prazo
  conf(d('assinaturas/P').atrasoDesde.toMillis() === ini, '2. segunda vencida nao reinicia o prazo');
  await evento('PAYMENT_RECEIVED', 'payL2', 'L', 'subL');
  conf(!d('comissoes/payL2_n1'), '2. em atraso a comissao NAO entra no saldo');
  const ret = d('comissoes_retidas/payL2_n1');
  conf(ret && ret.status === 'retida' && ret.valor === 10.49 && ret.prazoMs === ini + 30 * DIA, '2. comissao retida com prazo de 30 dias');
  const esp = d('parceiros/P').retidoAtraso;
  conf(esp && esp.valor === 10.49 && esp.qtd === 1 && esp.prazoMs === ini + 30 * DIA, '2. espelho no cadastro do parceiro (painel le daqui)');
  await evento('PAYMENT_CONFIRMED', 'payL2', 'L', 'subL');
  conf(Object.keys(Object.fromEntries(store)).filter((k) => k.startsWith('comissoes_retidas/')).length === 1, '2. reenvio do Asaas nao duplica a retida');

  let r = await cron();
  conf(r.enviados === 1 && emails.length === 1, '2. cron manda o e-mail do atraso (' + r.enviados + ')');
  const e1 = emails[0] || {};
  conf(/retidas/.test(e1.subject || ''), '2. assunto fala das comissoes retidas: ' + e1.subject);
  const html = String(e1.html || '');
  conf(html.indexOf('Contagem regressiva') > html.indexOf('Pagar minha mensalidade'), '2. contagem regressiva no FIM do e-mail');
  conf(/R\$ 10,49/.test(html) && /29 dias/.test(html), '2. e-mail mostra o retido e os dias que faltam');
  conf(!/ganh|renda|garantid/i.test(html + e1.text), '2. sem promessa de ganho');
  conf(d('assinaturas/P').lembretes.atrasoParc.etapa === 1, '2. marca etapa 1');
  r = await cron();
  conf(r.enviados === 0, '2. mesma etapa nao reenvia');
  desloc = 10 * DIA;
  r = await cron();
  conf(r.enviados === 1 && /Faltam \d+ dias/.test(emails[1].subject), '2. 10 dias depois: proxima etapa (' + (emails[1] && emails[1].subject) + ')');
  desloc = 28.6 * DIA;
  r = await cron();
  conf(r.enviados === 1 && /Último dia/.test(emails[2].subject), '2. ultimo dia: ' + (emails[2] && emails[2].subject));

  telegram.length = 0;
  await evento('PAYMENT_RECEIVED', 'payP0', 'P', 'subP', { dueDate: somaDias(hojeBR(), -28) });
  conf(d('assinaturas/P').ativo === true && !('atrasoDesde' in d('assinaturas/P')), '2. pagou: plano volta e o atraso some');
  conf(d('comissoes/payL2_n1') && d('comissoes/payL2_n1').valor === 10.49 && d('comissoes_retidas/payL2_n1').status === 'liberada', '2. pagou no prazo: comissao liberada no saldo');
  conf(telegram.some((t) => /liberadas: 1/.test(t)), '2. Paulo avisado da liberacao');
  conf(!('retidoAtraso' in d('parceiros/P')), '2. liberou: espelho some do painel');

  // ---------- 3. passou dos 30 dias: perdida ----------
  cenario();
  await atrasar(1);
  await evento('PAYMENT_RECEIVED', 'payL3', 'L', 'subL');
  desloc = 30 * DIA;
  emails.length = 0;
  r = await cron();
  conf(d('comissoes_retidas/payL3_n1').status === 'perdida', '3. depois de 30 dias a retida vira perdida');
  conf(!('retidoAtraso' in d('parceiros/P')), '3. perdeu: espelho some do painel');
  conf(emails.length === 1 && /perdidas/.test(emails[0].subject) && /R\$ 10,49/.test(emails[0].html), '3. aviso unico de comissao perdida');
  r = await cron();
  conf(emails.length === 1, '3. aviso de perda nao repete');
  await evento('PAYMENT_RECEIVED', 'payL4', 'L', 'subL', { dueDate: hojeBR() });
  conf(!d('comissoes/payL4_n1') && !d('comissoes_retidas/payL4_n1'), '3. comissao gerada depois do prazo nao e retida');
  await evento('PAYMENT_RECEIVED', 'payP9', 'P', 'subP', { dueDate: hojeBR() });
  conf(!d('comissoes/payL3_n1'), '3. pagar depois do prazo nao devolve a perdida');

  // ---------- 4. liberacao confere o prazo mesmo sem o cron ----------
  cenario();
  await atrasar(1);
  await evento('PAYMENT_RECEIVED', 'payL5', 'L', 'subL');
  desloc = 31 * DIA;
  await evento('PAYMENT_RECEIVED', 'payP5', 'P', 'subP', { dueDate: hojeBR() });
  conf(!d('comissoes/payL5_n1') && d('comissoes_retidas/payL5_n1').status === 'perdida', '4. sem cron, pagar fora do prazo nao libera');

  // ---------- 5. estorno do indicado derruba a retida ----------
  cenario();
  await atrasar(1);
  await evento('PAYMENT_RECEIVED', 'payL6', 'L', 'subL');
  await evento('PAYMENT_REFUNDED', 'payL6', 'L', 'subL');
  conf(d('comissoes_retidas/payL6_n1').status === 'estornada', '5. estorno do indicado estorna a retida');
  conf(!('retidoAtraso' in d('parceiros/P')), '5. estornou: espelho some do painel');
  await evento('PAYMENT_RECEIVED', 'payP6', 'P', 'subP', { dueDate: hojeBR() });
  conf(!d('comissoes/payL6_n1'), '5. estornada nao e liberada');

  // ---------- 6. teste gratis e Basico: regra antiga ----------
  cenario();
  store.set('assinaturas/P', { plano: 'pro', periodo: 'trial', ativo: true, vence_em: ts(Date.now() + 5 * DIA) });
  await evento('PAYMENT_RECEIVED', 'payL7', 'L', 'subL');
  conf(!d('comissoes/payL7_n1') && !d('comissoes_retidas/payL7_n1'), '6. lojista-parceiro no teste gratis nao ganha nem retem');
  await atrasar(1);
  conf(!('atrasoDesde' in (d('assinaturas/P') || {})), '6. vencida no teste nao abre carencia');

  // ---------- 7. parceiro puro nao muda ----------
  cenario();
  store.delete('negocios/P'); store.delete('assinaturas/P');
  await evento('PAYMENT_RECEIVED', 'payL8', 'L', 'subL');
  conf(d('comissoes/payL8_n1') && d('comissoes/payL8_n1').valor === 10.49, '7. parceiro puro recebe normal');

  // ---------- 8. em atraso mas nao e parceiro: sem e-mail ----------
  cenario();
  store.delete('parceiros/P');
  await atrasar(1);
  emails.length = 0;
  r = await cron();
  conf(emails.length === 0, '8. lojista em atraso que nao e parceiro nao recebe o e-mail');

  Date.now = realNow;
  console.log(falhas ? ('FALHAS: ' + falhas + ' / OK ' + ok) : ('TUDO OK (' + ok + ' conferencias)'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
