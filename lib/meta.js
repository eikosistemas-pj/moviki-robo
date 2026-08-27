// lib/meta.js  (repo: moviki-robo)
// Envia conversoes para a Meta pela Conversions API (CAPI), do lado SERVIDOR.
//
// POR QUE SERVIDOR E NAO PIXEL: o privacidade.html do Moviki diz, na secao 9,
// que o site nao usa cookie de publicidade. Pixel de navegador grava cookie de
// publicidade — subir o pixel contradiz a propria politica publicada e vira
// problema de LGPD. A CAPI manda o evento do robo direto pra Meta, sem cookie
// nenhum no navegador do visitante.
//
// REGRA DE OURO: medicao NUNCA derruba cobranca. Tudo aqui e try/catch com
// timeout curto, devolve booleano e JAMAIS lanca. Meta fora do ar = venda
// segue normal, so nao e medida. Mesmo contrato do lib/ga.js.
//
// Vive em lib/ (nao em api/) de proposito: o teto do plano Hobby e 12 funcoes
// em /api e o repo esta no teto. Isto e um modulo, nao um endpoint.
//
// Envs no Vercel (projeto moviki-robo):
//   META_PIXEL_ID     = ID do conjunto de dados/pixel (Gerenciador de Eventos)
//   META_CAPI_TOKEN   = token de acesso da CAPI (gerar no proprio conjunto de
//                       dados, em Configuracoes > Token de acesso à API de
//                       Conversões). NUNCA no chat, no codigo ou no GitHub.
//   META_TEST_CODE    = (opcional) codigo TEST#### pra ver o evento chegando na
//                       aba "Testar eventos". TIRAR depois do teste — enquanto
//                       existir, o evento NAO conta como conversao de verdade.
//   META_API_VERSION  = (opcional) padrao v25.0, a mesma do robo social.
//
// Sem PIXEL_ID ou sem TOKEN, tudo aqui vira no-op silencioso (retorna false).

const crypto = require('crypto');

const PIXEL = process.env.META_PIXEL_ID || '';
const TOKEN = process.env.META_CAPI_TOKEN || '';
const TESTE = process.env.META_TEST_CODE || '';
const VERSAO = process.env.META_API_VERSION || 'v25.0';

/* A Meta exige os dados da pessoa em SHA-256, nunca em texto claro.
   Normalizar antes de criptografar e obrigatorio: 'Joao@Email.COM ' e
   'joao@email.com' tem hash diferente e a Meta nao casaria os dois. */
function sha(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (!s) return '';
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}
function hashEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || e.indexOf('@') < 1) return '';
  return sha(e);
}
/* Telefone: so digitos, com o codigo do pais. O banco guarda SEM o 55
   (10 ou 11 digitos, decisao da secao 3J do mapa), entao ele e acrescentado. */
function hashTelefone(tel) {
  let d = String(tel || '').replace(/\D+/g, '');
  if (!d) return '';
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (d.length < 12 || d.length > 15) return '';
  return sha(d);
}

/* action_source: de ONDE o evento nasceu. A Meta exige client_user_agent
   quando o valor e 'website' — e um evento que nasce no webhook do Asaas NAO
   tem navegador nenhum pra informar. Por isso:
     Purchase -> 'system_generated' (o robo confirmou o pagamento sozinho)
     Lead     -> 'website' + o agente de usuario REAL, porque o cadastro parte
                 do navegador do lojista e a chamada carrega esse dado.
   Marcar tudo como 'website' faria a Meta recusar ou rebaixar a venda. */

/* Monta o bloco user_data so com o que existe. Campo vazio nao vai:
   a Meta trata string vazia como valor invalido e derruba a qualidade
   da correspondencia do conjunto de dados inteiro. */
function montarUsuario(o) {
  const u = {};
  const em = hashEmail(o.email);
  const ph = hashTelefone(o.telefone);
  const ext = o.uid ? sha(o.uid) : '';
  if (em) u.em = [em];
  if (ph) u.ph = [ph];
  if (ext) u.external_id = [ext];
  if (o.pais !== false) u.country = [sha('br')];
  return u;
}

// Envia UM evento. Devolve true se despachou, false se pulou/falhou.
async function enviarEvento(nome, o) {
  try {
    if (!PIXEL || !TOKEN) return false;          // ainda nao configurado
    if (typeof fetch !== 'function') return false;

    o = o || {};
    const usuario = montarUsuario(o);
    // Sem NENHUM dado de correspondencia a Meta nao consegue atribuir o evento
    // a ninguem — mandar assim so suja o conjunto de dados.
    if (!usuario.em && !usuario.ph && !usuario.external_id) return false;

    const evento = {
      event_name: String(nome),
      event_time: Math.floor((o.quando ? Number(o.quando) : Date.now()) / 1000),
      action_source: String(o.origem || 'website'),
      user_data: usuario,
    };
    // Nao vao em hash: sao dados tecnicos, nao dados da pessoa.
    if (o.agenteUsuario) evento.user_data.client_user_agent = String(o.agenteUsuario).slice(0, 500);
    if (o.ip) evento.user_data.client_ip_address = String(o.ip);
    // event_id: a Meta usa pra nao contar o mesmo evento duas vezes se o
    // webhook do Asaas reenviar. Aqui e sempre o id do pagamento ou do uid.
    if (o.eventoId) evento.event_id = String(o.eventoId);
    if (o.origemUrl) evento.event_source_url = String(o.origemUrl);
    if (o.dados) evento.custom_data = o.dados;

    const corpo = { data: [evento] };
    if (TESTE) corpo.test_event_code = TESTE;

    const url = 'https://graph.facebook.com/' + VERSAO + '/' +
      encodeURIComponent(PIXEL) + '/events?access_token=' + encodeURIComponent(TOKEN);

    // Timeout curto: o webhook do Asaas nao pode ficar preso esperando a Meta.
    const ctrl = new AbortController();
    const t = setTimeout(function () { try { ctrl.abort(); } catch (_) {} }, 2500);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
        signal: ctrl.signal,
      });
      if (r && r.ok) return true;
      // Erro de configuracao (token errado, pixel errado) aparece aqui e so
      // aqui — por isso o corpo da resposta vai pro log, sem derrubar nada.
      try {
        const txt = await r.text();
        console.error('meta CAPI recusou (ignorado):', r.status, String(txt).slice(0, 300));
      } catch (_) {}
      return false;
    } finally {
      clearTimeout(t);
    }
  } catch (e) {
    console.error('meta enviarEvento (ignorado):', e && e.message ? e.message : e);
    return false;
  }
}

// Venda confirmada. valor em reais; id do pagamento vira o event_id.
async function purchase(o) {
  o = o || {};
  const valor = Number(o.valor) || 0;
  if (!(valor > 0)) return false;
  return enviarEvento('Purchase', {
    origem: 'system_generated',   // nasce no webhook do Asaas, sem navegador
    eventoId: o.pagamentoId,
    email: o.email,
    telefone: o.telefone,
    uid: o.uid,
    origemUrl: o.origemUrl || 'https://app.moviki.com.br/',
    dados: {
      currency: 'BRL',
      value: Number(valor.toFixed(2)),
      content_name: [o.plano || '', o.periodo || ''].filter(Boolean).join(' '),
      content_type: 'product',
      content_ids: [String(o.plano || 'plano')],
    },
  });
}

// Cadastro de comerciante. Enquanto o volume de venda for baixo, ESTE e o
// evento que da material pra campanha otimizar — Purchase sozinho demora
// demais pra sair do aprendizado.
async function lead(o) {
  o = o || {};
  return enviarEvento('Lead', {
    origem: 'website',            // parte do navegador do lojista
    agenteUsuario: o.agenteUsuario,
    eventoId: o.uid ? ('lead_' + o.uid) : '',
    email: o.email,
    telefone: o.telefone,
    uid: o.uid,
    origemUrl: o.origemUrl || 'https://app.moviki.com.br/',
    dados: { content_name: o.origem || 'cadastro_comerciante' },
  });
}

module.exports = { enviarEvento, purchase, lead, hashEmail, hashTelefone };
