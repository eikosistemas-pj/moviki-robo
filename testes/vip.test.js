'use strict';
// Lista VIP (P70 etapa 4, 03/10/2026). Sem internet e sem Firebase:
// cd moviki-robo && node testes/vip.test.js
process.env.CHECKOUT_CHAVE = 'uma-frase-longa-e-aleatoria-de-teste-1234567890';
process.env.RESEND_API_KEY = 're_teste';
process.env.VIP_EMAIL_TETO_DIA = '5';
const path = require('path');
const crypto = require('crypto');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'x', filename: 'x', loaded: true, exports: { admin: fake.admin, db: fake.db } };
const enviados = [];
let pushStatus = {};
global.fetch = async (url, op) => {
  const corpo = op && op.body ? JSON.parse(op.body) : null;
  enviados.push({ url: String(url), corpo, headers: (op && op.headers) || {} });
  if (/resend\.com/.test(url)) return { ok: true, status: 200, json: async () => ({}) };
  const st = pushStatus[url] || 201;
  return { ok: st < 300, status: st };
};
const ck = require(path.join(ROBO, 'lib/checkout.js'));
const T = ck._t;
const V = T.vip();
const { store, Timestamp } = fake;
let falhas = 0, ok = 0;
function conf(c, msg) { if (c) { ok++; } else { falhas++; console.log('FALHOU:', msg); } }
const d = (p) => store.get(p);
const UID = 'lojistaVVVVVVVVVVV6';
const docsVip = () => [...store.keys()].filter((k) => k.startsWith('vip/')).map((k) => [k, store.get(k)]);
function resFalso() { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; r.send = (b) => { r.body = b; return r; }; return r; }
async function chamar(body) { const res = resFalso(); await ck.tratar({ headers: { origin: 'https://www.moviki.com.br' }, socket: { remoteAddress: '1.2.3.' + Math.random() } }, res, body); return res; }
const EP = 'https://fcm.googleapis.com/fcm/send/abc123';
const EP2 = 'https://updates.push.services.mozilla.com/wpush/v2/xyz';

(async () => {
  store.clear();
  store.set('assinaturas/' + UID, { ativo: true, plano: 'premium' });
  store.set('negocios/' + UID, { nome: 'Perfumaria Teste', slug: 'perfumaria-teste' });
  const base = { lojistaUid: UID, nome: 'Rui Alves', aceite: true, origem: 'live' };

  // 1. desligado por padrao
  let r = await V.entrar(Object.assign({}, base, { email: 'rui@exemplo.com' }), '1.1.1.1');
  conf(r.erro === 'vip_off', 'chave desligada recusa: ' + JSON.stringify(r));
  r = await V.lojaVip(UID);
  conf(r.ok && r.ligado === false, 'painel diz desligado');
  await T.admRecursos('donoXXXXXXXXXXXXX', { uid: UID, listaVip: true });
  conf(d('checkout_publico/' + UID).recursos.listaVip === true, 'espelho publico do recurso');

  // 2. validacoes
  r = await V.entrar(Object.assign({}, base, { aceite: false, email: 'rui@exemplo.com' }), '1.1.1.1');
  conf(r.erro === 'aceite', 'sem aceite');
  r = await V.entrar(Object.assign({}, base), '1.1.1.1');
  conf(r.erro === 'canal', 'sem canal');
  r = await V.entrar(Object.assign({}, base, { push: { endpoint: 'https://evil.example/push' } }), '1.1.1.1');
  conf(r.erro === 'push', 'endpoint de push fora da lista (SSRF)');
  r = await V.entrar(Object.assign({}, base, { whatsapp: '123' }), '1.1.1.1');
  conf(r.erro === 'whatsapp', 'whatsapp curto');
  r = await V.entrar(Object.assign({}, base, { email: 'nao-e-email' }), '1.1.1.1');
  conf(r.erro === 'email', 'email invalido');
  store.set('assinaturas/' + UID, { ativo: false, plano: 'basico' });
  r = await V.entrar(Object.assign({}, base, { email: 'rui@exemplo.com' }), '1.1.1.1');
  conf(r.erro === 'vip_off', 'sem plano pago recusa');
  store.set('assinaturas/' + UID, { ativo: true, plano: 'premium' });

  // 3. inscricao nos tres canais
  enviados.length = 0;
  r = await V.entrar(Object.assign({}, base, { email: 'Rui@Exemplo.com', whatsapp: '+55 (11) 99999-8888', push: { endpoint: EP } }), '1.1.1.1');
  conf(r.ok && r.email === 'confirmar' && r.whatsapp && r.push, 'tres canais: ' + JSON.stringify(r));
  const vs = docsVip();
  conf(vs.length === 3, '3 documentos: ' + vs.length);
  const em = vs.find(([, x]) => x.canal === 'email')[1];
  conf(em.email === 'rui@exemplo.com' && em.confirmado === false && /^[0-9a-f]{24}$/.test(em.confirmaToken), 'email minusculo e sem confirmar');
  conf(vs.find(([, x]) => x.canal === 'whatsapp')[1].whatsapp === '11999998888', 'whatsapp sem 55');
  conf(em.consentimento.versao === 'vip-1' && /Perfumaria Teste/.test(em.consentimento.texto) && em.consentimento.origem === 'live', 'consentimento gravado');
  const conf1 = enviados.find((e) => /resend/.test(e.url));
  conf(conf1 && /\/vip\/confirmar\/e[0-9a-f]{30}-[0-9a-f]{24}/.test(JSON.stringify(conf1.corpo)), 'email de confirmacao com link');
  conf(d('vip_teto/' + new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10)).n === 1, 'confirmacao conta no teto');

  // 4. repetir nao duplica e nao reenvia em 10 min
  enviados.length = 0;
  r = await V.entrar(Object.assign({}, base, { email: 'rui@exemplo.com', whatsapp: '11999998888', push: { endpoint: EP } }), '1.1.1.2');
  conf(r.ok && docsVip().length === 3 && !enviados.some((e) => /resend/.test(e.url)), 'repetir nao duplica nem reenvia');

  // 5. confirmar
  const emId = vs.find(([, x]) => x.canal === 'email')[0].split('/')[1];
  r = await V.confirmar({ t: emId + '-' + '0'.repeat(24) });
  conf(r.erro === 'link', 'token errado');
  r = await V.confirmar({ t: emId + '-' + em.confirmaToken });
  conf(r.ok && r.loja === 'Perfumaria Teste' && d('vip/' + emId).confirmado === true, 'confirmou');
  r = await V.confirmar({ t: emId + '-' + em.confirmaToken });
  conf(r.ok, 'clicar de novo no link de confirmar continua ok');

  // 6. painel
  r = await V.lojaVip(UID);
  conf(r.ok && r.ligado && r.contagem.email === 1 && r.contagem.push === 1 && r.contagem.whatsapp === 1, 'contagem: ' + JSON.stringify(r.contagem));
  conf(r.whatsapp[0].whatsapp === '11999998888' && /\/vip\/sair\/w[0-9a-f]{30}-[0-9a-f]{24}$/.test(r.whatsapp[0].sair), 'lista do WhatsApp com link de sair');
  conf(JSON.stringify(r).indexOf('rui@exemplo.com') < 0 && JSON.stringify(r).indexOf('fcm.googleapis') < 0, 'painel nao recebe e-mail nem endpoint');
  conf(r.link === 'https://www.moviki.com.br/perfumaria-teste?vip=link' && r.qr === 'https://www.moviki.com.br/perfumaria-teste?vip=qr', 'link fixo e link do QR');
  conf(r.pessoas === 1 && r.porOrigem.live === 1, 'tres canais da mesma inscricao = 1 pessoa: ' + JSON.stringify({ p: r.pessoas, o: r.porOrigem }));
  conf(docsVip().every(([, x]) => x.origem === 'live' && /^[0-9a-f]{24}$/.test(x.pessoa)), 'origem e pessoa gravadas em todos os canais');

  // 7. aviso: so com live no ar
  r = await V.lojaAvisar(UID, {});
  conf(r.erro === 'sem_live', 'sem live nao avisa');
  store.set('live_sessoes/' + UID, { ativa: true, pulsoEm: Timestamp.now(), sessaoId: 's1' });
  r = await V.lojaAvisar(UID, { chamada: 'vendo cigarro eletronico hoje' });
  conf(r.erro === 'termo', 'chamada com termo proibido');
  // mais dois inscritos de push, um deles sumido (410)
  await V.entrar(Object.assign({}, base, { nome: 'Ana', push: { endpoint: EP2 } }), '1.1.1.3');
  pushStatus[EP2] = 410;
  enviados.length = 0;
  r = await V.lojaAvisar(UID, { chamada: 'Lançamento de perfumes!' });
  conf(r.ok && r.push.enviados === 1 && r.push.removidos === 1 && r.email.enviados === 1 && r.whatsapp === 1, 'aviso: ' + JSON.stringify(r));
  const pushCall = enviados.find((e) => e.url === EP);
  conf(pushCall && /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/.test(pushCall.headers.Authorization) && pushCall.headers.TTL === '3600' && !pushCall.corpo, 'push com VAPID e sem conteudo');
  // assinatura VAPID confere com a chave publica
  const [jh, jp, js] = pushCall.headers.Authorization.slice(8).split(', k=')[0].split('.');
  const pub = Buffer.from(pushCall.headers.Authorization.split('k=')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  const chavePub = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.slice(1, 33).toString('base64url'), y: pub.slice(33).toString('base64url') }, format: 'jwk' });
  const ver = crypto.verify('sha256', Buffer.from(jh + '.' + jp), { key: chavePub, dsaEncoding: 'ieee-p1363' }, Buffer.from(js, 'base64url'));
  conf(ver && JSON.parse(Buffer.from(jp, 'base64url')).aud === 'https://fcm.googleapis.com', 'JWT VAPID valido para a origem do endpoint');
  conf(d('sistema/vapid') && /^[A-Za-z0-9+/=:.-]+$/.test(String(d('sistema/vapid').priv)) && String(d('sistema/vapid').priv).indexOf('"d"') < 0, 'chave privada guardada cifrada');
  conf(!docsVip().some(([, x]) => x.push && x.push.endpoint === EP2), 'push 410 removido');
  const mail = enviados.find((e) => /emails\/batch/.test(e.url) && Array.isArray(e.corpo));
  conf(mail && mail.corpo[0].headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click' && /vip_sair=e[0-9a-f]{30}-[0-9a-f]{24}/.test(mail.corpo[0].headers['List-Unsubscribe']), 'e-mail com sair de um clique');
  conf(mail && /\/live\/perfumaria-teste/.test(mail.corpo[0].html) && /Lançamento de perfumes/.test(mail.corpo[0].html), 'e-mail com link da live');

  // 8. freio do aviso
  r = await V.lojaAvisar(UID, {});
  conf(r.erro === 'vip_intervalo', 'segundo aviso em menos de 2 h');
  // 9. ultimo aviso para o service worker
  r = await V.ultimo({ endpoint: EP });
  conf(r.ok && r.titulo === 'Perfumaria Teste está ao vivo agora' && r.url === 'https://www.moviki.com.br/live/perfumaria-teste', 'ultimo aviso: ' + JSON.stringify(r));
  r = await V.ultimo({ endpoint: 'https://evil.example/x' });
  conf(r.ok && r.url === 'https://www.moviki.com.br/aovivo', 'endpoint estranho recebe aviso generico');

  // 10. teto de e-mail do dia
  store.set('vip_teto/' + new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10), { n: 5 });
  store.set('vip_avisos/' + UID, { dia: 'x', qtd: 0 });
  r = await V.lojaAvisar(UID, {});
  conf(r.ok && r.email.enviados === 0 && r.email.semCota === 1, 'teto do dia segura o e-mail: ' + JSON.stringify(r.email));

  // 11. sair
  const wId = docsVip().find(([, x]) => x.canal === 'whatsapp')[0].split('/')[1];
  const wTok = d('vip/' + wId).sairToken;
  r = await V.sair({ t: wId + '-' + '1'.repeat(24) });
  conf(r.erro === 'link' && d('vip/' + wId), 'sair com token errado nao apaga');
  r = await V.sair({ t: wId + '-' + wTok });
  conf(r.ok && !d('vip/' + wId), 'sair apaga de verdade');
  r = await V.sair({ t: wId + '-' + wTok });
  conf(r.ok && r.ja, 'sair duas vezes = ok');
  // um clique pela porta publica (POST do Gmail)
  const eTok = d('vip/' + emId).sairToken;
  const pedido = require(path.join(ROBO, 'api/pedido.js'));
  const res1 = resFalso();
  await pedido({ method: 'POST', query: { vip_sair: emId + '-' + eTok }, headers: {}, body: 'List-Unsubscribe=One-Click' }, res1);
  conf(res1.code === 200 && !d('vip/' + emId), 'sair de um clique (POST)');
  // push sai pelo aparelho
  r = await V.sairPush({ lojistaUid: UID, endpoint: EP });
  conf(r.ok && !docsVip().some(([, x]) => x.canal === 'push'), 'aparelho sai da lista');

  // 12. porta publica e porta do lojista
  let res = await chamar({ acao: 'compra_vip_chave' });
  conf(res.code === 200 && /^[\w-]{87}$/.test(res.body.chave), 'chave publica VAPID');
  res = await chamar({ acao: 'compra_vip_entrar', lojistaUid: UID, nome: 'Bia', whatsapp: '21988887777', aceite: true });
  conf(res.code === 200 && res.body.whatsapp, 'entrar pela porta publica');
  res = await chamar({ acao: 'loja_vip', idToken: UID });
  conf(res.code === 200 && res.body.contagem.whatsapp === 1, 'loja_vip pela porta do lojista');
  const bia = res.body.whatsapp[0].id;
  res = await chamar({ acao: 'loja_vip_remover', idToken: 'outroLojistaXXXXXX', id: bia });
  conf(res.code === 403 || (res.body && res.body.erro), 'outro lojista nao remove');
  res = await chamar({ acao: 'loja_vip_remover', idToken: UID, id: bia });
  conf(res.code === 200 && !d('vip/' + bia), 'lojista remove');

  // 12b. origens do P71
  await V.entrar(Object.assign({}, base, { nome: 'Caio', whatsapp: '31977776666', origem: 'qr' }), '2.2.2.1');
  await V.entrar(Object.assign({}, base, { nome: 'Duda', whatsapp: '31977775555', origem: 'link' }), '2.2.2.2');
  await V.entrar(Object.assign({}, base, { nome: 'Eva', whatsapp: '31977774444', origem: 'hack<script>' }), '2.2.2.3');
  r = await V.lojaVip(UID);
  conf(r.porOrigem.qr === 1 && r.porOrigem.link === 1 && r.porOrigem.pagina >= 1, 'contagem por origem: ' + JSON.stringify(r.porOrigem));
  conf(!docsVip().some(([, x]) => /script/.test(String(x.origem))), 'origem fora da lista vira pagina');

  // 13. e-mail sem confirmar some em 7 dias
  await V.entrar(Object.assign({}, base, { email: 'velho@exemplo.com' }), '1.1.1.9');
  const vel = docsVip().find(([, x]) => x.email === 'velho@exemplo.com');
  store.set(vel[0], Object.assign(vel[1], { confirmaEnviadoEm: Timestamp.fromMillis(Date.now() - 8 * 86400000) }));
  await V.lojaVip(UID);
  conf(!d(vel[0]), 'nao confirmado em 7 dias e apagado');

  // 14. freio por IP
  let barrou = false;
  for (let i = 0; i < 14; i++) { const x = await V.entrar(Object.assign({}, base, { whatsapp: '119' + String(10000000 + i) }), '9.9.9.9'); if (x.erro === 'freio') barrou = true; }
  conf(barrou, 'freio por IP');

  console.log('OK ' + ok + ' / FALHAS ' + falhas);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
