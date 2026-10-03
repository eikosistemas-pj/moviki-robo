'use strict';
// Rastreio do envio e pagina de acompanhamento (P70 etapa 3, 03/10/2026). Sem internet e sem Firebase:
// cd moviki-robo && node testes/rastreio.test.js
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
const UID = 'lojistaRRRRRRRRRRR4';
const OUTRO = 'lojistaOOOOOOOOOOO5';
function base() {
  store.clear();
  store.set('assinaturas/' + UID, { ativo: true, plano: 'enterprise' });
  store.set('negocios/' + UID, { nome: 'Perfumaria Teste', slug: 'perfumaria-teste', cardapio: [
    { categoria: 'Perfumes', produtos: [{ nome: 'Perfume Azul', preco: '120', sku: 'per1', envia: true }] },
    { categoria: 'Lanche', produtos: [{ nome: 'Bolo de pote', preco: '15', sku: 'bol1' }] }] });
  store.set('recebimento/' + UID, { ligado: true, modo: 'pix', entrega: 'retirada', pix: { chaveCifrada: T.cifrar('loja@teste.com'), nome: 'Perfumaria', cidade: 'Joao Pessoa', docMascara: '***', mascara: 'x', tipo: 'email' } });
  store.set('configuracoes/liveTermos', {});
}
const comprador = { nome: 'Rui Alves Souza', cpf: '52998224725', whatsapp: '11999998888', aceite: true, lojistaUid: UID };
const endSP = { cep: '01310100', rua: 'Av. Paulista', numero: '1000', complemento: 'ap 5', bairro: 'Bela Vista', cidade: 'São Paulo', uf: 'SP' };
const ENV = { ativo: true, ufOrigem: 'PB', mesmoEstado: '12', regioes: { N: '', NE: '20', CO: '35', SE: '30', S: '38' }, gratisAcima: '300', prazo: '5 a 10 dias úteis' };
let n = 0;
const card = (itens, extra) => T.compraCriar(Object.assign({ origem: 'cardapio', itens }, comprador, extra || {}), '9.9.9.' + (++n));
function resFalso() { const r = { code: 0, body: null, headers: {} }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; }; r.end = () => r; return r; }
async function chamar(body) { const res = resFalso(); await ck.tratar({ headers: { origin: 'https://www.moviki.com.br' }, socket: {} }, res, body); return res; }

(async () => {
  base();
  await T.lojaEntrega(UID, { entrega: 'retirada', bairros: [], envio: ENV });
  await T.admRecursos('donoXXXXXXXXXXXXX', { uid: UID, freteBrasil: true });
  let r = await card([{ sku: 'per1', qtd: 1 }], { entrega: 'envio', endereco: endSP });
  conf(r.ok, 'pedido de envio criado ' + JSON.stringify(r).slice(0, 100));
  const ENV_ID = r.pedidoId, ENV_CHAVE = r.chave;
  r = await card([{ sku: 'bol1', qtd: 1 }], { entrega: 'retirada' });
  const RET_ID = r.pedidoId;

  // 1. so pago e so envio
  r = await T.lojaRastreio(UID, ENV_ID, { transp: 'correios', codigo: 'AA123456789BR' });
  conf(r.erro === 'so_pago', 'aguardando recusa: ' + JSON.stringify(r));
  store.set('pedidos/' + ENV_ID, Object.assign(d('pedidos/' + ENV_ID), { status: 'pago', pagoEm: Timestamp.now() }));
  store.set('pedidos/' + RET_ID, Object.assign(d('pedidos/' + RET_ID), { status: 'pago' }));
  r = await T.lojaRastreio(UID, RET_ID, { transp: 'correios', codigo: 'AA123456789BR' });
  conf(r.erro === 'so_envio', 'retirada nao tem rastreio');
  r = await T.lojaRastreio(OUTRO, ENV_ID, { transp: 'correios', codigo: 'AA123456789BR' });
  conf(r.erro === 'nao_encontrado', 'pedido de outro lojista');

  // 2. formato do codigo
  r = await T.lojaRastreio(UID, ENV_ID, { transp: 'correios', codigo: '123' });
  conf(r.erro === 'codigo_rastreio', 'codigo dos Correios fora do formato');
  r = await T.lojaRastreio(UID, ENV_ID, { transp: 'sedex-falso', codigo: 'AA123456789BR' });
  conf(r.erro === 'transportadora', 'transportadora fora da lista');
  r = await T.lojaRastreio(UID, ENV_ID, { transp: 'outra', codigo: 'ABC12345' });
  conf(r.erro === 'transportadora_nome', 'outra sem nome');
  r = await T.lojaRastreio(UID, ENV_ID, { transp: 'outra', nome: 'X', codigo: 'ABC12345', url: 'https://golpe.example' });
  conf(r.erro === 'transportadora_nome', 'outra com nome curto');

  // 3. salva, normaliza e marca enviado
  r = await T.lojaRastreio(UID, ENV_ID, { transp: 'correios', codigo: ' aa 123456789 br ' });
  conf(r.ok && r.status === 'saiu', 'salvou e marcou saiu: ' + JSON.stringify(r).slice(0, 160));
  let p = d('pedidos/' + ENV_ID);
  conf(p.entrega.rastreio.codigo === 'AA123456789BR' && p.entrega.rastreio.nome === 'Correios', 'codigo normalizado');
  conf(p.status === 'saiu' && p.saiuEm && /^[0-9a-f]{24}$/.test(p.acompanhar), 'status saiu e token');
  conf(p.entrega.rua === 'Av. Paulista' && p.entrega.cidade === 'São Paulo', 'endereco intacto');
  const LINK = r.acompanhar;
  conf(LINK === ENV_ID + '-' + p.acompanhar, 'link = pedido-token');
  conf(r.rastreio.url === 'https://rastreamento.correios.com.br/app/index.php', 'link oficial da lista');

  // 4. troca de codigo mantem o token; outra transportadora nunca leva link livre
  r = await T.lojaRastreio(UID, ENV_ID, { transp: 'outra', nome: 'Transportes Silva', codigo: 'ts-998877', url: 'https://golpe.example' });
  conf(r.ok && r.acompanhar === LINK, 'token nao muda na troca');
  conf(r.rastreio.url === '' && r.rastreio.nome === 'Transportes Silva' && r.rastreio.codigo === 'TS-998877', 'outra sem link');
  conf(JSON.stringify(d('pedidos/' + ENV_ID)).indexOf('golpe') < 0, 'url do lojista nao e gravada');

  // 5. entregue nao volta para saiu
  await T.lojaPedido(UID, ENV_ID, 'entregue');
  r = await T.lojaRastreio(UID, ENV_ID, { transp: 'loggi', codigo: 'LOG-12345' });
  conf(r.ok && r.status === 'entregue' && d('pedidos/' + ENV_ID).status === 'entregue', 'entregue continua entregue');

  // 6. pagina publica
  r = await T.pedidoVer({ ref: LINK });
  conf(r.ok && r.negocio === 'Perfumaria Teste' && r.slug === 'perfumaria-teste' && r.etapa === 'entregue', 'pagina publica: ' + JSON.stringify(r).slice(0, 200));
  conf(r.cidade === 'São Paulo' && r.uf === 'SP' && r.prazo === '5 a 10 dias úteis' && r.rastreio.codigo === 'LOG-12345' && r.rastreio.url === 'https://www.loggi.com/rastreador/', 'cidade, prazo e rastreio');
  const txtPub = JSON.stringify(r);
  conf(['Rui', '11999998888', 'Paulista', '01310100', 'ap 5', 'Bela Vista', '52998224725', ENV_CHAVE].every((x) => txtPub.indexOf(x) < 0), 'nada da pessoa na pagina publica');
  r = await T.pedidoVer({ ref: ENV_ID + '-' + '0'.repeat(24) });
  conf(r.erro === 'nao_encontrado', 'token errado');
  r = await T.pedidoVer({ ref: ENV_ID });
  conf(r.erro === 'nao_encontrado', 'sem token');
  r = await T.pedidoVer({ ref: RET_ID + '-' + d('pedidos/' + ENV_ID).acompanhar });
  conf(r.erro === 'nao_encontrado', 'token de um pedido nao abre outro');

  // 7. porta publica e porta do lojista
  let res = await chamar({ acao: 'compra_acompanhar', ref: LINK });
  conf(res.code === 200 && res.body.ok && res.body.rastreio, 'compra_acompanhar pela porta publica');
  res = await chamar({ acao: 'compra_acompanhar', ref: 'x' });
  conf(res.code === 404, 'link quebrado = 404');
  res = await chamar({ acao: 'loja_rastreio', idToken: UID, pedidoId: ENV_ID, dados: { transp: 'jadlog', codigo: '10012345678' } });
  conf(res.code === 200 && res.body.ok && res.body.rastreio.nome === 'Jadlog', 'loja_rastreio pela porta do lojista: ' + JSON.stringify(res.body).slice(0, 120));
  store.set('assinaturas/' + UID, { ativo: false, plano: 'basico' });
  res = await chamar({ acao: 'loja_rastreio', idToken: UID, pedidoId: ENV_ID, dados: { transp: 'jadlog', codigo: '10012345678' } });
  conf(res.code === 403, 'sem plano pago recusa');
  store.set('assinaturas/' + UID, { ativo: true, plano: 'enterprise' });

  // 8. tela do comprador
  r = await T.compraStatus({ pedidoId: ENV_ID, chave: ENV_CHAVE });
  conf(r.ok && r.envio === true && r.acompanhar === 'https://www.moviki.com.br/pedido/' + LINK, 'compra_status leva o link: ' + JSON.stringify(r).slice(0, 200));

  // 9. remover rastreio
  r = await T.lojaRastreio(UID, ENV_ID, { remover: true });
  conf(r.ok && !d('pedidos/' + ENV_ID).entrega.rastreio, 'remove o rastreio');
  r = await T.pedidoVer({ ref: LINK });
  conf(r.ok && r.rastreio === null, 'pagina sem rastreio continua de pe');

  // 10. devolvido aparece como cancelado; LGPD apaga o link
  store.set('pedidos/' + ENV_ID, Object.assign(d('pedidos/' + ENV_ID), { status: 'devolvido' }));
  r = await T.pedidoVer({ ref: LINK });
  conf(r.ok && r.etapa === 'cancelado', 'devolvido = cancelado');
  await T.apagarDadosDoComprador(fake.db.collection('pedidos').doc(ENV_ID), d('pedidos/' + ENV_ID));
  conf(!d('pedidos/' + ENV_ID).acompanhar, 'retencao apaga o token');
  r = await T.pedidoVer({ ref: LINK });
  conf(r.erro === 'nao_encontrado', 'link morre com os dados');

  console.log('OK ' + ok + ' / FALHAS ' + falhas);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
