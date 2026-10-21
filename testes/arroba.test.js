'use strict';
// Teste da trava do @ do parceiro (13/10/2026, P80).
// Sem internet e sem Firebase: cd moviki-robo && node testes/arroba.test.js
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');

let falhas = 0, ok = 0;
function confere(nome, cond) { if (cond) ok++; else { falhas++; console.error('FALHOU:', nome); } }

// ---------------------------------------------------------------- unidade
const arr = require(path.join(ROBO, 'lib/arrobaParceiro.js'));

[['TikTok', true], ['@tiktok', true], ['tiktok.oficial', true], ['tik_tok_brasil', true], ['TIKTOKBR', true],
 ['instagram', true], ['https://www.instagram.com/facebook/', true], ['moviki', true], ['moviki.app', true],
 ['asaas', true], ['nike', true], ['oficialnike', true], ['whatsapp_suporte', true], ['twitter.br', true], ['interiorana', false],
 ['joaodatiktok', false], ['metalurgicasilva', false], ['carlosmendes', false], ['maria.doces', false], ['', false]]
  .forEach(([a, esp]) => confere('reservado(' + a + ') = ' + esp, arr.reservado(a) === esp));

confere('contem plataforma vai para revisao', arr.motivosRevisao({ arroba: 'lojinhadotiktok' }).indexOf('marca') >= 0);
confere('meta dentro de metalurgica nao e marca', arr.motivosRevisao({ arroba: 'metalurgicasilva' }).length === 0);
confere('verificado vai para revisao', arr.motivosRevisao({ arroba: 'fulano', igVerificado: true }).indexOf('verificado') >= 0);
confere('conta grande vai para revisao', arr.motivosRevisao({ arroba: 'fulano', igSeguidores: 50000 }).indexOf('grande') >= 0);
confere('conta pequena nao vai', arr.motivosRevisao({ arroba: 'fulano', igSeguidores: 49999 }).length === 0);

confere('sem @ pode auto', arr.podeAutoAprovar({}) === true);
confere('@ sem prova nao pode auto', arr.podeAutoAprovar({ arroba: '@fulano' }) === false);
confere('@ com prova pode auto', arr.podeAutoAprovar({ arroba: '@Fulano', igConfirmado: true, igConfirmadoArroba: 'fulano' }) === true);
confere('prova de OUTRO @ nao vale', arr.podeAutoAprovar({ arroba: '@outro', igConfirmado: true, igConfirmadoArroba: 'fulano' }) === false);
confere('com prova mas verificado nao pode auto', arr.podeAutoAprovar({ arroba: 'fulano', igConfirmado: true, igConfirmadoArroba: 'fulano', igVerificado: true }) === false);

const cod = arr.gerarCodigo();
confere('codigo no formato MVK-0000', /^MVK-\d{4}$/.test(cod));
confere('bio com o codigo', arr.bioTemCodigo('Doces caseiros • ' + cod + ' • JP', cod));
confere('bio com codigo minusculo e espacado', arr.bioTemCodigo('mvk - ' + cod.slice(4), cod));
confere('bio sem o codigo', !arr.bioTemCodigo('Doces caseiros', cod));

// ---------------------------------------------------------------- integracao
// Meta falsa: perfis e bios.
const PERFIS = {
  tiktok: { nome: 'TikTok', seguidores: 9000000, verificado: true, bio: 'Make your day' },
  fulano: { nome: 'Fulano', seguidores: 1200, verificado: false, bio: 'Artesanato' },
  famoso: { nome: 'Famoso', seguidores: 800000, verificado: true, bio: '' },
};
let chamadasMeta = 0;
const igFalso = {
  limparArroba: (a) => arr.normalizar(a).replace(/[^a-z0-9._]/g, ''),
  buscarPerfil: async (_a, _d, bruto, o) => {
    chamadasMeta++;
    const a = arr.normalizar(bruto);
    const x = PERFIS[a];
    if (!x) return { ok: true, achou: false, motivo: 'nao_profissional' };
    return { ok: true, achou: true, arroba: a, nome: x.nome, foto: '', seguidores: x.seguidores, posts: 10, verificado: x.verificado, bio: (o && o.comBio) ? x.bio : undefined };
  },
};
const TELEGRAM = [];
process.env.TELEGRAM_TOKEN = 't'; process.env.TELEGRAM_CHAT_ID = 'c'; process.env.CRON_SECRET = 'segredo-do-cron-de-teste-123';
global.fetch = async (url, op) => { if (String(url).indexOf('api.telegram.org') >= 0) TELEGRAM.push(JSON.parse(op.body).text); return { ok: true, json: async () => ({}), text: async () => '' }; };

const mock = (rel, exp) => { const f = require.resolve(path.join(ROBO, rel)); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp }; };
mock('lib/firebase.js', { admin: fake.admin, db: fake.db });
mock('lib/instagram.js', igFalso);
mock('lib/meta.js', { lead: async () => {}, ultimoTexto: () => '' });
mock('lib/boasVindasParceiro.js', { enviarBoasVindasParceiro: async () => ({ ok: true }) });
fake.admin.auth = () => ({ verifyIdToken: async (t) => ({ uid: t }) });

const h = require(path.join(ROBO, 'api/novo-parceiro.js'));
function chamar(query, body, headers) {
  return new Promise((resolve) => {
    const res = { _s: 200, _h: {}, setHeader(k, v) { this._h[k] = v; }, status(c) { this._s = c; return this; },
      json(j) { resolve({ status: this._s, j }); }, end() { resolve({ status: this._s, j: null }); } };
    h({ method: body ? 'POST' : 'GET', query: query || {}, body: body || {}, headers: Object.assign({ origin: 'https://app.moviki.com.br' }, headers || {}) }, res);
  });
}
const P = (uid) => fake.store.get('parceiros/' + uid);
function novoParceiro(uid, dados) {
  fake.store.set('parceiros/' + uid, Object.assign({ nome: 'Nome ' + uid, slug: uid.toLowerCase(), status: 'pendente', criadoEm: fake.Timestamp.fromMillis(Date.now() - 3600000) }, dados));
}

(async () => {
  fake.store.set('configuracoes/sistema', { aprovacaoAutomaticaParceiros: true });

  // 1) o cartao do quiz nao mostra o @ reservado e nem consulta a Meta
  chamadasMeta = 0;
  let r = await chamar({ instagram: 'TikTok' });
  confere('quiz: @tiktok sai como reservado', r.j && r.j.achou === false && r.j.motivo === 'reservado');
  confere('quiz: reservado nao gasta Meta', chamadasMeta === 0);

  // 2) cadastro com @ reservado e recusado na hora
  novoParceiro('UidTiktok0000000000a', { arroba: '@TikTok' });
  r = await chamar({}, { idToken: 'UidTiktok0000000000a', uid: 'UidTiktok0000000000a' });
  confere('cadastro TikTok responde recusado', r.j && r.j.status === 'recusado');
  confere('cadastro TikTok gravado recusado', P('UidTiktok0000000000a').status === 'recusado' && P('UidTiktok0000000000a').recusaMotivo === 'arroba_reservado');
  confere('cadastro TikTok sem selo gravado', P('UidTiktok0000000000a').igVerificado === undefined);
  confere('Telegram avisou a recusa', TELEGRAM.some(t => t.indexOf('RECUSADO') >= 0));

  // 3) cadastro normal: carimba, mas nao entra na aprovacao automatica sem prova
  novoParceiro('UidFulano0000000000a', { arroba: '@fulano' });
  r = await chamar({}, { idToken: 'UidFulano0000000000a', uid: 'UidFulano0000000000a' });
  confere('cadastro fulano segue pendente', P('UidFulano0000000000a').status === 'pendente');
  confere('Telegram fala da prova de posse', TELEGRAM.some(t => t.indexOf('prova de posse') >= 0));
  r = await chamar({ processarPendentes: '1' }, null, { authorization: 'Bearer segredo-do-cron-de-teste-123' });
  confere('varredura NAO aprova @ sem prova', P('UidFulano0000000000a').status === 'pendente');
  confere('auditoria unica rodou', r.j && r.j.auditoria && r.j.auditoria.parceiros >= 2);
  const r2 = await chamar({ processarPendentes: '1' }, null, { authorization: 'Bearer segredo-do-cron-de-teste-123' });
  confere('auditoria nao roda duas vezes', r2.j && r2.j.auditoria === null);

  // 4) prova de posse
  r = await chamar({ posse: '1' }, { idToken: 'UidFulano0000000000a', acao: 'conferir' });
  confere('conferir sem codigo pede codigo', r.j && r.j.motivo === 'sem_codigo');
  r = await chamar({ posse: '1' }, { idToken: 'UidFulano0000000000a', acao: 'codigo' });
  const codigo = r.j && r.j.codigo;
  confere('codigo gerado', /^MVK-\d{4}$/.test(codigo || ''));
  const r3 = await chamar({ posse: '1' }, { idToken: 'UidFulano0000000000a', acao: 'codigo' });
  confere('mesmo codigo reaproveitado', r3.j && r3.j.codigo === codigo);
  r = await chamar({ posse: '1' }, { idToken: 'UidFulano0000000000a', acao: 'conferir' });
  confere('bio sem o codigo nao confirma', r.j && r.j.motivo === 'codigo_nao_achado' && P('UidFulano0000000000a').igConfirmado !== true);
  PERFIS.fulano.bio = 'Artesanato • ' + codigo;
  r = await chamar({ posse: '1' }, { idToken: 'UidFulano0000000000a', acao: 'conferir' });
  confere('bio com o codigo confirma', r.j && r.j.confirmado === true);
  confere('cadastro marcado confirmado para o @ certo', P('UidFulano0000000000a').igConfirmado === true && P('UidFulano0000000000a').igConfirmadoArroba === 'fulano');
  confere('codigo apagado depois da prova', !fake.store.get('ig_posse/UidFulano0000000000a'));
  await chamar({ processarPendentes: '1' }, null, { authorization: 'Bearer segredo-do-cron-de-teste-123' });
  confere('com prova a varredura aprova', P('UidFulano0000000000a').status === 'aprovado');
  const pub = fake.store.get('parceiros_publicos/uidfulano0000000000a');
  confere('espelho publico mostra o @ provado', pub && pub.arroba === '@fulano' && pub.ativo === true);

  // 5) espelho sem prova nao leva o @
  const { montar } = require(path.join(ROBO, 'lib/espelhoParceiro.js'));
  confere('espelho sem prova vai sem @', montar({ slug: 'x', nome: 'X', arroba: '@famoso', status: 'aprovado' }).arroba === '');

  // 6) conta verificada e grande: mesmo com prova, fica com o dono
  novoParceiro('UidFamoso0000000000a', { arroba: 'famoso' });
  await chamar({}, { idToken: 'UidFamoso0000000000a', uid: 'UidFamoso0000000000a' });
  r = await chamar({ posse: '1' }, { idToken: 'UidFamoso0000000000a', acao: 'codigo' });
  PERFIS.famoso.bio = r.j.codigo;
  await chamar({ posse: '1' }, { idToken: 'UidFamoso0000000000a', acao: 'conferir' });
  await chamar({ processarPendentes: '1' }, null, { authorization: 'Bearer segredo-do-cron-de-teste-123' });
  confere('verificado com prova NAO e aprovado sozinho', P('UidFamoso0000000000a').status === 'pendente');
  confere('motivo de revisao gravado', (P('UidFamoso0000000000a').arrobaRevisao || []).indexOf('verificado') >= 0);

  // 7) parceiro sem @ continua entrando sozinho
  novoParceiro('UidSemArroba0000000a', {});
  await chamar({ processarPendentes: '1' }, null, { authorization: 'Bearer segredo-do-cron-de-teste-123' });
  confere('sem @ segue a aprovacao automatica', P('UidSemArroba0000000a').status === 'aprovado');

  // 8) a prova nao aceita @ reservado nem conta sem @
  novoParceiro('UidNaoTem00000000000', {});
  r = await chamar({ posse: '1' }, { idToken: 'UidNaoTem00000000000', acao: 'codigo' });
  confere('sem @ nao gera codigo', r.j && r.j.motivo === 'sem_arroba');

  console.log(falhas ? ('FALHAS ' + falhas + ' / OK ' + ok) : ('OK ' + ok + ' / FALHAS 0'));
  process.exit(falhas ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
