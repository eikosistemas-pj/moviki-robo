// api/meta-visita.js  (repo: moviki-robo)  | versao 2026-10-07-visita1
// P75, fase 0 — aviso de VISITA a Meta, so de quem chegou por anuncio da Meta.
//
// O QUE FAZ: recebe PageView (abriu uma pagina) e ViewContent (clicou para
// abrir o painel) e repassa pela Conversions API (lib/meta.js > visita).
// Da a campanha o sinal de topo de funil que faltava (2 visualizacoes de
// pagina em 41 cliques, de 26/09 a 06/10) e cria o publico "visitou o site".
//
// QUEM CHAMA:
//   - o painel (app.moviki.com.br), direto, pelo mvmetrica.js. O CSP do app
//     ja libera moviki-robo.vercel.app. IP e navegador saem do proprio pedido.
//   - o site (www.moviki.com.br), pela funcao api/visita.js DO SITE, servidor
//     a servidor. O CSP das paginas do site nao libera este dominio, e mexer
//     em cinco paginas grandes para isso seria arriscado. Pedido sem Origin =
//     veio de servidor; ai o IP e o navegador do visitante vem no corpo.
//
// O QUE NUNCA FAZ:
//   - nao grava nada no aparelho de ninguem (nenhum cookie, nenhum pixel);
//   - nao recebe e-mail, telefone ou uid — so fbc, fbp, a pagina e o evento;
//   - nao manda nada sem fbc valido (visita organica nao gera evento);
//   - nunca responde com detalhe: sempre 204, para nao virar oraculo.
//
// FREIO: 60 eventos por hora por fbc. Um anuncio clicado gera poucas visitas;
// acima disso e laco ou abuso, e evento falso so sujaria o conjunto de dados.

const crypto = require('crypto');
const { admin, db } = require('../lib/firebase');
const { freioUid } = require('../lib/freio');
const meta = require('../lib/meta');

const ORIGENS_NAVEGADOR = ['https://app.moviki.com.br'];
const EVENTOS = ['PageView', 'ViewContent'];
const HOSTS = /^https:\/\/(www\.)?moviki\.com\.br(\/|$)|^https:\/\/app\.moviki\.com\.br(\/|$)/;

function corpoDe(req) {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  try { return JSON.parse(String(b || '{}')); } catch (_) { return {}; }
}

function ipDoPedido(req) {
  const h = (req && req.headers) || {};
  return String(h['x-forwarded-for'] || h['x-real-ip'] || h['x-vercel-forwarded-for'] || '');
}

/* Pagina sem parametros: o endereco do anuncio carrega fbclid e UTMs, e a
   Meta so precisa saber QUAL pagina foi aberta. */
function paginaLimpa(u) {
  const s = String(u || '').slice(0, 1000);
  if (!HOSTS.test(s)) return '';
  try {
    const x = new URL(s);
    return x.origin + x.pathname;
  } catch (_) { return ''; }
}

module.exports = async (req, res) => {
  const origem = String((req.headers && req.headers.origin) || '');
  if (ORIGENS_NAVEGADOR.indexOf(origem) >= 0) {
    res.setHeader('Access-Control-Allow-Origin', origem);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).end(); return; }

  // Navegador de outra origem: recusado. Sem Origin: servidor (api/visita do site).
  const doNavegador = !!origem;
  if (doNavegador && ORIGENS_NAVEGADOR.indexOf(origem) < 0) { res.status(403).end(); return; }

  try {
    const b = corpoDe(req);
    const evento = String(b.evento || '');
    const fbc = meta.limparFbc(b.fbc);
    const pagina = paginaLimpa(b.url);
    const eventoId = /^[A-Za-z0-9_-]{8,64}$/.test(String(b.eventId || '')) ? String(b.eventId) : '';
    if (EVENTOS.indexOf(evento) < 0 || !fbc || !pagina || !eventoId) { res.status(204).end(); return; }

    const chave = crypto.createHash('sha256').update(fbc).digest('hex').slice(0, 40);
    if (!(await freioUid(admin, db, 'metavisita', chave, 60, 3600000))) { res.status(204).end(); return; }

    const ip = doNavegador ? ipDoPedido(req) : String(b.ip || '');
    const agente = doNavegador
      ? String((req.headers && req.headers['user-agent']) || '')
      : String(b.ua || '');

    await meta.visita({
      evento,
      fbc,
      fbp: meta.limparFbp(b.fbp),
      ip,
      agenteUsuario: agente.slice(0, 500),
      eventoId,
      origemUrl: pagina,
      // Pagina em espanhol nao e visitante do Brasil.
      pais: /^https:\/\/(www\.)?moviki\.com\.br\/es(\/|$)/.test(pagina) ? false : undefined,
    });
  } catch (e) {
    console.error('meta-visita (ignorado):', (e && e.message) || e);
  }
  res.status(204).end();
};
