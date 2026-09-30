'use strict';
// Teste do estoque e da reserva (P53, 30/09/2026). Roda sem internet e sem Firebase:
// cd moviki-robo && node testes/estoque.test.js  (nao precisa de npm install)
process.env.CHECKOUT_CHAVE = 'uma-frase-longa-e-aleatoria-de-teste-1234567890';
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'x', filename: 'x', loaded: true, exports: { admin: fake.admin, db: fake.db } };
const ck = require(path.join(ROBO, 'lib/checkout.js'));
const T = ck._t;
const { store, Timestamp } = fake;
let falhas = 0, ok = 0;
function conf(c, msg) { if (c) { ok++; } else { falhas++; console.log('FALHOU:', msg); } }
const realNow = Date.now; let desloc = 0; Date.now = () => realNow() + desloc;
const d = (p) => store.get(p);
const UID = 'lojistaAAAAAAAAAAA1';
function base(plano) {
  store.clear();
  store.set('assinaturas/' + UID, { ativo: true, plano: plano || 'premium' });
  store.set('negocios/' + UID, { nome: 'Loja Teste', cardapio: [{ categoria: 'Roupas', produtos: [{ nome: 'Camiseta Azul', preco: '50', sku: 'abc123' }, { nome: 'Boné', preco: '30', sku: 'bon111' }] }] });
  store.set('recebimento/' + UID, { ligado: true, modo: 'pix', entrega: 'retirada', pix: { chaveCifrada: T.cifrar('loja@teste.com'), nome: 'Loja Teste', cidade: 'Joao Pessoa', docMascara: '***', mascara: 'lo***@teste.com', tipo: 'email' } });
  store.set('configuracoes/liveTermos', {});
}
const comprador = { nome: 'Ana Souza', cpf: '52998224725', whatsapp: '83999998888', aceite: true, lojistaUid: UID };
async function compraCard(itens, ip) { return T.compraCriar(Object.assign({ origem: 'cardapio', itens }, comprador), ip || '1.1.1.' + Math.random()); }
const est = () => (d('estoque/' + UID) || {}).itens || {};
const pub = () => (d('checkout_publico/' + UID) || {}).estoque || {};

(async () => {
  // 1. ajuste de estoque
  base();
  let r = await T.lojaEstoque(UID, { itens: [{ sku: 'abc123', nome: 'Camiseta Azul', para: 2 }] });
  conf(r.ok && r.itens.length === 1 && r.itens[0].qtd === 2, 'lojaEstoque cria item');
  conf(pub()['s:abc123'] === 2 && pub()['n:camiseta azul'] === 2, 'espelho publico por sku e nome');
  // 2. compra cardapio reserva
  r = await compraCard([{ sku: 'abc123', qtd: 2 }]);
  conf(r.ok, 'compra 2 unidades ok ' + JSON.stringify(r).slice(0, 120));
  const p1 = r.pedidoId;
  conf(est()['s:abc123'].qtd === 0 && est()['s:abc123'].res === 2, 'reserva baixa qtd e soma res');
  conf(pub()['s:abc123'] === 0, 'espelho mostra 0');
  conf(d('estoque_reservas/' + p1).ativa === true, 'reserva ativa');
  conf(d('pedidos/' + p1).estoque.v === 1 && d('pedidos/' + p1).estoque.linhas.length === 1, 'pedido guarda linhas');
  const freioAntes = (d('checkout_freio/_neg_' + UID) || {}).n;
  r = await compraCard([{ sku: 'abc123', qtd: 1 }]);
  conf(r.erro === 'esgotado' && r.nome === 'Camiseta Azul' && r.restam === 0, 'terceira unidade esgotada');
  conf((d('checkout_freio/_neg_' + UID) || {}).n === freioAntes, 'tentativa esgotada nao conta no freio');
  // produto sem controle continua vendendo
  r = await compraCard([{ sku: 'bon111', qtd: 3 }]);
  conf(r.ok && !d('estoque_reservas/' + r.pedidoId), 'produto sem controle vende sem reserva');
  // 3. vence pelo compraStatus do comprador
  desloc = 31 * 60000;
  r = await T.compraStatus({ pedidoId: p1, chave: 'errada' });
  conf(r.erro === 'nao_encontrado', 'status sem chave nao mexe');
  // 4. vence pelo cron (Pix direto abandonado)
  const g = await ck.varrerPedidosGateway(40);
  conf(d('pedidos/' + p1).status === 'expirado', 'cron vence Pix direto abandonado');
  conf(est()['s:abc123'].qtd === 2 && est()['s:abc123'].res === 0, 'peca volta ao vencer');
  conf(d('estoque_reservas/' + p1).ativa === false && d('estoque_reservas/' + p1).venceEm === undefined, 'reserva fecha e sai da busca');
  // 5. confirmar depois do prazo: baixa de novo
  r = await T.lojaPedido(UID, p1, 'pago');
  conf(r.ok && d('pedidos/' + p1).status === 'pago', 'lojista confirma pix vencido');
  conf(est()['s:abc123'].qtd === 0 && !d('pedidos/' + p1).estoqueFurou, 'baixa forcada sem furo');
  conf(d('pedidos/' + p1).estoque.baixado === true, 'pedido marcado baixado');
  // 6. devolucao
  r = await T.lojaPedido(UID, p1, 'devolvido', 'x');
  conf(r.erro === 'motivo', 'devolucao exige motivo');
  r = await T.lojaPedido(UID, p1, 'devolvido', 'cliente desistiu', true);
  conf(r.ok && d('pedidos/' + p1).status === 'devolvido' && est()['s:abc123'].qtd === 2, 'devolucao volta estoque');
  r = await T.lojaPedido(UID, p1, 'devolvido', 'de novo', true);
  conf(r.erro === 'so_pago', 'nao devolve duas vezes');
  conf(est()['s:abc123'].qtd === 2, 'estoque nao duplica');
  // 7. furo: reserva vence, outro compra, lojista confirma o primeiro
  desloc = 0;
  r = await compraCard([{ sku: 'abc123', qtd: 2 }]); const p2 = r.pedidoId;
  desloc = 45 * 60000;
  const vr = await ck.varrerReservas(50);
  conf(vr.devolvidas >= 1 && d('pedidos/' + p2).status === 'expirado', 'varrerReservas devolve e vence');
  r = await compraCard([{ sku: 'abc123', qtd: 2 }]); const p3 = r.pedidoId;
  conf(r.ok, 'outro cliente leva as 2');
  r = await T.lojaPedido(UID, p2, 'pago');
  conf(r.ok && d('pedidos/' + p2).alertaEstoque === 'sem_estoque' && est()['s:abc123'].qtd === 0, 'confirmacao atrasada marca alertaEstoque sem_estoque');
  // 8. pagar normal consome reserva
  r = await T.lojaPedido(UID, p3, 'pago');
  conf(est()['s:abc123'].res === 0 && est()['s:abc123'].qtd === 0 && d('estoque_reservas/' + p3).ativa === false, 'pagamento consome reserva');
  // 9. recusado devolve; reabrir confirma
  await T.lojaEstoque(UID, { itens: [{ sku: 'abc123', nome: 'Camiseta Azul', de: 0, para: 5 }] });
  r = await compraCard([{ sku: 'abc123', qtd: 1 }]); const p4 = r.pedidoId;
  conf(est()['s:abc123'].qtd === 4, 'reserva 1 de 5');
  r = await T.lojaPedido(UID, p4, 'recusado', 'nao caiu');
  conf(est()['s:abc123'].qtd === 5 && d('pedidos/' + p4).status === 'recusado', 'recusa devolve');
  r = await T.lojaPedido(UID, p4, 'pago');
  conf(r.ok && est()['s:abc123'].qtd === 4, 'recusado por engano pode ser confirmado');
  // 10. ajuste por diferenca nao apaga venda
  // painel viu 4; entra venda de 1 (qtd 3); painel salva 10 -> 9
  r = await compraCard([{ sku: 'abc123', qtd: 1 }]);
  await T.lojaEstoque(UID, { itens: [{ sku: 'abc123', nome: 'Camiseta Azul', de: 4, para: 10 }] });
  conf(est()['s:abc123'].qtd === 9, 'ajuste aplica diferenca (' + est()['s:abc123'].qtd + ')');
  r = await T.lojaEstoque(UID, { itens: [{ sku: 'abc123', nome: 'Camiseta Azul', para: null }] });
  conf(r.erro === 'estoque_reservado', 'nao tira controle com reserva aberta');
  // 11. linhas repetidas somam
  r = await compraCard([{ sku: 'abc123', qtd: 5 }, { sku: 'abc123', qtd: 5 }]);
  conf(r.erro === 'esgotado', 'linhas repetidas somam (C4)');
  // 12. cancelado pelo lojista devolve
  r = await compraCard([{ sku: 'abc123', qtd: 2 }]); const p5 = r.pedidoId;
  const antes = est()['s:abc123'].qtd;
  await T.lojaPedido(UID, p5, 'cancelado');
  conf(est()['s:abc123'].qtd === antes + 2, 'cancelar devolve');

  // ===== LIVE + OFERTA =====
  base('enterprise'); desloc = 0;
  await T.lojaEstoque(UID, { itens: [{ sku: 'abc123', nome: 'Camiseta Azul', para: 10 }] });
  store.set('live_sessoes/' + UID, { ativa: true, pulsoMs: Date.now(), sessaoId: 'S1' });
  store.set('negocios/' + UID + '/estado/live', { sacola: [{ nome: 'Camiseta Azul', preco: '50' }], oferta: { nome: 'Camiseta Azul', precoPor: '40', estoque: 3, vendidos: 0, fimEm: Date.now() + 600000 } });
  const compraLive = (qtd, cpf) => T.compraCriar(Object.assign({ origem: 'live', produto: 'Camiseta Azul', qtd }, comprador, cpf ? { cpf } : {}), '2.2.2.' + Math.random());
  r = await compraLive(2); const l1 = r.pedidoId;
  conf(r.ok && r.total > 79 && r.total < 81, 'compra oferta na live ' + JSON.stringify(r).slice(0, 80));
  conf((d('negocios/' + UID + '/estado/live').oferta.reservas || []).length === 2, 'oferta segura 2 unidades (reserva da oferta, 2026-09-30-reserva)');
  conf(est()['s:abc123'].qtd === 8, 'produto da live baixa o estoque do cardapio (mesmo nome)');
  r = await compraLive(2, '11144477735');
  conf(r.erro === 'esgotado', 'oferta esgota para outro comprador');
  conf(est()['s:abc123'].qtd === 8, 'oferta esgotada nao segura estoque do produto');
  desloc = 50 * 60000;
  store.get('live_sessoes/' + UID).pulsoMs = Date.now();
  await ck.varrerReservas(50);
  conf(est()['s:abc123'].qtd === 10 && d('pedidos/' + l1).status === 'expirado', 'estoque volta e Pix da oferta vence');
  desloc = 0;
  // estorno de venda paga
  store.get('live_sessoes/' + UID).pulsoMs = Date.now();
  store.get('negocios/' + UID + '/estado/live').oferta.fimEm = Date.now() + 600000;
  r = await compraLive(1); const l2 = r.pedidoId;
  await T.lojaPedido(UID, l2, 'pago');
  store.set('negocios/' + UID + '/livechat/CHATMSG0000001', { tipo: 'venda' });
  store.get('pedidos/' + l2).chatVendaId = 'CHATMSG0000001';
  await T.lojaPedido(UID, l2, 'separando');
  const q0 = est()['s:abc123'].qtd;
  r = await T.webhookPedido('PAYMENT_REFUNDED', { externalReference: 'pedido:' + l2 });
  conf(d('pedidos/' + l2).status === 'estornado' && d('pedidos/' + l2).alerta === 'estornado', 'estorno marca alerta');
  conf(est()['s:abc123'].qtd === q0 + 1, 'estorno devolve peca');
  conf(!d('negocios/' + UID + '/livechat/CHATMSG0000001'), 'estorno apaga comprou do chat');
  // estorno de entregue nao volta estoque
  r = await compraLive(1); const l3 = r.pedidoId;
  await T.lojaPedido(UID, l3, 'pago'); await T.lojaPedido(UID, l3, 'entregue');
  const q1 = est()['s:abc123'].qtd;
  await T.webhookPedido('PAYMENT_REFUNDED', { externalReference: 'pedido:' + l3 });
  conf(d('pedidos/' + l3).status === 'estornado' && est()['s:abc123'].qtd === q1, 'estorno de entregue nao volta estoque');
  // pedido legado (sem estoque.v) continua baixando oferta no pagamento
  const legRef = 'pedidos/LEGADO0000000001';
  store.get('negocios/' + UID + '/estado/live').oferta.vendidos = 0;
  store.set(legRef, { lojistaUid: UID, status: 'aguardando', modo: 'pix', oferta: true, liveId: 'S1', itens: [{ nome: 'Camiseta Azul', qtd: 1 }], total: 40 });
  await T.lojaPedido(UID, 'LEGADO0000000001', 'pago');
  conf(d('negocios/' + UID + '/estado/live').oferta.vendidos === 1, 'pedido legado mantem baixa no pagamento');
  // freio da live acima de 40
  store.delete('checkout_freio/_neg_' + UID);
  await T.lojaEstoque(UID, { itens: [{ sku: 'abc123', nome: 'Camiseta Azul', para: null }] }).catch(() => {});
  store.get('negocios/' + UID + '/estado/live').oferta = null;
  let okN = 0;
  for (let i = 0; i < 45; i++) { const x = await compraLive(1); if (x.ok) okN++; }
  conf(okN === 45, 'live aceita mais de 40 pedidos por hora (' + okN + ')');

  // ===== extras =====
  base(); desloc = 0;
  await T.lojaEstoque(UID, { itens: [{ sku: 'abc123', nome: 'Camiseta Azul', para: 3 }] });
  r = await compraCard([{ sku: 'abc123', qtd: 1 }]); const e1 = r.pedidoId, ch1 = r.chave;
  r = await T.compraPaguei({ pedidoId: e1, chave: ch1 });
  conf(r.ok && d('pedidos/' + e1).status === 'conferindo', 'comprador avisa que pagou');
  conf(d('estoque_reservas/' + e1).venceEm.toMillis() > Date.now() + 20 * 3600000, 'aviso de pagamento estende a reserva para 24h');
  desloc = 60 * 60000;
  await ck.varrerReservas(50); await ck.varrerPedidosGateway(40);
  conf(d('pedidos/' + e1).status === 'conferindo' && est()['s:abc123'].res === 1, 'conferindo nao vence em 1h');
  desloc = 0;
  // freio barrado devolve a reserva
  store.set('checkout_freio/_neg_' + UID, { ini: Date.now(), n: 120 });
  const q2 = est()['s:abc123'].qtd;
  r = await compraCard([{ sku: 'abc123', qtd: 1 }]);
  conf(r.erro === 'freio' && est()['s:abc123'].qtd === q2, 'freio devolve reserva');
  store.delete('checkout_freio/_neg_' + UID);
  // RECEIVED_IN_CASH vira pago do lojista (modo asaas)
  store.set('recebimento/' + UID, Object.assign(d('recebimento/' + UID), { modo: 'asaas', asaasChave: T.cifrar('chave-asaas-teste') }));
  global.fetch = async (url, o) => {
    const u = String(url);
    const J = (x) => ({ ok: true, status: 200, json: async () => x });
    if (u.endsWith('/customers')) return J({ id: 'cus_1' });
    if (u.endsWith('/payments') && o.method === 'POST') { const b = JSON.parse(o.body); global._ref = b.externalReference; global._val = b.value; return J({ id: 'pay_1' }); }
    if (u.includes('/pixQrCode')) return J({ encodedImage: 'x', payload: 'y' });
    if (u.includes('/payments/pay_1')) return J({ id: 'pay_1', status: 'RECEIVED_IN_CASH', value: global._val, externalReference: global._ref });
    return { ok: false, status: 404, json: async () => ({}) };
  };
  r = await compraCard([{ sku: 'abc123', qtd: 1 }]); const a1 = r.pedidoId;
  conf(r.ok && d('pedidos/' + a1).modo === 'asaas' && d('pedidos/' + a1).estoque.linhas.length === 1, 'modo asaas reserva');
  r = await T.lojaPedido(UID, a1, 'conferir');
  conf(r.status === 'pago' && d('pedidos/' + a1).confirmadoPor === 'lojista', 'RECEIVED_IN_CASH conta como confirmado pelo lojista');
  // falha do Asaas devolve a reserva
  global.fetch = async () => ({ ok: false, status: 500, json: async () => ({ errors: [{ description: 'fora' }] }) });
  const q3 = est()['s:abc123'].qtd;
  r = await compraCard([{ sku: 'abc123', qtd: 1 }]);
  conf(r.erro === 'asaas' && est()['s:abc123'].qtd === q3, 'falha do banco devolve reserva');
  conf(ck._t && true, 'fim');
  console.log('\nOK ' + ok + ' / FALHAS ' + falhas);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('ERRO', e); process.exit(2); });
