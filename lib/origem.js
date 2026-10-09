// lib/origem.js  (repo: moviki-robo)  versao 2026-10-09-origem
//
// DE ONDE VEIO CADA CADASTRO DE LOJISTA.
//
// POR QUE EXISTE — 09/10/2026
// O funil do dono contava cadastros, mas so sabia dizer "anuncio da Meta" ou
// "organico". Com o direct do Instagram (ManyChat), o anuncio do Google, o QR
// de panfleto e os parceiros rodando juntos, a verba de R$ 33/dia era dividida
// no escuro. Agora cada cadastro grava UM canal, e o painel do dono soma por
// canal ate o pagante.
//
// De onde sai cada pista (tudo vem do navegador de quem se cadastrou, pelo
// window.mvAtrib() do painel; e dado do cliente, entao e LIMPO e CORTADO aqui
// e nunca decide nada alem desta etiqueta):
//   utm        — "utm_source=...&utm_medium=..." guardado pelo mvmetrica.js
//                na chegada (sessionStorage) ou lido do proprio endereco.
//   ref        — dominio da pagina anterior (document.referrer), so o host.
//   fbc        — clique de anuncio da Meta (fb.1.<ms>.<fbclid>).
//   origemUrl  — endereco do painel no momento do cadastro (gclid, utm).
//   parceiro   — apelido do parceiro que indicou (indicacoes/{uid}.ref),
//                lido NO SERVIDOR, nao do navegador.
//
// Ordem de precedencia (a primeira que bater ganha):
//   parceiro > direct do Instagram (utm_medium=dm, ManyChat) > anuncio Google
//   > anuncio Meta > Instagram organico > Facebook organico > WhatsApp
//   > busca organica > site moviki.com.br > sem origem.
// Parceiro vem primeiro porque e ele quem recebe comissao: o painel do dono
// precisa ver que o cadastro e dele mesmo que tenha passado por um anuncio.

const MAX = 60;

const CANAIS = {
  parceiro:          'Parceiro',
  direct_instagram:  'Direct do Instagram',
  anuncio_google:    'Anúncio Google',
  anuncio_meta:      'Anúncio Meta',
  instagram:         'Instagram (orgânico)',
  facebook:          'Facebook (orgânico)',
  whatsapp:          'WhatsApp',
  busca:             'Busca orgânica',
  site:              'Site moviki.com.br',
  direto:            'Sem origem',
  sem_registro:      'Antes de 09/10 (sem registro)',
};

function limpo(v, n) {
  return String(v == null ? '' : v)
    .replace(/[\u0000-\u001f\u007f<>"'`]/g, '')
    .trim()
    .slice(0, n || MAX);
}
function minusculo(v, n) { return limpo(v, n).toLowerCase(); }

/* "utm_source=x&utm_medium=y" ou um objeto ja pronto -> { source, medium, campaign, content } */
function lerUtm(utm, origemUrl) {
  const out = { source: '', medium: '', campaign: '', content: '' };
  const pegar = (texto) => {
    const s = String(texto || '');
    ['source', 'medium', 'campaign', 'content'].forEach((k) => {
      if (out[k]) return;
      const m = s.match(new RegExp('(?:^|[?&#])utm_' + k + '=([^&#]*)'));
      if (m) {
        let v = m[1];
        try { v = decodeURIComponent(v.replace(/\+/g, ' ')); } catch (_) {}
        out[k] = minusculo(v);
      }
    });
  };
  if (utm && typeof utm === 'object') {
    ['source', 'medium', 'campaign', 'content'].forEach((k) => {
      const v = utm[k] != null ? utm[k] : utm['utm_' + k];
      if (v) out[k] = minusculo(v);
    });
  } else {
    pegar(utm);
  }
  pegar(origemUrl);   // completa o que faltou com o endereco do cadastro
  return out;
}

/* So o dominio, sem www. Aceita "https://l.instagram.com/..." ou "l.instagram.com". */
function hostDe(ref) {
  let s = String(ref || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0].replace(/^www\./, '');
  return /^[a-z0-9.-]{3,80}$/.test(s) ? s : '';
}

function temGclid(origemUrl) {
  return /[?&](gclid|gbraid|wbraid)=/i.test(String(origemUrl || ''));
}

const FONTES_META = ['facebook', 'fb', 'instagram', 'ig', 'meta', 'an', 'msg'];
const MEIOS_PAGOS = ['cpc', 'paid', 'paid_social', 'paidsocial', 'ads', 'ad', 'anuncio', 'ppc', 'cpm'];

/* entrada = { utm, ref, fbc, origemUrl, parceiro }
   saida   = { canal, rotulo, source, medium, campaign, ref, parceiro } */
function classificarOrigem(entrada) {
  const e = entrada || {};
  const u = lerUtm(e.utm, e.origemUrl);
  const ref = hostDe(e.ref);
  const parceiro = minusculo(e.parceiro, 40).replace(/[^a-z0-9_-]/g, '');
  const anuncioMeta = /^fb\.\d\.\d+\..+/.test(String(e.fbc || ''));
  const pago = MEIOS_PAGOS.indexOf(u.medium) >= 0;

  let canal = 'direto';
  if (parceiro.length >= 3) canal = 'parceiro';
  else if (u.medium === 'dm' && (u.source === 'instagram' || u.source === 'ig' || !u.source)) canal = 'direct_instagram';
  else if (temGclid(e.origemUrl) || (u.source === 'google' && pago)) canal = 'anuncio_google';
  else if (anuncioMeta || (FONTES_META.indexOf(u.source) >= 0 && pago)) canal = 'anuncio_meta';
  else if (u.source === 'instagram' || u.source === 'ig' || /(^|\.)instagram\.com$/.test(ref)) canal = 'instagram';
  else if (u.source === 'facebook' || u.source === 'fb' || /(^|\.)facebook\.com$/.test(ref) || ref === 'fb.me') canal = 'facebook';
  else if (u.source === 'whatsapp' || ref === 'wa.me' || /(^|\.)whatsapp\.com$/.test(ref)) canal = 'whatsapp';
  else if (/(^|\.)(google|bing|duckduckgo|yahoo)\.[a-z.]+$/.test(ref)) canal = 'busca';
  else if (/(^|\.)moviki\.com\.br$/.test(ref) && ref !== 'app.moviki.com.br') canal = 'site';

  return {
    canal,
    rotulo: CANAIS[canal],
    source: u.source,
    medium: u.medium,
    campaign: u.campaign,
    ref,
    parceiro: canal === 'parceiro' ? parceiro : '',
  };
}

/* Para cadastro antigo (antes deste arquivo existir) so havia origemAnuncio. */
function origemDoAviso(aviso) {
  const a = aviso || {};
  if (a.origem && CANAIS[a.origem.canal]) {
    return { canal: a.origem.canal, rotulo: CANAIS[a.origem.canal], campaign: limpo(a.origem.campaign, MAX) };
  }
  if (a.origemAnuncio === true) return { canal: 'anuncio_meta', rotulo: CANAIS.anuncio_meta, campaign: '' };
  return { canal: 'sem_registro', rotulo: CANAIS.sem_registro, campaign: '' };
}

/* Linha do aviso no Telegram: "Direct do Instagram (comente-live)". */
function textoOrigem(o) {
  if (!o || !o.canal) return '';
  const extra = o.canal === 'parceiro' ? o.parceiro : (o.campaign || '');
  return o.rotulo + (extra ? ' (' + extra + ')' : '');
}

module.exports = { classificarOrigem, origemDoAviso, textoOrigem, lerUtm, hostDe, CANAIS };
