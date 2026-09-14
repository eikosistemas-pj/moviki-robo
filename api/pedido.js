// api/pedido.js  (repo: moviki-robo) | versao 2026-09-14-porta1
//
// PORTA PUBLICA DO CHECKOUT — so acoes 'compra_*', sem login.
//
// Por que existe, se o api/pontos.js ja atende o checkout desde 11/09:
// o pontos.js virou um arquivo com DOIS publicos — lojista logado e visitante
// anonimo — no mesmo lugar. Enquanto o plano Hobby limitava o projeto a 12
// funcoes, empilhar era a unica saida. Com o Pro (14/09/2026) o teto acabou, e
// separar as portas e a correcao do achado A7 da auditoria de seguranca:
// arquivo com dois publicos e onde erro de autorizacao nasce.
//
// Aqui NAO se verifica idToken de proposito: quem compra e visitante. As
// barreiras sao as do lib/checkout.js — freio por IP e por negocio, preco
// recalculado no servidor, segredo por pedido, consentimento LGPD.
//
// O pontos.js continua aceitando as mesmas acoes por compatibilidade: a
// pagina da live no ar ainda aponta para la. Esta porta e para as telas novas.

const checkout = require('../lib/checkout');

const ORIGENS_OK = [
  'https://app.moviki.com.br',
  'https://moviki.com.br',
  'https://www.moviki.com.br',
];

module.exports = async (req, res) => {
  const orig = String(req.headers.origin || '');
  const permitida = ORIGENS_OK.indexOf(orig) >= 0;
  res.setHeader('Access-Control-Allow-Origin', permitida ? orig : ORIGENS_OK[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const acao = String(body.acao || '');

    /* So o que e do comprador passa por esta porta. 'loja_' e 'adm_' aqui
       seriam recusados pelo proprio checkout por falta de idToken, mas cortar
       antes deixa a superficie desta porta explicita em uma linha. */
    if (!/^compra_/.test(acao)) { res.status(400).json({ ok: false, erro: 'acao' }); return; }

    await checkout.tratar(req, res, body);
  } catch (e) {
    console.error('pedido erro', e);
    res.status(500).json({ ok: false, erro: 'interno' });
  }
};
