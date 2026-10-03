'use strict';
// Envio para outras cidades por tabela (P70 etapa 2, 03/10/2026). Sem internet e sem Firebase:
// cd moviki-robo && node testes/envio.test.js
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
const UID = 'lojistaCCCCCCCCCCC3';
function base() {
  store.clear();
  store.set('assinaturas/' + UID, { ativo: true, plano: 'enterprise' });
  store.set('negocios/' + UID, { nome: 'Perfumaria Teste', cardapio: [
    { categoria: 'Perfumes', produtos: [{ nome: 'Perfume Azul', preco: '120', sku: 'per1', envia: true }, { nome: 'Hidratante', preco: '40', sku: 'hid1', envia: true }] },
    { categoria: 'Lanche', produtos: [{ nome: 'Bolo de pote', preco: '15', sku: 'bol1' }] }] });
  store.set('recebimento/' + UID, { ligado: true, modo: 'pix', entrega: 'retirada', pix: { chaveCifrada: T.cifrar('loja@teste.com'), nome: 'Perfumaria', cidade: 'Joao Pessoa', docMascara: '***', mascara: 'x', tipo: 'email' } });
  store.set('configuracoes/liveTermos', {});
  store.set('live_sessoes/' + UID, { ativa: true, pulsoEm: Timestamp.now(), sessaoId: 'ses1' });
  store.set('negocios/' + UID + '/estado/live', { sacola: [{ nome: 'Perfume Azul', preco: '120' }, { nome: 'Bolo de pote', preco: '15' }] });
}
const comprador = { nome: 'Rui Alves', cpf: '52998224725', whatsapp: '11999998888', aceite: true, lojistaUid: UID };
const endSP = { cep: '01310100', rua: 'Av. Paulista', numero: '1000', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP' };
const endPB = { cep: '58038000', rua: 'Av. Epitácio', numero: '10', bairro: 'Tambaú', cidade: 'João Pessoa', uf: 'PB' };
const endAM = { cep: '69005000', rua: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Manaus', uf: 'AM' };
let n = 0;
const card = (itens, end, extra) => T.compraCriar(Object.assign({ origem: 'cardapio', itens, entrega: 'envio', endereco: end }, comprador, extra || {}), '7.7.7.' + (++n));
const ENV = { ativo: true, ufOrigem: 'PB', mesmoEstado: '12', regioes: { N: '', NE: '20', CO: '35', SE: '30', S: '38' }, gratisAcima: '300', prazo: '5 a 10 dias úteis' };

(async () => {
  base();
  // 1. configuracao
  let r = await T.lojaEntrega(UID, { entrega: 'retirada', bairros: [], envio: ENV });
  conf(r && r.entregaCfg && r.entregaCfg.envio && r.entregaCfg.envio.ativo === true, 'salva envio ' + JSON.stringify(r).slice(0, 160));
  const env = d('recebimento/' + UID).entregaCfg.envio;
  conf(env.regioes.N === null && env.regioes.SE === 30 && env.mesmoEstado === 12 && env.gratisAcima === 300, 'valores salvos ' + JSON.stringify(env));
  conf(d('checkout_publico/' + UID).envio.regioes.SE === 30, 'espelho publico com a tabela');
  r = await T.lojaEntrega(UID, { entrega: 'retirada', bairros: [], envio: Object.assign({}, ENV, { regioes: { SE: '900' } }) });
  conf(r.erro === 'taxa_envio', 'taxa acima do teto recusa');
  r = await T.lojaEntrega(UID, { entrega: 'retirada', bairros: [], envio: { ativo: true, ufOrigem: 'PB', regioes: {} } });
  conf(r.erro === 'envio_vazio', 'ativo sem nenhuma taxa recusa');
  r = await T.lojaEntrega(UID, { entrega: 'retirada', bairros: [], envio: Object.assign({}, ENV, { ufOrigem: 'XX' }) });
  conf(r.erro === 'uf_origem', 'UF de origem invalida recusa');
  r = await T.lojaEntrega(UID, { entrega: 'retirada', bairros: [] });
  conf(d('recebimento/' + UID).entregaCfg.envio.regioes.SE === 30, 'tela antiga (sem bloco envio) nao apaga a tabela');

  // 2. recurso desligado
  r = await card([{ sku: 'per1', qtd: 1 }], endSP);
  conf(r.erro === 'sem_envio', 'recurso desligado recusa envio ' + JSON.stringify(r).slice(0, 80));
  await T.admRecursos('donoXXXXXXXXXXXXX', { uid: UID, freteBrasil: true });
  conf(d('checkout_publico/' + UID).recursos.freteBrasil === true, 'espelho do recurso');

  // 3. frete por regiao, mesmo estado, gratis acima, fora
  r = await card([{ sku: 'per1', qtd: 1 }], endSP);
  conf(r.ok && r.frete === 30, 'SP = Sudeste R$ 30: ' + JSON.stringify(r).slice(0, 120));
  const p1 = d('pedidos/' + r.pedidoId);
  conf(p1.entrega.tipo === 'entrega' && p1.entrega.envio === true && p1.entrega.uf === 'SP' && p1.entrega.regiao === 'SE' && p1.entrega.prazo === '5 a 10 dias úteis', 'pedido marcado como envio');
  r = await card([{ sku: 'per1', qtd: 1 }], endPB);
  conf(r.ok && r.frete === 12, 'mesmo estado R$ 12: ' + r.frete);
  r = await card([{ sku: 'per1', qtd: 3 }], endSP);
  conf(r.ok && r.frete === 0, 'acima de R$ 300 = gratis: ' + r.frete);
  r = await card([{ sku: 'per1', qtd: 1 }], endAM);
  conf(r.erro === 'envio_fora' && r.uf === 'AM', 'Norte vazio = nao envia');
  r = await card([{ sku: 'per1', qtd: 1 }], Object.assign({}, endSP, { cep: '' }));
  conf(r.erro === 'cep', 'envio sem CEP recusa');
  r = await card([{ sku: 'per1', qtd: 1 }], Object.assign({}, endSP, { uf: '' }));
  conf(r.erro === 'uf', 'envio sem UF recusa');

  // 4. produto local no carrinho
  r = await card([{ sku: 'per1', qtd: 1 }, { sku: 'bol1', qtd: 1 }], endSP);
  conf(r.erro === 'item_local' && r.nome === 'Bolo de pote', 'bolo nao vai pelo correio: ' + JSON.stringify(r).slice(0, 100));
  r = await T.compraCriar(Object.assign({ origem: 'cardapio', itens: [{ sku: 'bol1', qtd: 1 }], entrega: 'retirada' }, comprador), '7.7.8.1');
  conf(r.ok, 'bolo com retirada continua normal');

  // 5. live (produto sem sku casa pelo nome do cardapio)
  r = await T.compraCriar(Object.assign({ origem: 'live', produto: 'Perfume Azul', qtd: 1, entrega: 'envio', endereco: endSP }, comprador), '7.7.9.1');
  conf(r.ok && r.frete === 30, 'live com envio ' + JSON.stringify(r).slice(0, 100));
  r = await T.compraCriar(Object.assign({ origem: 'live', produto: 'Bolo de pote', qtd: 1, entrega: 'envio', endereco: endSP }, comprador), '7.7.9.2');
  conf(r.erro === 'item_local', 'live: bolo nao vai pelo correio');

  // 6. entrega suspensa pelo dono suspende o envio
  store.set('recebimento/' + UID, Object.assign({}, d('recebimento/' + UID), { entregaSuspensa: { ativa: true } }));
  r = await card([{ sku: 'per1', qtd: 1 }], endSP);
  conf(r.erro === 'sem_envio', 'suspensa = sem envio');

  // 7. funcoes puras
  const e = T.lerEnvioCfg({ envio: { ativo: true, ufOrigem: 'pb', mesmoEstado: 5, regioes: { NE: 10 } } });
  conf(e.ufOrigem === 'PB' && e.regioes.SE === null, 'lerEnvioCfg normaliza');
  conf(T.freteEnvio(e, 'BA', 50).taxa === 10 && T.freteEnvio(e, 'PB', 50).taxa === 5, 'freteEnvio por regiao e por estado');

  console.log('\nOK ' + ok + ' / FALHAS ' + falhas);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
