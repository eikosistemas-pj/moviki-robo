'use strict';
// Teste do cancelar/desistir pelo painel (22/10/2026). Sem internet:
//   cd moviki-robo && node testes/cancelar.test.js
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
const SESS = { tA: { uid: 'LojaAAAAAAAAAAAAAAAA', email: 'a@x.com' }, tB: { uid: 'LojaBBBBBBBBBBBBBBBB', email: 'b@x.com' }, tC: { uid: 'LojaCCCCCCCCCCCCCCCC', email: 'c@x.com' } };
fake.admin.auth = () => ({ verifyIdToken: async (t) => { if (!SESS[t]) throw new Error('token'); return SESS[t]; } });
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'x', filename: 'x', loaded: true, exports: { admin: fake.admin, db: fake.db } };
const chamadas = [];
require.cache[require.resolve(path.join(ROBO, 'lib/asaas.js'))] = { id: 'y', filename: 'y', loaded: true, exports: { asaas: async (p, m, b) => { chamadas.push(m + ' ' + p); return { deleted: true }; } } };
global.fetch = async () => ({ ok: true, json: async () => ({}), text: async () => '' });
const h = require(path.join(ROBO, 'api/cancelar-assinatura.js'));
let falhas = 0, ok = 0;
function conf(c, m) { if (c) ok++; else { falhas++; console.log('FALHOU:', m); } }
function res() { return { c: 0, b: null, setHeader() {}, status(c) { this.c = c; return this; }, json(b) { this.b = b; return this; }, end() { return this; } }; }
async function post(t, body) { const r = res(); await h({ method: 'POST', headers: { origin: 'https://app.moviki.com.br', authorization: 'Bearer ' + t }, body }, r); return r; }
const TS = fake.Timestamp, DIA = 86400000, agora = Date.now();
(async () => {
  // A: Pro mensal, pagou ha 3 dias -> pode desistir
  await fake.db.collection('assinaturas').doc('LojaAAAAAAAAAAAAAAAA').set({ plano: 'pro', periodo: 'mensal', ativo: true, vence_em: TS.fromMillis(agora + 28 * DIA) });
  await fake.db.collection('faturamento').doc('LojaAAAAAAAAAAAAAAAA').set({ asaasSubscriptionId: 'sub_A', pagosLigados: { pay_A1: TS.fromMillis(agora - 3 * DIA) } });
  // B: Premium, 1o pagamento ha 40 dias -> so cancela
  await fake.db.collection('assinaturas').doc('LojaBBBBBBBBBBBBBBBB').set({ plano: 'premium', periodo: 'mensal', ativo: true, vence_em: TS.fromMillis(agora + 10 * DIA) });
  await fake.db.collection('faturamento').doc('LojaBBBBBBBBBBBBBBBB').set({ asaasSubscriptionId: 'sub_B', pagosLigados: { pay_B1: TS.fromMillis(agora - 40 * DIA), pay_B2: TS.fromMillis(agora - 10 * DIA) } });
  // C: teste gratis -> nada para cancelar
  await fake.db.collection('assinaturas').doc('LojaCCCCCCCCCCCCCCCC').set({ plano: 'pro', periodo: 'trial', ativo: true });

  let r = await post('xx', { acao: 'status' });
  conf(r.c === 401, 'sem sessao -> 401');

  r = await post('tA', { acao: 'status' });
  conf(r.c === 200 && r.b.pago === true && r.b.podeDesistir === true && r.b.renovacaoCancelada === false, 'A pode desistir');
  r = await post('tB', { acao: 'status' });
  conf(r.b.podeDesistir === false && r.b.pago === true, 'B fora do prazo');

  r = await post('tB', { acao: 'desistir' });
  conf(r.c === 400 && r.b.erro === 'fora_do_prazo', 'B nao desiste fora do prazo');
  r = await post('tB', { acao: 'cancelar', motivo: 'caro' });
  conf(r.c === 200 && /^MVK-\d{8}-[0-9A-F]{6}$/.test(r.b.protocolo), 'B cancela com protocolo');
  conf(chamadas.indexOf('DELETE /subscriptions/sub_B') >= 0, 'B: renovacao parada no Asaas');
  let a = fake.store.get('assinaturas/LojaBBBBBBBBBBBBBBBB');
  conf(a.renovacaoCancelada === true && a.ativo === true, 'B: plano segue ativo ate o fim');
  conf(!fake.store.get('faturamento/LojaBBBBBBBBBBBBBBBB').asaasSubscriptionId, 'B: assinatura atual sai do registro');
  r = await post('tB', { acao: 'cancelar' });
  conf(r.c === 200 && r.b.jaCancelado === true, 'cancelar de novo nao duplica');

  r = await post('tC', { acao: 'cancelar' });
  conf(r.c === 400 && r.b.erro === 'sem_plano', 'teste gratis nao tem o que cancelar');

  delete process.env.DESISTENCIA_REEMBOLSO_AUTO;
  r = await post('tA', { acao: 'desistir' });
  conf(r.c === 200 && r.b.reembolsoAuto === false, 'A desiste (devolucao pelo dono)');
  conf(chamadas.indexOf('DELETE /subscriptions/sub_A') >= 0 && !chamadas.some((c) => /refund/.test(c)), 'sem env nao estorna sozinho');
  const fa = fake.store.get('faturamento/LojaAAAAAAAAAAAAAAAA');
  const reg = fa.cancelamentos[Object.keys(fa.cancelamentos)[0]];
  conf(reg.tipo === 'desistir' && reg.pagamentos.indexOf('pay_A1') >= 0, 'registro com os pagamentos a devolver');
  r = await post('tA', { acao: 'desistir' });
  conf(r.c === 400, 'desistir duas vezes nao');

  // estorno automatico com a env
  process.env.DESISTENCIA_REEMBOLSO_AUTO = '1';
  await fake.db.collection('assinaturas').doc('LojaCCCCCCCCCCCCCCCC').set({ plano: 'enterprise', periodo: 'fundador', ativo: true, vence_em: TS.fromMillis(agora + 340 * DIA) });
  await fake.db.collection('faturamento').doc('LojaCCCCCCCCCCCCCCCC').set({ asaasSubscriptionId: 'sub_C', pagosLigados: { pay_C1: TS.fromMillis(agora - 20 * DIA) } });
  r = await post('tC', { acao: 'status' });
  conf(r.b.podeDesistir === true && r.b.fundador === true, 'Fundador: garantia de 30 dias');
  r = await post('tC', { acao: 'desistir' });
  conf(r.c === 200 && chamadas.indexOf('POST /payments/pay_C1/refund') >= 0, 'com a env o estorno e pedido');

  console.log(ok + ' ok, ' + falhas + ' falha(s)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
