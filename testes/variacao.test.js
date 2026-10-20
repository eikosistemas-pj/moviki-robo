'use strict';
// Tamanho e cor no produto do cardapio (P85 Fase 2b, 19/10/2026). Sem internet e sem Firebase:
// cd moviki-robo && node testes/variacao.test.js
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
const UID = 'lojistaVVVVVVVVVVV9';
const VAR = [{ nome: 'Tamanho', ops: ['P', 'M', 'G'] }, { nome: 'Cor', ops: ['Preto', 'Azul-marinho'] }];
function base() {
  store.clear();
  store.set('assinaturas/' + UID, { ativo: true, plano: 'premium' });
  store.set('negocios/' + UID, { nome: 'Moda Teste', cardapio: [
    { categoria: 'Roupas', produtos: [
      { nome: 'Camiseta', preco: '50', sku: 'cam1', variacoes: VAR },
      { nome: 'Bone', preco: '30', sku: 'bon1' },
      { nome: 'Sem sku', preco: '20', variacoes: [{ nome: 'Tamanho', ops: ['U'] }] },
      { nome: 'Lixo', preco: '10', sku: 'lix1', variacoes: [{ nome: '', ops: ['x'] }, { nome: 'Cor', ops: [] }, 'nada'] }] }] });
  store.set('recebimento/' + UID, { ligado: true, modo: 'pix', entrega: 'retirada', pix: { chaveCifrada: T.cifrar('loja@teste.com'), nome: 'Moda', cidade: 'Joao Pessoa', docMascara: '***', mascara: 'x', tipo: 'email' } });
  store.set('configuracoes/liveTermos', {});
  store.set('estoque/' + UID, { itens: { cam1: { sku: 'cam1', nome: 'Camiseta', qtd: 3, res: 0 } } });
}
const comprador = { nome: 'Ana Lima', cpf: '52998224725', whatsapp: '11999998888', aceite: true, lojistaUid: UID };
let n = 0;
const card = (itens) => T.compraCriar(Object.assign({ origem: 'cardapio', itens, entrega: 'retirada' }, comprador), '9.9.9.' + (++n));

(async () => {
  base();
  let r = await card([{ sku: 'cam1', qtd: 1 }]);
  conf(r.erro === 'opcao' && r.grupo === 'Tamanho', 'sem escolha recusa e diz o grupo: ' + JSON.stringify(r));
  r = await card([{ sku: 'cam1', qtd: 1, escolha: ['M'] }]);
  conf(r.erro === 'opcao' && r.grupo === 'Cor', 'falta a cor: ' + JSON.stringify(r));
  r = await card([{ sku: 'cam1', qtd: 1, escolha: ['XG', 'Preto'] }]);
  conf(r.erro === 'opcao', 'tamanho que nao existe recusa');
  r = await card([{ sku: 'cam1', qtd: 2, escolha: ['m', 'azul-MARINHO'], preco: 1 }]);
  conf(r.ok && r.subtotal === 100, 'escolha valida (sem diferenca de maiuscula), preco do servidor: ' + JSON.stringify(r).slice(0, 160));
  const p1 = r.ok ? d('pedidos/' + r.pedidoId) : {};
  const it = (p1.itens || [])[0] || {};
  conf(it.nome === 'Camiseta (M · Azul-marinho)' && it.opcao === 'Tamanho M · Cor Azul-marinho' && it.sku === 'cam1', 'item com a escolha no nome: ' + JSON.stringify(it));
  conf(d('estoque/' + UID).itens.cam1.qtd === 1, 'estoque do produto desce para todas as variacoes: ' + JSON.stringify(d('estoque/' + UID).itens.cam1));
  r = await card([{ sku: 'cam1', qtd: 1, escolha: ['G', 'Preto'] }, { sku: 'cam1', qtd: 1, escolha: ['P', 'Preto'] }]);
  conf(r.erro === 'esgotado', 'duas variacoes somam no mesmo estoque (resta 1): ' + JSON.stringify(r));
  r = await card([{ sku: 'bon1', qtd: 1, escolha: ['M'] }]);
  conf(r.ok && d('pedidos/' + r.pedidoId).itens[0].nome === 'Bone', 'produto sem variacao ignora escolha');
  r = await card([{ nome: 'Sem sku', qtd: 1, escolha: ['U'] }]);
  conf(r.ok && d('pedidos/' + r.pedidoId).itens[0].nome === 'Sem sku' && d('pedidos/' + r.pedidoId).itens[0].opcao === 'Tamanho U', 'sem sku: nome do produto e a escolha em opcao');
  r = await card([{ sku: 'lix1', qtd: 1 }]);
  conf(r.ok, 'variacao mal formada no cardapio e ignorada: ' + JSON.stringify(r).slice(0, 100));
  console.log(falhas ? 'FALHAS: ' + falhas : 'ok ' + ok);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
