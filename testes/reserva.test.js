'use strict';
// Reserva por 2 h para pagar na loja (P85 Fase 2b, 20/10/2026). Sem internet e sem Firebase:
// cd moviki-robo && node testes/reserva.test.js
process.env.CHECKOUT_CHAVE = 'uma-frase-longa-e-aleatoria-de-teste-1234567890';
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'x', filename: 'x', loaded: true, exports: { admin: fake.admin, db: fake.db } };
const ck = require(path.join(ROBO, 'lib/checkout.js'));
const T = ck._t;
const { store } = fake;
let falhas = 0, ok = 0;
function conf(c, msg) { if (c) { ok++; } else { falhas++; console.log('FALHOU:', msg); } }
const d = (p) => store.get(p);
const UID = 'lojistaRRRRRRRRRRR1';
const realNow = Date.now; let desloc = 0; Date.now = () => realNow() + desloc;
function base() {
  store.clear(); desloc = 0;
  store.set('assinaturas/' + UID, { ativo: true, plano: 'premium' });
  store.set('negocios/' + UID, { nome: 'Moda Teste', cardapio: [{ categoria: 'Roupas', produtos: [{ nome: 'Vestido', preco: '100', sku: 'ves1' }, { nome: 'Bolsa', preco: '50', sku: 'bol1' }] }] });
  store.set('recebimento/' + UID, { ligado: true, modo: 'pix', entrega: 'ambos', pix: { chaveCifrada: T.cifrar('loja@teste.com'), nome: 'Moda', cidade: 'Joao Pessoa', docMascara: '***', mascara: 'x', tipo: 'email' } });
  store.set('configuracoes/liveTermos', {});
  store.set('estoque/' + UID, { itens: { ves1: { sku: 'ves1', nome: 'Vestido', qtd: 2, res: 0 } } });
}
const comp = (w) => ({ nome: 'Ana Lima', cpf: '52998224725', whatsapp: w || '11999998888', aceite: true, lojistaUid: UID });
let n = 0;
const reservar = (itens, extra) => T.compraCriar(Object.assign({ origem: 'cardapio', itens, entrega: 'retirada', pagamento: 'reserva' }, comp(), extra || {}), '6.6.6.' + (++n));

(async () => {
  base();
  let r = await reservar([{ sku: 'ves1', qtd: 1 }]);
  conf(r.erro === 'reserva_indisponivel', 'lojista sem a opcao ligada recusa: ' + JSON.stringify(r));
  r = await T.lojaEntrega(UID, { entrega: 'ambos', bairros: [], reserva: true });
  conf(d('recebimento/' + UID).entregaCfg.reserva === true && d('checkout_publico/' + UID).reserva === true, 'liga a reserva e espelha');
  await T.lojaEntrega(UID, { entrega: 'ambos', bairros: [] });
  conf(d('recebimento/' + UID).entregaCfg.reserva === true, 'tela antiga sem o campo mantem ligada');

  r = await reservar([{ sku: 'ves1', qtd: 1 }], { entrega: 'entrega', endereco: { rua: 'Rua A', numero: '1', bairro: 'Centro', cep: '' } });
  conf(r.erro === 'reserva_retirada', 'reserva so com retirada: ' + JSON.stringify(r));
  r = await reservar([{ sku: 'ves1', qtd: 1 }]);
  conf(r.ok && r.modo === 'reserva' && !r.pix && r.total === 100 && r.frete === 0, 'reserva nasce sem Pix e sem centavos: ' + JSON.stringify(r).slice(0, 200));
  const id = r.pedidoId, chave = r.chave;
  const p = d('pedidos/' + id);
  conf(p.status === 'reservado' && p.modo === 'reserva' && p.reservaAte - realNow() > 119 * 60000 && p.reservaAte - realNow() <= 120 * 60000 + 2000, 'pedido reservado por 2 h');
  conf(d('estoque/' + UID).itens.ves1.qtd === 1 && d('estoque/' + UID).itens.ves1.res === 1, 'peca presa no estoque: ' + JSON.stringify(d('estoque/' + UID).itens.ves1));
  r = await reservar([{ sku: 'bol1', qtd: 1 }]);
  conf(r.erro === 'reserva_ja', 'mesmo WhatsApp nao faz 2a reserva ativa: ' + JSON.stringify(r));
  r = await T.compraCriar(Object.assign({ origem: 'cardapio', itens: [{ sku: 'bol1', qtd: 1 }], entrega: 'retirada', pagamento: 'reserva' }, comp('11988887777')), '6.6.7.1');
  conf(r.ok, 'outro WhatsApp reserva normalmente');
  r = await T.compraCriar(Object.assign({ origem: 'cardapio', itens: [{ sku: 'bol1', qtd: 1 }], entrega: 'retirada' }, comp()), '6.6.7.2');
  conf(r.ok && r.modo === 'pix', 'com reserva ativa a pessoa ainda pode pagar no Pix');

  r = await T.compraStatus({ pedidoId: id, chave });
  conf(r.ok && r.status === 'reservado' && r.modo === 'reserva', 'status do comprador: reservado');
  r = await T.lojaPedido(UID, id, 'pago');
  conf(r.ok && d('pedidos/' + id).status === 'pago' && d('pedidos/' + id).confirmadoPor === 'lojista' && d('pedidos/' + id).pagoNaLoja === true, 'Pago na loja: ' + JSON.stringify(r));
  conf(d('estoque/' + UID).itens.ves1.qtd === 1 && d('estoque/' + UID).itens.ves1.res === 0, 'pago fecha a reserva do estoque: ' + JSON.stringify(d('estoque/' + UID).itens.ves1));

  // vencimento
  r = await T.compraCriar(Object.assign({ origem: 'cardapio', itens: [{ sku: 'ves1', qtd: 1 }], entrega: 'retirada', pagamento: 'reserva' }, comp('11977776666')), '6.6.8.1');
  const id2 = r.pedidoId;
  conf(d('estoque/' + UID).itens.ves1.qtd === 0, 'segunda peca reservada');
  desloc = 121 * 60000;
  const g = await T.varrerPedidosGateway(10);
  conf(d('pedidos/' + id2).status === 'expirado' && g.reservasVencidas >= 1, 'cron vence a reserva: ' + JSON.stringify(g));
  conf(d('estoque/' + UID).itens.ves1.qtd === 1, 'peca voltou: ' + JSON.stringify(d('estoque/' + UID).itens.ves1));
  r = await T.lojaPedido(UID, id2, 'pago');
  conf(r.ok && d('pedidos/' + id2).status === 'pago', 'cliente atrasado ainda pode ser marcado Pago na loja');

  // cancelar
  desloc = 0;
  r = await T.compraCriar(Object.assign({ origem: 'cardapio', itens: [{ sku: 'bol1', qtd: 1 }], entrega: 'retirada', pagamento: 'reserva' }, comp('11966665555')), '6.6.9.1');
  r = await T.lojaPedido(UID, r.pedidoId, 'cancelado', 'nao veio');
  conf(r.ok && r.status === 'cancelado', 'lojista cancela a reserva');
  // live nao reserva
  r = await T.compraCriar(Object.assign({ origem: 'live', itens: [{ nome: 'Vestido', qtd: 1 }], entrega: 'retirada', pagamento: 'reserva' }, comp('11955554444')), '6.6.9.2');
  conf(!!r.erro, 'live nao aceita reserva: ' + JSON.stringify(r));
  // aviso
  const c = T.corpoAviso('reserva', { valor: 'R$ 100,00', itens: '1 item', entrega: 'retirada no local', negocio: 'Moda', ate: '15h30' });
  conf(c && /Nova reserva/.test(c.assunto) && /15h30/.test(c.html) && /Pago na loja/.test(c.html), 'e-mail da reserva');

  Date.now = realNow;
  console.log(falhas ? 'FALHAS: ' + falhas : 'ok ' + ok);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
