'use strict';
// Teste da trava de troca de Pix (06/10/2026, plano de seguranca 1.3).
// Sem internet e sem Firebase: cd moviki-robo && node testes/pix-trava.test.js
process.env.CHECKOUT_CHAVE = 'uma-frase-longa-e-aleatoria-de-teste-1234567890';
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'x', filename: 'x', loaded: true, exports: { admin: fake.admin, db: fake.db } };

const checkout = require(path.join(ROBO, 'lib/checkout.js'));
const { lojaPixSalvar, pixPausaRestanteMs, PIX_CARENCIA_MS, PIX_LOGIN_RECENTE_MS } = checkout._t;
const { Timestamp } = fake.admin.firestore;

let falhas = 0, ok = 0;
function conf(c, msg) { if (c) ok++; else { falhas++; console.log('FALHOU:', msg); } }

const UID = 'LojistaAAAAAAAAAAAA';
const agoraS = () => Math.floor(Date.now() / 1000);
const decRecente = { uid: UID, auth_time: agoraS() };             // entrou agora
const decVelho = { uid: UID, auth_time: agoraS() - 3600 };        // entrou ha 1 h

(async () => {
  const dados1 = { chave: '11122233344', nome: 'Joao da Silva', cidade: 'Joao Pessoa', documento: '11144477735' };

  // 1) CADASTRO da primeira chave: nao exige login recente nem pausa a venda.
  let r = await lojaPixSalvar(UID, dados1, decVelho);
  conf(!r.erro && r.pix && r.pix.tem === true, '1a chave cadastra mesmo sem login recente');
  let rec = (await fake.db.collection('recebimento').doc(UID).get()).data();
  conf(!rec.pixTrocadoEm, 'cadastro nao marca pixTrocadoEm');
  conf(pixPausaRestanteMs(rec) === 0, 'cadastro nao pausa a venda');

  // 2) TROCA sem login recente: recusada.
  const dados2 = Object.assign({}, dados1, { chave: '55566677788' });
  r = await lojaPixSalvar(UID, dados2, decVelho);
  conf(r.erro === 'login_recente', 'troca sem login recente e recusada');
  rec = (await fake.db.collection('recebimento').doc(UID).get()).data();
  conf(decifraIgual(rec, '+5511122233344'), 'chave nao mudou apos recusa');

  // recebimento ligado no modo pix, para o espelho ter ativo:true
  await fake.db.collection('recebimento').doc(UID).set({ ligado: true, modo: 'pix' }, { merge: true });

  // 3) TROCA com login recente: aceita, marca o carimbo e pausa a venda.
  r = await lojaPixSalvar(UID, dados2, decRecente);
  conf(!r.erro, 'troca com login recente e aceita');
  rec = (await fake.db.collection('recebimento').doc(UID).get()).data();
  conf(!!rec.pixTrocadoEm, 'troca marca pixTrocadoEm');
  conf(pixPausaRestanteMs(rec) > 0, 'troca pausa a venda');
  conf(pixPausaRestanteMs(rec) <= PIX_CARENCIA_MS, 'pausa nao passa da carencia');

  // 4) Espelho publico desligou o botao de comprar.
  const pub = (await fake.db.collection('checkout_publico').doc(UID).get()).data();
  conf(pub && pub.pixPausadoAte && pub.pixPausadoAte.toMillis() > Date.now(), 'espelho leva pixPausadoAte no futuro');
  conf(pub && pub.ativo === true, 'espelho NAO derruba ativo durante a pausa (a pagina decide pela data)');

  // 5) Salvar a MESMA chave de novo (nome/cidade) nao e troca: nao exige login.
  r = await lojaPixSalvar(UID, dados2, decVelho);
  conf(!r.erro, 'regravar a mesma chave nao exige login recente');

  // 6) Passada a carencia, a venda volta sozinha.
  rec = (await fake.db.collection('recebimento').doc(UID).get()).data();
  rec.pixTrocadoEm = Timestamp.fromMillis(Date.now() - PIX_CARENCIA_MS - 1000);
  conf(pixPausaRestanteMs(rec) === 0, 'passada a carencia, a pausa some');

  console.log(falhas ? ('FALHAS: ' + falhas) : ('OK (' + ok + ' conferencias)'));
  process.exit(falhas ? 1 : 0);
})();

function decifraIgual(rec, chaveCrua) {
  try { return checkout._t.decifrar(rec.pix.chaveCifrada) === chaveCrua; } catch (_) { return false; }
}
