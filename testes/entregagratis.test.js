'use strict';
// Entrega gratis acima de R$ X na tabela de bairros (P85 Fase 2b, 19/10/2026). Sem internet e sem Firebase:
// cd moviki-robo && node testes/entregagratis.test.js
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
const UID = 'lojistaGGGGGGGGGGG7';
function base() {
  store.clear();
  store.set('assinaturas/' + UID, { ativo: true, plano: 'premium' });
  store.set('negocios/' + UID, { nome: 'Doceria Teste', cardapio: [
    { categoria: 'Doces', produtos: [{ nome: 'Bolo', preco: '50', sku: 'bo1' }, { nome: 'Brigadeiro', preco: '3', sku: 'br1' }] }] });
  store.set('recebimento/' + UID, { ligado: true, modo: 'pix', entrega: 'ambos', pix: { chaveCifrada: T.cifrar('loja@teste.com'), nome: 'Doceria', cidade: 'Joao Pessoa', docMascara: '***', mascara: 'x', tipo: 'email' } });
  store.set('configuracoes/liveTermos', {});
}
const comprador = { nome: 'Ana Lima', cpf: '52998224725', whatsapp: '11999998888', aceite: true, lojistaUid: UID };
const end = { cep: '58038000', rua: 'Av. Epitácio', numero: '10', bairro: 'Tambaú', cidade: 'João Pessoa', uf: 'PB' };
let n = 0;
const card = (itens) => T.compraCriar(Object.assign({ origem: 'cardapio', itens, entrega: 'entrega', endereco: end }, comprador), '8.8.8.' + (++n));
const BAIRROS = [{ nome: 'Tambaú', taxa: '8' }, { nome: 'Centro', taxa: '0' }];

(async () => {
  base();
  // 1. configuracao
  let r = await T.lojaEntrega(UID, { entrega: 'ambos', bairros: BAIRROS, minimoEntrega: '', gratisAcima: 'R$ 100,00' });
  conf(r && r.entregaCfg && r.entregaCfg.gratisAcima === 100, 'salva gratisAcima ' + JSON.stringify(r && r.entregaCfg));
  conf(d('checkout_publico/' + UID).gratisAcima === 100, 'espelho publico com gratisAcima');
  r = await T.lojaEntrega(UID, { entrega: 'ambos', bairros: BAIRROS });
  conf(d('recebimento/' + UID).entregaCfg.gratisAcima === 100, 'tela antiga (sem o campo) mantem o valor');
  r = await T.lojaEntrega(UID, { entrega: 'ambos', bairros: BAIRROS, gratisAcima: '9000' });
  conf(r.erro === 'gratis_entrega', 'acima do teto recusa');
  r = await T.lojaEntrega(UID, { entrega: 'ambos', bairros: BAIRROS, gratisAcima: 'abc' });
  conf(r.erro === 'gratis_entrega', 'texto invalido recusa');

  // 2. abaixo do valor: cobra a taxa do bairro
  r = await card([{ sku: 'bo1', qtd: 1 }]);
  conf(r.ok && r.frete === 8, 'R$ 50 em produtos paga R$ 8: ' + JSON.stringify(r).slice(0, 140));
  // 3. no valor: gratis, e o pedido guarda a taxa da tabela
  r = await card([{ sku: 'bo1', qtd: 2 }]);
  conf(r.ok && r.frete === 0, 'R$ 100 em produtos = gratis: ' + JSON.stringify(r).slice(0, 140));
  const p = r.ok ? d('pedidos/' + r.pedidoId) : {};
  conf(p.entrega && p.entrega.taxa === 0 && p.entrega.taxaTabela === 8 && p.entrega.gratisAcima === 100, 'pedido marca a entrega gratis ' + JSON.stringify(p.entrega || {}).slice(0, 200));
  // 4. vazio desliga
  await T.lojaEntrega(UID, { entrega: 'ambos', bairros: BAIRROS, gratisAcima: '' });
  conf(d('recebimento/' + UID).entregaCfg.gratisAcima === 0, 'vazio desliga');
  r = await card([{ sku: 'bo1', qtd: 2 }]);
  conf(r.ok && r.frete === 8, 'desligado volta a cobrar: ' + JSON.stringify(r).slice(0, 120));

  console.log(falhas ? 'FALHAS: ' + falhas : 'ok ' + ok);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
