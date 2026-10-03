'use strict';
// Carrinho na live (P70, 03/10/2026). Roda sem internet e sem Firebase:
// cd moviki-robo && node testes/carrinho.test.js
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
const d = (p) => store.get(p);
const UID = 'lojistaBBBBBBBBBBB2';
function base() {
  store.clear();
  store.set('assinaturas/' + UID, { ativo: true, plano: 'enterprise' });
  store.set('negocios/' + UID, { nome: 'Loja Live', cardapio: [{ categoria: 'Roupas', produtos: [{ nome: 'Vestido', preco: '50', sku: 'ves1' }, { nome: 'Bolsa', preco: '30', sku: 'bol1' }] }] });
  store.set('recebimento/' + UID, { ligado: true, modo: 'pix', entrega: 'ambos', entregaCfg: { bairros: [{ nome: 'Centro', taxa: 8 }] }, pix: { chaveCifrada: T.cifrar('loja@teste.com'), nome: 'Loja Live', cidade: 'Curitiba', docMascara: '***', mascara: 'lo***@teste.com', tipo: 'email' } });
  store.set('configuracoes/liveTermos', {});
  store.set('live_sessoes/' + UID, { ativa: true, pulsoEm: Timestamp.now(), sessaoId: 'ses1' });
  store.set('negocios/' + UID + '/estado/live', {
    sacola: [{ nome: 'Vestido', preco: '50' }, { nome: 'Bolsa', preco: '30' }, { nome: 'Brinco', preco: '25' }],
    oferta: { nome: 'Brinco', precoPor: '15', fimEm: Timestamp.fromMillis(Date.now() + 15 * 60000), estoque: 3, vendidos: 0 },
  });
}
const comprador = { nome: 'Bia Lima', cpf: '52998224725', whatsapp: '41999998888', aceite: true, lojistaUid: UID };
let ipN = 0;
const compra = (extra) => T.compraCriar(Object.assign({ origem: 'live' }, comprador, extra), '9.9.9.' + (++ipN));

(async () => {
  // 1. sem o recurso: carrinho recusado, compra de um produto segue
  base();
  let r = await compra({ itens: [{ nome: 'Vestido', qtd: 1 }, { nome: 'Bolsa', qtd: 1 }] });
  conf(r.erro === 'carrinho_off', 'sem recurso recusa itens[] ' + JSON.stringify(r).slice(0, 100));
  r = await compra({ produto: 'Vestido', qtd: 2 });
  conf(r.ok && r.total >= 100 && r.total < 101, 'compra de um produto continua ' + JSON.stringify(r).slice(0, 100));

  // 2. dono liga o recurso
  r = await T.admRecursos('donoXXXXXXXXXXXXX', { uid: UID, carrinho: true });
  conf(r.ok && r.recursos.carrinho === true, 'admRecursos liga');
  conf(d('recursos/' + UID).carrinho === true, 'autoridade gravada');
  conf(d('checkout_publico/' + UID).recursos.carrinho === true, 'espelho publico');
  conf((await T.admRecursos('donoXXXXXXXXXXXXX', { uid: 'x', carrinho: true })).erro === 'uid', 'uid invalido');
  conf((await T.admRecursos('donoXXXXXXXXXXXXX', { uid: UID })).erro === 'recurso', 'sem recurso no pedido');

  // 3. carrinho: linhas repetidas somam, um Pix, um frete
  r = await compra({ itens: [{ nome: 'Vestido', qtd: 2 }, { nome: 'Bolsa', qtd: 1 }, { nome: 'Vestido', qtd: 1 }], entrega: 'entrega', endereco: { cep: '80000000', rua: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Curitiba', uf: 'PR' } });
  conf(r.ok, 'carrinho ok ' + JSON.stringify(r).slice(0, 160));
  const p1 = d('pedidos/' + r.pedidoId);
  conf(p1 && p1.itens.length === 2 && p1.itens[0].nome === 'Vestido' && p1.itens[0].qtd === 3, 'somou linhas repetidas');
  conf(p1.subtotal === 180 && p1.frete === 8 && p1.total >= 188 && p1.total < 189, 'um frete so: ' + p1.subtotal + '+' + p1.frete);
  conf(p1.validadeMin === 30 && !p1.oferta, 'sem oferta = 30 min');

  // 4. carrinho com a oferta: oferta vai para itens[0], 10 min, reserva da quantidade dela
  r = await compra({ itens: [{ nome: 'Bolsa', qtd: 1 }, { nome: 'Brinco', qtd: 2 }] });
  conf(r.ok, 'carrinho com oferta ok ' + JSON.stringify(r).slice(0, 160));
  const p2 = d('pedidos/' + r.pedidoId);
  conf(p2.itens[0].nome === 'Brinco' && p2.itens[0].preco === 15 && p2.itens[0].qtd === 2, 'oferta em itens[0] com preco de oferta');
  conf(p2.validadeMin === 10 && p2.oferta === true && !!p2.reservaChave, 'carrinho com oferta vale 10 min e reserva');
  conf(p2.subtotal === 60 && p2.total >= 60 && p2.total < 61, 'total com oferta ' + p2.total);
  const resv = d('oferta_reservas/' + p2.reservaChave);
  conf(resv && resv.itens[r.pedidoId] && resv.itens[r.pedidoId].qtd === 2, 'reserva segura so a quantidade da oferta');

  // 5. oferta acima do estoque
  r = await compra({ itens: [{ nome: 'Brinco', qtd: 5 }] });
  conf(r.erro === 'esgotado', 'oferta acima do estoque recusa ' + JSON.stringify(r).slice(0, 100));

  // 6. produto fora da sacola
  r = await compra({ itens: [{ nome: 'Vestido', qtd: 1 }, { nome: 'Sapato', qtd: 1 }] });
  conf(r.erro === 'produto' && r.nome === 'Sapato', 'produto fora da sacola recusa com o nome');

  // 7. pago: vendidos da oferta sobe so a quantidade da oferta
  const ok2 = await T.marcarPago(fake.db.collection('pedidos').doc(p2 ? Object.keys(Object.fromEntries([...store].filter(([k]) => k.startsWith('pedidos/')))).find((k) => store.get(k).reservaChave).split('/')[1] : ''), 'lojista');
  conf(ok2 === true, 'marcarPago do carrinho');
  const live = d('negocios/' + UID + '/estado/live');
  conf(live.oferta.vendidos === 2, 'vendidos da oferta = 2 (nao conta a bolsa): ' + live.oferta.vendidos);

  // 8. desligar o recurso volta a recusar
  await T.admRecursos('donoXXXXXXXXXXXXX', { uid: UID, carrinho: false });
  r = await compra({ itens: [{ nome: 'Vestido', qtd: 1 }] });
  conf(r.erro === 'carrinho_off', 'desligado recusa de novo');

  console.log('\nOK ' + ok + ' / FALHAS ' + falhas);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
