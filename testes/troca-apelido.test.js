'use strict';
// Teste da troca de apelido de parceiro (01/10/2026).
// Roda sem internet e sem Firebase:
//   cd moviki-robo && node testes/troca-apelido.test.js   (nao precisa de npm install)
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
const { store, Timestamp } = fake;

require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'f', filename: 'f', loaded: true, exports: { admin: fake.admin, db: fake.db } };
const boas = { enviarBoasVindasParceiro: async () => ({ ok: true }) };
require.cache[require.resolve(path.join(ROBO, 'lib/boasVindasParceiro.js'))] = { id: 'b', filename: 'b', loaded: true, exports: boas };
fake.admin.auth = () => ({ verifyIdToken: async (t) => { if (t === 'ruim') throw new Error('x'); return { uid: t, firebase: { sign_in_provider: 'google.com' } }; } });

const { trocarApelido, normalizarApelidos, limparApelido } = require(path.join(ROBO, 'lib/trocaApelido.js'));
const { gravarEspelho } = require(path.join(ROBO, 'lib/espelhoParceiro.js'));
const api = require(path.join(ROBO, 'api/parceiro-aprovado.js'));

let ok = 0, falhou = 0;
function t(nome, cond) { if (cond) { ok++; } else { falhou++; console.log('FALHOU:', nome); } }
const D = (p) => store.get(p);

function cenario() {
  store.clear();
  store.set('admins/dono', { ok: true });
  store.set('parceiros/U1', { nome: 'Paulo PJ', slug: 'paulopj', status: 'aprovado', pix: 'x', criadoEm: Timestamp.fromMillis(1) });
  store.set('parceiro_slugs/paulopj', { uid: 'U1' });
  store.set('parceiros_publicos/paulopj', { slug: 'paulopj', nome: 'Paulo PJ', ativo: true });
  store.set('parceiros/U2', { nome: 'Ana', slug: 'ana', status: 'aprovado', indicadoPor: 'paulopj' });
  store.set('parceiro_slugs/ana', { uid: 'U2' });
  store.set('parceiro_slugs/lapide', { excluido: true });
  store.set('indicacoes/L1', { ref: 'paulopj' });
  store.set('indicacoes/L2', { ref: 'paulopj' });
  store.set('indicacoes/L3', { ref: 'ana' });
}

function chamar(body) {
  return new Promise((resolve) => {
    const res = { _s: 200, setHeader() {}, status(s) { this._s = s; return this; }, json(j) { resolve({ s: this._s, j }); }, end() { resolve({ s: this._s }); } };
    api({ method: 'POST', body }, res);
  });
}

(async () => {
  t('limpa acento e espaco', limparApelido(' Equipe Móviki ') === 'equipe-moviki');

  // ---- troca completa
  cenario();
  let r = await trocarApelido({ admin: fake.admin, db: fake.db, uid: 'U1', novo: 'Equipe Moviki', nome: 'Equipe Moviki', porUid: 'dono', gravarEspelho });
  t('troca ok', r.ok === true && r.novo === 'equipe-moviki' && r.antigo === 'paulopj');
  t('novo reservado', D('parceiro_slugs/equipe-moviki').uid === 'U1' && !D('parceiro_slugs/equipe-moviki').movidoPara);
  t('velho continua do mesmo dono', D('parceiro_slugs/paulopj').uid === 'U1' && D('parceiro_slugs/paulopj').movidoPara === 'equipe-moviki');
  t('cadastro', D('parceiros/U1').slug === 'equipe-moviki' && D('parceiros/U1').nome === 'Equipe Moviki'
    && D('parceiros/U1').slugsAnteriores.indexOf('paulopj') === 0 && D('parceiros/U1').apelidoTrocadoPor === 'dono');
  t('indicacoes migradas', r.indicacoes === 2 && D('indicacoes/L1').ref === 'equipe-moviki' && D('indicacoes/L3').ref === 'ana');
  t('parceiro de baixo migrado', r.parceiros === 1 && D('parceiros/U2').indicadoPor === 'equipe-moviki');
  t('espelho novo com nome novo', D('parceiros_publicos/equipe-moviki').nome === 'Equipe Moviki' && D('parceiros_publicos/equipe-moviki').ativo === true);
  const velho = D('parceiros_publicos/paulopj');
  t('espelho velho sem nome', velho.movidoPara === 'equipe-moviki' && velho.ativo === false && !velho.nome && !velho.foto);

  // ---- segunda troca achata a corrente
  r = await trocarApelido({ admin: fake.admin, db: fake.db, uid: 'U1', novo: 'moviki-oficial', nome: null, porUid: 'dono', gravarEspelho });
  t('segunda troca ok', r.ok === true);
  t('corrente achatada', D('parceiro_slugs/paulopj').movidoPara === 'moviki-oficial' && D('parceiro_slugs/equipe-moviki').movidoPara === 'moviki-oficial');
  t('espelho do primeiro aponta pro atual', D('parceiros_publicos/paulopj').movidoPara === 'moviki-oficial');
  t('nome mantido', D('parceiros/U1').nome === 'Equipe Moviki');
  t('indicacao seguiu', D('indicacoes/L1').ref === 'moviki-oficial');

  // ---- voltar para um apelido proprio antigo e permitido
  r = await trocarApelido({ admin: fake.admin, db: fake.db, uid: 'U1', novo: 'paulopj', nome: null, porUid: 'dono', gravarEspelho });
  t('volta ao proprio apelido', r.ok === true && D('parceiro_slugs/paulopj').uid === 'U1' && !D('parceiro_slugs/paulopj').movidoPara);
  t('volta sem auto-ponteiro', D('parceiros_publicos/paulopj').ativo === true && !D('parceiros_publicos/paulopj').movidoPara);

  // ---- recusas
  cenario();
  r = await trocarApelido({ admin: fake.admin, db: fake.db, uid: 'U1', novo: 'ana', gravarEspelho });
  t('ocupado por outro', r.ok === false && r.erro === 'ocupado' && D('parceiros/U1').slug === 'paulopj');
  r = await trocarApelido({ admin: fake.admin, db: fake.db, uid: 'U1', novo: 'lapide', gravarEspelho });
  t('lapide de excluido nao volta', r.erro === 'ocupado');
  r = await trocarApelido({ admin: fake.admin, db: fake.db, uid: 'U1', novo: 'fundador', gravarEspelho });
  t('reservado', r.erro === 'reservado');
  r = await trocarApelido({ admin: fake.admin, db: fake.db, uid: 'U1', novo: 'ab', gravarEspelho });
  t('curto', r.erro === 'apelido_invalido');
  r = await trocarApelido({ admin: fake.admin, db: fake.db, uid: 'U1', novo: 'paulopj', nome: 'Paulo PJ', gravarEspelho });
  t('nada mudou', r.erro === 'nada_mudou');
  r = await trocarApelido({ admin: fake.admin, db: fake.db, uid: 'U1', novo: '', nome: 'X', gravarEspelho });
  t('nome curto', r.erro === 'nome_curto');
  r = await trocarApelido({ admin: fake.admin, db: fake.db, uid: 'NAO', novo: 'zzz', gravarEspelho });
  t('sem parceiro', r.erro === 'sem_parceiro');
  t('nada gravado nas recusas', D('parceiro_slugs/paulopj').uid === 'U1' && !D('parceiro_slugs/paulopj').movidoPara && D('indicacoes/L1').ref === 'paulopj');

  // ---- so o nome
  r = await trocarApelido({ admin: fake.admin, db: fake.db, uid: 'U1', novo: '', nome: 'Moviki Equipe', gravarEspelho });
  t('so nome', r.ok === true && D('parceiros/U1').slug === 'paulopj' && D('parceiros_publicos/paulopj').nome === 'Moviki Equipe');

  // ---- parceiro recusado sem espelho nao ganha espelho
  cenario();
  store.set('parceiros/U3', { nome: 'Rec', slug: 'rec', status: 'recusado' });
  store.set('parceiro_slugs/rec', { uid: 'U3' });
  r = await trocarApelido({ admin: fake.admin, db: fake.db, uid: 'U3', novo: 'rec2', gravarEspelho });
  t('recusado sem espelho', r.ok === true && r.espelho === 'sem_espelho' && !D('parceiros_publicos/rec2'));

  // ---- cron: indicacao nova pelo link velho
  cenario();
  await trocarApelido({ admin: fake.admin, db: fake.db, uid: 'U1', novo: 'time-moviki', gravarEspelho });
  store.set('indicacoes/L9', { ref: 'paulopj' });
  store.set('parceiros/U9', { nome: 'Novo', slug: 'novo9', indicadoPor: 'paulopj' });
  const n = await normalizarApelidos({ db: fake.db });
  t('cron normaliza', n.indicacoes === 1 && n.parceiros === 1 && D('indicacoes/L9').ref === 'time-moviki' && D('parceiros/U9').indicadoPor === 'time-moviki');

  // ---- endpoint: so admin
  cenario();
  let x = await chamar({ idToken: 'U2', uid: 'U1', acao: 'trocar_apelido', novo: 'hack' });
  t('nao admin barrado', x.s === 403 && D('parceiros/U1').slug === 'paulopj');
  x = await chamar({ idToken: 'ruim', uid: 'U1', acao: 'trocar_apelido', novo: 'hack' });
  t('token ruim', x.s === 401);
  x = await chamar({ idToken: 'dono', uid: 'U1', acao: 'trocar_apelido', novo: 'ana' });
  t('endpoint ocupado 409', x.s === 409 && x.j.erro === 'ocupado');
  x = await chamar({ idToken: 'dono', uid: 'U1', acao: 'trocar_apelido', novo: 'time-moviki', nome: 'Equipe Moviki' });
  t('endpoint troca', x.s === 200 && x.j.ok && x.j.novo === 'time-moviki' && D('parceiros/U1').slug === 'time-moviki');

  console.log(ok + ' OK, ' + falhou + ' falhou');
  process.exit(falhou ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
