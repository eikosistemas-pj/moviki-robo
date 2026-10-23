'use strict';
// Teste dos Dados para receber do parceiro (22/10/2026). Sem internet:
//   cd moviki-robo && node testes/fiscal-parceiro.test.js
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
const SESS = { tP: { uid: 'ParcAAAAAAAAAAAAAAAA', email: 'p@x.com' }, tL: { uid: 'LojaBBBBBBBBBBBBBBBB', email: 'l@x.com' }, tA: { uid: 'ADMxxxxxxxxxxxxxxxxx', email: 'a@x.com', firebase: { sign_in_provider: 'google.com' } } };
fake.admin.auth = () => ({ verifyIdToken: async (t) => { if (!SESS[t]) throw new Error('token'); return SESS[t]; } });
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'x', filename: 'x', loaded: true, exports: { admin: fake.admin, db: fake.db } };
process.env.TELEGRAM_TOKEN = 't'; process.env.TELEGRAM_CHAT_ID = 'c';
const tg = [];
global.fetch = async (u, o) => { if (/telegram/.test(u)) tg.push(JSON.parse(o.body).text); return { ok: true, json: async () => ({}) }; };
const F = require(path.join(ROBO, 'lib/fiscalParceiro.js'));
const h = require(path.join(ROBO, 'api/parceiro-fiscal.js'));
let falhas = 0, ok = 0;
function conf(c, m) { if (c) ok++; else { falhas++; console.log('FALHOU:', m); } }
function res() { return { c: 0, b: null, setHeader() {}, status(c) { this.c = c; return this; }, json(b) { this.b = b; return this; }, end() { return this; } }; }
async function post(t, body) { const r = res(); await h({ method: 'POST', headers: { origin: 'https://app.moviki.com.br', authorization: 'Bearer ' + t }, body }, r); return r; }

const REF = Date.UTC(2026, 9, 22, 15);
const CPF = '52998224725', CPF2 = '11144477735', CNPJ = '11222333000181';
(async () => {
  // regras puras
  conf(F.idade('2008-10-22', REF) === 18, '18 anos no dia do aniversario');
  conf(F.idade('2008-10-23', REF) === 17, '17 anos na vespera');
  conf(F.idade('2008-02-30', REF) === -1, 'data impossivel');
  conf(F.validar({ tipo: 'pf', documento: CPF, nome: 'Maria Souza', nascimento: '2008-10-23' }, REF).erro === 'menor', 'menor de 18 recusado');
  conf(F.validar({ tipo: 'pf', documento: '12345678900', nome: 'Maria Souza', nascimento: '1990-01-01' }, REF).erro === 'documento', 'CPF invalido');
  conf(F.validar({ tipo: 'pf', documento: CPF, nome: 'Maria', nascimento: '1990-01-01' }, REF).erro === 'nome', 'nome sem sobrenome');
  conf(F.validar({ tipo: 'pj', documento: CPF, nome: 'Loja X Ltda' }, REF).erro === 'documento', 'PJ com CPF recusado');
  const vpj = F.validar({ tipo: 'pj', documento: CNPJ, nome: 'Maria Souza ME', mei: true }, REF);
  conf(vpj.ok && vpj.dados.mei === true && !vpj.dados.nascimento, 'PJ ok sem nascimento');
  conf(F.validar({ tipo: 'xx' }).erro === 'tipo', 'tipo obrigatorio');
  conf(F.mascarar(CPF) === '***.982.247-**', 'mascara CPF');
  conf(F.docConfere(CPF, '***.982.247-**') === true, 'chave Pix do mesmo CPF');
  conf(F.docConfere(CPF, '***.444.777-**') === false, 'chave Pix de outro CPF');
  conf(F.docConfere(CNPJ, '***.982.247-**') === false, 'CNPJ x chave de CPF');
  conf(F.docConfere(CPF, '') === null, 'sem documento do Asaas');

  // endpoint
  await fake.db.collection('parceiros').doc('ParcAAAAAAAAAAAAAAAA').set({ nome: 'Maria', slug: 'maria', status: 'aprovado' });
  let r = await post('xx', { acao: 'ver' });
  conf(r.c === 401, 'sem sessao');
  r = await post('tL', { acao: 'ver' });
  conf(r.c === 403, 'quem nao e parceiro nao usa');
  r = await post('tP', { acao: 'ver' });
  conf(r.c === 200 && r.b.completo === false, 'comeca incompleto');
  r = await post('tP', { acao: 'salvar', tipo: 'pf', documento: '529.982.247-25', nome: '  Maria   Souza ', nascimento: '1990-05-10' });
  conf(r.c === 200 && r.b.completo && r.b.documento === '***.982.247-**' && r.b.nome === 'Maria Souza' && r.b.nascimento === '10/05/1990', 'salva PF e devolve mascarado');
  const fis = (await fake.db.collection('parceiros_fiscal').doc('ParcAAAAAAAAAAAAAAAA').get()).data();
  conf(fis.documento === CPF && fis.tipo === 'pf', 'documento inteiro so no servidor');
  const par = (await fake.db.collection('parceiros').doc('ParcAAAAAAAAAAAAAAAA').get()).data();
  conf(par.fiscalOk === true && par.fiscalTipo === 'pf' && !par.documento, 'espelho sem o documento');
  conf(tg.length === 0, 'primeiro cadastro nao avisa');
  r = await post('tP', { acao: 'salvar', tipo: 'pf', documento: CPF2, nome: 'Maria Souza', nascimento: '1990-05-10' });
  conf(r.c === 200 && tg.length === 1 && /TROCOU/.test(tg[0]), 'troca de documento avisa no Telegram');
  r = await post('tP', { acao: 'salvar', tipo: 'pj', documento: CNPJ, nome: 'Maria Souza ME', mei: true });
  const fis2 = (await fake.db.collection('parceiros_fiscal').doc('ParcAAAAAAAAAAAAAAAA').get()).data();
  conf(r.c === 200 && fis2.tipo === 'pj' && !fis2.nascimento && fis2.mei === true, 'vira PJ e some o nascimento');
  r = await post('tP', { acao: 'salvar', tipo: 'pf', documento: CPF, nome: 'Maria Souza', nascimento: '2010-01-01' });
  conf(r.c === 400 && r.b.erro === 'menor', 'endpoint recusa menor');

  // nota do PJ no pedido de saque
  const NF = '3'.repeat(50);
  await fake.db.collection('saques').doc('S1').set({ parceiroUid: 'ParcAAAAAAAAAAAAAAAA', status: 'solicitado', valorSolicitado: 40 });
  await fake.db.collection('saques').doc('S2').set({ parceiroUid: 'OutroXXXXXXXXXXXXXXX', status: 'solicitado', valorSolicitado: 40 });
  r = await post('tP', { acao: 'salvar', tipo: 'pj', documento: CNPJ, nome: 'Maria Souza ME' });
  r = await post('tP', { acao: 'nota_saque', saqueId: 'S1', chave: '123' });
  conf(r.c === 400 && r.b.erro === 'chave', 'chave da NFS-e com 50 numeros');
  r = await post('tP', { acao: 'nota_saque', saqueId: 'S2', chave: NF });
  conf(r.c === 404, 'nao mexe no saque de outro');
  r = await post('tP', { acao: 'nota_saque', saqueId: 'S1', chave: NF });
  conf(r.c === 200 && (await fake.db.collection('saques').doc('S1').get()).data().nfseChave === NF, 'chave gravada no saque');
  // relatorio do dono
  await fake.db.collection('saques').doc('S9').set({ parceiroUid: 'ParcAAAAAAAAAAAAAAAA', status: 'pago', pagoEm: fake.Timestamp.fromMillis(Date.now()), valorBruto: 300, inssRetido: 33, irrfRetido: 0, valorPago: 267, fiscalTipo: 'pf' });
  r = await post('tP', { acao: 'relatorio' });
  conf(r.c === 403, 'relatorio so do dono');
  await fake.db.collection('admins').doc('ADMxxxxxxxxxxxxxxxxx').set({ ok: true });
  r = await post('tA', { acao: 'relatorio' });
  conf(r.c === 200 && r.b.linhas.length === 1 && r.b.linhas[0].documento === CNPJ && r.b.linhas[0].inss === 33, 'relatorio do mes com documento e retencao');

  console.log(ok + ' ok, ' + falhas + ' falha(s)');
  process.exit(falhas ? 1 : 0);
})();
