'use strict';
// Parceiros de entrega (P70 etapa 5, 04/10/2026). Sem internet e sem Firebase:
// cd moviki-robo && node testes/logistica.test.js
process.env.CHECKOUT_CHAVE = 'uma-frase-longa-e-aleatoria-de-teste-1234567890';
process.env.TELEGRAM_TOKEN = 'tg';
process.env.TELEGRAM_CHAT_ID = '1';
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'x', filename: 'x', loaded: true, exports: { admin: fake.admin, db: fake.db } };
const enviados = [];
global.fetch = async (url, op) => { enviados.push({ url: String(url), corpo: op && op.body ? JSON.parse(op.body) : null }); return { ok: true, status: 200, json: async () => ({}) }; };
const ck = require(path.join(ROBO, 'lib/checkout.js'));
const T = ck._t;
const L = T.logi();
const { store } = fake;
let falhas = 0, ok = 0;
function conf(c, msg) { if (c) { ok++; } else { falhas++; console.log('FALHOU:', msg); } }
const d = (p) => store.get(p);
const UID = 'lojistaLLLLLLLLLLL5';
const DONO = 'donoXXXXXXXXXXXXX1';
const docsLog = () => [...store.keys()].filter((k) => k.startsWith('logistica/')).map((k) => [k.split('/')[1], store.get(k)]);
function resFalso() { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; r.send = (b) => { r.body = b; return r; }; return r; }
let ipN = 0;
async function porta(body) { const res = resFalso(); const pedido = require(path.join(ROBO, 'api/pedido.js')); await pedido({ method: 'POST', headers: { origin: 'https://www.moviki.com.br', 'x-forwarded-for': '9.9.9.' + (ipN++) }, query: {}, body }, res); return res; }

(async () => {
  store.clear();
  const base = { acao: 'compra_logi_entrar', aceite: true, tipo: 'entregador', nome: 'Zé Entregas', responsavel: 'José da Silva', whatsapp: '+55 (41) 99999-1111', cidade: 'Curitiba', uf: 'PR', servicos: ['bairro', 'cidade'], veiculos: ['moto'], atende: 'Centro e Batel' };

  // 1. validacoes
  let r = await porta(Object.assign({}, base, { aceite: false }));
  conf(r.code === 400 && r.body.erro === 'aceite', 'sem aceite');
  r = await porta(Object.assign({}, base, { tipo: 'pirata' }));
  conf(r.body.erro === 'tipo', 'tipo invalido');
  r = await porta(Object.assign({}, base, { whatsapp: '123' }));
  conf(r.body.erro === 'whatsapp', 'whatsapp curto');
  r = await porta(Object.assign({}, base, { uf: 'XX' }));
  conf(r.body.erro === 'uf', 'uf invalida');
  r = await porta(Object.assign({}, base, { servicos: ['voar'] }));
  conf(r.body.erro === 'servicos', 'servico fora da lista');
  r = await porta(Object.assign({}, base, { veiculos: [] }));
  conf(r.body.erro === 'veiculos', 'entregador sem veiculo');
  r = await porta(Object.assign({}, base, { email: 'nao-e-email' }));
  conf(r.body.erro === 'email', 'email invalido');
  conf(docsLog().length === 0, 'nada gravado nas recusas');

  // 2. cadastro
  enviados.length = 0;
  r = await porta(base);
  conf(r.code === 200 && r.body.ok && /^https:\/\/www\.moviki\.com\.br\/entregadores\/sair\/l[0-9a-f]{30}-[0-9a-f]{24}$/.test(r.body.sair), 'cadastro ok: ' + JSON.stringify(r.body));
  const [zeId, ze] = docsLog()[0];
  conf(ze.status === 'pendente' && ze.whatsapp === '41999991111' && ze.cidadeChave === 'curitiba' && ze.consentimento.versao === 'log-1' && /só apresenta/.test(ze.consentimento.texto), 'documento pendente com consentimento');
  conf(enviados.some((e) => /telegram/.test(e.url) && /Zé Entregas/.test(e.corpo.text)), 'dono avisado no Telegram');
  r = await porta(Object.assign({}, base, { whatsapp: '41 99999-1111', nome: 'Outro nome' }));
  conf(r.body.erro === 'ja_cadastrado' && docsLog().length === 1, 'mesmo WhatsApp nao duplica');
  // transportadora sem veiculo pode; atende outros estados
  r = await porta(Object.assign({}, base, { tipo: 'transportadora', nome: 'Rápido Sul', whatsapp: '11988887777', cidade: 'São Paulo', uf: 'SP', servicos: ['estados', 'coleta'], veiculos: [] }));
  conf(r.body.ok, 'transportadora sem veiculo');
  r = await porta(Object.assign({}, base, { nome: 'Moto Batel', whatsapp: '41977776666', cidade: 'São José dos Pinhais', servicos: ['regiao'] }));
  conf(r.body.ok, 'segundo do PR');
  r = await porta(Object.assign({}, base, { nome: 'Bike Rio', whatsapp: '21966665555', cidade: 'Rio de Janeiro', uf: 'RJ', veiculos: ['bicicleta'] }));
  conf(r.body.ok, 'um do RJ');

  // 3. freio por IP
  let ultimo;
  for (let i = 0; i < 7; i++) ultimo = await L.entrar(Object.assign({}, base, { whatsapp: '4196000000' + i }), '7.7.7.7');
  conf(ultimo.erro === 'freio', '7o cadastro do mesmo IP na hora = freio');
  docsLog().filter(([, x]) => /^4196/.test(x.whatsapp)).forEach(([id]) => store.delete('logistica/' + id));

  // 4. lojista: desligado e plano
  store.set('assinaturas/' + UID, { ativo: true, plano: 'premium' });
  r = await L.lojaListar(UID, { uf: 'PR' });
  conf(r.ok && r.ligado === false, 'chave desligada');
  const tokLoja = async (acao, dados) => { const res = resFalso(); fake.admin.auth = () => ({ verifyIdToken: async () => ({ uid: UID, firebase: { sign_in_provider: 'google.com' } }) }); await ck.tratar({ headers: { origin: 'https://app.moviki.com.br' }, socket: {} }, res, { acao, idToken: 'x', dados }); return res; };
  await T.admRecursos(DONO, { uid: UID, logistica: true });
  conf(d('checkout_publico/' + UID).recursos.logistica === true && d('recursos/' + UID).logistica === true, 'dono liga a chave e o espelho mostra');
  r = await L.lojaListar(UID, { uf: 'PR', cidade: 'curitiba' });
  conf(r.ok && r.ligado && r.total === 0, 'pendente nao aparece para o lojista');

  // 5. dono aprova / suspende / recusa
  r = await L.admListar({ status: 'pendente' });
  conf(r.ok && r.itens.length === 4, 'fila de pendentes: ' + (r.itens && r.itens.length));
  const idDe = (nome) => docsLog().find(([, x]) => x.nome === nome)[0];
  r = await L.admMudar(DONO, { id: zeId, status: 'aprovado' });
  conf(r.ok && d('logistica/' + zeId).status === 'aprovado' && d('logistica/' + zeId).aprovadoEm, 'aprovou');
  await L.admMudar(DONO, { id: idDe('Rápido Sul'), status: 'aprovado' });
  await L.admMudar(DONO, { id: idDe('Moto Batel'), status: 'aprovado' });
  await L.admMudar(DONO, { id: idDe('Bike Rio'), status: 'aprovado' });
  r = await L.admMudar(DONO, { id: idDe('Moto Batel'), status: 'suspenso' });
  conf(r.erro === 'motivo', 'suspender exige motivo');
  r = await L.admMudar(DONO, { id: 'lzzz', status: 'aprovado' });
  conf(r.erro === 'id', 'id invalido');
  r = await L.admMudar(DONO, { id: zeId, status: 'qualquer' });
  conf(r.erro === 'status', 'status invalido');

  // 6. lojista ve
  r = await L.lojaListar(UID, { uf: 'pr', cidade: 'CURITIBA' });
  conf(r.ok && r.total === 3, 'PR ve Ze, Moto Batel e a transportadora que atende estados: ' + JSON.stringify(r.itens && r.itens.map((x) => x.nome)));
  conf(r.itens[0].nome === 'Zé Entregas' && r.itens[0].mesmaCidade === true, 'mesma cidade primeiro');
  conf(r.itens[2].nome === 'Rápido Sul', 'outro estado por ultimo');
  conf(r.itens[0].responsavel === 'José' && r.itens[0].whatsapp === '41999991111' && r.itens[0].servicos.indexOf('Entrega no bairro') >= 0 && r.itens[0].veiculos[0] === 'Moto', 'cartao com primeiro nome, WhatsApp e rotulos');
  conf(JSON.stringify(r).indexOf('sairToken') < 0 && JSON.stringify(r).indexOf('consentimento') < 0 && JSON.stringify(r).indexOf('email') < 0, 'lojista nao recebe token, consentimento nem e-mail');
  conf(!r.itens.some((x) => x.nome === 'Bike Rio'), 'RJ nao aparece no PR');
  r = await L.lojaListar(UID, { uf: '' });
  conf(r.erro === 'uf', 'sem UF');
  await L.admMudar(DONO, { id: idDe('Moto Batel'), status: 'suspenso', motivo: 'Reclamação de loja' });
  r = await L.lojaListar(UID, { uf: 'PR', cidade: 'Curitiba' });
  conf(r.total === 2 && !r.itens.some((x) => x.nome === 'Moto Batel'), 'suspenso some');
  r = await L.admListar({ status: 'suspenso' });
  conf(r.itens.length === 1 && r.itens[0].motivo === 'Reclamação de loja', 'aba suspensos com motivo');
  r = await L.admMudar(DONO, { id: idDe('Bike Rio'), status: 'recusado' });
  conf(r.ok && r.status === 'apagado' && docsLog().length === 3, 'recusar apaga');
  r = await L.admMudar(DONO, { id: idDe('Moto Batel'), status: 'aprovado' });
  conf(r.ok && !('motivo' in d('logistica/' + idDe('Moto Batel'))), 'reaprovar limpa o motivo');

  // 7. rotas do checkout
  r = await tokLoja('loja_logistica', { uf: 'PR', cidade: 'Curitiba' });
  conf(r.code === 200 && r.body.ok && r.body.total === 3, 'rota loja_logistica: ' + JSON.stringify(r.body && r.body.total));
  store.set('assinaturas/' + UID, { ativo: true, plano: 'pro' });
  r = await tokLoja('loja_logistica', { uf: 'PR' });
  conf(r.code === 403 && r.body.erro === 'nao_pago', 'Pro nao ve');
  store.set('assinaturas/' + UID, { ativo: true, plano: 'premium' });
  r = await tokLoja('adm_logistica', {});
  conf(r.code === 403 || r.code === 401, 'lojista nao entra na acao do dono: ' + r.code);
  store.set('admins/' + UID, { ativo: true });
  r = await tokLoja('adm_logistica', { status: 'aprovado' });
  conf(r.code === 200 && r.body.itens.length === 3, 'admin lista aprovados: ' + r.code + ' ' + JSON.stringify(r.body).slice(0, 120));
  store.delete('admins/' + UID);
  r = await porta({ acao: 'adm_logistica_mudar', dados: { id: zeId, status: 'recusado' } });
  conf(r.code === 400 && d('logistica/' + zeId), 'porta publica recusa acao do dono');
  r = await porta({ acao: 'loja_logistica', dados: { uf: 'PR' } });
  conf(r.code === 400, 'porta publica recusa acao do lojista');

  // 8. sair
  const tok = d('logistica/' + zeId).sairToken;
  r = await porta({ acao: 'compra_logi_sair', t: zeId + '-' + '0'.repeat(24) });
  conf(r.code === 400 && d('logistica/' + zeId), 'token errado nao apaga');
  r = await porta({ acao: 'compra_logi_sair', t: zeId + '-' + tok });
  conf(r.code === 200 && !d('logistica/' + zeId), 'sair apaga');
  r = await porta({ acao: 'compra_logi_sair', t: zeId + '-' + tok });
  conf(r.code === 200 && r.body.ja, 'sair duas vezes = ok');
  r = await porta({ acao: 'compra_logi_qualquer' });
  conf(r.code === 400, 'acao desconhecida');

  // 9. a chave desligada esconde de novo
  await T.admRecursos(DONO, { uid: UID, logistica: false });
  r = await L.lojaListar(UID, { uf: 'PR' });
  conf(r.ok && r.ligado === false, 'desligar a chave esconde');

  console.log(falhas ? '\n' + falhas + ' FALHA(S), ' + ok + ' ok' : '\nTUDO OK: ' + ok + ' conferencias');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
