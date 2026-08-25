// lib/ga.js  (repo: moviki-robo)
// Envia eventos ao Google Analytics 4 pelo Measurement Protocol (lado servidor).
// Hoje so o evento que importa de verdade: purchase (pagamento CONFIRMADO).
//
// REGRA DE OURO: medicao NUNCA derruba cobranca. Tudo aqui e try/catch com
// timeout, devolve booleano e JAMAIS lanca. Se o GA estiver fora, a venda
// segue normal — so nao e medida.
//
// Vive em lib/ (nao em api/) de proposito: o teto do plano Hobby e 12 funcoes
// em /api e ja esta cheio. Isto e um modulo, nao um endpoint.
//
// Envs no Vercel (projeto moviki-robo):
//   GA_MEASUREMENT_ID  = ID da propriedade GA4 (G-XXXXXXXXXX)
//   GA_API_SECRET      = Admin do GA4 -> Fluxos de dados -> (seu fluxo web) ->
//                        Measurement Protocol -> criar um segredo.
// Sem QUALQUER uma das duas, a funcao simplesmente nao faz nada (retorna false).

const GA_ID = process.env.GA_MEASUREMENT_ID || '';
const GA_SECRET = process.env.GA_API_SECRET || '';
const ENDPOINT = 'https://www.google-analytics.com/mp/collect';

// Envia UM evento. Devolve true se despachou, false se pulou/falhou.
// client_id e obrigatorio no Measurement Protocol: sem ele o GA descarta.
async function enviarEvento(clientId, evento, params, sessionId) {
  try {
    if (!GA_ID || !GA_SECRET) return false;   // ainda nao configurado
    if (!clientId) return false;              // sem sessao do navegador -> nao atribui
    if (typeof fetch !== 'function') return false;

    const ev = { name: String(evento), params: Object.assign({}, params || {}) };
    if (sessionId) ev.params.session_id = String(sessionId);
    // Ajuda o GA a contar a sessao como engajada.
    if (ev.params.engagement_time_msec == null) ev.params.engagement_time_msec = 1;

    const corpo = JSON.stringify({ client_id: String(clientId), events: [ev] });
    const url = ENDPOINT +
      '?measurement_id=' + encodeURIComponent(GA_ID) +
      '&api_secret=' + encodeURIComponent(GA_SECRET);

    // Timeout curto: o webhook do Asaas nao pode ficar preso esperando o GA.
    const ctrl = new AbortController();
    const t = setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, 2500);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: corpo,
        signal: ctrl.signal,
      });
      return !!(r && (r.ok || r.status === 204));
    } finally {
      clearTimeout(t);
    }
  } catch (e) {
    console.error('ga enviarEvento (ignorado):', e && e.message ? e.message : e);
    return false;
  }
}

// Atalho pro purchase (a venda). valor em reais; id do pagamento = transaction_id
// (o GA deduplica transacoes com o mesmo transaction_id, camada extra de trava).
async function purchase(o) {
  o = o || {};
  return enviarEvento(o.clientId, 'purchase', {
    transaction_id: String(o.transactionId || ''),
    value: Number(o.value) || 0,
    currency: 'BRL',
    items: [{
      item_id: 'plano_' + String(o.plano || ''),
      item_name: 'Moviki ' + String(o.plano || '').toUpperCase(),
      item_category: String(o.periodo || ''),
      price: Number(o.value) || 0,
      quantity: 1,
    }],
  }, o.sessionId);
}

module.exports = { enviarEvento, purchase };
