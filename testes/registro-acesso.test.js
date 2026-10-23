'use strict';
// Teste do registro de acesso do Marco Civil (22/10/2026).
// Sem internet e sem Firebase: cd moviki-robo && node testes/registro-acesso.test.js
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');

const SESSOES = {
  tLoja: { uid: 'LojaAAAAAAAAAAAAAAAA', firebase: { sign_in_provider: 'password' } },
  tDono: { uid: 'DonoBBBBBBBBBBBBBBBB', firebase: { sign_in_provider: 'google.com' } },
  tSenha: { uid: 'DonoBBBBBBBBBBBBBBBB', firebase: { sign_in_provider: 'password' } },
};
fake.admin.auth = () => ({ verifyIdToken: async (t) => { if (!SESSOES[t]) throw new Error('token'); return SESSOES[t]; } });
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'x', filename: 'x', loaded: true, exports: { admin: fake.admin, db: fake.db } };

const RA = require(path.join(ROBO, 'lib/registroAcesso.js'));
const h = require(path.join(ROBO, 'api/acesso.js'));
let falhas = 0, ok = 0;
function conf(c, msg) { if (c) ok++; else { falhas++; console.log('FALHOU:', msg); } }
function res() { return { c: 0, b: null, h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.c = c; return this; }, json(b) { this.b = b; return this; }, end() { return this; } }; }
async function post(body, headers) {
  const r = res();
  await h({ method: 'POST', headers: Object.assign({ origin: 'https://app.moviki.com.br', 'x-vercel-forwarded-for': '200.10.20.30', 'x-forwarded-for': '200.10.20.30' }, headers || {}), body }, r);
  return r;
}
function registros() { const out = []; for (const [p, d] of fake.store) if (p.startsWith('registros_acesso/')) out.push(d); return out; }

(async () => {
  // 1) sem token -> 401, nada gravado
  let r = await post({ acao: 'sessao', painel: '/index' });
  conf(r.c === 401, 'sem token -> 401');
  conf(registros().length === 0, 'sem token nao grava');

  // 2) sessao valida grava IP COMPLETO, uid do token (nunca do corpo), painel e UTC
  r = await post({ acao: 'sessao', t: 'tLoja', painel: '/index', uid: 'OutroCCCCCCCCCCCCCCC' });
  conf(r.c === 200 && r.b.ok === true, 'sessao valida -> ok');
  let regs = registros();
  conf(regs.length === 1, '1 registro');
  conf(regs[0].ip === '200.10.20.30', 'IP completo, nao abreviado');
  conf(regs[0].uid === 'LojaAAAAAAAAAAAAAAAA', 'uid vem do token, nao do corpo');
  conf(regs[0].app === 'painel' && regs[0].evento === 'sessao', 'painel e evento');
  conf(/Z$/.test(regs[0].emIso) && regs[0].fuso === 'UTC', 'data e hora em UTC');
  conf(regs[0].porta === null, 'porta null quando a hospedagem nao informa');
  const guarda = regs[0].apagarEm.toMillis() - regs[0].em.toMillis();
  conf(guarda >= 183 * 86400000 && guarda <= 185 * 86400000, 'apaga em ~6 meses');

  // 3) mesma sessao, mesmo IP, dentro de 30 min -> nao duplica
  await post({ acao: 'sessao', t: 'tLoja', painel: '/index' });
  conf(registros().length === 1, 'dedup na janela de 30 min');

  // 4) IP diferente -> novo registro; painel do parceiro reconhecido
  await post({ acao: 'sessao', t: 'tLoja', painel: '/parceiro' }, { 'x-vercel-forwarded-for': '2804:14c:1:2::5', 'x-forwarded-for': '2804:14c:1:2::5' });
  regs = registros();
  conf(regs.length === 2, 'IP novo gera registro');
  conf(regs.some((x) => x.ip === '2804:14c:1:2::5' && x.app === 'parceiro'), 'IPv6 e parceiro');

  // 5) IP lixo nao grava
  const okLixo = await RA.registrar(fake.admin, fake.db, { headers: { 'x-vercel-forwarded-for': '<script>' } }, { evento: 'sessao' });
  conf(okLixo === false, 'IP invalido nao grava');

  // 6) porta de cliente gravada quando informada; 443 descartada
  conf(RA.portaDe({ headers: { 'x-client-port': '51234' } }) === 51234, 'porta do cliente');
  conf(RA.portaDe({ headers: { 'x-forwarded-port': '443' } }) === null, '443 e do servidor, nao grava');

  // 7) evento de visitante (sem uid) nao deduplica
  await RA.registrar(fake.admin, fake.db, { headers: { 'x-vercel-forwarded-for': '177.1.2.3' } }, { app: 'avaliacao', evento: 'avaliacao', alvo: 'LojaAAAAAAAAAAAAAAAA' });
  await RA.registrar(fake.admin, fake.db, { headers: { 'x-vercel-forwarded-for': '177.1.2.3' } }, { app: 'avaliacao', evento: 'avaliacao', alvo: 'LojaAAAAAAAAAAAAAAAA' });
  conf(registros().filter((x) => x.ip === '177.1.2.3').length === 2, 'evento grava cada um');

  // 8) consulta: lojista nao pode; dono por senha nao pode; dono Google pode
  r = await post({ acao: 'adm_consulta', t: 'tLoja', dados: { uid: 'LojaAAAAAAAAAAAAAAAA' } });
  conf(r.c === 403, 'lojista nao consulta');
  await fake.db.collection('admins').doc('DonoBBBBBBBBBBBBBBBB').set({ ok: true });
  r = await post({ acao: 'adm_consulta', t: 'tSenha', dados: { uid: 'LojaAAAAAAAAAAAAAAAA' } });
  conf(r.c === 403 && r.b.erro === 'entre_com_google', 'dono por senha nao consulta');
  r = await post({ acao: 'adm_consulta', t: 'tDono', dados: { uid: 'LojaAAAAAAAAAAAAAAAA' } });
  conf(r.c === 200 && r.b.total === 2, 'dono consulta por uid');
  r = await post({ acao: 'adm_consulta', t: 'tDono', dados: { ip: '177.1.2.3' } });
  conf(r.c === 200 && r.b.total === 2, 'dono consulta por ip');
  r = await post({ acao: 'adm_consulta', t: 'tDono', dados: {} });
  conf(r.c === 400, 'consulta sem filtro recusada');
  let trilha = 0; for (const [p] of fake.store) if (p.startsWith('registros_acesso_trilha/')) trilha++;
  conf(trilha >= 3, 'toda consulta do dono fica na trilha');

  // 9) varredura apaga so o vencido, respeita retido e roda 1x por hora
  const TS = fake.Timestamp;
  await fake.db.collection('registros_acesso').doc('velho1').set({ ip: '1.1.1.1', apagarEm: TS.fromMillis(Date.now() - 1000) });
  await fake.db.collection('registros_acesso').doc('retido1').set({ ip: '1.1.1.2', apagarEm: TS.fromMillis(Date.now() - 1000) });
  r = await post({ acao: 'adm_reter', t: 'tDono', dados: { ids: ['retido1'], ateMs: Date.now() + 30 * 86400000, motivo: 'oficio 123' } });
  conf(r.c === 200 && r.b.retidos === 1, 'ordem cautelar retem');
  const v = await RA.varrer(fake.admin, fake.db, 100);
  conf(v.apagados === 1, 'varredura apagou so o vencido');
  conf(!fake.store.has('registros_acesso/velho1') && fake.store.has('registros_acesso/retido1'), 'retido sobrevive');
  const v2 = await RA.varrer(fake.admin, fake.db, 100);
  conf(v2.pulado === true, 'varredura segura a si mesma 1x por hora');

  // 10) metodo e CORS
  const rg = res(); await h({ method: 'GET', headers: {} }, rg);
  conf(rg.c === 405, 'GET recusado');

  console.log(ok + ' ok, ' + falhas + ' falha(s)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
