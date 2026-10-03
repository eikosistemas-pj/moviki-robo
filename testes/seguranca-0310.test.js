'use strict';
// Teste da rodada de seguranca de 03/10/2026. Sem internet e sem Firebase:
// cd moviki-robo && node testes/seguranca-0310.test.js
process.env.CHECKOUT_CHAVE = 'uma-frase-longa-e-aleatoria-de-teste-1234567890';
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
const apagados = [];
fake.admin.storage = () => ({ bucket: () => ({
  name: 'b',
  file: (p) => ({ save: async () => {}, delete: async () => { apagados.push(p); }, getSignedUrl: async () => ['https://x'] }),
}) });
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'x', filename: 'x', loaded: true, exports: { admin: fake.admin, db: fake.db } };
const { store } = fake;
let falhas = 0, ok = 0;
function conf(c, msg) { if (c) ok++; else { falhas++; console.log('FALHOU:', msg); } }

(async () => {
  // 1. segredo em tempo constante
  const { segredoConfere, bearerConfere } = require(path.join(ROBO, 'lib/segredo.js'));
  conf(segredoConfere('abc', 'abc') === true, 'segredo igual passa');
  conf(segredoConfere('abd', 'abc') === false, 'segredo diferente nao passa');
  conf(segredoConfere('', '') === false, 'segredo vazio nunca passa');
  conf(segredoConfere('abc', undefined) === false, 'env ausente nunca passa');
  conf(bearerConfere({ headers: { authorization: 'Bearer s3gr3d0' } }, 's3gr3d0') === true, 'Bearer certo passa');
  conf(bearerConfere({ headers: { authorization: 's3gr3d0' } }, 's3gr3d0') === false, 'sem Bearer nao passa');
  conf(bearerConfere({ headers: {} }, 's3gr3d0') === false, 'sem cabecalho nao passa');

  // 2. freio: fecha por padrao, abre so quando pedido
  const { freioUid } = require(path.join(ROBO, 'lib/freio.js'));
  store.clear();
  let n = 0; for (let i = 0; i < 5; i++) if (await freioUid(fake.admin, fake.db, 't', 'u1', 3, 3600000)) n++;
  conf(n === 3, 'freio segura no teto (' + n + ')');
  const dbQuebrado = { collection: fake.db.collection, runTransaction: async () => { throw new Error('fora'); } };
  conf(await freioUid(fake.admin, dbQuebrado, 't', 'u2', 3, 3600000) === false, 'freio com Firestore fora recusa');
  conf(await freioUid(fake.admin, dbQuebrado, 't', 'u2', 3, 3600000, { falhaAberta: true }) === true, 'contador global com falhaAberta deixa passar');

  // 3. video-capa: redirecionamento para fora do TikTok nao e seguido; freio por conta
  const chamadas = [];
  global.fetch = async (u, o) => {
    chamadas.push(u);
    if (/tiktok\.com\/oembed/.test(u)) return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ thumbnail_url: 'https://p16.tiktokcdn.com/img.jpg' }) };
    if (/tiktokcdn/.test(u)) return { ok: false, status: 302, headers: { get: () => 'http://169.254.169.254/latest/meta-data/' } };
    throw new Error('fora da lista: ' + u);
  };
  const capa = require(path.join(ROBO, 'api/video-capa.js'));
  function resFake() { const r = { c: 0, j: null, setHeader() {}, status(c) { r.c = c; return r; }, json(j) { r.j = j; return r; }, end() { return r; } }; return r; }
  store.clear();
  let r = resFake();
  await capa({ method: 'POST', body: { idToken: 'lojA', url: 'https://www.tiktok.com/@loja/video/123' } }, r);
  conf(r.j && r.j.ok === false, 'capa recusada quando a imagem redireciona para fora');
  conf(!chamadas.some((u) => /169\.254/.test(u)), 'robo nunca chamou o endereco interno');
  store.clear();
  let barrada = 0;
  for (let i = 0; i < 32; i++) { const x = resFake(); await capa({ method: 'POST', body: { idToken: 'lojB', url: 'https://www.tiktok.com/@loja/video/123' } }, x); if (x.j && x.j.motivo === 'freio') barrada++; }
  conf(barrada === 2, 'capa: 30 por hora, a 31a e barrada (' + barrada + ')');

  // 4. comprovante: no maximo 3 por pedido, o anterior e apagado
  const ck = require(path.join(ROBO, 'lib/checkout.js'));
  const crypto = require('crypto');
  const segredo = 'segredoDoPedido123';
  store.clear();
  store.set('pedidos/PEDIDO0000000001', { modo: 'pix', status: 'aguardando', lojistaUid: 'L1', segredoHash: crypto.createHash('sha256').update(segredo).digest('hex'), expiraEm: null });
  const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(800, 1)]).toString('base64');
  const res = [];
  for (let i = 0; i < 4; i++) res.push(await ck._t.compraPaguei({ pedidoId: 'PEDIDO0000000001', chave: segredo, comprovanteBase64: png }));
  const p = store.get('pedidos/PEDIDO0000000001');
  conf(res[0].ok && res[1].ok && res[2].ok, 'tres comprovantes entram (' + JSON.stringify(res.slice(0, 3).map((x) => x.erro || x.ok)) + ')');
  conf(res[3].erro === 'comprovante_limite', 'quarto comprovante e recusado');
  conf(p.comprovantesN === 3, 'contador gravado (' + p.comprovantesN + ')');
  conf(apagados.length === 2, 'comprovantes anteriores apagados (' + apagados.length + ')');
  const semArquivo = await ck._t.compraPaguei({ pedidoId: 'PEDIDO0000000001', chave: segredo });
  conf(semArquivo.ok === true, '"Ja paguei" sem arquivo continua funcionando depois do limite');

  // 5. acao de dono so com sessao do Google
  const { conferirAdmin } = require(path.join(ROBO, 'lib/admin.js'));
  store.clear();
  store.set('admins/DONO1', {});
  conf((await conferirAdmin(fake.db, { uid: 'DONO1', firebase: { sign_in_provider: 'google.com' } })).ok === true, 'dono pelo Google passa');
  const porSenha = await conferirAdmin(fake.db, { uid: 'DONO1', firebase: { sign_in_provider: 'password' } });
  conf(porSenha.ok === false && porSenha.erro === 'entre_com_google' && porSenha.status === 403, 'dono por senha e recusado');
  conf((await conferirAdmin(fake.db, { uid: 'OUTRO', firebase: { sign_in_provider: 'google.com' } })).erro === 'nao_admin', 'Google sem admins/ e recusado');
  process.env.ADMIN_ACEITA_SENHA = '1';
  conf((await conferirAdmin(fake.db, { uid: 'DONO1', firebase: { sign_in_provider: 'password' } })).ok === true, 'emergencia ADMIN_ACEITA_SENHA libera a senha');
  delete process.env.ADMIN_ACEITA_SENHA;
  // nas portas de verdade
  fake.admin.auth = () => ({ verifyIdToken: async (t) => ({ uid: 'DONO1', firebase: { sign_in_provider: t } }), getUser: async () => ({}) });
  const portas = [
    ['api/pagar-saque.js', (t) => ({ idToken: t, saqueId: 'S1', etapa: 'conferir' })],
    ['api/exclusoes.js', (t) => ({ idToken: t, action: 'listar' })],
    ['api/parceiro-aprovado.js', (t) => ({ idToken: t, uid: 'PARC1' })],
  ];
  for (const [arq, corpo] of portas) {
    const h = require(path.join(ROBO, arq));
    const r1 = resFake(); await h({ method: 'POST', headers: { origin: 'https://app.moviki.com.br' }, body: corpo('password') }, r1);
    conf(r1.c === 403 && r1.j && r1.j.erro === 'entre_com_google', arq + ': senha recusada (' + r1.c + ' ' + JSON.stringify(r1.j) + ')');
    const r2 = resFake(); await h({ method: 'POST', headers: { origin: 'https://app.moviki.com.br' }, body: corpo('google.com') }, r2);
    conf(!(r2.j && r2.j.erro === 'entre_com_google') && r2.c !== 403, arq + ': Google passa do portao (' + r2.c + ')');
  }

  // checkout (adm_*) e live (live_adm_*)
  const fin = require(path.join(ROBO, 'api/financeiro.js'));
  for (const acao of ['adm_asaas', 'adm_wh_rotacionar', 'adm_entrega']) {
    const r = resFake(); await fin({ method: 'POST', headers: { origin: 'https://app.moviki.com.br' }, body: { acao, idToken: 'password', uid: 'LOJAAAAAAAAAAA1' } }, r);
    conf(r.c === 403 && r.j.erro === 'entre_com_google', 'financeiro ' + acao + ': senha recusada (' + r.c + ' ' + JSON.stringify(r.j) + ')');
  }
  const pts = require(path.join(ROBO, 'api/pontos.js'));
  for (const acao of ['live_adm_noar', 'live_adm_fechar']) {
    const r = resFake(); await pts({ method: 'POST', headers: { origin: 'https://app.moviki.com.br' }, body: { acao, idToken: 'password', uid: 'LOJAAAAAAAAAAA1' } }, r);
    conf(r.c === 403 && r.j.erro === 'entre_com_google', 'pontos ' + acao + ': senha recusada (' + r.c + ' ' + JSON.stringify(r.j) + ')');
  }

  console.log('\nOK ' + ok + ' / FALHAS ' + falhas);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
