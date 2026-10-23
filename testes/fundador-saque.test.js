'use strict';
// Teste do Lote Fundador e da trava de saque por parceiro (B14), 01/10/2026.
// Roda sem internet e sem Firebase:
//   cd moviki-robo && node testes/fundador-saque.test.js   (nao precisa de npm install)
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
const { store, Timestamp } = fake;

// ---------- stubs: Firebase, Asaas, GA, Meta, checkout ----------
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'f', filename: 'f', loaded: true, exports: { admin: fake.admin, db: fake.db } };
const real = require(path.join(ROBO, 'lib/asaas.js'));
let chamadas = [];
let roteiro = () => ({});
async function asaasFalso(p, metodo, corpo) {
  chamadas.push({ p, metodo: metodo || 'GET', corpo });
  const r = roteiro(p, metodo || 'GET', corpo);
  if (r instanceof Error) throw r;
  return r;
}
require.cache[require.resolve(path.join(ROBO, 'lib/asaas.js'))] = { id: 'a', filename: 'a', loaded: true,
  exports: Object.assign({}, real, { asaas: asaasFalso }) };
const vazio = { purchase: async () => {}, uidPorTokenWebhook: async () => '', webhookPedido: async () => ({}) };
['lib/ga.js', 'lib/meta.js', 'lib/checkout.js'].forEach((f) => {
  require.cache[require.resolve(path.join(ROBO, f))] = { id: f, filename: f, loaded: true, exports: vazio };
});
fake.admin.auth = () => ({ verifyIdToken: async (t) => ({ uid: t, email: t + '@x.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } }), getUser: async (u) => ({ emailVerified: true, email: u + '@x.com' }) });

const criar = require(path.join(ROBO, 'api/criar-assinatura.js'));
const wh = require(path.join(ROBO, 'api/webhook.js'));
const saque = require(path.join(ROBO, 'api/pagar-saque.js'));
const { PLANOS, FUNDADOR } = real;

let falhas = 0, ok = 0;
function conf(c, msg) { if (c) ok++; else { falhas++; console.log('FALHOU:', msg); } }
const realNow = Date.now; let desloc = 0; Date.now = () => realNow() + desloc;
const DIA = 86400000;
const hojeBR = () => new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
const somaDias = (iso, n) => new Date(Date.parse(iso + 'T12:00:00-03:00') + n * DIA).toISOString().slice(0, 10);
const d = (p) => store.get(p);

function res() {
  return { code: 0, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; }, end() { return this; } };
}
async function chamarCriar(uid, plano, periodo) {
  const r = res();
  await criar({ method: 'POST', headers: { authorization: 'Bearer ' + uid, origin: 'https://app.moviki.com.br' }, body: { plano, periodo, cpfCnpj: '52998224725', nome: 'Loja' } }, r);
  return r;
}
async function chamarSaque(body) {
  const r = res();
  await saque({ method: 'POST', body: Object.assign({ idToken: 'ADM' }, body) }, r);
  return r;
}
function emTeste(uid, diasRestantes) {
  store.set('assinaturas/' + uid, { plano: 'pro', periodo: 'trial', ativo: true, vence_em: Timestamp.fromMillis(Date.now() + diasRestantes * DIA) });
}
function roteiroCriar(extra) {
  return (p, m, c) => {
    if (extra) { const x = extra(p, m, c); if (x !== undefined) return x; }
    if (p === '/customers' && m === 'POST') return { id: 'cus1' };
    if (p.indexOf('/customers/') === 0) return { id: 'cus1' };
    if (p === '/subscriptions' && m === 'POST') return { id: 'sub_' + c.value };
    if (/^\/subscriptions\/[^/]+\/payments/.test(p)) return { data: [{ invoiceUrl: 'https://asaas/fatura' }] };
    if (p === '/payments' && m === 'POST') return { id: 'pay_p1', installment: 'inst1', invoiceUrl: 'https://asaas/parcelado' };
    if (/^\/subscriptions\/[^/]+$/.test(p) && m === 'GET') return { status: 'ACTIVE' };
    return {};
  };
}

(async () => {
  // ===================== LOTE FUNDADOR — criar-assinatura =====================
  conf(PLANOS.enterprise.fundador.value === 990 && PLANOS.enterprise.fundador.cycle === 'YEARLY', 'plano fundador R$ 990 anual');
  conf(PLANOS.enterprise.fundador12x.value === 89.9 && PLANOS.enterprise.fundador12x.parcelas === 12 && !PLANOS.enterprise.fundador12x.cycle, '12x de 89,90 sem ciclo');
  conf(Math.abs(PLANOS.enterprise.fundador12x.total - 1078.8) < 0.001, 'total do 12x = 1.078,80');

  // 1. a vista, no teste gratis: cobranca vence HOJE e a vaga fica reservada
  store.clear(); chamadas = []; roteiro = roteiroCriar();
  emTeste('L1', 20);
  let r = await chamarCriar('L1', 'enterprise', 'fundador');
  conf(r.code === 200 && r.body.fundador === true, '1. fundador a vista criado (' + r.code + ' ' + JSON.stringify(r.body) + ')');
  const sub = chamadas.find((c) => c.p === '/subscriptions' && c.metodo === 'POST');
  conf(sub && sub.corpo.nextDueDate === hojeBR(), '1. cobranca vence hoje mesmo no teste (' + (sub && sub.corpo.nextDueDate) + ')');
  conf(sub && sub.corpo.value === 990 && sub.corpo.cycle === 'YEARLY' && sub.corpo.billingType === 'UNDEFINED', '1. R$ 990 anual, Pix/boleto/cartao');
  let est = d('oferta_fundador/estado');
  conf(est && est.itens.L1 && est.itens.L1.expiraMs > Date.now() && est.itens.L1.pago === false, '1. vaga reservada');
  conf(d('faturamento/L1').assinaturasAsaas['sub_990'].fundador === true, '1. assinatura marcada como fundador');
  conf(d('assinaturas/L1').periodo === 'trial', '1. o teste continua ate o pagamento');

  // 2. mesmo lojista clica de novo: reaproveita a propria vaga
  r = await chamarCriar('L1', 'enterprise', 'fundador');
  est = d('oferta_fundador/estado');
  conf(r.code === 200 && Object.keys(est.itens).length === 1, '2. clique de novo nao gasta outra vaga');

  // 3. lote cheio: ninguem novo gera cobranca; reserva vencida nao conta
  store.clear(); chamadas = []; roteiro = roteiroCriar();
  const itens = {};
  for (let i = 0; i < FUNDADOR.vagas; i++) itens['X' + i] = i < 49 ? { pago: true } : { pago: false, expiraMs: Date.now() + DIA };
  itens.VENCIDA = { pago: false, expiraMs: Date.now() - 1000 };
  store.set('oferta_fundador/estado', { vagas: FUNDADOR.vagas, itens });
  r = await chamarCriar('L2', 'enterprise', 'fundador');
  conf(r.code === 409 && r.body.motivo === 'fundador_esgotado', '3. esgotado com 49 vendidas + 1 reservada (' + r.code + ')');
  conf(!chamadas.some((c) => c.metodo === 'POST'), '3. nenhuma cobranca nasce com o lote cheio');
  // a reservada vence -> abre vaga
  store.get('oferta_fundador/estado').itens.X49.expiraMs = Date.now() - 1;
  r = await chamarCriar('L2', 'enterprise', 'fundador');
  conf(r.code === 200, '3. reserva vencida devolve a vaga');
  // quem ja tinha reserva viva passa mesmo com o lote cheio
  r = await chamarCriar('L2', 'enterprise', 'fundador');
  conf(r.code === 200, '3. dono da reserva viva continua passando');

  // 4. Asaas falhou ao criar: a vaga volta na hora
  store.clear(); chamadas = [];
  roteiro = roteiroCriar((p, m) => { if (p === '/subscriptions' && m === 'POST') { const e = new Error('CPF invalido'); e.status = 400; return e; } });
  r = await chamarCriar('L3', 'enterprise', 'fundador');
  est = d('oferta_fundador/estado');
  conf(r.code === 400 && est.itens.L3.expiraMs === 0, '4. falha no Asaas devolve a vaga (' + r.code + ')');

  // 5. prazo encerrado
  store.clear(); chamadas = []; roteiro = roteiroCriar();
  desloc = Date.parse(FUNDADOR.encerraEm) - realNow() + 60000;
  r = await chamarCriar('L4', 'enterprise', 'fundador');
  conf(r.code === 410 && !chamadas.length, '5. depois de 27/11 nao gera cobranca');
  r = await chamarCriar('L4', 'premium', 'mensal');
  conf(r.code === 200, '5. outros planos seguem');
  desloc = 0;

  // 6. 12x no cartao: cobranca parcelada, assinatura anterior cancelada
  store.clear(); chamadas = []; roteiro = roteiroCriar();
  store.set('faturamento/L5', { asaasCustomerId: 'cus1', asaasSubscriptionId: 'subVelha' });
  r = await chamarCriar('L5', 'enterprise', 'fundador12x');
  const parc = chamadas.find((c) => c.p === '/payments' && c.metodo === 'POST');
  conf(r.code === 200 && r.body.invoiceUrl === 'https://asaas/parcelado', '6. 12x devolve o link do Asaas');
  conf(parc && parc.corpo.billingType === 'CREDIT_CARD' && parc.corpo.installmentCount === 12 && parc.corpo.installmentValue === 89.9 && parc.corpo.externalReference === 'L5', '6. 12x de 89,90 no cartao');
  conf(!chamadas.some((c) => c.p === '/subscriptions' && c.metodo === 'POST'), '6. 12x nao cria assinatura');
  const f5 = d('faturamento/L5');
  conf(f5.parcelamentosAsaas.inst1.periodo === 'fundador12x' && f5.asaasParcelamentoAtual === 'inst1' && !('asaasSubscriptionId' in f5), '6. parcelamento registrado e assinatura atual removida');
  conf(chamadas.some((c) => c.p === '/subscriptions/subVelha' && c.metodo === 'DELETE'), '6. assinatura antiga cancelada');

  // 6b. gerou o 12x e depois o a vista: o parcelamento sem pagamento e cancelado
  r = await chamarCriar('L5', 'enterprise', 'fundador');
  conf(r.code === 200 && chamadas.some((c) => c.p === '/installments/inst1' && c.metodo === 'DELETE'), '6b. a vista depois do 12x cancela o parcelamento pendente');
  conf(!('asaasParcelamentoAtual' in d('faturamento/L5')) && d('faturamento/L5').asaasSubscriptionId === 'sub_990', '6b. a assinatura vira a cobranca atual');
  // 6c. dois cliques no 12x: o primeiro parcelamento sai
  store.clear(); chamadas = []; let nInst = 0;
  roteiro = roteiroCriar((p, m) => { if (p === '/payments' && m === 'POST') { nInst++; return { id: 'pay' + nInst, installment: 'instK' + nInst, invoiceUrl: 'https://asaas/p' + nInst }; } });
  await chamarCriar('L5b', 'enterprise', 'fundador12x');
  await chamarCriar('L5b', 'enterprise', 'fundador12x');
  conf(chamadas.some((c) => c.p === '/installments/instK1' && c.metodo === 'DELETE') && d('faturamento/L5b').asaasParcelamentoAtual === 'instK2', '6c. 12x de novo cancela o parcelamento anterior');

  // ===================== LOTE FUNDADOR — webhook =====================
  // parceiro P1 (direto), P2 (acima dele)
  function rede() {
    store.set('parceiro_slugs/p1', { uid: 'P1' }); store.set('parceiros/P1', { status: 'aprovado', indicadoPor: 'p2' });
    store.set('parceiro_slugs/p2', { uid: 'P2' }); store.set('parceiros/P2', { status: 'aprovado' });
  }
  // 7. a vista pago no teste: 12 meses depois do fim do teste, vaga vendida, renovacao ajustada, comissao retida 30 dias
  store.clear(); chamadas = []; rede();
  emTeste('L6', 20);
  const fimTeste = d('assinaturas/L6').vence_em.toMillis();
  store.set('indicacoes/L6', { ref: 'p1' });
  store.set('faturamento/L6', { asaasSubscriptionId: 'subF', assinaturasAsaas: { subF: { plano: 'enterprise', periodo: 'fundador', fundador: true } } });
  store.set('oferta_fundador/estado', { vagas: 50, itens: { L6: { pago: false, expiraMs: Date.now() + DIA } } });
  roteiro = (p, m) => {
    if (p === '/payments/payF') return { id: 'payF', status: 'RECEIVED', externalReference: 'L6', value: 990, subscription: 'subF', dueDate: hojeBR(), billingType: 'PIX' };
    return {};
  };
  await wh.processarEvento({ event: 'PAYMENT_RECEIVED', payment: { id: 'payF', externalReference: 'L6', subscription: 'subF' } }, { escopo: 'mae' });
  let a = d('assinaturas/L6');
  const esperado = fimTeste + (366 + 3) * DIA;
  conf(a.plano === 'enterprise' && a.periodo === 'fundador' && a.ativo === true, '7. Enterprise fundador ligado');
  conf(Math.abs(a.vence_em.toMillis() - esperado) < 2 * DIA, '7. 12 meses contam do fim do teste');
  conf(d('oferta_fundador/estado').itens.L6.pago === true, '7. vaga vendida');
  const ajuste = chamadas.find((c) => c.p === '/subscriptions/subF' && c.metodo === 'POST');
  conf(ajuste && Math.abs(Date.parse(ajuste.corpo.nextDueDate + 'T12:00:00-03:00') - (esperado - 3 * DIA)) < 2 * DIA, '7. renovacao do 2o ano no fim do periodo pago (' + (ajuste && ajuste.corpo.nextDueDate) + ')');
  const c1 = d('comissoes/payF_n1'), c2 = d('comissoes/payF_n2');
  conf(c1 && Math.abs(c1.valor - 148.5) < 0.01, '7. N1 15% = 148,50');
  conf(c2 && Math.abs(c2.valor - 74.25) < 0.01, '7. N2 7,5% = 74,25');
  conf(c1 && c1.liberaEm.toMillis() > Date.now() + 29 * DIA, '7. comissao do lote retida 30 dias');

  // 8. 12x: parcelas confirmadas juntas ligam o plano UMA vez; comissao de cada parcela so libera depois do credito
  store.clear(); chamadas = []; rede();
  store.set('indicacoes/L7', { ref: 'p1' });
  const v1 = hojeBR();
  store.set('faturamento/L7', { asaasParcelamentoAtual: 'inst7', parcelamentosAsaas: { inst7: { plano: 'enterprise', periodo: 'fundador12x', primeiroVencimento: v1 } } });
  store.set('oferta_fundador/estado', { vagas: 50, itens: { L7: { pago: false, expiraMs: Date.now() + DIA } } });
  const parcela = (n) => ({ id: 'parc' + n, status: 'CONFIRMED', externalReference: 'L7', value: 89.9, installment: 'inst7', installmentNumber: n,
    dueDate: somaDias(v1, 30 * (n - 1)), billingType: 'CREDIT_CARD', estimatedCreditDate: somaDias(v1, 30 * n) });
  roteiro = (p) => { const m = /^\/payments\/parc(\d+)$/.exec(p); return m ? parcela(Number(m[1])) : {}; };
  for (const n of [2, 1, 3, 12]) {
    await wh.processarEvento({ event: 'PAYMENT_CONFIRMED', payment: { id: 'parc' + n, externalReference: 'L7', installment: 'inst7' } }, { escopo: 'mae' });
  }
  a = d('assinaturas/L7');
  const esp7 = Date.parse(v1 + 'T12:00:00-03:00') + (366 + 3) * DIA;
  conf(a.plano === 'enterprise' && a.periodo === 'fundador12x' && a.ativo === true, '8. fundador 12x ligado');
  conf(Math.abs(a.vence_em.toMillis() - esp7) < 2 * DIA, '8. vence 12 meses depois do 1o vencimento, parcelas nao empurram (' + new Date(a.vence_em.toMillis()).toISOString().slice(0, 10) + ')');
  conf(d('oferta_fundador/estado').itens.L7.pago === true, '8. vaga vendida no 12x');
  const n1s = [1, 2, 3, 12].map((n) => d('comissoes/parc' + n + '_n1'));
  conf(n1s.every((c) => c && Math.abs(c.valor - 13.49) < 0.01), '8. N1 de 13,49 em cada parcela');
  conf(n1s[3].liberaEm.toMillis() > Date.parse(somaDias(v1, 360) + 'T00:00:00-03:00'), '8. comissao da 12a parcela so libera depois do credito dela');
  const n2s = [1, 2, 3, 12].map((n) => d('comissoes/parc' + n + '_n2')).filter(Boolean);
  conf(n2s.length === 1, '8. N2 so na primeira parcela processada (' + n2s.length + ')');

  // 9. parcela sem registro nunca liga plano
  store.clear(); chamadas = [];
  store.set('faturamento/L8', {});
  roteiro = (p) => (p === '/payments/ppxx' ? { id: 'ppxx', status: 'CONFIRMED', externalReference: 'L8', value: 89.9, installment: 'instX', dueDate: hojeBR() } : {});
  let erro = null;
  try { await wh.processarEvento({ event: 'PAYMENT_CONFIRMED', payment: { id: 'ppxx', externalReference: 'L8', installment: 'instX' } }, { escopo: 'mae' }); } catch (e) { erro = e; }
  conf(erro && !d('assinaturas/L8'), '9. parcela desconhecida: erro (reprocessa e avisa), plano nao liga');

  // 9b. parcela vencida de um parcelamento que NAO e o atual nao derruba o plano pago
  store.clear(); chamadas = [];
  store.set('assinaturas/L8b', { plano: 'enterprise', periodo: 'fundador', ativo: true, vence_em: Timestamp.fromMillis(Date.now() + 300 * DIA) });
  store.set('faturamento/L8b', { asaasSubscriptionId: 'subH', assinaturasAsaas: { subH: { plano: 'enterprise', periodo: 'fundador' } }, parcelamentosAsaas: { instVelho: { plano: 'enterprise', periodo: 'fundador12x' } } });
  await wh.processarEvento({ event: 'PAYMENT_OVERDUE', payment: { id: 'ppvv', externalReference: 'L8b', installment: 'instVelho' } }, { escopo: 'mae' });
  conf(d('assinaturas/L8b').ativo === true, '9b. parcela de parcelamento antigo nao derruba');
  // 9c. com o 12x como atual, aviso de assinatura velha tambem nao derruba
  store.set('faturamento/L8b', { asaasParcelamentoAtual: 'instA', parcelamentosAsaas: { instA: { plano: 'enterprise', periodo: 'fundador12x', ligadoEm: 1 } } });
  await wh.processarEvento({ event: 'PAYMENT_OVERDUE', payment: { id: 'subvv', externalReference: 'L8b', subscription: 'subVelha' } }, { escopo: 'mae' });
  conf(d('assinaturas/L8b').ativo === true, '9c. assinatura velha nao derruba o 12x atual');

  // 10. garantia: devolucao desliga, estorna comissao e devolve a vaga
  store.clear(); chamadas = []; rede();
  store.set('indicacoes/L9', { ref: 'p1' });
  store.set('faturamento/L9', { asaasSubscriptionId: 'subG', assinaturasAsaas: { subG: { plano: 'enterprise', periodo: 'fundador', fundador: true } } });
  store.set('oferta_fundador/estado', { vagas: 50, itens: { L9: { pago: false, expiraMs: Date.now() + DIA } } });
  roteiro = (p) => (p === '/payments/payG' ? { id: 'payG', status: 'RECEIVED', externalReference: 'L9', value: 990, subscription: 'subG', dueDate: hojeBR(), billingType: 'PIX' } : {});
  await wh.processarEvento({ event: 'PAYMENT_RECEIVED', payment: { id: 'payG', externalReference: 'L9', subscription: 'subG' } }, { escopo: 'mae' });
  await wh.processarEvento({ event: 'PAYMENT_REFUNDED', payment: { id: 'payG', externalReference: 'L9', subscription: 'subG' } }, { escopo: 'mae' });
  conf(d('assinaturas/L9').ativo === false, '10. devolucao desliga o plano');
  conf(d('comissoes/payG_n1').estornada === true, '10. comissao estornada');
  conf(d('oferta_fundador/estado').itens.L9.pago === false, '10. vaga volta para o lote');

  // 10b. placar publico: so numeros, conta vendidas + reservas vivas
  store.clear();
  store.set('oferta_fundador/estado', { vagas: 50, itens: { A: { pago: true }, B: { pago: false, expiraMs: Date.now() + DIA }, C: { pago: false, expiraMs: Date.now() - 1 } } });
  r = res(); await criar({ method: 'GET', headers: { origin: 'https://www.moviki.com.br' } }, r);
  conf(r.code === 200 && r.body.restam === 48 && r.body.aberto === true && r.body.avista === 990 && r.body.parcela === 89.9, '10b. placar: restam 48 (' + JSON.stringify(r.body) + ')');
  conf(r.headers['Access-Control-Allow-Origin'] === 'https://www.moviki.com.br' && !JSON.stringify(r.body).includes('"A"'), '10b. placar sem uid e com CORS do site');
  desloc = Date.parse(FUNDADOR.encerraEm) - realNow() + 60000;
  r = res(); await criar({ method: 'GET', headers: {} }, r);
  conf(r.body.aberto === false, '10b. placar fecha depois do prazo');
  desloc = 0;

  // 11. planos antigos continuam iguais
  conf(PLANOS.premium.mensal.value === 69.9 && PLANOS.enterprise.mensal.value === 129.9 && PLANOS.premium.anual.value === 699, '11. precos atuais intactos');

  // ===================== B14 — dois saques do mesmo parceiro =====================
  store.clear(); chamadas = [];
  store.set('admins/ADM', { ok: true });
  store.set('parceiros/PX', { status: 'aprovado', pix: 'parceiro@teste.com', nome: 'Parceiro X' });
  store.set('parceiros_fiscal/PX', { tipo: 'pj', documento: '11222333000181', nome: 'Parceiro X Teste ME' });  // 22/10: sem dados para receber o robo nao paga; PJ = sem retencao (PF tem teste proprio)
  const antes = Timestamp.fromMillis(Date.now() - 20 * DIA);
  store.set('comissoes/c1', { parceiroUid: 'PX', valor: 30, pago: false, estornada: false, criadoEm: antes, liberaEm: Timestamp.fromMillis(Date.now() - 10 * DIA) });
  store.set('comissoes/c2', { parceiroUid: 'PX', valor: 20, pago: false, estornada: false, criadoEm: antes, liberaEm: Timestamp.fromMillis(Date.now() - 10 * DIA) });
  store.set('saques/SA', { parceiroUid: 'PX', nfseChave: '11111111111111111111111111111111111111111111111111', status: 'solicitado', valorSolicitado: 50, pedidoEm: Timestamp.now() });
  store.set('saques/SB', { parceiroUid: 'PX', nfseChave: '11111111111111111111111111111111111111111111111111', status: 'solicitado', valorSolicitado: 50, pedidoEm: Timestamp.now() });
  let transfers = 0;
  let modo = 'incerto';
  roteiro = (p, m, c) => {
    if (p.indexOf('/pix/addressKeys/external') === 0) return { name: 'Parceiro X' };
    if (p === '/transfers' && m === 'POST') {
      transfers++;
      if (modo === 'incerto') { const e = new Error('timeout'); e.status = 503; return e; }
      return { id: 't_' + c.externalReference, status: 'PENDING', authorized: true };
    }
    if (p.indexOf('/transfers?externalReference=') === 0) return { data: [] };
    return {};
  };
  r = await chamarSaque({ saqueId: 'SA', etapa: 'pagar' });
  conf(r.code === 502 && r.body.erro === 'asaas_incerto', '12. Pix do saque A sem confirmacao (' + r.code + ')');
  conf(d('saque_trava/PX') && d('saque_trava/PX').incerto === true && d('saque_trava/PX').saqueId === 'SA', '12. trava do parceiro fica em duvida');
  modo = 'ok';
  r = await chamarSaque({ saqueId: 'SB', etapa: 'pagar' });
  conf(r.code === 409 && r.body.erro === 'outro_saque_incerto' && transfers === 1, '12. saque B NAO paga enquanto o A esta em duvida (' + r.code + ', transfers ' + transfers + ')');
  r = await chamarSaque({ saqueId: 'SB', etapa: 'manual', valorConferido: 50 });
  conf(r.code === 409 && r.body.erro === 'outro_saque_incerto', '12. registrar B na mao tambem e barrado');
  // o dono tenta o A de novo: agora sai, quita e solta a trava
  store.get('saques/SA').pagamentoEmCursoEm = null;
  r = await chamarSaque({ saqueId: 'SA', etapa: 'pagar' });
  conf(r.code === 200 && r.body.valorPago === 50 && transfers === 2, '12. saque A pago na nova tentativa');
  conf(!d('saque_trava/PX'), '12. trava solta depois do pagamento');
  r = await chamarSaque({ saqueId: 'SB', etapa: 'pagar' });
  conf(r.code === 409 && r.body.erro === 'sem_valor' && transfers === 2, '12. saque B nao tem mais o que pagar (nada em dobro)');

  // 13. baixa pendente de outro saque segura o pagamento seguinte
  store.set('comissoes/c3', { parceiroUid: 'PX', valor: 10, pago: false, estornada: false, criadoEm: antes, liberaEm: Timestamp.fromMillis(Date.now() - 10 * DIA) });
  store.set('saques/SC', { parceiroUid: 'PX', status: 'pago', quitacaoPendente: true, valorPago: 10, pedidoEm: Timestamp.now() });
  store.set('saques/SD', { parceiroUid: 'PX', nfseChave: '11111111111111111111111111111111111111111111111111', status: 'solicitado', valorSolicitado: 10, pedidoEm: Timestamp.now() });
  r = await chamarSaque({ saqueId: 'SD', etapa: 'pagar' });
  conf(r.code === 409 && r.body.erro === 'outro_saque_baixa_pendente' && transfers === 2, '13. baixa pendente do saque C barra o D');
  conf(!d('saque_trava/PX'), '13. recusa nao deixa trava presa');
  r = await chamarSaque({ saqueId: 'SC', etapa: 'pagar' });
  conf(r.code === 200 && r.body.retomada === true && transfers === 2, '13. retomar o C conclui a baixa sem Pix novo');
  r = await chamarSaque({ saqueId: 'SD', etapa: 'pagar' });
  conf(r.code === 409 && r.body.erro === 'sem_valor', '13. D nao paga o que o C ja pagou');

  // 14. trava viva de outro saque (em curso) segura; vencida libera
  store.set('saque_trava/PX', { saqueId: 'SZ', incerto: false, em: Timestamp.now() });
  store.set('comissoes/c4', { parceiroUid: 'PX', valor: 15, pago: false, estornada: false, criadoEm: antes, liberaEm: Timestamp.fromMillis(Date.now() - 10 * DIA) });
  store.set('saques/SE', { parceiroUid: 'PX', nfseChave: '11111111111111111111111111111111111111111111111111', status: 'solicitado', valorSolicitado: 15, pedidoEm: Timestamp.now() });
  r = await chamarSaque({ saqueId: 'SE', etapa: 'pagar' });
  conf(r.code === 409 && r.body.erro === 'outro_saque_em_curso', '14. outro saque em curso segura');
  store.get('saque_trava/PX').em = Timestamp.fromMillis(Date.now() - 11 * 60000);
  store.get('saques/SE').pagamentoEmCursoEm = null;
  r = await chamarSaque({ saqueId: 'SE', etapa: 'pagar' });
  conf(r.code === 200 && r.body.valorPago === 15, '14. trava vencida (sem duvida) libera');

  // 15. aviso de transferencia do Asaas solta a trava do saque em duvida
  store.set('saques/SF', { parceiroUid: 'PX', nfseChave: '11111111111111111111111111111111111111111111111111', status: 'solicitado', valorSolicitado: 0, pedidoEm: Timestamp.now(), transferenciaId: 'tF' });
  store.set('saque_trava/PX', { saqueId: 'SF', incerto: true, em: Timestamp.now() });
  await wh.processarEvento({ event: 'TRANSFER_FAILED', transfer: { id: 'tF', status: 'FAILED', externalReference: 'SF' } }, { escopo: 'mae' });
  conf(!d('saque_trava/PX'), '15. TRANSFER_FAILED solta a trava');

  // ===================== 16. PF: retencao e 1 pagamento por mes (22/10/2026) =====================
  store.clear(); chamadas = [];
  process.env.PF_DIA_PAGAMENTO = '1';
  store.set('admins/ADM', { ok: true });
  store.set('parceiros/PY', { status: 'aprovado', pix: 'py@teste.com', nome: 'Parceiro Y' });
  const ant2 = Timestamp.fromMillis(Date.now() - 20 * DIA);
  store.set('comissoes/y1', { parceiroUid: 'PY', valor: 100, pago: false, estornada: false, criadoEm: ant2, liberaEm: Timestamp.fromMillis(Date.now() - 10 * DIA) });
  store.set('comissoes/y2', { parceiroUid: 'PY', valor: 200, pago: false, estornada: false, criadoEm: ant2, liberaEm: Timestamp.fromMillis(Date.now() - 10 * DIA) });
  store.set('saques/SY', { parceiroUid: 'PY', status: 'solicitado', valorSolicitado: 300, pedidoEm: Timestamp.now() });
  let valorPix = null;
  roteiro = (p, m, c) => {
    if (p.indexOf('/pix/addressKeys/external') === 0) return { name: 'Parceiro Y', cpfCnpj: '***.982.247-**' };
    if (p === '/transfers' && m === 'POST') { valorPix = c.value; return { id: 't_' + c.externalReference, status: 'PENDING', authorized: true }; }
    if (p.indexOf('/transfers?externalReference=') === 0) return { data: [] };
    return {};
  };
  r = await chamarSaque({ saqueId: 'SY', etapa: 'pagar' });
  conf(r.code === 409 && r.body.erro === 'sem_dados_fiscais', '16. sem dados para receber nao paga');
  store.set('parceiros_fiscal/PY', { tipo: 'pf', documento: '52998224725', nome: 'Parceiro Y Silva', nascimento: '1990-01-01' });
  r = await chamarSaque({ saqueId: 'SY', etapa: 'conferir' });
  conf(r.code === 200 && r.body.retencao.inss === 33 && r.body.retencao.liquido === 267 && r.body.docConfere === true, '16. conferir mostra INSS 11% e liquido (' + JSON.stringify(r.body.retencao) + ')');
  r = await chamarSaque({ saqueId: 'SY', etapa: 'pagar' });
  conf(r.code === 200 && valorPix === 267 && d('saques/SY').valorBruto === 300 && d('saques/SY').inssRetido === 33 && d('saques/SY').valorPago === 267, '16. Pix sai pelo liquido e o saque guarda a retencao');
  store.set('comissoes/y3', { parceiroUid: 'PY', valor: 50, pago: false, estornada: false, criadoEm: ant2, liberaEm: Timestamp.fromMillis(Date.now() - 10 * DIA) });
  store.set('saques/SY2', { parceiroUid: 'PY', status: 'solicitado', valorSolicitado: 50, pedidoEm: Timestamp.now() });
  r = await chamarSaque({ saqueId: 'SY2', etapa: 'pagar' });
  conf(r.code === 409 && r.body.erro === 'pf_ja_recebeu_no_mes', '16. PF so recebe 1 vez por mes');
  r = await chamarSaque({ saqueId: 'SY2', etapa: 'manual', valorConferido: 50 });
  conf(r.code === 409 && r.body.erro === 'pf_ja_recebeu_no_mes', '16. nem registrando na mao');
  // PJ sem nota
  store.set('parceiros_fiscal/PY', { tipo: 'pj', documento: '11222333000181', nome: 'Parceiro Y ME' });
  r = await chamarSaque({ saqueId: 'SY2', etapa: 'pagar' });
  conf(r.code === 409 && r.body.erro === 'pj_sem_nota', '16. PJ sem chave da NFS-e nao paga');
  delete process.env.PF_DIA_PAGAMENTO;

  console.log('\nOK ' + ok + ' / FALHAS ' + falhas);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
