'use strict';
// Teste do "regras no ar" (03/10/2026). Sem internet e sem Firebase:
// cd moviki-robo && node testes/regras.test.js
const path = require('path');
const fs = require('fs');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'x', filename: 'x', loaded: true, exports: { admin: fake.admin, db: fake.db } };
const R = require(path.join(ROBO, 'lib/regras.js'));
const ESP = require(path.join(ROBO, 'lib/regrasEsperadas.js'));
const { store } = fake;
let ok = 0, falhas = 0;
const conf = (c, m) => { if (c) ok++; else { falhas++; console.log('FALHOU:', m); } };

const avisos = [];
global.fetch = async (u, o) => { avisos.push({ u, corpo: JSON.parse(o.body) }); return { ok: true, status: 200, text: async () => '' }; };
process.env.TELEGRAM_TOKEN = 't'; process.env.TELEGRAM_CHAT_ID = 'c'; process.env.RESEND_API_KEY = 'k';

// Textos que batem com o esperado: o teste fabrica um texto e troca o esperado por ele.
const FS_TXT = 'rules_version = \'2\';\r\n    //  v32 — 03/10/2026 — DONO SO COM O GOOGLE   \r\nservice cloud.firestore {}\r\n\r\n';
const ST_TXT = "rules_version = '2';\n//  27/08/2026\n//  30/09/2026: + material/\n//  03/10/2026: ehAdmin\nservice firebase.storage {}\n";
ESP.firestore.sha256 = R.hash(FS_TXT);
ESP.storage.sha256 = R.hash(ST_TXT);

const sr = (fsTxt, stTxt, erro) => ({
  getFirestoreRuleset: async () => { if (erro) { const e = new Error('Caller does not have permission'); e.code = 'permission-denied'; throw e; } return { createTime: '2026-10-03T09:00:00Z', source: [{ name: 'firestore.rules', content: fsTxt }] }; },
  getStorageRuleset: async (b) => { conf(b === 'moviki-app.firebasestorage.app', 'balde certo'); return { createTime: '2026-10-03T09:01:00Z', source: [{ name: 'storage.rules', content: stTxt }] }; },
});

(async () => {
  conf(R.normalizar('a  \r\nb\r\n\r\n') === 'a\nb', 'normaliza CRLF, espaco e linha vazia final');
  conf(R.marcaFirestore(FS_TXT) === 'v32', 'marca do Firestore');
  conf(R.marcaStorage(ST_TXT) === '03/10/2026', 'data mais nova do Storage');

  store.clear(); avisos.length = 0;
  let r = await R.conferirEGuardar(sr(FS_TXT.replace(/\r\n/g, '\n'), ST_TXT));
  conf(r.tudoOk === true && r.firestore.versaoNoAr === 'v32' && r.storage.versaoNoAr === '03/10/2026', 'tudo igual = OK (mesmo com CRLF diferente)');
  conf(r.mudou === true && avisos.length === 2, '1a conferencia avisa (Telegram + e-mail): ' + avisos.length);
  conf(avisos[1].corpo.to[0] === 'eikosistemas@gmail.com' && /regras no ar: OK/.test(avisos[1].corpo.subject), 'e-mail para eikosistemas com OK no assunto');

  avisos.length = 0;
  r = await R.conferirEGuardar(sr(FS_TXT, ST_TXT));
  conf(r.mudou === false && avisos.length === 0, 'sem mudanca, sem aviso');

  r = await R.conferirEGuardar(sr(FS_TXT.replace('v32', 'v31'), ST_TXT));
  conf(r.tudoOk === false && r.firestore.ok === false && r.firestore.versaoNoAr === 'v31' && r.storage.ok === true, 'Firestore antigo = diferente');
  conf(avisos.length === 2 && /ATENCAO/.test(avisos[1].corpo.subject), 'mudou para diferente: avisa com ATENCAO');

  avisos.length = 0;
  r = await R.conferirEGuardar(sr('', '', true));
  conf(r.firestore.erro === 'sem_permissao' && r.tudoOk === false, 'sem permissao vira erro claro');
  conf(/papel/.test(avisos[0].corpo.text), 'aviso explica o papel que falta');

  // endpoint
  fake.admin.auth = () => ({ verifyIdToken: async (t) => ({ uid: t, firebase: { sign_in_provider: 'google.com' } }) });
  fake.admin.securityRules = () => sr(FS_TXT, ST_TXT);
  const h = require(path.join(ROBO, 'api/regras.js'));
  const res = () => { const o = { c: 0, j: null, setHeader() {}, status(c) { o.c = c; return o; }, json(j) { o.j = j; return o; }, end() { return o; } }; return o; };
  let x = res(); await h({ method: 'GET', headers: {} }, x);
  conf(x.c === 401, 'GET sem segredo: 401');
  process.env.CRON_SECRET = 'segredo-do-cron';
  x = res(); await h({ method: 'GET', headers: { authorization: 'Bearer segredo-do-cron' } }, x);
  conf(x.c === 200 && x.j.tudoOk === true, 'cron confere');
  store.set('admins/DONO1', {});
  x = res(); await h({ method: 'POST', headers: { origin: 'https://app.moviki.com.br' }, body: { idToken: 'OUTRO' } }, x);
  conf(x.c === 403, 'quem nao e dono: 403');
  x = res(); await h({ method: 'POST', headers: { origin: 'https://app.moviki.com.br' }, body: { idToken: 'DONO1' } }, x);
  conf(x.c === 200 && x.j.firestore.versaoNoAr === 'v32', 'dono pelo Google le o estado');

  // o esperado do arquivo bate com as regras do moviki-app, se elas estiverem ao lado
  const app = process.env.APP;
  if (app && fs.existsSync(path.join(app, 'firebase/firestore.rules'))) {
    delete require.cache[require.resolve(path.join(ROBO, 'lib/regrasEsperadas.js'))];
    const E = require(path.join(ROBO, 'lib/regrasEsperadas.js'));
    conf(R.hash(fs.readFileSync(path.join(app, 'firebase/firestore.rules'), 'utf8')) === E.firestore.sha256, 'esperado = firestore.rules do moviki-app');
    conf(R.hash(fs.readFileSync(path.join(app, 'firebase/storage.rules'), 'utf8')) === E.storage.sha256, 'esperado = storage.rules do moviki-app');
  }
  console.log('\nOK ' + ok + ' / FALHAS ' + falhas);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
