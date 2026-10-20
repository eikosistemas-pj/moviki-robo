// testes/panfleto-email.test.js — lib/panfletoEmail.js (20/10/2026)
const assert = require('assert');
const pe = require('../lib/panfletoEmail');

const PDF = Buffer.from('%PDF-1.4\n%teste\n').toString('base64');
let n = 0;
function ok(nome, fn) { return Promise.resolve().then(fn).then(() => { n++; console.log('ok', nome); }); }

(async () => {
  await ok('recusa sem destinatario', () => {
    const r = pe.validar({ pdf: PDF }); assert.strictEqual(r.ok, false); assert.strictEqual(r.erro, 'para');
  });
  await ok('recusa e-mail invalido', () => {
    const r = pe.validar({ para: 'grafica@', pdf: PDF }); assert.strictEqual(r.erro, 'para');
  });
  await ok('recusa mais de 3 destinatarios', () => {
    const r = pe.validar({ para: 'a@x.com,b@x.com,c@x.com,d@x.com', pdf: PDF }); assert.strictEqual(r.erro, 'para');
  });
  await ok('junta repetidos e aceita lista com virgula', () => {
    const r = pe.validar({ para: 'A@x.com, a@x.com; b@y.com.br', pdf: PDF });
    assert.ok(r.ok); assert.deepStrictEqual(r.dados.para, ['a@x.com', 'b@y.com.br']);
  });
  await ok('recusa arquivo que nao e PDF', () => {
    const r = pe.validar({ para: 'a@x.com', pdf: Buffer.from('GIF89a....').toString('base64') });
    assert.strictEqual(r.erro, 'pdf');
  });
  await ok('recusa PDF acima de 3 MB', () => {
    const grande = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(pe.MAX_BYTES + 10, 65)]).toString('base64');
    const r = pe.validar({ para: 'a@x.com', pdf: grande }); assert.strictEqual(r.erro, 'pdf');
  });
  await ok('aceita data URL e limpa o nome do arquivo', () => {
    const r = pe.validar({ para: 'a@x.com', pdf: 'data:application/pdf;base64,' + PDF, arquivo: 'Panfleto Eiko/../x' });
    assert.ok(r.ok); assert.ok(/^[a-z0-9._-]+\.pdf$/.test(r.dados.arquivo)); assert.ok(r.dados.arquivo.indexOf('/') < 0);
  });
  await ok('sem chave do Resend nao envia', async () => {
    const r = await pe.enviar({ para: 'a@x.com', pdf: PDF }, { email: 'dono@moviki.com.br' }, { chave: '' });
    assert.strictEqual(r.erro, 'sem_config');
  });
  await ok('envia com anexo, resposta para o dono e copia quando pedida', async () => {
    let pedido = null;
    const r = await pe.enviar({ para: 'grafica@exemplo.com', pdf: PDF, arquivo: 'panfleto-moviki-eiko.pdf', titulo: 'Panfleto <b>', copia: true, sangria: true },
      { email: 'dono@moviki.com.br' },
      { chave: 'k', fetchFn: async (u, o) => { pedido = JSON.parse(o.body); return { ok: true, text: async () => '' }; } });
    assert.ok(r.ok); assert.strictEqual(r.copia, true);
    assert.deepStrictEqual(pedido.to, ['grafica@exemplo.com']);
    assert.deepStrictEqual(pedido.cc, ['dono@moviki.com.br']);
    assert.strictEqual(pedido.reply_to, 'dono@moviki.com.br');
    assert.strictEqual(pedido.attachments[0].filename, 'panfleto-moviki-eiko.pdf');
    assert.strictEqual(pedido.attachments[0].content, PDF);
    assert.ok(pedido.html.indexOf('Panfleto &lt;b&gt;') >= 0);
    assert.ok(/sangria/.test(pedido.text));
  });
  await ok('Resend recusando devolve erro de envio', async () => {
    const r = await pe.enviar({ para: 'a@x.com', pdf: PDF }, {}, { chave: 'k', fetchFn: async () => ({ ok: false, status: 422, text: async () => 'x' }) });
    assert.strictEqual(r.erro, 'envio');
  });
  console.log(n + ' testes passaram');
})().catch((e) => { console.error('FALHOU', e); process.exit(1); });
