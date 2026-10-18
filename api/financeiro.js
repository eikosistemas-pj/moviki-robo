// api/financeiro.js  (repo: moviki-robo) | versao 2026-10-17-seguir (acao loja_instagram: @ do Instagram da loja, lib/seguirLojista.js) | antes 2026-09-14-porta1
//
// PORTA DO LOJISTA E DO DONO — so acoes 'loja_*' e 'adm_*', todas com login.
//
// Par do api/pedido.js. Separar as duas portas e a correcao do achado A7 da
// auditoria de 14/09/2026: ate aqui, lojista logado e visitante anonimo
// entravam pelo mesmo api/pontos.js, por causa do teto de 12 funcoes do plano
// Hobby. Com o Pro esse teto acabou.
//
// Quem confere o login, o plano e o dono e o proprio lib/checkout.js — aqui
// so se garante que nenhuma acao de comprador entra por esta porta e que
// existe idToken antes de gastar leitura de banco.
//
// Acoes que passam por aqui:
//   loja_recebimento  estado do Financeiro do lojista
//   loja_pix          cadastrar ou trocar a chave Pix
//   loja_modo         escolher o modo e ligar/desligar o recebimento
//   loja_asaas        conectar a conta Asaas do proprio lojista
//   loja_pedido       confirmar, recusar, cancelar, marcar entregue
//   loja_comprovante  link assinado do comprovante (20 minutos)
//   loja_estado / loja_criar / loja_ligar   subconta (legado, Enterprise)
//   adm_asaas         conferencia do dono
//   loja_instagram    @ do Instagram da loja + o que falta para a loja ficar
//                     completa (17/10/2026). NAO e dinheiro: e tratada aqui
//                     antes do checkout e nunca chega no lib/checkout.js
//                     (lib/seguirLojista.js, freio de 20 por hora por conta).
//
// O CORS e so do painel: pagina publica nao tem o que fazer nesta porta.

const checkout = require('../lib/checkout');
const { admin, db } = require('../lib/firebase');
const { freioUid } = require('../lib/freio');
const seguir = require('../lib/seguirLojista');

const ORIGEM_OK = 'https://app.moviki.com.br';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGEM_OK);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const acao = String(body.acao || '');

    if (!/^(loja|adm)_/.test(acao)) { res.status(400).json({ ok: false, erro: 'acao' }); return; }
    if (!String(body.idToken || '')) { res.status(401).json({ ok: false, erro: 'sessao' }); return; }

    /* Corta origem estranha ANTES de delegar. O lib/checkout.js reescreve o
       cabecalho de CORS com a lista dele, que inclui o site — o que afrouxaria
       justamente o que esta porta quer manter fechado. Requisicao sem Origin
       (fora do navegador) passa: quem protege ali e o idToken, nao o CORS. */
    const orig = String(req.headers.origin || '');
    if (orig && orig !== ORIGEM_OK) { res.status(403).json({ ok: false, erro: 'origem' }); return; }

    /* 17/10/2026: @ do Instagram da loja. Ler o estado nao gasta freio;
       salvar um @ gasta (cada salvamento consulta a Meta). */
    if (acao === 'loja_instagram') {
      let dec;
      try { dec = await admin.auth().verifyIdToken(String(body.idToken || '')); }
      catch (_) { res.status(401).json({ ok: false, erro: 'sessao' }); return; }
      const salvando = body.arroba !== undefined && body.ler !== true;
      if (salvando && !(await freioUid(admin, db, 'lojaig', dec.uid, 20, 3600000))) {
        res.status(429).json({ ok: false, erro: 'freio', mensagem: 'Muitas tentativas seguidas. Tente de novo daqui a pouco.' }); return;
      }
      const r = await seguir.tratarLoja(dec.uid, body);
      res.status(r.status).json(r.json);
      return;
    }

    await checkout.tratar(req, res, body);
  } catch (e) {
    console.error('financeiro erro', e);
    res.status(500).json({ ok: false, erro: 'interno' });
  }
};
