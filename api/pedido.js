// api/pedido.js  (repo: moviki-robo) | versao 2026-10-03-vip | antes 2026-09-14-porta1
//
// 03/10/2026 (P70 etapa 4): SAIR DA LISTA VIP COM UM CLIQUE. O e-mail de aviso
// leva o cabecalho List-Unsubscribe apontando para ?vip_sair=<id>-<token>.
// O Gmail e o Yahoo mandam um POST (corpo "List-Unsubscribe=One-Click") e
// exigem isso de quem envia aviso em volume. GET tambem sai, e responde uma
// pagina curta. So apaga com o token certo daquele inscrito.
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

  const vipSair = String((req.query && req.query.vip_sair) || '');
  if (vipSair) {
    try {
      const r = await checkout.vip().sair({ t: vipSair });
      if (req.method === 'POST') { res.status(r.erro ? 400 : 200).json({ ok: !r.erro }); return; }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.status(200).send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Moviki</title>'
        + '<body style="font-family:Arial,sans-serif;max-width:480px;margin:40px auto;padding:0 16px;color:#0d1b2a">'
        + (r.erro ? '<h1 style="font-size:20px">Link inválido</h1><p>Abra o link mais recente que você recebeu.</p>' : '<h1 style="font-size:20px">Pronto, você saiu da lista</h1><p>Você não vai mais receber o aviso de live desta loja.</p>')
        + '</body>');
    } catch (e) { console.error('vip sair', e); res.status(500).json({ ok: false }); }
    return;
  }
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
