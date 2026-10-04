'use strict';
// Frete automatico pelo Melhor Envio (P70 etapa 6, 04/10/2026). Sem internet e sem Firebase:
// cd moviki-robo && node testes/freteauto.test.js
process.env.CHECKOUT_CHAVE = 'uma-frase-longa-e-aleatoria-de-teste-1234567890';
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'x', filename: 'x', loaded: true, exports: { admin: fake.admin, db: fake.db } };
const TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.' + 'a'.repeat(120) + '.assinatura';
const chamadas = [];
let modoME = 'ok';   // ok | fora | token | vazio
global.fetch = async (url, op) => {
  const corpo = op && op.body ? JSON.parse(op.body) : null;
  chamadas.push({ url: String(url), corpo, headers: (op && op.headers) || {} });
  if (!/melhorenvio/.test(url)) return { ok: true, status: 200, json: async () => ({}) };
  if (modoME === 'fora') throw new Error('ECONNRESET');
  const auth = (op.headers || {}).Authorization;
  if (modoME === 'token' || auth !== 'Bearer ' + TOKEN) return { ok: false, status: 401, json: async () => ({ message: 'Unauthenticated.' }) };
  if (modoME === 'vazio') return { ok: true, status: 200, json: async () => ([{ id: 1, name: 'PAC', error: 'Serviço indisponível para o trecho.' }]) };
  const w = corpo.package.weight;
  return { ok: true, status: 200, json: async () => ([
    { id: 1, name: 'PAC', price: String((20 + w * 10).toFixed(2)), custom_price: String((20 + w * 10).toFixed(2)), delivery_time: 8, custom_delivery_time: 8, company: { name: 'Correios' } },
    { id: 2, name: 'SEDEX', price: '45.90', custom_price: '45.90', delivery_time: 3, custom_delivery_time: 3, company: { name: 'Correios' } },
    { id: 3, name: '.Package', price: '31.10', delivery_time: 5, company: { name: 'Jadlog' } },
    { id: 17, name: 'Mini Envios', error: 'Peso acima do permitido' },
  ]) };
};
const ck = require(path.join(ROBO, 'lib/checkout.js'));
const T = ck._t;
const { store, Timestamp } = fake;
let falhas = 0, ok = 0;
function conf(c, msg) { if (c) { ok++; } else { falhas++; console.log('FALHOU:', msg); } }
const d = (p) => store.get(p);
const UID = 'lojistaFFFFFFFFFFF6';
function resFalso() { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; }
let ipN = 0;
async function publico(body) { const res = resFalso(); await ck.tratar({ headers: { origin: 'https://www.moviki.com.br', 'x-forwarded-for': '5.5.5.' + (ipN++) }, socket: {} }, res, body); return res; }
async function loja(acao, dados) { const res = resFalso(); fake.admin.auth = () => ({ verifyIdToken: async () => ({ uid: UID }) }); await ck.tratar({ headers: { origin: 'https://app.moviki.com.br' }, socket: {} }, res, { acao, idToken: 'x', dados }); return res; }
const comprador = { nome: 'Rui Alves', cpf: '52998224725', whatsapp: '11999998888', aceite: true, lojistaUid: UID };
const endSP = { cep: '01310100', rua: 'Av. Paulista', numero: '1000', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP' };
const endAM = { cep: '69005000', rua: 'Rua A', numero: '1', bairro: 'Centro', cidade: 'Manaus', uf: 'AM' };
let n = 0;
const card = (itens, end, extra) => T.compraCriar(Object.assign({ origem: 'cardapio', itens, entrega: 'envio', endereco: end }, comprador, extra || {}), '7.7.9.' + (++n));
const CFG = { ligado: true, cepOrigem: '58038-000', pesoItem: '0,5', alt: '4', larg: '12', comp: '17', acrescimo: '2', prazoExtra: '1' };

(async () => {
  store.clear();
  store.set('assinaturas/' + UID, { ativo: true, plano: 'premium' });
  store.set('negocios/' + UID, { nome: 'Moda Teste', cardapio: [{ categoria: 'Roupas', produtos: [{ nome: 'Vestido', preco: '100', sku: 'v1', envia: true }, { nome: 'Bolo', preco: '15', sku: 'b1' }] }] });
  store.set('recebimento/' + UID, { ligado: true, modo: 'pix', entrega: 'retirada', pix: { chaveCifrada: T.cifrar('loja@teste.com'), nome: 'Moda', cidade: 'Joao Pessoa', docMascara: '***', mascara: 'x', tipo: 'email' } });
  store.set('configuracoes/liveTermos', {});
  // tabela de envio so com Sudeste (para o caso de o Melhor Envio cair)
  await T.lojaEntrega(UID, { entrega: 'retirada', bairros: [], envio: { ativo: true, ufOrigem: 'PB', regioes: { SE: '30' }, gratisAcima: '' } });
  await T.admRecursos('donoXXXXXXXXXXXXX', { uid: UID, freteBrasil: true });

  // 1. chave desligada
  let r = await loja('loja_frete_auto', Object.assign({ token: TOKEN }, CFG));
  conf(r.code === 400 && r.body.erro === 'auto_off', 'sem a chave freteAuto recusa: ' + JSON.stringify(r.body).slice(0, 80));
  r = await publico({ acao: 'compra_frete', lojistaUid: UID, cep: '01310100', qtd: 1 });
  conf(r.body.erro === 'sem_auto', 'cotacao publica desligada');
  await T.admRecursos('donoXXXXXXXXXXXXX', { uid: UID, freteAuto: true });
  conf(d('checkout_publico/' + UID).recursos.freteAuto === true, 'espelho do recurso');

  // 2. conectar: validacoes e token conferido
  r = await loja('loja_frete_auto', Object.assign({}, CFG, { cepOrigem: '123' }));
  conf(r.body.erro === 'cep_origem', 'cep de origem');
  r = await loja('loja_frete_auto', Object.assign({}, CFG, { pesoItem: '50' }));
  conf(r.body.erro === 'peso', 'peso acima de 30 kg');
  r = await loja('loja_frete_auto', Object.assign({}, CFG, { larg: '2' }));
  conf(r.body.erro === 'caixa', 'caixa menor que o minimo');
  r = await loja('loja_frete_auto', Object.assign({}, CFG));
  conf(r.body.erro === 'sem_token', 'ligar sem token recusa');
  r = await loja('loja_frete_auto', Object.assign({ token: 'curto' }, CFG));
  conf(r.body.erro === 'token_formato', 'token curto');
  r = await loja('loja_frete_auto', Object.assign({ token: TOKEN.replace('a', 'b') }, CFG));
  conf(r.body.erro === 'token', 'token recusado pelo Melhor Envio nao e guardado: ' + JSON.stringify(r.body));
  conf(!d('recebimento/' + UID).melhorEnvio, 'nada gravado');
  chamadas.length = 0;
  r = await loja('loja_frete_auto', Object.assign({ token: TOKEN }, CFG));
  conf(r.code === 200 && r.body.freteAuto && r.body.freteAuto.conectado && r.body.freteAuto.ativo && r.body.teste.length === 3, 'conectou: ' + JSON.stringify(r.body.freteAuto));
  const rb = d('recebimento/' + UID);
  conf(rb.melhorEnvio.token !== TOKEN && rb.melhorEnvio.token.indexOf('eyJ') < 0 && T.decifrar(rb.melhorEnvio.token) === TOKEN, 'token guardado cifrado');
  conf(JSON.stringify(r.body).indexOf(TOKEN) < 0 && JSON.stringify(r.body).indexOf('eyJ0') < 0, 'token nao volta ao painel');
  conf(rb.envioAuto.cepOrigem === '58038000' && rb.envioAuto.pesoItem === 0.5 && rb.envioAuto.acrescimo === 2, 'configuracao normalizada');
  const ch = chamadas.find((c) => /melhorenvio/.test(c.url));
  conf(ch && ch.headers['User-Agent'] === 'Moviki (suporte@moviki.com.br)' && ch.headers.Accept === 'application/json' && ch.corpo.from.postal_code === '58038000', 'cabecalhos e origem: ' + JSON.stringify(ch && ch.headers));
  conf(d('checkout_publico/' + UID).envio.auto === true, 'espelho publico avisa que o frete e automatico');
  conf(JSON.stringify(d('checkout_publico/' + UID)).indexOf('eyJ') < 0, 'espelho publico sem token');

  // 3. cotacao publica
  chamadas.length = 0;
  r = await publico({ acao: 'compra_frete', lojistaUid: UID, cep: '01310-100', qtd: 2, subtotal: 200 });
  conf(r.code === 200 && r.body.opcoes.length === 3, '3 opcoes validas (a com erro sai): ' + JSON.stringify(r.body));
  const op = r.body.opcoes;
  conf(op[0].nome === 'PAC' && op[0].preco === 32 && op[0].prazo === 9 && op[0].empresa === 'Correios', 'PAC peso 1 kg + R$ 2 = R$ 32, prazo +1: ' + JSON.stringify(op[0]));
  conf(op[1].empresa === 'Jadlog' && op[1].preco === 33.1 && op[2].preco === 47.9, 'ordem por preco');
  const me = chamadas.find((c) => /melhorenvio/.test(c.url));
  conf(me.corpo.package.weight === 1 && me.corpo.package.height === 4 && me.corpo.package.width === 12 && me.corpo.package.length === 17 && me.corpo.to.postal_code === '01310100' && !('insurance' in me.corpo.package), 'pacote: peso x qtd, caixa padrao, sem seguro');
  chamadas.length = 0;
  r = await publico({ acao: 'compra_frete', lojistaUid: UID, cep: '01310100', qtd: 2, subtotal: 200 });
  conf(r.body.opcoes.length === 3 && !chamadas.some((c) => /melhorenvio/.test(c.url)), 'segunda cotacao igual sai do cache');
  conf(![...store.keys()].some((k) => k.startsWith('frete_cotacoes/') && JSON.stringify(store.get(k)).indexOf('01310100') >= 0), 'cache sem o CEP do comprador');
  r = await publico({ acao: 'compra_frete', lojistaUid: UID, cep: '0131', qtd: 2 });
  conf(r.body.erro === 'cep', 'cep incompleto');

  // 4. pedido usa o preco do servico escolhido
  r = await card([{ sku: 'v1', qtd: 2 }], Object.assign({}, endSP, { servico: '3' }));
  conf(r.ok && r.frete === 33.1, 'pedido com Jadlog R$ 33,10: ' + JSON.stringify(r).slice(0, 140));
  let p = d('pedidos/' + r.pedidoId);
  conf(p.entrega.envio === true && p.entrega.freteAuto.servico === '3' && /Jadlog/.test(p.entrega.freteAuto.nome) && p.entrega.prazo === '6 dias úteis', 'pedido grava servico e prazo: ' + JSON.stringify(p.entrega.freteAuto) + ' ' + p.entrega.prazo);
  r = await card([{ sku: 'v1', qtd: 2 }], Object.assign({}, endSP, { servico: '99' }));
  conf(r.erro === 'frete_escolher', 'servico inexistente recusa');
  r = await card([{ sku: 'v1', qtd: 2 }], endSP);
  conf(r.erro === 'frete_escolher', 'sem servico escolhido recusa');
  r = await card([{ sku: 'v1', qtd: 1 }, { sku: 'b1', qtd: 1 }], Object.assign({}, endSP, { servico: '1' }));
  conf(r.erro === 'item_local', 'bolo continua sem correio');
  r = await card([{ sku: 'v1', qtd: 1 }], Object.assign({}, endAM, { servico: '1' }));
  conf(r.ok && r.frete === 27, 'Norte vai pelo automatico mesmo sem tabela (PAC 0,5 kg = 25 + 2): ' + JSON.stringify(r).slice(0, 100));

  // 5. frete gratis acima de X: a mais barata zera, as outras pagam a diferenca
  await T.lojaEntrega(UID, { entrega: 'retirada', bairros: [], envio: { ativo: true, ufOrigem: 'PB', regioes: { SE: '30' }, gratisAcima: '150' } });
  r = await publico({ acao: 'compra_frete', lojistaUid: UID, cep: '01310100', qtd: 2, subtotal: 200 });
  conf(r.body.opcoes[0].preco === 0 && r.body.opcoes[1].preco === 1.1 && r.body.opcoes[2].preco === 15.9, 'gratis: ' + JSON.stringify(r.body.opcoes.map((x) => x.preco)));
  r = await card([{ sku: 'v1', qtd: 2 }], Object.assign({}, endSP, { servico: '2' }));
  conf(r.ok && r.frete === 15.9, 'SEDEX acima do gratis paga a diferenca: ' + r.frete);
  r = await card([{ sku: 'v1', qtd: 1 }], Object.assign({}, endSP, { servico: '1' }));
  conf(r.ok && r.frete === 27, 'abaixo do gratis paga cheio: ' + r.frete);

  // 6. Melhor Envio fora: cai na tabela; sem tabela para a regiao, indisponivel
  [...store.keys()].filter((k) => k.startsWith('frete_cotacoes/')).forEach((k) => store.delete(k));
  modoME = 'fora';
  r = await card([{ sku: 'v1', qtd: 1 }], Object.assign({}, endSP, { servico: '1' }));
  conf(r.ok && r.frete === 30 && !d('pedidos/' + r.pedidoId).entrega.freteAuto, 'fora do ar: tabela do Sudeste R$ 30');
  r = await card([{ sku: 'v1', qtd: 1 }], Object.assign({}, endAM, { servico: '1' }));
  conf(r.erro === 'frete_indisponivel', 'fora do ar e sem tabela do Norte: ' + JSON.stringify(r));
  r = await publico({ acao: 'compra_frete', lojistaUid: UID, cep: '69005000', qtd: 1 });
  conf(r.body.erro === 'frete_indisponivel', 'cotacao publica avisa indisponivel');
  modoME = 'vazio';
  r = await publico({ acao: 'compra_frete', lojistaUid: UID, cep: '69005001', qtd: 1 });
  conf(r.body.erro === 'sem_opcao', 'nenhum servico para o trecho');
  modoME = 'ok';

  // 7. simulacao no painel
  r = await loja('loja_frete_auto_testar', { cep: '01310100', qtd: 3 });
  conf(r.code === 200 && r.body.opcoes.length === 3 && r.body.peso === 1.5, 'simulacao no painel: ' + JSON.stringify(r.body).slice(0, 100));
  r = await loja('loja_recebimento');
  conf(r.body.freteAuto && r.body.freteAuto.conectado && r.body.freteAuto.final === TOKEN.slice(-6) && r.body.freteAuto.cfg.caixa.comp === 17, 'situacao do painel');
  conf(JSON.stringify(r.body).indexOf(TOKEN) < 0, 'loja_recebimento sem token');

  // 8. seguro: valor entra na cotacao
  r = await loja('loja_frete_auto', Object.assign({}, CFG, { seguro: true }));
  conf(r.code === 200 && r.body.freteAuto.conectado, 'salvar sem token novo mantem o conectado');
  chamadas.length = 0;
  r = await publico({ acao: 'compra_frete', lojistaUid: UID, cep: '01310100', qtd: 1, subtotal: 100 });
  const me2 = chamadas.find((c) => /melhorenvio/.test(c.url));
  conf(me2 && me2.corpo.package.insurance === 100, 'seguro declara o valor');

  // 9. Pro nao usa; desligar a chave para; desconectar apaga o token
  store.set('assinaturas/' + UID, { ativo: true, plano: 'pro' });
  r = await publico({ acao: 'compra_frete', lojistaUid: UID, cep: '01310100', qtd: 1 });
  conf(r.body.erro === 'sem_auto', 'plano sem pedido nao cota');
  store.set('assinaturas/' + UID, { ativo: true, plano: 'premium' });
  await T.admRecursos('donoXXXXXXXXXXXXX', { uid: UID, freteAuto: false });
  r = await card([{ sku: 'v1', qtd: 1 }], Object.assign({}, endSP, { servico: '1' }));
  conf(r.ok && r.frete === 30 && !d('pedidos/' + r.pedidoId).entrega.freteAuto, 'chave desligada volta para a tabela');
  await T.admRecursos('donoXXXXXXXXXXXXX', { uid: UID, freteAuto: true });
  r = await loja('loja_frete_auto', { desconectar: true });
  conf(r.code === 200 && !d('recebimento/' + UID).melhorEnvio && r.body.freteAuto.conectado === false && d('checkout_publico/' + UID).envio.auto === false, 'desconectar apaga o token e o espelho');

  // 10. tabela vazia aceita com o automatico ligado
  await loja('loja_frete_auto', Object.assign({ token: TOKEN }, CFG));
  r = await T.lojaEntrega(UID, { entrega: 'retirada', bairros: [], envio: { ativo: true, ufOrigem: 'PB', regioes: {} } });
  conf(!r.erro, 'envio ativo sem tabela, com o automatico: ' + JSON.stringify(r).slice(0, 80));

  // 11. peso por produto (cardapio) entra no pacote; cache igual na cotacao e no pedido
  store.set('negocios/' + UID, { nome: 'Moda Teste', cardapio: [{ categoria: 'Roupas', produtos: [{ nome: 'Vestido', preco: '100', sku: 'v1', envia: true }, { nome: 'Casaco', preco: '200', sku: 'c1', envia: true, pesoEnvio: '1.2' }, { nome: 'Bolo', preco: '15', sku: 'b1' }] }] });
  [...store.keys()].filter((k) => k.startsWith('frete_cotacoes/')).forEach((k) => store.delete(k));
  await loja('loja_frete_auto', Object.assign({}, CFG, { seguro: false }));
  chamadas.length = 0;
  r = await publico({ acao: 'compra_frete', lojistaUid: UID, cep: '01310100', qtd: 3, subtotal: 400, itens: [{ sku: 'c1', qtd: 1 }, { nome: 'vestido', qtd: 2 }] });
  const me3 = chamadas.find((c) => /melhorenvio/.test(c.url));
  conf(r.body.ok && me3 && me3.corpo.package.weight === 2.2, 'peso = casaco 1,2 + 2 vestidos x 0,5: ' + (me3 && me3.corpo.package.weight));
  chamadas.length = 0;
  r = await card([{ sku: 'c1', qtd: 1 }, { sku: 'v1', qtd: 2 }], Object.assign({}, endSP, { servico: '1' }));
  conf(r.ok && r.frete === 44 && !chamadas.some((c) => /melhorenvio/.test(c.url)), 'pedido usa a mesma cotacao do cache (PAC 2,2 kg = 42 + 2): ' + JSON.stringify(r).slice(0, 80));
  conf(T.fa()._t.pesoDoPacote({ cardapio: [] }, [{ nome: 'x', qtd: 200 }], 0.5) === 30, 'teto de 30 kg');

  console.log('OK ' + ok + ' / FALHAS ' + falhas);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
