'use strict';
// Teste da avaliacao pelo robo (06/10/2026, plano de seguranca 2.2).
// Sem internet e sem Firebase: cd moviki-robo && node testes/avaliacao.test.js
process.env.CHECKOUT_CHAVE = 'uma-frase-longa-e-aleatoria-de-teste-1234567890';
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');

// sessoes falsas: 'tLoja' = lojista dono do negocio; 'tDono' = admin pelo Google; 'tSenha' = admin por senha
const SESSOES = {
  tLoja: { uid: 'LojaAAAAAAAAAAAAAAAA', firebase: { sign_in_provider: 'password' } },
  tDono: { uid: 'DonoBBBBBBBBBBBBBBBB', firebase: { sign_in_provider: 'google.com' } },
  tSenha: { uid: 'DonoBBBBBBBBBBBBBBBB', firebase: { sign_in_provider: 'password' } },
};
fake.admin.auth = () => ({ verifyIdToken: async (t) => { if (!SESSOES[t]) throw new Error('token'); return SESSOES[t]; } });
fake.admin.appCheck = () => ({ verifyToken: async (t) => { if (t !== 'APPCHECK_OK') { const e = new Error('invalid'); e.code = 'app-check/invalid-argument'; throw e; } return { appId: '1:x:web:y' }; } });
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'x', filename: 'x', loaded: true, exports: { admin: fake.admin, db: fake.db } };

const h = require(path.join(ROBO, 'api/avaliacao.js'));
let falhas = 0, ok = 0;
function conf(c, msg) { if (c) ok++; else { falhas++; console.log('FALHOU:', msg); } }
function res() { return { c: 0, b: null, h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.c = c; return this; }, json(b) { this.b = b; return this; }, end() { return this; } }; }
async function post(body, headers, ip) {
  const r = res();
  await h({ method: 'POST', headers: Object.assign({ origin: 'https://moviki.com.br', 'x-forwarded-for': ip || '1.1.1.1', 'user-agent': 'ua' }, headers || {}), body }, r);
  return r;
}
const NEG = 'LojaAAAAAAAAAAAAAAAA';
const AC = { 'x-firebase-appcheck': 'APPCHECK_OK' };

(async () => {
  await fake.db.collection('negocios').doc(NEG).set({ nome: 'Loja Teste', slug: 'loja-teste' });
  await fake.db.collection('admins').doc('DonoBBBBBBBBBBBBBBBB').set({ ok: true });

  // 1) sem App Check: 401, nada gravado
  let r = await post({ acao: 'criar', negocio: NEG, nota: 5, nome: 'Ana Maria', comentario: 'Otimo', aparelho: 'ap1' });
  conf(r.c === 401 && r.b.erro === 'appcheck', 'sem App Check -> 401');
  let qs = await fake.db.collection('negocios').doc(NEG).collection('avaliacoes').get();
  conf(qs.size === 0, 'sem App Check nao grava');

  // 2) com App Check: grava avaliacao e resumo
  r = await post({ acao: 'criar', negocio: NEG, nota: 5, nome: 'Ana Maria', comentario: 'Otimo', aparelho: 'ap1' }, AC);
  conf(r.c === 200 && r.b.ok && /^[A-Za-z0-9]{20}$/.test(r.b.id), 'cria com App Check (id formato addDoc)');
  const id1 = r.b.id;
  let rs = (await fake.db.collection('negocios').doc(NEG).collection('resumo').doc('avaliacoes').get()).data();
  conf(rs && rs.n === 1 && rs.soma === 5 && rs.ultimaAv === id1, 'resumo n=1 soma=5');
  const av1 = (await fake.db.collection('negocios').doc(NEG).collection('avaliacoes').doc(id1).get()).data();
  conf(av1 && av1.nota === 5 && av1.nome === 'Ana Maria' && !('ip' in av1) && typeof av1.apHash === 'string', 'avaliacao sem IP em claro, com apHash');

  // 3) mesmo aparelho, mesmo negocio: recusado (ja avaliou)
  r = await post({ acao: 'criar', negocio: NEG, nota: 1, nome: 'Ana Maria', aparelho: 'ap1' }, AC, '2.2.2.2');
  conf(r.c === 429 && r.b.erro === 'ja_avaliou', 'mesmo aparelho -> ja_avaliou');

  // 4) aparelhos diferentes, mesmo IP: a 6a por hora cai no freio de IP
  let ultima;
  for (let i = 2; i <= 7; i++) ultima = await post({ acao: 'criar', negocio: NEG, nota: 4, nome: 'Pessoa ' + i, aparelho: 'ap' + i }, AC, '3.3.3.3');
  conf(ultima.c === 429 && ultima.b.erro === 'freio', '6a avaliacao do mesmo IP na hora -> freio');
  qs = await fake.db.collection('negocios').doc(NEG).collection('avaliacoes').get();
  conf(qs.size === 6, '1 + 5 avaliacoes gravadas (a 6a do IP nao)');

  // 5) termo proibido
  r = await post({ acao: 'criar', negocio: NEG, nota: 3, nome: 'Zeca', comentario: 'vende cocaina aqui', aparelho: 'apX' }, AC, '4.4.4.4');
  conf(r.c === 400 && r.b.erro === 'termo', 'termo grave -> 400');

  // 6) nota invalida / negocio inexistente
  r = await post({ acao: 'criar', negocio: NEG, nota: 7, nome: 'Zeca', aparelho: 'apY' }, AC, '5.5.5.5');
  conf(r.c === 400 && r.b.erro === 'nota', 'nota 7 -> 400');
  r = await post({ acao: 'criar', negocio: 'NaoExisteAAAAAAAAAAAA', nota: 5, nome: 'Zeca', aparelho: 'apZ' }, AC, '6.6.6.6');
  conf(r.c === 404, 'negocio inexistente -> 404');

  // 7) denunciar: so o dono do negocio, so avaliacao dele
  r = await post({ acao: 'denunciar', idToken: 'tLoja', avId: id1, motivo: 'concorrente', detalhe: 'nunca comprou' });
  conf(r.c === 200 && r.b.ok && r.b.status === 'aberta', 'lojista denuncia a propria avaliacao');
  const den = (await fake.db.collection('denuncias_avaliacao').doc(NEG + '_' + id1).get()).data();
  conf(den && den.status === 'aberta' && den.negocioUid === NEG && den.nota === 5, 'denuncia gravada com snapshot');
  r = await post({ acao: 'denunciar', idToken: 'tLoja', avId: id1, motivo: 'spam' });
  conf(r.c === 200 && r.b.ja === true, 'denunciar de novo nao duplica');
  r = await post({ acao: 'denunciar', idToken: 'tLoja', avId: 'AAAAAAAAAAAAAAAAAAAA', motivo: 'spam' });
  conf(r.c === 404, 'avaliacao de outro/inexistente -> 404');
  r = await post({ acao: 'denunciar', idToken: 'xxx', avId: id1 });
  conf(r.c === 401, 'sem sessao -> 401');

  // 8) dono: por senha nao; por Google sim
  r = await post({ acao: 'adm_lista', idToken: 'tSenha' });
  conf(r.c === 403 && r.b.erro === 'entre_com_google', 'dono por senha -> 403');
  r = await post({ acao: 'adm_lista', idToken: 'tDono' });
  conf(r.c === 200 && r.b.itens.length === 1 && r.b.itens[0].avId === id1, 'adm_lista traz a denuncia aberta');

  // 9) apagar recalcula o resumo
  r = await post({ acao: 'adm_apagar', idToken: 'tDono', negocioUid: NEG, avId: id1 });
  conf(r.c === 200 && r.b.status === 'apagada' && r.b.resumo.n === 5 && r.b.resumo.soma === 20, 'apagar recalcula: 5 avaliacoes nota 4 = 20');
  rs = (await fake.db.collection('negocios').doc(NEG).collection('resumo').doc('avaliacoes').get()).data();
  conf(rs.n === 5 && rs.soma === 20, 'resumo no banco recalculado');
  conf(!(await fake.db.collection('negocios').doc(NEG).collection('avaliacoes').doc(id1).get()).exists, 'avaliacao apagada');
  r = await post({ acao: 'adm_lista', idToken: 'tDono' });
  conf(r.c === 200 && r.b.itens.length === 0, 'fila vazia depois de decidir');

  // 10) manter e recalcular
  await fake.db.collection('denuncias_avaliacao').doc(NEG + '_BBBBBBBBBBBBBBBBBBBB').set({ negocioUid: NEG, avId: 'BBBBBBBBBBBBBBBBBBBB', status: 'aberta' });
  r = await post({ acao: 'adm_manter', idToken: 'tDono', negocioUid: NEG, avId: 'BBBBBBBBBBBBBBBBBBBB' });
  conf(r.c === 200 && r.b.status === 'mantida', 'manter');
  await fake.db.collection('negocios').doc(NEG).collection('resumo').doc('avaliacoes').set({ n: 2000, soma: 10000 });
  r = await post({ acao: 'adm_recalcular', idToken: 'tDono', negocioUid: NEG });
  conf(r.c === 200 && r.b.resumo.n === 5 && r.b.resumo.soma === 20, 'recalcular conserta resumo torto');

  // 11) acao desconhecida e metodo errado
  r = await post({ acao: 'zzz' });
  conf(r.c === 400, 'acao desconhecida -> 400');
  const g = res(); await h({ method: 'GET', headers: {} }, g);
  conf(g.c === 405, 'GET -> 405');

  console.log(falhas ? ('FALHAS: ' + falhas) : ('OK (' + ok + ' conferencias)'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.log('ERRO', e); process.exit(1); });
