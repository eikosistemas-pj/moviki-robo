'use strict';
// Aviso de seguir o lojista no Instagram (17/10/2026). Sem internet e sem Firebase:
// cd moviki-robo && node testes/seguir-lojista.test.js
process.env.TELEGRAM_TOKEN = 'tg_teste';
process.env.TELEGRAM_CHAT_ID = '123';
delete process.env.IG_USER_ID; delete process.env.IG_TOKEN; // busca da Meta desligada: guarda o @ digitado
const path = require('path');
const assert = require('assert');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'x', filename: 'x', loaded: true, exports: { admin: fake.admin, db: fake.db } };

const tg = [];
let tgModo = 'ok';
global.fetch = async (url, op) => {
  if (/api\.telegram\.org/.test(String(url))) {
    tg.push(JSON.parse(op.body));
    if (tgModo === 'erro') throw new Error('rede caiu');
    return { ok: true, status: 200, json: async () => ({}) };
  }
  throw new Error('fetch inesperado: ' + url);
};

const S = require(path.join(ROBO, 'lib/seguirLojista.js'));
const { store, Timestamp } = fake;

const UID = 'LojistaTeste0001';
const UID2 = 'LojistaTeste0002';
const FOTO = 'https://firebasestorage.googleapis.com/v0/b/x/o/p.jpg?alt=media';
function prod(n, comFoto) { return { nome: 'P' + n, preco: '10,00', fotos: comFoto ? [FOTO] : [] }; }
function negocio(fotos, ramo) {
  return { nome: 'Loja da Ana', slug: 'lojadaana', segmento: ramo === undefined ? 'moda' : ramo,
    cardapio: [{ categoria: 'A', produtos: [prod(1, fotos > 0), prod(2, fotos > 1)] }, { categoria: 'B', produtos: [prod(3, fotos > 2), prod(4, false)] }] };
}

let falhas = 0, ok = 0;
async function t(nome, fn) {
  try { await fn(); ok++; console.log('ok   ' + nome); }
  catch (e) { falhas++; console.log('FALHA ' + nome + '\n     ' + (e && e.stack || e)); }
}

(async () => {
  await t('avaliar: cardapio de exemplo (sem foto) nao conta', () => {
    const a = S._t.avaliar({ segmento: 'moda', cardapio: [{ categoria: 'X', produtos: [{ nome: 'a' }, { nome: 'b' }, { nome: 'c' }] }] }, { arroba: 'ana' });
    assert.strictEqual(a.completa, false); assert.deepStrictEqual(a.falta, ['fotos']); assert.strictEqual(a.fotos, 0);
  });
  await t('avaliar: foto de fora do Storage/ibb nao conta', () => {
    assert.strictEqual(S._t.produtosComFoto([{ produtos: [{ fotos: ['http://evil.com/a.jpg'] }, { fotos: ['javascript:x'] }] }]), 0);
  });
  await t('avaliar: sem ramo, sem fotos, sem @', () => {
    const a = S._t.avaliar({ cardapio: [] }, null);
    assert.deepStrictEqual(a.falta, ['ramo', 'fotos', 'instagram']);
  });

  store.set('negocios/' + UID, negocio(2));

  await t('loja_instagram: @ invalido e recusado', async () => {
    const r = await S.tratarLoja(UID, { arroba: 'nao vale @@' });
    assert.strictEqual(r.status, 400); assert.strictEqual(r.json.erro, 'arroba_invalido');
  });

  await t('salva o @ com 2 fotos: guarda, nao entra na fila, nao avisa', async () => {
    const r = await S.tratarLoja(UID, { arroba: 'https://www.instagram.com/Loja.DaAna/?hl=pt' });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.arroba, 'loja.daana');
    assert.strictEqual(r.json.completa, false); assert.deepStrictEqual(r.json.falta, ['fotos']);
    assert.strictEqual(store.get('lojista_instagram/' + UID).naFila, false);
    assert.ok(!store.has('seguir_lojista/' + UID)); assert.strictEqual(tg.length, 0);
  });

  await t('ler: devolve o @ salvo e o que falta, sem gravar', async () => {
    const r = await S.tratarLoja(UID, { ler: true });
    assert.strictEqual(r.json.arroba, 'loja.daana'); assert.strictEqual(r.json.fotos, 2); assert.strictEqual(r.json.minFotos, 3);
  });

  await t('varredura depois da 3a foto: entra na fila e avisa UMA vez, com botao do perfil', async () => {
    store.set('negocios/' + UID, negocio(3));
    const r = await S.varrer(Date.now(), true);
    assert.strictEqual(r.entraram, 1);
    assert.strictEqual(tg.length, 1);
    assert.ok(/Loja completa/.test(tg[0].text) && /@loja\.daana/.test(tg[0].text) && /Ramo: moda/.test(tg[0].text));
    assert.strictEqual(tg[0].reply_markup.inline_keyboard[0][0].url, 'https://www.instagram.com/loja.daana/');
    const f = store.get('seguir_lojista/' + UID);
    assert.strictEqual(f.seguido, false); assert.strictEqual(f.arroba, 'loja.daana');
    assert.strictEqual(store.get('lojista_instagram/' + UID).naFila, true);
  });

  await t('segunda varredura e salvar o MESMO @ de novo: nao avisa outra vez', async () => {
    await S.varrer(Date.now(), true);
    await S.tratarLoja(UID, { arroba: '@loja.daana' });
    assert.strictEqual(tg.length, 1);
  });

  await t('varredura em simulacao (?dry=1) nao grava nem avisa', async () => {
    store.set('negocios/' + UID2, negocio(3));
    store.set('lojista_instagram/' + UID2, { arroba: 'outra', naFila: false });
    const r = await S.varrer(Date.now(), false);
    assert.strictEqual(r.analisados, 1); assert.strictEqual(r.entraram, 0);
    assert.ok(!store.has('seguir_lojista/' + UID2)); assert.strictEqual(tg.length, 1);
    store.delete('lojista_instagram/' + UID2); store.delete('negocios/' + UID2);
  });

  await t('lista do dono mostra o pendente com o link', async () => {
    const l = await S.listar();
    assert.ok(l.ok); assert.strictEqual(l.pendentes.length, 1);
    assert.strictEqual(l.pendentes[0].link, 'https://www.instagram.com/loja.daana/');
  });

  await t('Ja segui tira da lista', async () => {
    const r = await S.marcarSeguido(UID, 'DonoUid000000001');
    assert.ok(r.ok);
    assert.strictEqual((await S.listar()).pendentes.length, 0);
    assert.strictEqual((await S.marcarSeguido('LojistaNaoExiste99', 'x')).erro, 'nao_encontrado');
  });

  await t('trocou o @ depois de seguido: volta pendente e avisa o @ novo', async () => {
    const r = await S.tratarLoja(UID, { arroba: 'anamodas' });
    assert.strictEqual(r.json.completa, true);
    assert.strictEqual(tg.length, 2); assert.ok(/trocou o Instagram/.test(tg[1].text) && /@anamodas/.test(tg[1].text));
    const f = store.get('seguir_lojista/' + UID);
    assert.strictEqual(f.seguido, false); assert.strictEqual(f.arrobaAnterior, 'loja.daana'); assert.strictEqual(f.avisos, 2);
  });

  await t('Telegram fora do ar nao derruba nada e nao repete', async () => {
    tgModo = 'erro';
    store.set('negocios/' + UID2, negocio(3));
    const r = await S.tratarLoja(UID2, { arroba: 'segunda' });
    assert.strictEqual(r.status, 200); assert.strictEqual(r.json.completa, true);
    assert.ok(store.has('seguir_lojista/' + UID2));
    tgModo = 'ok';
    const n = tg.length; await S.varrer(Date.now(), true);
    assert.strictEqual(tg.length, n, 'nao reavisa');
  });

  await t('lembrete: pendente ha mais de 24 h sai 1 vez por dia', async () => {
    const velho = Timestamp.fromMillis(Date.now() - 30 * 3600000);
    const f1 = store.get('seguir_lojista/' + UID); f1.trocouEm = velho; store.set('seguir_lojista/' + UID, f1);
    const f2 = store.get('seguir_lojista/' + UID2); f2.criadoEm = velho; store.set('seguir_lojista/' + UID2, f2);
    const n = tg.length;
    assert.strictEqual(await S._t.lembrarPendentes(Date.now()), 'enviado');
    assert.strictEqual(tg.length, n + 1); assert.ok(/Ainda falta seguir 2 lojistas/.test(tg[n].text));
    assert.strictEqual(await S._t.lembrarPendentes(Date.now() + 3600000), 'ja_lembrado');
    assert.strictEqual(await S._t.lembrarPendentes(Date.now() + 21 * 3600000), 'enviado');
  });

  await t('lembrete: nada pendente ha 24 h = nenhum', async () => {
    await S.marcarSeguido(UID, 'x'); await S.marcarSeguido(UID2, 'x');
    assert.strictEqual(await S._t.lembrarPendentes(Date.now()), 'nenhum');
  });

  await t('ler depois do Salvar tudo: 3a foto com @ ja salvo entra na fila na hora', async () => {
    const U3 = 'LojistaTeste0003';
    store.set('negocios/' + U3, negocio(3));
    store.set('lojista_instagram/' + U3, { arroba: 'terceira', naFila: false });
    const n = tg.length;
    const r = await S.tratarLoja(U3, { ler: true });
    assert.strictEqual(r.json.completa, true);
    assert.ok(store.has('seguir_lojista/' + U3)); assert.strictEqual(tg.length, n + 1);
    await S.tratarLoja(U3, { ler: true });
    assert.strictEqual(tg.length, n + 1, 'ler de novo nao reavisa');
  });

  await t('texto do aviso nao leva caractere de controle nem < >', () => {
    const m = S._t.montarAviso({ nome: 'A<b>\nX', arroba: 'a', segmento: 'moda', slug: 's' }, 'nova');
    assert.ok(!/[<>]/.test(m)); assert.ok(/Negócio: A b X/.test(m));
  });

  console.log('\n' + ok + ' ok, ' + falhas + ' falha(s)');
  process.exit(falhas ? 1 : 0);
})();
