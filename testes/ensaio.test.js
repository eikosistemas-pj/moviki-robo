'use strict';
// Live de ensaio + marcos do lojista (P75 fase 1, 07/10/2026). Sem internet e sem Firebase:
// cd moviki-robo && node testes/ensaio.test.js
process.env.LIVE_SEGREDO = 'segredo-de-teste-com-mais-de-vinte-caracteres';
process.env.TELEGRAM_TOKEN = 'tg_teste';
process.env.TELEGRAM_CHAT_ID = '123';
process.env.RESEND_API_KEY = 're_teste';
process.env.CHECKOUT_CHAVE = 'uma-frase-longa-e-aleatoria-de-teste-1234567890';
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'x', filename: 'x', loaded: true, exports: { admin: fake.admin, db: fake.db } };

/* Telegram falso: modo 'ok' | 'erro' | 'trava' (nunca responde). */
let tgModo = 'ok';
const tg = [];
global.fetch = async (url, op) => {
  const u = String(url);
  if (/api\.telegram\.org/.test(u)) {
    tg.push(JSON.parse(op.body));
    if (tgModo === 'erro') throw new Error('rede caiu');
    if (tgModo === 'trava') return new Promise((ok, falha) => { if (op.signal) op.signal.addEventListener('abort', () => falha(new Error('abort'))); });
    return { ok: true, status: 200, json: async () => ({}) };
  }
  return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
};

const L = require(path.join(ROBO, 'lib/livesessao.js'));
const T = L._t;
const marcos = require(path.join(ROBO, 'lib/marcos.js'));
const { store, Timestamp } = fake;
/* O Firestore de verdade SERIALIZA transacoes que tocam o mesmo documento
   (a segunda e repetida e ve o que a primeira gravou). O falso nao: aqui uma
   fila reproduz essa garantia, para o teste de corrida medir o nosso codigo. */
{ const rt = fake.db.runTransaction; let fila = Promise.resolve();
  fake.db.runTransaction = function (fn) { const p = fila.then(() => rt.call(fake.db, fn)); fila = p.catch(() => {}); return p; }; }
let falhas = 0, ok = 0;
function conf(c, msg) { if (c) { ok++; } else { falhas++; console.log('FALHOU:', msg); } }
const d = (p) => store.get(p);
const WHEP = 'https://customer-abc123.cloudflarestream.com/' + 'a'.repeat(32) + '/webRTC/play';
function resFalso() { const r = { code: 0, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = () => {}; r.end = () => r; return r; }
async function http(body, segredo) {
  const res = resFalso();
  const headers = { origin: 'https://app.moviki.com.br' };
  if (segredo) headers['x-moviki-live'] = process.env.LIVE_SEGREDO;
  await L.tratar({ headers }, res, body);
  return res;
}
const zerarFreio = (uid) => store.delete('live_throttle/' + uid);

(async () => {
  store.clear();
  const UID = 'lojistaTRIAL0000001';
  store.set('negocios/' + UID, { nome: 'Pastel da Feira', slug: 'pastel-da-feira' });
  store.set('assinaturas/' + UID, { ativo: true, plano: 'pro', periodo: 'trial', vence_em: Timestamp.fromMillis(Date.now() + 20 * 86400000) });

  /* ---- 1. ensaio NAO consome a cota do teste gratis ---- */
  let r = await T.reservar({ uid: UID, periodo: 'trial', nivel: 'premium', ensaio: true });
  conf(r.ok && r.ensaio === true && r.ensaiosHoje === 1, 'reservar ensaio ok: ' + JSON.stringify(r));
  conf(!d('live_cota/' + UID) || !(d('live_cota/' + UID).usadas > 0), 'cota NAO andou no ensaio');
  r = await T.abrirEnsaio({ uid: UID, entradaId: 'e'.repeat(32), nivel: 'premium', periodo: 'trial' });
  conf(r.ok && r.limiteMin === T.ENSAIO_MIN, 'abrir ensaio ok');
  conf(!d('live_sessoes/' + UID), 'ensaio NAO grava live_sessoes (vitrine, pagina publica, VIP e Pix nao veem)');
  conf(d('live_ensaios/' + UID).ativa === true && !('whep' in d('live_ensaios/' + UID)), 'sessao do ensaio sem WHEP');
  conf(d('marcos_lojista/' + UID).ensaios === 1 && !!d('marcos_lojista/' + UID).primeiroEnsaioEm, 'marco do primeiro ensaio');
  conf(!d('marcos_lojista/' + UID).primeiraLiveEm, 'ensaio NAO vira primeira live');
  conf(tg.length === 0, 'ensaio nao avisa o Telegram');
  let lista = await T.noAr(60);
  conf(lista.lives.length === 0, 'ensaio fora da lista de lives no ar do dono');

  /* pulso dentro do tempo */
  r = await T.pulsoEnsaio(UID);
  conf(r.noAr === true && r.restamMin <= T.ENSAIO_MIN && r.restamSeg > 0, 'pulso do ensaio no ar: ' + JSON.stringify(r));

  /* ---- 2. duracao maxima aplicada no servidor ---- */
  const e0 = d('live_ensaios/' + UID);
  store.set('live_ensaios/' + UID, Object.assign({}, e0, { inicioEm: Timestamp.fromMillis(Date.now() - (T.ENSAIO_MIN * 60000 + 5000)) }));
  r = await T.pulsoEnsaio(UID);
  conf(r.encerrar === true && r.motivo === 'limite_ensaio' && d('live_ensaios/' + UID).ativa === false, 'ensaio cortado no limite: ' + JSON.stringify(r));
  conf(!d('live_cota/' + UID) || !d('live_cota/' + UID).ultimaFechadaEm, 'fechar o ensaio NAO carimba a carencia da live real');

  /* ---- 3. teto de ensaios por dia ---- */
  for (let i = 2; i <= T.ENSAIO_DIA; i++) {
    zerarFreio(UID);
    r = await T.reservar({ uid: UID, periodo: 'trial', nivel: 'premium', ensaio: true });
    conf(r.ok && r.ensaiosHoje === i, 'ensaio ' + i + ' do dia ok');
  }
  zerarFreio(UID);
  r = await T.reservar({ uid: UID, periodo: 'trial', nivel: 'premium', ensaio: true });
  conf(r.erro === 'ensaio_dia', 'ensaio acima do teto diario recusado: ' + JSON.stringify(r));
  /* virou o dia (SP): libera */
  store.set('live_ensaios/' + UID, Object.assign({}, d('live_ensaios/' + UID), { diaEnsaio: '2000-01-01' }));
  zerarFreio(UID);
  r = await T.reservar({ uid: UID, periodo: 'trial', nivel: 'premium', ensaio: true });
  conf(r.ok && r.ensaiosHoje === 1, 'dia novo libera o ensaio');
  conf(!d('live_cota/' + UID) || !(d('live_cota/' + UID).usadas > 0), 'depois de 6 ensaios a cota segue intacta');

  /* ensaio recusado pelo teto de video NAO gasta a vez do dia */
  const UIDV = 'lojistaVIDEO0000001';
  const ciclo = T.rotuloCiclo(undefined, Date.now());
  store.set('live_cota/' + UIDV, { usadas: 0, cicloVideo: ciclo, minutosVideo: 99999 });
  r = await T.reservar({ uid: UIDV, periodo: 'trial', nivel: 'premium', ensaio: true });
  conf(r.erro === 'teto_video', 'ensaio barrado pelo teto de video como a live');
  conf(!d('live_ensaios/' + UIDV), 'recusa por teto de video nao gastou ensaio do dia');

  /* ---- 4. live REAL consome a cota normalmente, mesmo logo depois do ensaio ---- */
  zerarFreio(UID);
  r = await T.reservar({ uid: UID, periodo: 'trial', nivel: 'premium' });
  conf(r.ok && r.restam === 1 && d('live_cota/' + UID).usadas === 1, 'live real consome 1: ' + JSON.stringify(r));
  conf(r.entradaId === 'e'.repeat(32), 'entrada mais nova (a do ensaio) vai para o api/live.js apagar');

  /* ---- 5. marco da primeira live: grava 1 vez, Telegram 1 vez ---- */
  store.set('live_ensaios/' + UID, Object.assign({}, d('live_ensaios/' + UID), { ativa: true }));
  r = await T.abrir({ uid: UID, whep: WHEP, entradaId: 'f'.repeat(32), nivel: 'premium', limiteMin: 60, periodo: 'trial', jaReservado: true });
  conf(r.ok, 'abrir live real ok');
  conf(d('live_ensaios/' + UID).ativa === false && d('live_ensaios/' + UID).motivo === 'live_real', 'live real encerra ensaio aberto');
  const m1 = d('marcos_lojista/' + UID);
  conf(!!m1.primeiraLiveEm && !m1.primeiraLiveAprox && m1.primeiraLiveAviso === 'enviado', 'marco primeiraLiveEm gravado: ' + JSON.stringify(m1));
  conf(tg.length === 1, 'Telegram uma vez');
  conf(/Primeira live no Moviki!/.test(tg[0].text) && /Pastel da Feira/.test(tg[0].text) && /plano teste grátis/.test(tg[0].text) &&
       /moviki\.com\.br\/live\/pastel-da-feira/.test(tg[0].text), 'texto do aviso: ' + tg[0].text);
  conf(m1.ensaios === 1, 'contador de ensaios preservado (so abertura conta): ' + m1.ensaios);
  await T.fechar(UID, {});
  r = await T.abrir({ uid: UID, whep: WHEP, entradaId: 'f'.repeat(32), nivel: 'premium', limiteMin: 60, periodo: 'trial', jaReservado: true });
  conf(r.ok && tg.length === 1, 'segunda live NAO avisa de novo');
  /* duas aberturas simultaneas (outra conta) */
  const UIDC = 'lojistaCORRIDA00001';
  store.set('negocios/' + UIDC, { nome: 'Corrida', slug: 'corrida' });
  const antes = tg.length;
  await Promise.all([marcos.primeiraLive(UIDC, { nome: 'Corrida', slug: 'corrida', nivel: 'premium', periodo: 'mensal' }),
                     marcos.primeiraLive(UIDC, { nome: 'Corrida', slug: 'corrida', nivel: 'premium', periodo: 'mensal' })]);
  conf(tg.length - antes === 1, 'duas chamadas juntas = um aviso so');

  /* ensaio depois da primeira live real: teste gratis com live restante ainda pode */
  zerarFreio(UID);
  r = await T.reservar({ uid: UID, periodo: 'trial', nivel: 'premium', ensaio: true });
  conf(r.erro === 'live_no_ar', 'ensaio com a live real no ar e recusado (derrubaria a live): ' + JSON.stringify(r));
  await T.fechar(UID, {});
  zerarFreio(UID);
  r = await T.reservar({ uid: UID, periodo: 'trial', nivel: 'premium', ensaio: true });
  conf(r.ok, 'teste gratis com 1 live restante ainda ensaia');
  /* gastou as 2 lives do teste: nao ensaia mais */
  store.set('live_cota/' + UID, Object.assign({}, d('live_cota/' + UID), { usadas: 2 }));
  zerarFreio(UID);
  r = await T.reservar({ uid: UID, periodo: 'trial', nivel: 'premium', ensaio: true });
  conf(r.erro === 'ensaio_indisponivel' && r.motivo === 'cota', 'teste gratis sem live restante nao ensaia');

  /* ---- 6. falha do Telegram nao derruba a abertura ---- */
  const UIDF = 'lojistaFALHATG00001';
  store.set('negocios/' + UIDF, { nome: 'Doces', slug: 'doces' });
  tgModo = 'erro';
  r = await T.abrir({ uid: UIDF, whep: WHEP, entradaId: '', nivel: 'enterprise', limiteMin: 180, periodo: 'mensal', jaReservado: true });
  conf(r.ok && d('live_sessoes/' + UIDF).ativa === true, 'Telegram com erro: live abre');
  conf(!!d('marcos_lojista/' + UIDF).primeiraLiveEm && d('marcos_lojista/' + UIDF).primeiraLiveAviso === 'falhou', 'marco gravado mesmo com Telegram falhando');
  /* Telegram travado: a abertura responde em ate ~2,8 s */
  const UIDT = 'lojistaTRAVATG00001';
  store.set('negocios/' + UIDT, { nome: 'Travado', slug: 'travado' });
  tgModo = 'trava';
  const t0 = Date.now();
  r = await T.abrir({ uid: UIDT, whep: WHEP, entradaId: '', nivel: 'premium', limiteMin: 60, periodo: 'mensal', jaReservado: true });
  const dt = Date.now() - t0;
  conf(r.ok && dt < 3200, 'Telegram travado: abertura em ' + dt + ' ms');
  /* Firestore do marco quebrado: a live abre */
  tgModo = 'ok';
  const UIDX = 'lojistaMARCOQUEBRA1';
  const rtOrig = fake.db.runTransaction;
  fake.db.runTransaction = async function (fn) {
    const stack = new Error().stack;
    if (/marcos\.js/.test(stack)) throw new Error('firestore fora');
    return rtOrig.call(this, fn);
  };
  r = await T.abrir({ uid: UIDX, whep: WHEP, entradaId: '', nivel: 'premium', limiteMin: 60, periodo: 'mensal', jaReservado: true });
  fake.db.runTransaction = rtOrig;
  conf(r.ok && d('live_sessoes/' + UIDX).ativa === true, 'erro no marco nao derruba a live');

  /* ---- 7. conta antiga (ja fez live antes do marco existir): sem aviso ---- */
  const UIDA = 'lojistaANTIGO000001';
  store.set('negocios/' + UIDA, { nome: 'Antigo', slug: 'antigo' });
  store.set('live_sessoes/' + UIDA, { ativa: false, inicioMs: Date.now() - 5 * 86400000, sessaoId: 'x' });
  const antesA = tg.length;
  r = await T.abrir({ uid: UIDA, whep: WHEP, entradaId: '', nivel: 'premium', limiteMin: 60, periodo: 'mensal', jaReservado: true });
  conf(r.ok && tg.length === antesA && d('marcos_lojista/' + UIDA).primeiraLiveAprox === true, 'conta antiga: marco aproximado e sem aviso');

  /* ---- 8. plano pago: ensaio so antes da primeira live ---- */
  const UIDP = 'lojistaPAGO00000001';
  r = await T.reservar({ uid: UIDP, periodo: 'mensal', nivel: 'premium', ensaio: true });
  conf(r.ok, 'pagante que nunca fez live ensaia');
  await T.fechar(UIDA, {});
  zerarFreio(UIDA);
  r = await T.reservar({ uid: UIDA, periodo: 'mensal', nivel: 'premium', ensaio: true });
  conf(r.erro === 'ensaio_indisponivel' && r.motivo === 'ja_fez_live', 'pagante que ja fez live nao ensaia');

  /* ---- 9. saldo (o que o estudio le) ---- */
  const UIDS = 'lojistaSALDO0000001';
  store.set('assinaturas/' + UIDS, { ativo: true, plano: 'pro', periodo: 'trial', vence_em: Timestamp.fromMillis(Date.now() + 20 * 86400000) });
  let s = await T.saldo(UIDS);
  conf(s.ok && s.livesUsadas === 0 && s.livesCota === 2 && s.ensaio.pode === true && s.ensaio.restamHoje === T.ENSAIO_DIA, 'saldo oferece o ensaio: ' + JSON.stringify(s.ensaio));
  await T.reservar({ uid: UIDS, periodo: 'trial', nivel: 'premium', ensaio: true });
  s = await T.saldo(UIDS);
  conf(s.livesUsadas === 0 && s.ensaio.restamHoje === T.ENSAIO_DIA - 1, 'ensaio nao entra em "lives usadas"');
  s = await T.saldo(UID);
  conf(s.livesUsadas === 2 && s.ensaio.pode === false, 'quem gastou as 2 lives nao ve o ensaio');

  /* ---- 10. portas HTTP ---- */
  let h = await http({ acao: 'live_ensaio_abrir', dados: { uid: UIDS, entradaId: '' } }, false);
  conf(h.code === 401, 'live_ensaio_abrir sem segredo: 401');
  h = await http({ acao: 'live_ensaio_abrir', dados: { uid: UIDS, entradaId: 'c'.repeat(32), nivel: 'premium', periodo: 'trial' } }, true);
  conf(h.code === 200 && h.body.ensaio === true, 'live_ensaio_abrir com segredo');
  h = await http({ acao: 'live_reservar', dados: { uid: UIDS, periodo: 'trial', nivel: 'premium', ensaio: true } }, true);
  conf(h.code === 200 && h.body.ok, 'live_reservar ensaio pela porta HTTP: ' + JSON.stringify(h.body));
  h = await http({ acao: 'live_ensaio_pulso', idToken: UIDS }, false);
  conf(h.code === 200 && h.body.noAr === true && h.body.ensaio === true, 'live_ensaio_pulso do estudio');
  h = await http({ acao: 'live_ensaio_fechar', idToken: UIDS }, false);
  conf(h.code === 200 && d('live_ensaios/' + UIDS).ativa === false, 'live_ensaio_fechar do estudio');
  h = await http({ acao: 'live_ensaio_pulso', idToken: UIDS }, false);
  conf(h.body.noAr === false, 'pulso depois de fechar: fora do ar');

  /* ---- 11. primeira venda paga na live ---- */
  const ck = require(path.join(ROBO, 'lib/checkout.js'));
  const UIDV2 = 'lojistaVENDA0000001';
  store.set('negocios/' + UIDV2, { nome: 'Loja Venda', slug: 'loja-venda' });
  store.set('pedidos/pedC1', { lojistaUid: UIDV2, status: 'aguardando', origem: 'cardapio', modo: 'pix', itens: [{ nome: 'X', preco: 10, qtd: 1 }], total: 10 });
  await ck._t.marcarPago(fake.db.collection('pedidos').doc('pedC1'), 'lojista');
  conf(d('pedidos/pedC1').status === 'pago' && !(d('marcos_lojista/' + UIDV2) || {}).primeiraVendaLiveEm, 'venda do cardapio nao e marco de live');
  store.set('pedidos/pedL1', { lojistaUid: UIDV2, status: 'aguardando', origem: 'live', modo: 'pix', itens: [{ nome: 'X', preco: 10, qtd: 1 }], total: 10 });
  await ck._t.marcarPago(fake.db.collection('pedidos').doc('pedL1'), 'gateway');
  const mv = d('marcos_lojista/' + UIDV2) || {};
  conf(d('pedidos/pedL1').status === 'pago' && !!mv.primeiraVendaLiveEm && mv.primeiraVendaLivePedido === 'pedL1' && mv.primeiraVendaLivePor === 'gateway', 'primeira venda da live gravada: ' + JSON.stringify(mv));
  store.set('pedidos/pedL2', { lojistaUid: UIDV2, status: 'aguardando', origem: 'live', modo: 'pix', itens: [{ nome: 'X', preco: 10, qtd: 1 }], total: 10 });
  await ck._t.marcarPago(fake.db.collection('pedidos').doc('pedL2'), 'lojista');
  conf(d('marcos_lojista/' + UIDV2).primeiraVendaLivePedido === 'pedL1', 'segunda venda nao sobrescreve o marco');

  console.log((falhas ? 'FALHAS: ' + falhas : 'TUDO OK') + ' (' + ok + ' conferencias)');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
