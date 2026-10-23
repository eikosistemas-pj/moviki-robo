'use strict';
// Teste da nota fiscal das mensalidades (22/10/2026). Sem internet:
//   cd moviki-robo && node testes/nfse.test.js
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
const N = require(path.join(ROBO, 'lib/nfse.js'));
let falhas = 0, ok = 0;
function conf(c, m) { if (c) ok++; else { falhas++; console.log('FALHOU:', m); } }
const chamadas = [];
async function asaasFalso(p, metodo, corpo) {
  chamadas.push({ p, metodo, corpo });
  if (p === '/invoices') return { id: 'inv_1', status: 'SCHEDULED' };
  if (/\/authorize$/.test(p)) return { id: 'inv_1', status: 'SYNCHRONIZED' };
  throw new Error('rota ' + p);
}
(async () => {
  // 1) desligada: nada acontece
  delete process.env.NFSE_ATIVA;
  let r = await N.emitirNotaDoPagamento({ asaas: asaasFalso, db: fake.db, admin: fake.admin, payId: 'pay_1', valor: 39.9, plano: 'pro', periodo: 'mensal', uid: 'U1' });
  conf(r.pulado === 'desligada' && chamadas.length === 0, 'desligada nao chama o Asaas');

  // 2) ligada sem codigo ou sem ISS: continua desligada
  process.env.NFSE_ATIVA = '1';
  r = await N.emitirNotaDoPagamento({ asaas: asaasFalso, db: fake.db, admin: fake.admin, payId: 'pay_1', valor: 39.9 });
  conf(r.pulado === 'desligada', 'sem codigo nao emite');

  // 3) ligada de verdade: agenda e autoriza
  process.env.NFSE_SERVICO_CODIGO = '010501';
  process.env.NFSE_ISS = '2';
  r = await N.emitirNotaDoPagamento({ asaas: asaasFalso, db: fake.db, admin: fake.admin, payId: 'pay_1', valor: 39.9, plano: 'pro', periodo: 'mensal', uid: 'U1' });
  conf(r.ok === true && r.invoiceId === 'inv_1', 'emite');
  const ag = chamadas.find((c) => c.p === '/invoices');
  conf(ag && ag.corpo.payment === 'pay_1' && ag.corpo.value === 39.9, 'nota ligada ao pagamento e ao valor');
  conf(ag && ag.corpo.municipalServiceCode === '010501' && ag.corpo.taxes.iss === 2 && ag.corpo.taxes.retainIss === false, 'servico e ISS das envs');
  conf(ag && /^\d{4}-\d{2}-\d{2}$/.test(ag.corpo.effectiveDate), 'data da nota');
  conf(/PRO \(mensal\)/.test(ag.corpo.serviceDescription), 'descricao com o plano');
  conf(chamadas.some((c) => c.p === '/invoices/inv_1/authorize'), 'pede a emissao na hora');
  conf(fake.store.get('nfse/pay_1').invoiceId === 'inv_1', 'guarda a nota');

  // 4) mesmo pagamento de novo (RECEIVED + CONFIRMED): nao duplica
  const antes = chamadas.length;
  r = await N.emitirNotaDoPagamento({ asaas: asaasFalso, db: fake.db, admin: fake.admin, payId: 'pay_1', valor: 39.9 });
  conf(r.pulado === 'ja_existe' && chamadas.length === antes, 'nao duplica');

  // 5) erro do Asaas: registra e devolve erro, nao lanca
  r = await N.emitirNotaDoPagamento({ asaas: async () => { throw new Error('Servico nao habilitado'); }, db: fake.db, admin: fake.admin, payId: 'pay_2', valor: 69.9 });
  conf(r.erro === 'agendar' && /habilitado/.test(r.mensagem), 'erro vira aviso');
  conf(fake.store.get('nfse/pay_2').status === 'erro_agendar', 'erro registrado');

  // 6) valor zero nao emite
  r = await N.emitirNotaDoPagamento({ asaas: asaasFalso, db: fake.db, admin: fake.admin, payId: 'pay_3', valor: 0 });
  conf(r.pulado === 'sem_valor', 'valor zero nao emite');

  // 7) webhook: recusa avisa o dono e atualiza o registro
  const avisos = [];
  await N.webhookNota('INVOICE_ERROR', { id: 'inv_1', payment: 'pay_1', status: 'ERROR', statusDescription: 'Codigo de servico invalido' }, fake.db, async (t) => avisos.push(t));
  conf(avisos.length === 1 && /RECUSADA/.test(avisos[0]) && /invalido/.test(avisos[0]), 'recusa avisa');
  conf(fake.store.get('nfse/pay_1').status === 'ERROR', 'status atualizado');
  await N.webhookNota('INVOICE_AUTHORIZED', { id: 'inv_1', payment: 'pay_1', status: 'AUTHORIZED', number: 15, pdfUrl: 'https://x/pdf' }, fake.db, async (t) => avisos.push(t));
  conf(avisos.length === 1 && fake.store.get('nfse/pay_1').numero === '15', 'autorizada nao avisa e guarda o numero');

  // 8) data em Brasilia: 01:00 UTC ainda e o dia anterior
  conf(N._t.hojeBR(Date.UTC(2026, 9, 23, 1, 0)) === '2026-10-22', 'data no fuso de Brasilia');
  console.log(ok + ' ok, ' + falhas + ' falha(s)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
