'use strict';
// Origem do cadastro + aviso com WhatsApp + funil por origem (09/10/2026).
// Sem internet e sem Firebase:  cd moviki-robo && node testes/origem.test.js
process.env.TELEGRAM_TOKEN = 'tg_teste';
process.env.TELEGRAM_CHAT_ID = '123';
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'x', filename: 'x', loaded: true, exports: { admin: fake.admin, db: fake.db } };
require.cache[require.resolve(path.join(ROBO, 'lib/meta.js'))] = { id: 'm', filename: 'm', loaded: true, exports: { lead: async () => {}, ultimoTexto: () => 'Medicao: enviada' } };

const tg = [];
global.fetch = async (url, op) => {
  if (/api\.telegram\.org/.test(String(url))) tg.push(JSON.parse(op.body).text);
  return { ok: true, status: 200, json: async () => ({}) };
};

const O = require(path.join(ROBO, 'lib/origem.js'));
const novoCliente = require(path.join(ROBO, 'api/novo-cliente.js'));
const funil = require(path.join(ROBO, 'api/funil-dono.js'))._t;
const { store, Timestamp } = fake;

let falhas = 0, ok = 0;
function conf(c, msg) { if (c) ok++; else { falhas++; console.log('FALHOU:', msg); } }
function resFalso() { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; }

(async () => {
  /* ---- 1. classificador ---- */
  const c = (e) => O.classificarOrigem(e).canal;
  conf(c({ utm: 'utm_source=instagram&utm_medium=dm&utm_campaign=comente-live' }) === 'direct_instagram', 'ManyChat = direct do Instagram');
  conf(O.classificarOrigem({ utm: 'utm_source=instagram&utm_medium=dm&utm_campaign=vik-direct' }).campaign === 'vik-direct', 'campanha guardada');
  conf(c({ utm: 'utm_source=instagram&utm_medium=dm', parceiro: 'joaovende' }) === 'parceiro', 'parceiro ganha de tudo');
  conf(c({ parceiro: 'ab' }) === 'direto', 'apelido curto nao vira parceiro');
  conf(c({ origemUrl: 'https://app.moviki.com.br/?criar=1&gclid=abc' }) === 'anuncio_google', 'gclid = anuncio Google');
  conf(c({ utm: 'utm_source=google&utm_medium=cpc' }) === 'anuncio_google', 'google/cpc = anuncio Google');
  conf(c({ fbc: 'fb.1.1700000000000.AbC' }) === 'anuncio_meta', 'fbc = anuncio Meta');
  conf(c({ utm: 'utm_source=facebook&utm_medium=paid_social' }) === 'anuncio_meta', 'facebook pago = anuncio Meta');
  conf(c({ ref: 'https://l.instagram.com/?u=x' }) === 'instagram', 'referrer do Instagram = organico');
  conf(c({ utm: 'utm_source=instagram&utm_medium=bio' }) === 'instagram', 'bio do Instagram = organico');
  conf(c({ ref: 'm.facebook.com' }) === 'facebook', 'Facebook organico');
  conf(c({ utm: 'utm_source=tiktok&utm_medium=dm&utm_campaign=comente-live' }) === 'direct_tiktok', 'ManyChat do TikTok = direct do TikTok');
  conf(c({ origemUrl: 'https://app.moviki.com.br/?criar=1&ttclid=E.abc' }) === 'anuncio_tiktok', 'ttclid = anuncio TikTok');
  conf(c({ utm: 'utm_source=tiktok&utm_medium=paid' }) === 'anuncio_tiktok', 'tiktok pago = anuncio TikTok');
  conf(c({ utm: 'utm_source=tiktok&utm_medium=bio' }) === 'tiktok', 'bio do TikTok = organico');
  conf(c({ ref: 'https://www.tiktok.com/@moviki.oficial' }) === 'tiktok', 'referrer do TikTok = organico');
  conf(c({ utm: 'utm_source=tiktok&utm_medium=dm', parceiro: 'joaovende' }) === 'parceiro', 'parceiro ganha do TikTok');
  conf(O.textoOrigem(O.classificarOrigem({ utm: 'utm_source=tiktok&utm_medium=dm&utm_campaign=comente-live' })) === 'Direct do TikTok (comente-live)', 'texto do aviso TikTok');
  conf(c({ utm: 'utm_source=whatsapp' }) === 'whatsapp', 'WhatsApp');
  conf(c({ ref: 'https://www.google.com.br/' }) === 'busca', 'busca organica');
  conf(c({ ref: 'https://www.moviki.com.br/aovivo' }) === 'site', 'site');
  conf(c({ ref: 'https://app.moviki.com.br/' }) === 'direto', 'o proprio painel nao e origem');
  conf(c({}) === 'direto', 'sem pista = sem origem');
  conf(c({ origemUrl: 'https://app.moviki.com.br/?criar=1&utm_source=instagram&utm_medium=dm' }) === 'direct_instagram', 'UTM lida do endereco do cadastro');
  const sujo = O.classificarOrigem({ utm: 'utm_source=<script>&utm_campaign=' + 'x'.repeat(500), ref: 'javascript:alert(1)' });
  conf(sujo.source.indexOf('<') < 0 && sujo.campaign.length <= 60 && sujo.ref === '', 'entrada suja e cortada: ' + JSON.stringify(sujo));
  conf(O.origemDoAviso({ origemAnuncio: true }).canal === 'anuncio_meta', 'aviso antigo com anuncio');
  conf(O.origemDoAviso({}).canal === 'sem_registro', 'aviso antigo sem nada');
  conf(O.origemDoAviso({ origem: { canal: 'inventado' } }).canal === 'sem_registro', 'canal desconhecido no banco nao vaza');
  conf(O.textoOrigem(O.classificarOrigem({ utm: 'utm_medium=dm&utm_campaign=comente-live' })) === 'Direct do Instagram (comente-live)', 'texto do aviso');

  /* ---- 2. link do WhatsApp ---- */
  const L = novoCliente._t.linkWhats;
  conf(/^https:\/\/wa\.me\/5583999998888\?text=/.test(L('83 99999-8888', 'Loja X')), 'celular com DDD');
  conf(/^https:\/\/wa\.me\/5583999998888\?/.test(L('5583999998888')), 'ja com 55');
  conf(L('12345') === '' && L('') === '', 'numero invalido = sem link');
  conf(decodeURIComponent(L('83999998888', 'Loja X').split('text=')[1]).indexOf('Loja X') > 0, 'mensagem cita o negocio');

  /* ---- 3. novo-cliente: negocio aparece DEPOIS da chamada + parceiro ---- */
  store.clear(); tg.length = 0;
  const UID = 'lojistaORIGEM000001';
  store.set('indicacoes/' + UID, { ref: 'joaovende' });
  setTimeout(() => store.set('negocios/' + UID, { nome: 'Ótica Central', whatsapp: '83999998888' }), 600);
  let res = resFalso();
  await novoCliente({ method: 'POST', headers: { 'user-agent': 't' }, body: { idToken: UID, utm: 'utm_source=instagram&utm_medium=dm&utm_campaign=comente-live', ref: 'l.instagram.com' } }, res);
  conf(res.body && res.body.ok === true && res.body.canal === 'parceiro', 'resposta com canal: ' + JSON.stringify(res.body));
  const av = store.get('avisos_cliente/' + UID) || {};
  conf(av.origem && av.origem.canal === 'parceiro' && av.origem.parceiro === 'joaovende', 'origem gravada: ' + JSON.stringify(av.origem));
  conf(av.nome === 'Ótica Central', 'nome esperado pelo negocio');
  conf(tg.length === 1 && /Origem: Parceiro \(joaovende\)/.test(tg[0]) && /wa\.me\/5583999998888/.test(tg[0]), 'Telegram com origem e WhatsApp: ' + tg[0]);

  /* sem negocio (cadastro so com e-mail): sai sem WhatsApp, sem quebrar */
  tg.length = 0;
  const UID2 = 'lojistaORIGEM000002';
  res = resFalso();
  await novoCliente({ method: 'POST', headers: {}, body: { idToken: UID2, origemUrl: 'https://app.moviki.com.br/?gclid=zz' } }, res);
  conf(res.body.ok === true && store.get('avisos_cliente/' + UID2).origem.canal === 'anuncio_google', 'cadastro sem negocio: canal Google');
  conf(tg.length === 1 && tg[0].indexOf('wa.me') < 0 && /Origem: Anúncio Google/.test(tg[0]), 'aviso sem WhatsApp: ' + tg[0]);

  /* repetido: idempotente, nao manda de novo */
  tg.length = 0; res = resFalso();
  await novoCliente({ method: 'POST', headers: {}, body: { idToken: UID2 } }, res);
  conf(res.body.jaAvisado === true && tg.length === 0, 'segunda chamada nao avisa de novo');

  /* duas chamadas quase juntas (dois pontos do painel chamando): um aviso so */
  tg.length = 0;
  const UID3 = 'lojistaORIGEM000003';
  const r1 = resFalso(), r2 = resFalso();
  await Promise.all([
    novoCliente({ method: 'POST', headers: {}, body: { idToken: UID3, utm: 'utm_source=instagram&utm_medium=dm' } }, r1),
    novoCliente({ method: 'POST', headers: {}, body: { idToken: UID3, utm: 'utm_source=instagram&utm_medium=dm' } }, r2),
  ]);
  conf(tg.length === 1, 'chamadas simultaneas: 1 aviso so (' + tg.length + ')');
  const av3 = store.get('avisos_cliente/' + UID3) || {};
  conf(av3.origem && av3.origem.canal === 'direct_instagram' && !('reservado' in av3) && av3.avisadoEm, 'registro completo, sem a marca de reserva: ' + JSON.stringify(av3));

  /* sem envs do Telegram: a origem nao se perde */
  const tok = process.env.TELEGRAM_TOKEN; delete process.env.TELEGRAM_TOKEN;
  const UID4 = 'lojistaORIGEM000004'; res = resFalso();
  await novoCliente({ method: 'POST', headers: {}, body: { idToken: UID4, origemUrl: 'https://app.moviki.com.br/?gclid=1' } }, res);
  process.env.TELEGRAM_TOKEN = tok;
  conf(res.body.motivo === 'sem_config' && store.get('avisos_cliente/' + UID4).origem.canal === 'anuncio_google', 'sem Telegram a origem fica gravada');

  /* ---- 4. funil por origem ---- */
  const agora = Date.now();
  const base = (uid, origem, extra) => Object.assign({ uid, cadastroEm: agora - 3 * 86400000, origem, emailVerificado: true, marcos: null, assinatura: null }, extra || {});
  const DIRECT = { canal: 'direct_instagram', rotulo: 'Direct do Instagram', campaign: 'comente-live' };
  const META = { canal: 'anuncio_meta', rotulo: 'Anúncio Meta', campaign: '' };
  const f = funil.montarFunil([
    base('a1', DIRECT, { marcos: { primeiraLiveEm: Timestamp.fromMillis(agora - 3 * 86400000 + 3600000) } }),
    base('a2', DIRECT),
    base('a3', META, { assinatura: { ativo: true, plano: 'premium', periodo: 'mensal', vence_em: Timestamp.fromMillis(agora + 20 * 86400000) } }),
    base('a4', undefined),
  ], new Set(), agora);
  const po = {}; (f.porOrigem || []).forEach((x) => { po[x.canal] = x; });
  conf(po.direct_instagram && po.direct_instagram.cadastros === 2 && po.direct_instagram.live === 1 && po.direct_instagram.live48 === 1, 'direct: 2 cadastros, 1 live em 48 h: ' + JSON.stringify(po.direct_instagram));
  conf(po.anuncio_meta && po.anuncio_meta.pagante === 1, 'Meta: 1 pagante');
  conf(po.sem_registro && po.sem_registro.cadastros === 1, 'sem origem cai em sem_registro');
  conf(f.porOrigem[0].canal === 'direct_instagram', 'ordenado por cadastros');
  conf(f.recentes.every((r) => r.origem && r.origem.rotulo), 'lista recente traz a origem');

  console.log('origem.test: ' + ok + ' ok, ' + falhas + ' falha(s)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
