// lib/instagram.js  (repo: moviki-robo)
//
// Busca o perfil publico de um @ do Instagram e devolve nome, foto e numero de
// seguidores. Usado em dois lugares, os dois em api/novo-parceiro.js:
//
//   1) DURANTE o quiz (branch 0, GET ?instagram=<arroba>): o influenciador
//      digita o @ e a tela mostra um cartao com a foto e os seguidores dele
//      pra ele confirmar "sou eu". E so vitrine — nada disso e gravado a
//      partir do que o navegador manda.
//
//   2) DEPOIS do cadastro (branch 1, ja autenticado): o robo refaz a busca
//      pelo Admin SDK e carimba igNome/igSeguidores no cadastro do parceiro.
//      REGRA DE OURO #1: numero de seguidores e dado de valor (define quem e
//      influenciador grande no painel do dono). Se viesse do navegador,
//      qualquer um forjaria 500 mil seguidores no F12. Vem daqui, do servidor.
//
// VIVE EM lib/ E NAO EM api/ DE PROPOSITO: o teto do plano Hobby da Vercel e
// 12 funcoes em /api e o repo ESTA no teto (mesmo motivo do lib/meta.js). Isto
// e um modulo; quem expoe o endpoint e o novo-parceiro.js.
//
// POR QUE A API OFICIAL E NAO O TRUQUE DOS SITES DE SEGUIDORES: aqueles sites
// batem num endpoint interno do Instagram que nao e publicado. Funciona ate o
// dia em que a Meta muda, e ai quebra calado, no meio do cadastro, sem aviso.
// Pior: e uso contra os termos da Meta, com a conta de anuncios do Moviki
// pendurada na mesma marca. business_discovery e a porta oficial pra isso.
//
// LIMITE HONESTO DA API OFICIAL: business_discovery so devolve dados de conta
// PROFISSIONAL (Comercial ou Criador de conteudo). Conta pessoal volta erro.
// Como o publico aqui e influenciador, a grande maioria e profissional — mas
// quem for pessoal PRECISA conseguir se cadastrar do mesmo jeito. Por isso
// achou:false NUNCA e tratado como erro: o @ digitado vale do mesmo jeito.
//
// Envs no Vercel (projeto moviki-robo):
//   IG_USER_ID  = id da conta profissional do Instagram do Moviki
//   IG_TOKEN    = token de acesso de longa duracao da Pagina Moviki.app,
//                 com instagram_basic + pages_read_engagement.
//                 NUNCA no chat, no codigo ou no GitHub.
//   IG_API_VERSION = (opcional) padrao v23.0
//
// Sem IG_USER_ID ou sem IG_TOKEN tudo aqui vira no-op silencioso: devolve
// {ok:false, motivo:'sem_config'} e o cadastro segue normal, sem cartao.

const crypto = require('crypto');

const IG_ID   = process.env.IG_USER_ID || '';
const IG_TOK  = process.env.IG_TOKEN || '';
const VERSAO  = process.env.IG_API_VERSION || 'v23.0';

const CACHE_COL   = 'instagram_cache';
const CACHE_DIAS  = 7;          // depois disso, busca de novo (seguidores mudam)
const TIMEOUT_MS  = 6000;       // a Meta as vezes demora; o quiz nao pode travar
const FOTO_MAX    = 300 * 1024; // teto do arquivo da foto antes de virar data:
const IP_MAX      = 25;         // consultas por IP...
const IP_JANELA   = 10 * 60000; // ...a cada 10 minutos
const DIA_MAX     = 3000;       // teto global por dia, protege a cota da Meta

// A Meta pode nao aceitar is_verified_user em business_discovery dependendo da
// versao/permissao. Na primeira recusa a gente desliga o campo pro resto da
// vida do processo, em vez de perder TODA busca por causa de um selinho.
let PEDIR_VERIFICADO = true;

/* Normaliza o que o usuario digitou. Aceita "@fulano", "fulano",
   "instagram.com/fulano", "https://www.instagram.com/fulano/?hl=pt".
   Devolve so o arroba limpo, minusculo, ou '' se nao sobrar nada valido.
   E ESTA funcao que impede injecao: o @ vai DENTRO de uma chamada
   business_discovery.username(...), entao so pode conter o alfabeto do
   Instagram (letras, numeros, ponto e underline). */
function limparArroba(bruto) {
  let s = String(bruto == null ? '' : bruto).trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.replace(/^instagram\.com\//, '').replace(/^m\.instagram\.com\//, '');
  s = s.split('?')[0].split('/')[0];
  s = s.replace(/^@+/, '');
  if (!/^[a-z0-9._]{1,30}$/.test(s)) return '';
  if (/^\.|\.$/.test(s)) return '';
  return s;
}

function fetchTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
}

/* Baixa a foto do perfil e devolve como data: URI.
   POR QUE NAO MANDAR A URL DIRETO: duas razoes, as duas fatais.
   1) A CSP do painel (img-src) nao libera scontent.cdninstagram.com — o
      navegador bloquearia a imagem e o cartao apareceria quebrado.
   2) A URL da Meta e assinada e EXPIRA em poucas horas. Guardada no cache,
      viraria link morto no dia seguinte.
   data: ja esta liberado na CSP e nunca expira. Se falhar, devolve '' — o
   cartao aparece com as iniciais no lugar da foto, e nada quebra. */
async function fotoComoDataUri(url) {
  if (!url) return '';
  try {
    const r = await fetchTimeout(url, TIMEOUT_MS);
    if (!r.ok) return '';
    const tipo = String(r.headers.get('content-type') || '');
    if (!/^image\/(jpeg|jpg|png|webp)/.test(tipo)) return '';
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > FOTO_MAX) return '';
    return 'data:' + tipo.split(';')[0] + ';base64,' + buf.toString('base64');
  } catch (_) {
    return '';
  }
}

/* A chamada oficial. business_discovery pendura a conta pesquisada DENTRO da
   consulta da propria conta do Moviki — por isso precisa do IG_USER_ID nosso
   e do token da nossa Pagina, e nao de nada do influenciador. */
async function consultarMeta(arroba) {
  const campos = ['username', 'name', 'profile_picture_url', 'followers_count', 'media_count']
    .concat(PEDIR_VERIFICADO ? ['is_verified_user'] : []);

  const url = 'https://graph.facebook.com/' + VERSAO + '/' + encodeURIComponent(IG_ID) +
    '?fields=' + encodeURIComponent('business_discovery.username(' + arroba + '){' + campos.join(',') + '}') +
    '&access_token=' + encodeURIComponent(IG_TOK);

  let r, j;
  try {
    r = await fetchTimeout(url, TIMEOUT_MS);
    j = await r.json();
  } catch (e) {
    console.error('[instagram] falha de rede na Graph API:', e && e.message);
    return { ok: false, motivo: 'falha' };
  }

  if (j && j.error) {
    const msg = String(j.error.message || '');
    const sub = Number(j.error.error_subcode || 0);

    // Campo recusado: desliga o selinho e tenta de novo, uma vez so.
    if (PEDIR_VERIFICADO && /is_verified_user/.test(msg)) {
      PEDIR_VERIFICADO = false;
      return consultarMeta(arroba);
    }

    // 110 = "usuario invalido" / conta pessoal / nao existe. NAO e erro nosso:
    // e a resposta legitima "nao achei". Vira achou:false e o cadastro segue.
    if (sub === 110 || /does not exist|not found|Invalid user/i.test(msg)) {
      return { ok: true, achou: false, motivo: 'nao_profissional' };
    }

    console.error('[instagram] Graph API recusou:', j.error.code, sub, msg);
    return { ok: false, motivo: 'falha' };
  }

  const bd = j && j.business_discovery;
  if (!bd || !bd.username) return { ok: true, achou: false, motivo: 'nao_profissional' };

  return {
    ok: true,
    achou: true,
    arroba: String(bd.username || arroba).slice(0, 30),
    nome: String(bd.name || '').slice(0, 80),
    fotoUrl: String(bd.profile_picture_url || ''),
    seguidores: Number.isFinite(bd.followers_count) ? bd.followers_count : 0,
    posts: Number.isFinite(bd.media_count) ? bd.media_count : 0,
    verificado: bd.is_verified_user === true,
  };
}

/* Cache no Firestore. Existe por dois motivos: a cota da Meta e finita, e o
   mesmo @ e consultado no minimo duas vezes (o cartao do quiz e o carimbo do
   servidor logo depois do cadastro). O documento guarda tambem os "nao achei",
   pra nao bater na Meta toda vez que alguem digita um @ que nao existe. */
async function lerCache(db, arroba) {
  try {
    const s = await db.collection(CACHE_COL).doc(arroba).get();
    if (!s.exists) return null;
    const d = s.data() || {};
    const ms = d.buscadoEm && typeof d.buscadoEm.toMillis === 'function' ? d.buscadoEm.toMillis() : 0;
    if (!ms || Date.now() - ms > CACHE_DIAS * 86400000) return null;
    return d;
  } catch (e) {
    console.error('[instagram] falha ao ler cache:', e && e.message);
    return null;
  }
}

async function gravarCache(admin, db, arroba, dados) {
  try {
    await db.collection(CACHE_COL).doc(arroba).set(
      Object.assign({}, dados, { buscadoEm: admin.firestore.FieldValue.serverTimestamp() })
    );
  } catch (e) {
    console.error('[instagram] falha ao gravar cache:', e && e.message);
  }
}

/* Freio do endpoint aberto. O branch do quiz responde SEM login (o
   influenciador ainda nao tem conta na hora que digita o @), entao sem freio
   qualquer um transformaria o robo do Moviki em consultor gratuito de perfil
   do Instagram e queimaria a nossa cota.
   Dois freios somados: por IP (rajada de uma pessoa) e um teto do dia inteiro
   (rajada distribuida). O IP e guardado em hash — nao interessa saber de quem
   e, so contar. */
async function podeConsultar(admin, db, ip) {
  const inc = admin.firestore.FieldValue.increment(1);
  const agora = Date.now();

  try {
    const dia = new Date().toISOString().slice(0, 10);
    const refDia = db.collection(CACHE_COL).doc('_dia_' + dia);
    const snapDia = await refDia.get();
    if (snapDia.exists && Number((snapDia.data() || {}).n || 0) >= DIA_MAX) {
      console.error('[instagram] teto diario atingido:', DIA_MAX);
      return false;
    }

    const chave = '_ip_' + crypto.createHash('sha256').update(String(ip || 'x')).digest('hex').slice(0, 24);
    const refIp = db.collection(CACHE_COL).doc(chave);
    const snapIp = await refIp.get();
    const d = snapIp.exists ? (snapIp.data() || {}) : {};
    const desde = Number(d.desde || 0);

    if (!desde || agora - desde > IP_JANELA) {
      await refIp.set({ n: 1, desde: agora });
    } else {
      if (Number(d.n || 0) >= IP_MAX) return false;
      await refIp.update({ n: inc });
    }

    await refDia.set({ n: inc }, { merge: true });
    return true;
  } catch (e) {
    // Freio quebrado nao pode derrubar o cadastro de ninguem: deixa passar.
    console.error('[instagram] falha no freio, liberando:', e && e.message);
    return true;
  }
}

/* A funcao publica do modulo.
   opts.ip      -> aplica o freio (usar no branch aberto do quiz)
   opts.semFoto -> nao devolve a foto (usar no carimbo do servidor: o cadastro
                   nao guarda foto, e baixar a imagem a toa custa tempo)

   Devolve SEMPRE um objeto, NUNCA lanca:
     {ok:true,  achou:true,  arroba, nome, foto, seguidores, posts, verificado}
     {ok:true,  achou:false, motivo:'nao_profissional'}
     {ok:false, motivo:'arroba_invalido'|'sem_config'|'limite'|'falha'}       */
async function buscarPerfil(admin, db, arrobaBruto, opts) {
  const o = opts || {};
  const arroba = limparArroba(arrobaBruto);
  if (!arroba) return { ok: false, motivo: 'arroba_invalido' };
  if (!IG_ID || !IG_TOK) return { ok: false, motivo: 'sem_config' };

  const cache = await lerCache(db, arroba);
  if (cache) {
    if (cache.achou === false) return { ok: true, achou: false, motivo: 'nao_profissional', doCache: true };
    return {
      ok: true, achou: true, doCache: true,
      arroba: cache.arroba || arroba,
      nome: cache.nome || '',
      foto: o.semFoto ? '' : (cache.foto || ''),
      seguidores: Number(cache.seguidores || 0),
      posts: Number(cache.posts || 0),
      verificado: cache.verificado === true,
    };
  }

  if (o.ip && !(await podeConsultar(admin, db, o.ip))) return { ok: false, motivo: 'limite' };

  const r = await consultarMeta(arroba);
  if (!r.ok) return r; // falha de rede/token: NAO grava no cache (senao congela o erro)

  if (!r.achou) {
    await gravarCache(admin, db, arroba, { achou: false });
    return { ok: true, achou: false, motivo: 'nao_profissional' };
  }

  const foto = await fotoComoDataUri(r.fotoUrl);
  const paraCache = {
    achou: true, arroba: r.arroba, nome: r.nome, foto: foto,
    seguidores: r.seguidores, posts: r.posts, verificado: r.verificado,
  };
  await gravarCache(admin, db, arroba, paraCache);

  return {
    ok: true, achou: true,
    arroba: r.arroba, nome: r.nome,
    foto: o.semFoto ? '' : foto,
    seguidores: r.seguidores, posts: r.posts, verificado: r.verificado,
  };
}

module.exports = { buscarPerfil, limparArroba };
