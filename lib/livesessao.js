/*!
 * MOVIKI lib/livesessao.js | versao 2026-10-14-provisorio (teste provisorio sem e-mail confirmado: ensaio sim, live aberta nao) | antes 2026-10-07-ensaio | antes 2026-10-03-admingoogle | base 2026-09-19-cotalive | repo: moviki-robo
 *
 * 07/10/2026 (P75 fase 1, B7 e parte da B5) — LIVE DE ENSAIO.
 *   Ninguem faz a primeira live "valendo" sem antes testar, e no teste gratis
 *   cada teste comia 1 das 2 lives. O ENSAIO e uma transmissao de verdade
 *   (camera -> Cloudflare), so que SEM PUBLICO, e tudo decidido AQUI:
 *     - NAO consome a cota do teste gratis (live_cota.usadas nao anda, e o
 *       fechamento do ensaio NAO carimba ultimaFechadaEm — senao a carencia de
 *       15 min daria uma live real de graca logo depois do ensaio);
 *     - NAO toca em live_sessoes: a sessao do ensaio mora em
 *       live_ensaios/{uid} (sem regra no Firestore = navegador nao le nem
 *       escreve). Logo: fora da vitrine, fora da lista de lives no ar, a
 *       pagina publica continua dizendo que a live nao comecou, a Lista VIP
 *       recusa (sem_live), a presenca de espectador e recusada pela regra
 *       liveNoAr() e o Pix da live responde live_fora;
 *     - o WHEP (endereco de reproducao) nao e gravado em lugar publico nem
 *       devolvido ao estudio. Ninguem tem como assistir;
 *     - dura no maximo ENSAIO_MIN (10 min, aplicado no pulso, no servidor) e
 *       tem teto de ENSAIO_DIA (5) por dia de Sao Paulo, contado numa
 *       transacao no live_reservar, ANTES do Cloudflare;
 *     - so para quem esta no teste gratis ou ainda nao fez nenhuma live real;
 *       teste gratis com as 2 lives ja usadas nao ensaia (nao ha live depois);
 *     - passa pelo MESMO freio, aceite, bloqueio, filtro de termos e teto de
 *       minutos de video da live real. Minutos de video: o ensaio segue a
 *       mesma regra da live (espectadores x tempo, contado no pulso). Como
 *       ninguem consegue assistir, a conta da zero — e o Cloudflare tambem
 *       cobra zero, porque ele cobra minuto ENTREGUE, nao minuto transmitido.
 *   MARCO DA PRIMEIRA LIVE: a primeira live REAL da conta grava
 *   marcos_lojista/{uid}.primeiraLiveEm e avisa o dono no Telegram UMA vez
 *   (lib/marcos.js). Nada disso derruba a abertura: try/catch e teto de 2,5 s.
 *
 * 19/09/2026 — COTA DE LIVE POR LOJISTA, versao de venda (decisao do Paulo):
 *   - teto de minutos entregues: Premium 3.000 · Enterprise 10.000 · teste 300;
 *   - TOLERANCIA de 20%: em 100% a live em andamento NAO cai; ela segue ate
 *     120% e so ali e encerrada. A PROXIMA fica barrada ate virar o ciclo;
 *   - limite de ESPECTADORES SIMULTANEOS: Premium 30 · Enterprise 100 ·
 *     teste 15. Gravado na sessao (publica); a pagina da live mostra
 *     "Live lotada" a quem chegar acima dele;
 *   - live_saldo: o estudio mostra o saldo do ciclo ANTES de entrar ao vivo;
 *   - live_cota/{uid} passa a guardar o teto aplicado (tetoVideo) — o painel
 *     do dono calcula a porcentagem e o veredito exatos de cada lojista.
 *
 * QUEM DIZ QUE A LIVE ESTA NO AR
 * ==============================
 * Ate 15/09/2026 quem dizia era o proprio lojista. A pagina publica lia
 * `negocios/{uid}/estado/live` — um documento que cai no curinga das regras
 * (`allow write: if request.auth.uid == uid`, sem hasOnly, sem validacao de
 * campo) — e acreditava nos campos `ativa`, `whep` e `pulso`.
 *
 * O QUE ISSO PERMITIA (auditoria de 15/09, achado A2):
 * qualquer lojista com plano — teste gratis inclusive — lia o `whep` de uma
 * live de verdade (negocios/* e read:true), escrevia no proprio estado
 *     { ativa:true, pulso:agora, whep:<whep alheio>, titulo:..., sacola:[...] }
 * e ficava AO VIVO em moviki.com.br/live/<apelido dele> RETRANSMITINDO A
 * IMAGEM DO OUTRO, com o WhatsApp dele, os produtos dele e o Pix dele — sem
 * aceitar as Regras da Live, sem passar pelo beta fechado, sem filtro de termos
 * e sem o api/live.js ser chamado uma unica vez.
 *
 * A CORRECAO E DE DESENHO, NAO DE REMENDO: separar CONTEUDO de AUTORIDADE.
 *
 *   negocios/{uid}/estado/live        escrito pelo LOJISTA (como sempre)
 *                                     titulo, sacola, fixado, oferta, cupom,
 *                                     brinde — CONTEUDO, ja filtrado na tela
 *
 *   live_sessoes/{uid}                escrito SO POR AQUI (Admin SDK)
 *                                     ativa, whep, inicioEm, pulsoEm, nivel,
 *                                     limiteMin, entradaId, encerradaPor
 *                                     — AUTORIDADE
 *
 * A pagina publica passa a decidir "esta no ar" e DE ONDE VEM O VIDEO por
 * live_sessoes/{uid}. Nas regras: `allow read: if true; allow write: if false`.
 * Leitura continua publica, entao o tempo real da pagina nao muda e nao custa
 * nada a mais.
 *
 * A COLECAO E DA RAIZ, e nao subcolecao de negocios/{uid}, por um motivo que
 * quase passou batido: regra do Firestore NAO tem "deny". Dentro de
 * negocios/{uid} existe `match /{documento=**}` com escrita para o dono — um
 * match especifico negando liveSessao nao tiraria essa escrita, porque basta
 * UM match permitir. A correcao inteira teria virado enfeite.
 *
 * O QUE ISTO FECHA DE UMA VEZ (numeracao da auditoria):
 *   A2  retransmissao da live alheia            -> o whep nao vem mais do lojista
 *   A3  "encerrada pelo Moviki" so na tela dele -> quem fecha e o servidor
 *   B1  endereco WHIP eterno                    -> entradaId guardado e apagavel
 *   B2  transmitir invisivel para a moderacao   -> a lista sai daqui
 *   B3  limite de 60/180 min so no relogio      -> aplicado no pulso, no servidor
 *   B6  entradas duplicadas no Cloudflare       -> o id da entrada tem dono unico
 * E entrega a COTA DE LIVES DO TESTE GRATIS decidida em P34.
 *
 * ONDE RODA
 * Nao e endpoint proprio: o projeto tem teto de funcoes na Vercel. Entra como
 * ETAPA de api/pontos.js, exatamente como o lib/checkout.js.
 *
 * AS TRES PORTAS
 *   live_reservar   SERVIDOR->SERVIDOR, e o PRIMEIRO passo do iniciar. Aplica
 *                   o FREIO por lojista e consome a cota do teste gratis ANTES
 *                   de qualquer chamada ao Cloudflare, e devolve o id da
 *                   entrada ja conhecida (para o api/live.js nao precisar
 *                   listar a conta inteira). Ver "O FREIO", abaixo.
 *   live_abrir      SERVIDOR->SERVIDOR. So o moviki/api/live.js chama, com o
 *                   header x-moviki-live = LIVE_SEGREDO. Ele e quem ja conferiu
 *                   plano, bloqueio, beta, aceite e filtro de termos, e e quem
 *                   tem as chaves do Cloudflare.
 *   live_pulso      do ESTUDIO, com idToken do lojista. Carimba o pulso e
 *                   aplica o teto de minutos.
 *   live_fechar     do ESTUDIO, com idToken do lojista.
 *   live_adm_fechar do PAINEL DO DONO, com idToken conferido em admins/{uid}.
 *
 * ENV NOVA (Vercel do moviki-robo, Production)
 *   LIVE_SEGREDO   frase longa e aleatoria, a MESMA cadastrada no projeto
 *                  `moviki`. Falha FECHADA: sem ela, live_abrir recusa e
 *                  nenhuma live comeca. E de proposito — sessao sem dono no
 *                  servidor e exatamente o buraco que estamos fechando.
 *
 * O FREIO — achado B5 da auditoria de 15/09
 *   O `api/live.js` nao tinha limite de chamadas. Um unico lojista rodando
 *   `iniciar` em laco fazia, a cada erro de cache, um GET da LISTA INTEIRA de
 *   entradas do Cloudflare. Estourado o teto do token da conta, o Cloudflare
 *   passa a responder 429 e **NENHUM lojista consegue comecar uma live** — um
 *   uid derrubando o Modo Live inteiro, com a fatura do Firestore subindo junto.
 *
 *   Duas barreiras, nesta ordem:
 *     1. em memoria, no proprio api/live.js: rajada da mesma instancia morre
 *        ali, sem custar leitura nenhuma;
 *     2. aqui, em `live_throttle/{uid}`: contador duravel por minuto, por hora
 *        e por dia, que pega a rajada distribuida por varias instancias — que a
 *        barreira 1, sozinha, nao pegaria.
 *
 *   E o freio roda ANTES do Cloudflare, nao depois: contar cota so no
 *   live_abrir deixava a entrada ja criada quando a cota estava estourada.
 *
 * COTA DO TESTE GRATIS (decisao do Paulo em 15/09)
 *   Teste gratis: 2 lives. Plano pago: sem limite de quantidade.
 *   CARENCIA DE 15 MINUTOS: reabrir ate 15 min depois de fechar NAO consome
 *   cota. Sem isso, uma queda de 4G no meio da feira gastaria a cota inteira e
 *   o lojista ficaria sem teste por causa do sinal — isso nao e trava, e
 *   cancelamento.
 */
'use strict';

const crypto = require('crypto');
const { admin, db } = require('./firebase');
const { conferirAdmin } = require('./admin');
const marcos = require('./marcos');

const FV = admin.firestore.FieldValue;
const SESSAO_COL = 'live_sessoes';
const PULSO_VALIDO_MS = 180000;        // 3 min sem pulso = acabou (igual a tela)
const CARENCIA_MS = 15 * 60000;        // reabrir dentro disso nao consome cota
const COTA_TRIAL = 2;                  // lives no teste gratis
const ENSAIO_MIN = 10;                  // minutos maximos de um ensaio (07/10)
const ENSAIO_DIA = 5;                  // ensaios por dia de Sao Paulo (07/10)
const MARCO_TETO_MS = 2800;            // espera maxima pelo marco/Telegram na abertura (07/10)
const ORIGENS = ['https://app.moviki.com.br', 'https://moviki.com.br', 'https://www.moviki.com.br'];

function txt(s, n) { return String(s == null ? '' : s).replace(/[\x00-\x1f\x7f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }
function ms(t) { return t && typeof t.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : 0); }

function segredoOk(req) {
  const esperado = process.env.LIVE_SEGREDO || '';
  if (esperado.length < 20) return false;              // falha fechada
  const veio = String(req.headers['x-moviki-live'] || '');
  const a = Buffer.from(veio), b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch (_) { return false; }
}

/* ATENCAO — POR QUE ISTO NAO MORA EM negocios/{uid}/estado/liveSessao.
   Regra do Firestore NAO tem "deny": quando varios match casam com o mesmo
   caminho, o acesso e liberado se QUALQUER UM deles permitir. Dentro de
   negocios/{uid} existe o curinga `match /{documento=**}` com
   `allow write: if request.auth.uid == uid` — um match especifico negando NAO
   tiraria a escrita do lojista, porque o curinga ja a concede.
   Por isso a sessao vive numa colecao PROPRIA na raiz, com
   `allow read: if true; allow write: if false;`. De quebra, a lista de lives
   no ar vira uma consulta simples, sem collectionGroup e sem indice novo. */
function refSessao(uid) { return db.collection(SESSAO_COL).doc(uid); }
function refCota(uid) { return db.collection('live_cota').doc(uid); }
function refFreio(uid) { return db.collection('live_throttle').doc(uid); }
/* 07/10: a sessao do ENSAIO. Colecao propria e SEM regra no Firestore: o
   navegador nao le nem escreve, e nenhuma superficie publica (vitrine, pagina
   da live, Lista VIP, Pix da live, presenca) olha para ela. */
function refEnsaio(uid) { return db.collection('live_ensaios').doc(uid); }

/* ------------------------------------------------------------- freio */
/* Tetos por lojista. Generosos para uso real (queda de sinal, reconexao,
   lojista indeciso) e apertados o suficiente para que um laco nao chegue perto
   do teto da conta do Cloudflare. */
const FREIO = { minuto: 3, hora: 20, dia: 60 };

/* ============================================================
   TETO DE MINUTOS DE VIDEO POR PLANO — 16/09/2026
   ============================================================
   Ate aqui existia UMA parede so: `tetoMinutosMes` em
   configuracoes/liveTermos, medida na analytics do Cloudflare e valida para a
   CONTA INTEIRA. Ela protege a fatura do Moviki e nao protege mais nada: um
   unico lojista com publico grande consome os 12.000 minutos sozinho e a live
   de TODOS os outros para, sem aviso, sem culpado e sem nada na tela de quem
   ficou de fora. Quem pagou Premium descobre que nao tem live porque o vizinho
   transmitiu.

   O QUE E "MINUTO DE VIDEO": o Cloudflare cobra por minuto ENTREGUE —
   espectadores x duracao, nao duracao. Uma live de 30 min com 20 pessoas sao
   600 minutos. Por isso o teto por plano nao pode ser o relogio da live
   (`limiteMin`, que ja existe e continua valendo): sao duas paredes
   diferentes, e so esta fala de dinheiro.

   POR QUE A CONTA E NOSSA E NAO DO CLOUDFLARE: a analytics deles agrega por
   conta, demora minutos e a entrada de video e apagada e recriada a cada live
   (achado B4) — nao da para atribuir minuto a lojista por la. Aqui a conta sai
   do nosso proprio dado: a cada pulso, o servidor CONTA a presenca
   (negocios/{uid}/livepresenca, a mesma consulta que o estudio ja faz) e
   multiplica pelo tempo desde o pulso anterior.

   POR QUE O SERVIDOR CONTA, E NAO O ESTUDIO MANDA: o numero de espectadores
   vira dinheiro. Dado de valor nao vem do navegador — bastaria declarar zero
   assistindo para transmitir de graca para sempre.

   FALHA: se a CONTAGEM falhar, o minuto nao e cobrado e a live segue (o
   relatorio erra para baixo; derrubar transmissao por causa de um count e
   pior). Mas se o acumulado JA estourou, a live cai — esse numero ja esta no
   banco e nao depende de ninguem responder. */

const TETO_VIDEO_PADRAO = { premium: 3000, enterprise: 10000, trial: 300 };

/* 19/09/2026 — TOLERANCIA. Cortar a live exatamente em 100% derrubava a
   transmissao que estava VENDENDO — justamente a que deu certo. Agora 100%
   bloqueia a PROXIMA live; a que esta no ar segue ate 100% + tolerancia.
   Custo maximo do excedente: 20% do teto (Premium: 600 min = US$ 0,60).
   Ajustavel no painel (configuracoes/liveTermos.toleranciaVideo, 0 a 0.5). */
const TOLERANCIA_PADRAO = 0.2;

/* 19/09/2026 — ESPECTADORES SIMULTANEOS. Sem isto, 100 pessoas consumiam o
   teto do Premium em meia hora e a live acabava de surpresa. O limite fica na
   sessao (live_sessoes e leitura publica) e a pagina da live mostra "Live
   lotada" a quem chegar acima dele. Tambem limita o estrago de quem forja
   presenca para queimar os minutos de um lojista. 0 = sem limite. */
const ESPECTADORES_PADRAO = { premium: 30, enterprise: 100, trial: 15 };

/* Delta maximo cobrado num pulso. O estudio bate a cada 45 s; um pulso que
   chega 40 minutos depois e aba dormindo ou rede caida, nao publico assistindo
   — cobrar o intervalo cheio inventaria consumo que ninguem entregou. */
const DELTA_MAX_MS = 150000;

/* Presenca vale 100 s, igual ao estudio: a aba carimba a cada 60 s. */
const PRESENCA_MS = 100000;

let termosCache = { em: 0, doc: null };
async function lerTermos() {
  if (termosCache.doc && (Date.now() - termosCache.em) < 300000) return termosCache.doc;
  let d = {};
  try {
    const t = await db.collection('configuracoes').doc('liveTermos').get();
    d = t.exists ? (t.data() || {}) : {};
  } catch (_) { d = termosCache.doc || {}; }
  termosCache = { em: Date.now(), doc: d };
  return d;
}

/* Rotulo do ciclo de faturamento, no mesmo dia de virada do teto global
   (configuracoes/liveTermos.cicloDia, padrao 12). Duas medicoes do mesmo mes
   tem que cair no mesmo balde, senao o teto reseta sozinho no meio. */
function rotuloCiclo(cicloDia, agora) {
  const dia = Math.max(1, Math.min(28, Number(cicloDia) || 1));
  const d = new Date(agora);
  let ano = d.getUTCFullYear(), mes = d.getUTCMonth();
  if (d.getUTCDate() < dia) { mes -= 1; if (mes < 0) { mes = 11; ano -= 1; } }
  return ano + '-' + String(mes + 1).padStart(2, '0');
}

/* Teto daquele lojista, em minutos entregues. 0 = sem teto, igual ao teto
   global e a lista do beta: numero ausente nao inventa parede. */
function tetoDoPlano(nivel, periodo, termos) {
  const t = termos || {};
  if (periodo === 'trial') {
    return Number(t.tetoVideoTrial != null ? t.tetoVideoTrial : TETO_VIDEO_PADRAO.trial) || 0;
  }
  if (nivel === 'enterprise') {
    return Number(t.tetoVideoEnterprise != null ? t.tetoVideoEnterprise : TETO_VIDEO_PADRAO.enterprise) || 0;
  }
  return Number(t.tetoVideoPremium != null ? t.tetoVideoPremium : TETO_VIDEO_PADRAO.premium) || 0;
}

function toleranciaDe(termos) {
  const t = termos || {};
  const v = t.toleranciaVideo != null ? Number(t.toleranciaVideo) : TOLERANCIA_PADRAO;
  return Math.max(0, Math.min(0.5, isFinite(v) ? v : TOLERANCIA_PADRAO));
}

function espectadoresDoPlano(nivel, periodo, termos) {
  const t = termos || {};
  const pega = (k, pad) => {
    const n = t[k] != null ? Number(t[k]) : pad;
    return Math.max(0, Math.min(100000, Math.floor(isFinite(n) ? n : pad)));
  };
  if (periodo === 'trial') return pega('espectadoresTrial', ESPECTADORES_PADRAO.trial);
  if (nivel === 'enterprise') return pega('espectadoresEnterprise', ESPECTADORES_PADRAO.enterprise);
  return pega('espectadoresPremium', ESPECTADORES_PADRAO.premium);
}

/* Dia (dd/mm) em que o ciclo vira — o lojista precisa saber QUANDO volta. */
function viradaDoCiclo(cicloDia, agora) {
  const dia = Math.max(1, Math.min(28, Number(cicloDia) || 1));
  const d = new Date(agora);
  let ano = d.getUTCFullYear(), mes = d.getUTCMonth();
  if (d.getUTCDate() >= dia) { mes += 1; if (mes > 11) { mes = 0; ano += 1; } }
  return String(dia).padStart(2, '0') + '/' + String(mes + 1).padStart(2, '0') + '/' + ano;
}

/* 19/09 — RECONEXAO NA TOLERANCIA. A live que passou de 100% segue no ar ate
   100% + tolerancia. Se o 4G cair nesse trecho, o lojista precisa conseguir
   VOLTAR para a mesma live — senao a tolerancia vira armadilha: o sinal caiu
   e a venda acabou. Vale so dentro da carencia de 15 min depois do fechamento,
   so abaixo do corte, e nunca se quem fechou foi o proprio teto. */
async function reconexaoNaTolerancia(uid, dadosCota, usado, teto, termos) {
  if (!(teto > 0) || usado >= teto * (1 + toleranciaDe(termos))) return false;
  const fechadaMs = ms((dadosCota || {}).ultimaFechadaEm);
  if (!fechadaMs || (Date.now() - fechadaMs) >= CARENCIA_MS) return false;
  try {
    const s = await refSessao(uid).get();
    const m = s.exists ? String((s.data() || {}).motivo || '') : '';
    const porMoviki = s.exists && (s.data() || {}).encerradaPor === 'moviki';
    return m !== 'teto_video' && !porMoviki;
  } catch (_) { return false; }
}

/* Quantos minutos de video este lojista ja consumiu NO CICLO corrente.
   Ciclo diferente do gravado = balde novo: o numero velho nao conta e nem
   precisa ser zerado por rotina nenhuma. */
function consumoDoCiclo(dadosCota, ciclo) {
  const d = dadosCota || {};
  if (String(d.cicloVideo || '') !== ciclo) return 0;
  return Number(d.minutosVideo) || 0;
}

/* Conta quem esta assistindo AGORA, do lado do servidor. `count()` cobra uma
   leitura a cada 1.000 documentos: numa live de 500 pessoas, isto e 1 leitura
   a cada 45 s. */
async function contarAssistindo(uid) {
  try {
    const q = db.collection('negocios').doc(uid).collection('livepresenca')
      .where('em', '>=', admin.firestore.Timestamp.fromMillis(Date.now() - PRESENCA_MS));
    const r = await q.count().get();
    return Number(r.data().count) || 0;
  } catch (_) { return null; }   // null = nao consegui medir; nao cobra
}


/* ENCERRAR LIBERA O FREIO — ajuste de 15/09, depois do teste no ar.
   O freio nasceu para pegar LACO: chamar `iniciar` sem transmitir. Quem abriu a
   live, transmitiu e ENCERROU nao e laco — e uso normal, e reabrir logo em
   seguida e o que qualquer um faz depois de um teste ou de um engano. O teste
   real pegou exatamente isso: live de 10 segundos, encerrou, tentou de novo e
   levou a mensagem de freio.
   Entao o `fechar()` zera o contador do MINUTO. Hora e dia continuam de pe — e
   sao eles que seguram o abuso de verdade. */

/* Janelas fixas, nao deslizantes: uma leitura e uma escrita por chamada, sem
   guardar lista de horarios. Em freio de abuso, simples e melhor que exato. */
function janelas(agora) {
  const d = new Date(agora);
  return {
    min: d.toISOString().slice(0, 16),      // AAAA-MM-DDTHH:MM
    hora: d.toISOString().slice(0, 13),     // AAAA-MM-DDTHH
    dia: d.toISOString().slice(0, 10),      // AAAA-MM-DD
  };
}

/* Quanto falta para a janela virar, em segundos — para a tela poder DIZER a
   espera em vez de so recusar. */
function esperaAte(escala, agora) {
  const d = new Date(agora);
  if (escala === 'minuto') return Math.max(1, 60 - d.getUTCSeconds());
  if (escala === 'hora') return Math.max(1, (60 - d.getUTCMinutes()) * 60);
  return Math.max(1, (24 - d.getUTCHours()) * 3600);
}

async function freioLive(uid) {
  const agora = Date.now();
  const j = janelas(agora);
  const ref = refFreio(uid);
  let recusa = null;
  await db.runTransaction(async (t) => {
    const s = await t.get(ref);
    const d = s.exists ? (s.data() || {}) : {};
    const nMin = (d.janelaMin === j.min) ? (Number(d.nMin) || 0) : 0;
    const nHora = (d.janelaHora === j.hora) ? (Number(d.nHora) || 0) : 0;
    const nDia = (d.janelaDia === j.dia) ? (Number(d.nDia) || 0) : 0;

    if (nMin >= FREIO.minuto) { recusa = { escala: 'minuto', teto: FREIO.minuto, esperaSeg: esperaAte('minuto', agora) }; return; }
    if (nHora >= FREIO.hora) { recusa = { escala: 'hora', teto: FREIO.hora, esperaSeg: esperaAte('hora', agora) }; return; }
    if (nDia >= FREIO.dia) { recusa = { escala: 'dia', teto: FREIO.dia, esperaSeg: esperaAte('dia', agora) }; return; }

    t.set(ref, {
      uid,
      janelaMin: j.min, nMin: nMin + 1,
      janelaHora: j.hora, nHora: nHora + 1,
      janelaDia: j.dia, nDia: nDia + 1,
      ultimaEm: FV.serverTimestamp(),
    }, { merge: true });
  });
  if (recusa) console.warn('live: freio', uid, recusa.escala, recusa.teto);
  return recusa;
}

/* ---------------------------------------------------- reservar (passo 1) */
/* Roda ANTES do Cloudflare. Gasta uma leitura e uma escrita; em troca, impede
   que o laco de um lojista chegue na conta do Cloudflare — e devolve o id da
   entrada que ja existe, para o api/live.js nao precisar listar a conta inteira
   (que era a chamada cara do achado B5). */
async function reservar(b) {
  const uid = String(b.uid || '');
  if (!/^[A-Za-z0-9]{10,128}$/.test(uid)) return { erro: 'uid' };
  const periodo = String(b.periodo || '');

  const ehEnsaio = b.ensaio === true;

  const travado = await freioLive(uid);
  if (travado) return { erro: 'freio', escala: travado.escala, teto: travado.teto, esperaSeg: travado.esperaSeg || 30 };

  /* 07/10 — ENSAIO: quem pode e o teto do dia, decididos AQUI, antes do
     Cloudflare. A cota do teste gratis NAO anda (ver o fim desta funcao). */
  if (ehEnsaio) {
    const pode = await podeEnsaiar(uid, periodo);
    if (!pode.ok) return pode;
  }

  /* 14/10 — TESTE PROVISORIO (e-mail ainda nao confirmado, api/ativar-trial.js):
     o ensaio vale, a live aberta ao publico nao. Decidido AQUI, no robo, para
     nao depender da tela. No teste, sem conseguir ler a assinatura, nao abre
     (falha fechada so para quem esta no teste; quem paga nao e afetado). */
  if (!ehEnsaio && periodo === 'trial') {
    let prov = true;
    try {
      const as = await db.collection('assinaturas').doc(uid).get();
      prov = !!(as.exists && (as.data() || {}).provisorio === true);
    } catch (_) { prov = true; }
    if (prov) return { erro: 'email_nao_confirmado' };
  }

  const cota = ehEnsaio
    ? { pode: true, usadas: 0, restam: null, mesmaSessao: true }   // ensaio nao consome nem confere a cota
    : await conferirCota(uid, periodo);
  if (!cota.pode) return { erro: 'cota', usadas: cota.usadas, cota: COTA_TRIAL };

  /* TETO DE VIDEO DO PLANO — pelo mesmo motivo da cota: aqui, ANTES do
     Cloudflare. Recusar depois deixaria a entrada de video ja criada e a cota
     do teste gratis ja consumida por uma live que nao vai acontecer. */
  const termosR = await lerTermos();
  const tetoR = tetoDoPlano(String(b.nivel || ''), periodo, termosR);
  if (tetoR > 0) {
    const cicloR = rotuloCiclo(termosR.cicloDia, Date.now());
    let usadoR = 0, dadosR = null;
    try {
      const cs = await refCota(uid).get();
      dadosR = cs.exists ? cs.data() : null;
      usadoR = consumoDoCiclo(dadosR, cicloR);
    } catch (_) { usadoR = 0; }   // nao consegui ler: nao barra
    if (usadoR >= tetoR && !(await reconexaoNaTolerancia(uid, dadosR, usadoR, tetoR, termosR))) {
      return { erro: 'teto_video', usadoMin: Math.round(usadoR), tetoMin: tetoR, ciclo: cicloR,
               viraEm: viradaDoCiclo(termosR.cicloDia, Date.now()) };
    }
  }

  /* A cota anda AQUI, e nao no live_abrir: assim uma cota estourada nem chega a
     criar entrada no Cloudflare. O live_abrir recebe `jaReservado` e nao conta
     de novo. */
  /* 07/10: o teto diario do ensaio anda POR ULTIMO, depois de todas as
     recusas — ensaio recusado pelo teto de video nao gasta a vez do dia. */
  let ensaioDia = null;
  if (ehEnsaio) {
    ensaioDia = await contarEnsaioDoDia(uid);
    if (ensaioDia.erro) return ensaioDia;
  }

  if (!ehEnsaio && periodo === 'trial' && !cota.mesmaSessao) {
    await refCota(uid).set({ uid, usadas: FV.increment(1), ultimaAberturaEm: FV.serverTimestamp() }, { merge: true });
  }

  const entradaId = await entradaMaisNova(uid);

  if (ehEnsaio) {
    return { ok: true, ensaio: true, entradaId, restam: null, cota: null,
             ensaiosHoje: ensaioDia.n, ensaiosMaxDia: ENSAIO_DIA, limiteMin: ENSAIO_MIN };
  }
  const restam = periodo === 'trial'
    ? Math.max(0, COTA_TRIAL - (cota.usadas + (cota.mesmaSessao ? 0 : 1)))
    : null;
  return { ok: true, entradaId, restam, cota: periodo === 'trial' ? COTA_TRIAL : null };
}

/* 07/10 — QUAL ENTRADA DO CLOUDFLARE E A ATUAL. Live e ensaio usam a mesma
   entrada por lojista (nome mv-<uid>), recriada a cada abertura (B4). Ate hoje
   so a live existia e o id certo estava sempre em live_sessoes. Com o ensaio,
   a entrada mais nova pode ser a dele — e o api/live.js tenta APAGAR o id
   recebido antes de criar outro: id velho = DELETE recusado = live nao abre.
   Vale a abertura mais recente das duas. */
async function entradaMaisNova(uid) {
  let ses = null, ens = null;
  try {
    const [a, b] = await Promise.all([refSessao(uid).get(), refEnsaio(uid).get()]);
    ses = a.exists ? (a.data() || {}) : null;
    ens = b.exists ? (b.data() || {}) : null;
  } catch (_) {}
  const quando = (d) => (d ? (ms(d.inicioEm) || Number(d.inicioMs) || 0) : -1);
  const escolhido = (ens && ens.entradaId && quando(ens) > quando(ses)) ? ens : ses;
  return (escolhido && escolhido.entradaId) ? String(escolhido.entradaId) : '';
}

/* ============================================================
   LIVE DE ENSAIO — 07/10/2026 (P75 fase 1, B7)
   ============================================================ */
function diaSP(agora) { return new Date((agora || Date.now()) - 3 * 3600000).toISOString().slice(0, 10); }

/* Fez alguma live REAL na vida da conta? marcos_lojista (desde 07/10) ou,
   para conta antiga, uma sessao com inicio gravado. Erro de leitura = trata
   como "ja fez": o ensaio e um extra, nao pode virar porta. */
async function jaFezLiveReal(uid) {
  try {
    const [m, s] = await Promise.all([db.collection('marcos_lojista').doc(uid).get(), refSessao(uid).get()]);
    if (m.exists && (m.data() || {}).primeiraLiveEm) return true;
    if (s.exists) { const d = s.data() || {}; if (ms(d.inicioEm) || Number(d.inicioMs)) return true; }
    return false;
  } catch (_) { return true; }
}

/* Live REAL no ar agora? Ensaio nesse momento recriaria a entrada do
   Cloudflare e DERRUBARIA a live de verdade. */
async function liveRealNoAr(uid) {
  try {
    const s = await refSessao(uid).get();
    if (!s.exists) return false;
    const d = s.data() || {};
    const p = ms(d.pulsoEm) || Number(d.pulsoMs) || 0;
    return d.ativa === true && !d.encerradaPor && p > 0 && (Date.now() - p) < PULSO_VALIDO_MS;
  } catch (_) { return true; }   // nao sei: nao arrisco derrubar a live
}

/* Quem pode ensaiar: teste gratis com live ainda por fazer, ou qualquer plano
   com live que ainda nao fez nenhuma live real. */
async function podeEnsaiar(uid, periodo) {
  if (await liveRealNoAr(uid)) return { erro: 'live_no_ar' };
  if (periodo === 'trial') {
    let usadas = 0;
    try { const c = await refCota(uid).get(); usadas = c.exists ? (Number((c.data() || {}).usadas) || 0) : 0; }
    catch (_) { return { erro: 'ensaio_indisponivel' }; }
    if (usadas >= COTA_TRIAL) return { erro: 'ensaio_indisponivel', motivo: 'cota' };
    return { ok: true };
  }
  if (await jaFezLiveReal(uid)) return { erro: 'ensaio_indisponivel', motivo: 'ja_fez_live' };
  return { ok: true };
}

/* Teto de ensaios por dia (Sao Paulo), numa transacao. Devolve { n } com o
   numero deste ensaio no dia, ou { erro:'ensaio_dia' }. */
async function contarEnsaioDoDia(uid) {
  const dia = diaSP();
  let saida = null;
  await db.runTransaction(async (t) => {
    const s = await t.get(refEnsaio(uid));
    const d = s.exists ? (s.data() || {}) : {};
    const n = (d.diaEnsaio === dia) ? (Number(d.nDia) || 0) : 0;
    if (n >= ENSAIO_DIA) { saida = { erro: 'ensaio_dia', maxDia: ENSAIO_DIA }; return; }
    t.set(refEnsaio(uid), { uid, diaEnsaio: dia, nDia: n + 1 }, { merge: true });
    saida = { n: n + 1 };
  });
  return saida || { erro: 'ensaio_dia', maxDia: ENSAIO_DIA };
}

/* SERVIDOR -> SERVIDOR (o api/live.js, depois do Cloudflare). Grava a sessao
   do ensaio em live_ensaios — NUNCA em live_sessoes — e nao grava o WHEP em
   lugar nenhum: sem endereco de reproducao, ninguem assiste. */
async function abrirEnsaio(b) {
  const uid = String(b.uid || '');
  if (!/^[A-Za-z0-9]{10,128}$/.test(uid)) return { erro: 'uid' };
  /* Mesmo conferido no reservar: a live real pode ter aberto entre as duas
     chamadas. Se abriu, o Cloudflare ja recriou a entrada e este ensaio
     nasceu morto — melhor dizer do que gravar sessao fantasma. */
  if (await liveRealNoAr(uid)) return { erro: 'live_no_ar' };
  const agora = Date.now();
  const sessaoId = 'ensaio_' + uid + '_' + agora;
  await refEnsaio(uid).set({
    uid,
    ativa: true,
    sessaoId,
    entradaId: txt(b.entradaId, 80),
    nivel: (b.nivel === 'enterprise') ? 'enterprise' : 'premium',
    periodo: txt(b.periodo, 20),
    limiteMin: ENSAIO_MIN,
    inicioEm: FV.serverTimestamp(),
    inicioMs: agora,
    pulsoEm: FV.serverTimestamp(),
    pulsoMs: agora,
    motivo: FV.delete(),
    fimEm: FV.delete(),
  }, { merge: true });
  await marcos.ensaio(uid);   // nunca lanca
  return { ok: true, ensaio: true, sessaoId, limiteMin: ENSAIO_MIN };
}

/* Pulso do ensaio (do estudio). Aplica o relogio de ENSAIO_MIN no servidor.
   Minutos de video: nao ha o que contar — sem WHEP publico e sem sessao em
   live_sessoes, a regra liveNoAr() recusa a presenca de qualquer espectador,
   e o Cloudflare cobra minuto ENTREGUE (zero). */
async function pulsoEnsaio(uid) {
  const s = await refEnsaio(uid).get();
  if (!s.exists || (s.data() || {}).ativa !== true) return { ok: true, noAr: false, ensaio: true };
  const d = s.data() || {};
  const inicio = ms(d.inicioEm) || Number(d.inicioMs) || 0;
  const limite = ENSAIO_MIN * 60000;
  const decorrido = inicio ? (Date.now() - inicio) : 0;
  if (inicio && decorrido >= limite) {
    await fecharEnsaio(uid, { motivo: 'limite_ensaio' });
    return { ok: true, noAr: false, ensaio: true, encerrar: true, motivo: 'limite_ensaio',
             mensagem: 'O ensaio chegou aos ' + ENSAIO_MIN + ' minutos e foi encerrado. Ninguém viu: ele não contou nas suas lives.' };
  }
  await refEnsaio(uid).set({ pulsoEm: FV.serverTimestamp(), pulsoMs: Date.now() }, { merge: true });
  const restaMs = inicio ? Math.max(0, limite - decorrido) : limite;
  return { ok: true, noAr: true, ensaio: true, restamMin: Math.ceil(restaMs / 60000), restamSeg: Math.ceil(restaMs / 1000) };
}

/* Fechar o ensaio NAO carimba live_cota.ultimaFechadaEm: a carencia de 15 min
   e da live real. Se carimbasse, a live "de verdade" aberta logo depois do
   ensaio seria tratada como reabertura e nao contaria na cota — o ensaio
   viraria uma live gratis. Zera so o freio do minuto, para "ensaiei, agora
   vou valendo" nao esbarrar nele. */
async function fecharEnsaio(uid, opc) {
  const o = opc || {};
  const s = await refEnsaio(uid).get().catch(() => null);
  if (!s || !s.exists) return { ok: true, ensaio: true };
  const dados = { ativa: false, fimEm: FV.serverTimestamp(), pulsoMs: Date.now() };
  if (o.motivo) dados.motivo = txt(o.motivo, 40);
  await refEnsaio(uid).set(dados, { merge: true });
  await refFreio(uid).set({ uid, janelaMin: '', nMin: 0, fechouEm: FV.serverTimestamp() }, { merge: true }).catch(() => {});
  return { ok: true, ensaio: true };
}

/* Para o estudio: posso oferecer o ensaio? Sem efeito colateral. */
async function infoEnsaio(uid, periodo, usadasTrial) {
  try {
    if (periodo === 'trial') {
      if ((Number(usadasTrial) || 0) >= COTA_TRIAL) return { pode: false, motivo: 'cota' };
    } else if (await jaFezLiveReal(uid)) {
      return { pode: false, motivo: 'ja_fez_live' };
    }
    const e = await refEnsaio(uid).get();
    const d = e.exists ? (e.data() || {}) : {};
    const n = (d.diaEnsaio === diaSP()) ? (Number(d.nDia) || 0) : 0;
    return { pode: n < ENSAIO_DIA, motivo: n < ENSAIO_DIA ? '' : 'ensaio_dia',
             restamHoje: Math.max(0, ENSAIO_DIA - n), maxDia: ENSAIO_DIA, maxMin: ENSAIO_MIN };
  } catch (_) { return { pode: false, motivo: 'erro' }; }
}

/* ---------------------------------------------------------------- cota */
/* Devolve { pode, usadas, restam, mesmaSessao }. `mesmaSessao` e a carencia:
   dentro dela a live que reabre e a MESMA, nao uma nova. */
async function conferirCota(uid, periodo) {
  if (periodo !== 'trial') return { pode: true, usadas: 0, restam: null, mesmaSessao: false };
  const s = await refCota(uid).get();
  const d = s.exists ? (s.data() || {}) : {};
  const usadas = Number(d.usadas) || 0;
  const fechadaMs = ms(d.ultimaFechadaEm);
  const mesmaSessao = !!(fechadaMs && (Date.now() - fechadaMs) < CARENCIA_MS && usadas > 0);
  if (mesmaSessao) return { pode: true, usadas, restam: Math.max(0, COTA_TRIAL - usadas), mesmaSessao: true };
  if (usadas >= COTA_TRIAL) return { pode: false, usadas, restam: 0, mesmaSessao: false };
  return { pode: true, usadas, restam: COTA_TRIAL - usadas, mesmaSessao: false };
}

/* ------------------------------------------------------- abrir a sessao */
async function abrir(b) {
  const uid = String(b.uid || '');
  if (!/^[A-Za-z0-9]{10,128}$/.test(uid)) return { erro: 'uid' };
  const whep = String(b.whep || '');
  /* Mesmo vindo do nosso proprio servidor, o endereco e conferido aqui: e ele
     que a pagina publica vai tocar. Uma so forma aceita. */
  if (!/^https:\/\/customer-[a-z0-9]+\.cloudflarestream\.com\/[a-f0-9]{32}\/webRTC\/play$/.test(whep)) return { erro: 'whep' };
  const nivel = (b.nivel === 'enterprise') ? 'enterprise' : 'premium';
  const limiteMin = Math.max(1, Math.min(600, Number(b.limiteMin) || 60));
  const periodo = String(b.periodo || '');

  /* Quando o api/live.js ja passou pelo live_reservar, a cota ja andou la — e
     contar de novo aqui comeria duas lives de uma vez. */
  const jaReservado = b.jaReservado === true;
  const cota = jaReservado
    ? { pode: true, usadas: 0, restam: null, mesmaSessao: true }
    : await conferirCota(uid, periodo);
  if (!cota.pode) {
    return { erro: 'cota', usadas: cota.usadas, cota: COTA_TRIAL };
  }

  /* TETO DE VIDEO DO PLANO — barrado AQUI, e nao 45 s depois no primeiro
     pulso. Abrir para fechar em seguida ja teria criado a entrada no
     Cloudflare, avisado os seguidores e posto o lojista no ar na frente de
     quem estava esperando. */
  const termosAb = await lerTermos();
  const tetoAb = tetoDoPlano(nivel, periodo, termosAb);
  if (tetoAb > 0) {
    const cicloAb = rotuloCiclo(termosAb.cicloDia, Date.now());
    let usadoAb = 0, dadosAb = null;
    try {
      const cs = await refCota(uid).get();
      dadosAb = cs.exists ? cs.data() : null;
      usadoAb = consumoDoCiclo(dadosAb, cicloAb);
    } catch (_) { usadoAb = 0; }   // nao consegui ler: nao barra
    if (usadoAb >= tetoAb && !(await reconexaoNaTolerancia(uid, dadosAb, usadoAb, tetoAb, termosAb))) {
      return { erro: 'teto_video', usadoMin: Math.round(usadoAb), tetoMin: tetoAb, ciclo: cicloAb,
               viraEm: viradaDoCiclo(termosAb.cicloDia, Date.now()) };
    }
  }

  const agora = Date.now();
  const sessaoId = uid + '_' + agora;

  /* 07/10 — o que existia ANTES desta abertura: serve ao marco da primeira
     live (conta antiga que ja transmitiu nao recebe "Primeira live!") e para
     encerrar um ensaio que estivesse aberto (a entrada dele acabou de ser
     apagada pelo api/live.js). Falha de leitura nao muda nada na live. */
  let sesAntes = null, ensAntes = null;
  try {
    const [sa, ea] = await Promise.all([refSessao(uid).get(), refEnsaio(uid).get()]);
    sesAntes = sa.exists ? (sa.data() || {}) : null;
    ensAntes = ea.exists ? (ea.data() || {}) : null;
  } catch (_) {}

  /* ---------- VITRINE PUBLICA: quem esta no ar AGORA ----------
     16/09/2026. Ate aqui `live_sessoes` guardava so o estado tecnico da live
     (whep, nivel, pulso). Nenhuma superficie publica do Moviki mostrava quem
     esta transmitindo: a live so era descoberta pelo link que o proprio
     lojista mandava no WhatsApp. Ou seja, o Moviki nao entregava um unico
     espectador — o lojista trazia a audiencia que ja tinha, e a promessa de
     "vender para quem esta perto" nao se cumpria em lugar nenhum.
     O cartao de identidade da live e gravado AQUI, uma vez por live: uma
     leitura de `negocios/{uid}` na abertura, contra uma leitura por lojista a
     cada vez que alguem abrir a vitrine. Nome trocado no meio da live segue o
     antigo ate a proxima — troco justo.
     Nada aqui derruba a live: se a leitura falhar, a sessao nasce sem cartao e
     a vitrine simplesmente nao mostra aquele lojista. */
  let cartao = {};
  try {
    const ns = await db.collection('negocios').doc(uid).get();
    const n = ns.exists ? (ns.data() || {}) : {};
    const logo = String(n.markerLogo || '');
    cartao = {
      slug: txt(n.slug, 40),
      nome: txt(n.nome, 80),
      segmento: txt(n.segmento, 40),
      logo: /^https:\/\/[a-z0-9.-]*(ibb\.co|firebasestorage\.googleapis\.com|firebasestorage\.app)\//i.test(logo) ? logo : '',
    };
  } catch (_) { cartao = {}; }

  await refSessao(uid).set(Object.assign({
    ativa: true,
    whep,
    nivel,
    limiteMin,
    sessaoId,
    entradaId: txt(b.entradaId, 80),
    inicioEm: FV.serverTimestamp(),
    inicioMs: agora,
    pulsoEm: FV.serverTimestamp(),
    pulsoMs: agora,
    /* 16/09: o periodo passa a viver na sessao. O pulso precisa dele para
       saber qual teto de video aplicar, e ate aqui ele so existia na chamada
       de abertura. */
    periodo: txt(periodo, 20),
    /* 19/09: limite de espectadores simultaneos desta live. Publico de
       proposito — e a pagina da live que mostra "Live lotada". */
    maxEspectadores: espectadoresDoPlano(nivel, periodo, termosAb),
    motivo: FV.delete(),
    encerradaPor: FV.delete(),
    motivoModeracao: FV.delete(),
    fimEm: FV.delete(),
  }, cartao), { merge: true });

  /* A cota so anda quando a live e NOVA. Reabertura dentro da carencia nao
     conta — ver o comentario do topo. */
  if (periodo === 'trial' && !jaReservado && !cota.mesmaSessao) {
    await refCota(uid).set({
      uid, usadas: FV.increment(1), ultimaAberturaEm: FV.serverTimestamp(),
    }, { merge: true });
  }

  /* 07/10: a live real derruba o ensaio que estivesse aberto (a entrada dele
     ja foi apagada no Cloudflare). */
  if (ensAntes && ensAntes.ativa === true) {
    await refEnsaio(uid).set({ ativa: false, fimEm: FV.serverTimestamp(), motivo: 'live_real' }, { merge: true }).catch(() => {});
  }

  /* 07/10 — MARCO DA PRIMEIRA LIVE (P75, B5). Uma vez na vida da conta,
     com aviso no Telegram. Nunca derruba a live: marcos.primeiraLive nao
     lanca, e esperamos no maximo MARCO_TETO_MS pela resposta. */
  try {
    const anteriorMs = sesAntes ? (ms(sesAntes.inicioEm) || Number(sesAntes.inicioMs) || 0) : 0;
    await marcos.comTeto(marcos.primeiraLive(uid, {
      nome: cartao.nome, slug: cartao.slug, nivel, periodo, sessaoId,
      jaTeveLive: anteriorMs > 0, liveAnteriorMs: anteriorMs,
    }), MARCO_TETO_MS);
  } catch (_) {}

  const restam = (periodo === 'trial' && !jaReservado)
    ? Math.max(0, COTA_TRIAL - (cota.usadas + (cota.mesmaSessao ? 0 : 1)))
    : null;
  return { ok: true, sessaoId, restam, cota: periodo === 'trial' ? COTA_TRIAL : null };
}

/* -------------------------------------------------------------- pulso */
/* O estudio bate aqui a cada 45 s. Alem de manter a live no ar, este e o lugar
   onde o TETO DE MINUTOS passa a existir de verdade: ate hoje ele era so o
   relogio da tela do lojista, e um `nivel.limiteMin=99999` no console fazia a
   live de 60 minutos durar doze horas. */
async function pulso(uid) {
  const s = await refSessao(uid).get();
  if (!s.exists || s.data().ativa !== true) return { ok: true, noAr: false };
  const d = s.data() || {};
  const inicio = ms(d.inicioEm) || Number(d.inicioMs) || 0;
  const limite = (Number(d.limiteMin) || 60) * 60000;
  const decorrido = inicio ? (Date.now() - inicio) : 0;

  if (inicio && decorrido >= limite) {
    await fechar(uid, { motivo: 'limite' });
    return { ok: true, noAr: false, encerrar: true, motivo: 'limite' };
  }
  /* ---------- TETO DE MINUTOS DE VIDEO DO PLANO ---------- */
  const agoraP = Date.now();
  const termos = await lerTermos();
  const teto = tetoDoPlano(d.nivel, String(d.periodo || ''), termos);
  let video = null;

  if (teto > 0) {
    const ciclo = rotuloCiclo(termos.cicloDia, agoraP);
    const anterior = Number(d.pulsoMs) || agoraP;
    const delta = Math.max(0, Math.min(DELTA_MAX_MS, agoraP - anterior));
    const assistindo = await contarAssistindo(uid);

    let usado = 0;
    try {
      const cs = await refCota(uid).get();
      usado = consumoDoCiclo(cs.exists ? cs.data() : null, ciclo);

      /* Minuto ENTREGUE = espectadores x tempo. Sem ninguem assistindo o
         Cloudflare nao entrega nada e nada e cobrado — live vazia nao gasta
         teto, mesmo rodando. */
      if (assistindo !== null && assistindo > 0 && delta > 0) {
        const minutos = (assistindo * delta) / 60000;
        const novo = usado + minutos;
        await refCota(uid).set({
          uid,
          cicloVideo: ciclo,
          minutosVideo: Math.round(novo * 100) / 100,
          /* 19/09: o teto aplicado vai junto — o painel do dono calcula a
             porcentagem e o veredito de cada lojista sem ler a assinatura. */
          tetoVideo: teto,
          videoMedidoEm: FV.serverTimestamp(),
        }, { merge: true });
        usado = novo;
      }
    } catch (_) { /* nao mediu: nao cobra, e o acumulado que ja existe decide */ }

    /* 19/09: em 100% a live NAO cai (bloqueia so a proxima, no reservar).
       Cai em 100% + tolerancia — o excedente tem teto. */
    const corte = teto * (1 + toleranciaDe(termos));
    const viraEm = viradaDoCiclo(termos.cicloDia, agoraP);
    if (usado >= corte) {
      await fechar(uid, { motivo: 'teto_video' });
      return {
        ok: true, noAr: false, encerrar: true, motivo: 'teto_video',
        usadoMin: Math.round(usado), tetoMin: teto, viraEm,
        mensagem: 'Sua live foi encerrada: o plano passou do limite de minutos de vídeo deste ciclo, ' +
                  'já contando a tolerância de ' + Math.round(toleranciaDe(termos) * 100) + '%. ' +
                  'A próxima live fica liberada em ' + viraEm + '.',
      };
    }
    video = {
      videoRestamMin: Math.max(0, Math.round(teto - usado)),
      videoPct: Math.floor((usado * 100) / teto),
      videoTetoMin: teto,
      videoUsadoMin: Math.round(usado),
      videoToleranciaRestamMin: Math.max(0, Math.round(corte - usado)),
      viraEm,
    };
  }

  await refSessao(uid).set({ pulsoEm: FV.serverTimestamp(), pulsoMs: agoraP }, { merge: true });
  const restaMs = inicio ? Math.max(0, limite - decorrido) : limite;
  const saida = { ok: true, noAr: true, restamMin: Math.ceil(restaMs / 60000) };
  if (video) Object.assign(saida, video);
  return saida;
}

/* ------------------------------------------------------------- fechar */
async function fechar(uid, opc) {
  const o = opc || {};
  const dados = {
    ativa: false,
    fimEm: FV.serverTimestamp(),
    pulsoEm: FV.serverTimestamp(),
    pulsoMs: Date.now(),
  };
  if (o.porMoviki) {
    dados.encerradaPor = 'moviki';
    dados.motivoModeracao = txt(o.motivo, 200);
  } else if (o.motivo) {
    dados.motivo = txt(o.motivo, 40);
  }
  await refSessao(uid).set(dados, { merge: true });
  /* Carimba o fim para a carencia de 15 min saber medir a reabertura. */
  await refCota(uid).set({ uid, ultimaFechadaEm: FV.serverTimestamp() }, { merge: true }).catch(() => {});
  /* Encerrou de verdade -> zera o contador do minuto, para reabrir logo em
     seguida nao esbarrar no freio. Hora e dia ficam de pe. */
  await refFreio(uid).set({ uid, janelaMin: '', nMin: 0, fechouEm: FV.serverTimestamp() }, { merge: true }).catch(() => {});
  return { ok: true };
}

/* -------------------------------------------------------------- saldo */
/* 19/09/2026 — o estudio mostra o saldo do ciclo ANTES de o lojista entrar ao
   vivo. Ate aqui o unico jeito de saber era o aviso durante a live, ou a
   recusa na hora de comecar. Custa 3 leituras, uma vez por abertura do estudio.
   O plano e lido aqui, com Admin SDK, na MESMA regra do api/live.js
   (nivelDaAssinatura): ativo, nao vencido; teste gratis conta como Premium. */
async function saldo(uid) {
  const [a, c, termos] = await Promise.all([
    db.collection('assinaturas').doc(uid).get(),
    refCota(uid).get(),
    lerTermos(),
  ]);
  const f = a.exists ? (a.data() || {}) : {};
  const vence = ms(f.vence_em);
  const ativo = f.ativo === true && !(vence && vence < Date.now());
  // 23/09 (rodada 3): Pro pago durante o teste segue com os LIMITES do teste ate o fim dele.
  const periodo = (f.plano === 'pro' && ms(f.testeAte) > Date.now()) ? 'trial' : String(f.periodo || '');
  const nivel = !ativo ? '' : (f.plano === 'enterprise' ? 'enterprise'
    : ((f.plano === 'premium' || periodo === 'trial' || ms(f.testeAte) > Date.now()) ? 'premium' : ''));  // 23/09: testeAte = pagou durante o teste
  if (!nivel) return { ok: true, nivel: '' };
  const agora = Date.now();
  const ciclo = rotuloCiclo(termos.cicloDia, agora);
  const teto = tetoDoPlano(nivel, periodo, termos);
  const usado = consumoDoCiclo(c.exists ? c.data() : null, ciclo);
  /* 07/10: lives do teste (so as REAIS; ensaio nao entra em live_cota) e se o
     estudio pode oferecer o ensaio. Quem decide de verdade e o reservar. */
  const usadasTrial = c.exists ? (Number((c.data() || {}).usadas) || 0) : 0;
  const ensaio = await infoEnsaio(uid, periodo, usadasTrial);
  return {
    ok: true, nivel, periodo,
    livesUsadas: periodo === 'trial' ? usadasTrial : null,
    livesCota: periodo === 'trial' ? COTA_TRIAL : null,
    ensaio,
    tetoMin: teto,                                        // 0 = sem teto
    usadoMin: Math.round(usado),
    pct: teto > 0 ? Math.floor((usado * 100) / teto) : 0,
    bloqueada: teto > 0 && usado >= teto,
    toleranciaPct: Math.round(toleranciaDe(termos) * 100),
    maxEspectadores: espectadoresDoPlano(nivel, periodo, termos),
    viraEm: viradaDoCiclo(termos.cicloDia, agora),
  };
}

/* ------------------------------------------------ o que a moderacao ve */
/* A lista de lives no ar deixa de ser declaracao voluntaria do vigiado (o
   documento `lives/{id}`, que o proprio lojista escreve e podia marcar
   ativa:false continuando a transmitir) e passa a sair daqui, de uma consulta
   direta em live_sessoes — colecao que so o Admin SDK escreve. */
async function noAr(limite) {
  const n = Math.max(1, Math.min(200, Number(limite) || 60));
  const q = await db.collection(SESSAO_COL).where('ativa', '==', true).limit(n * 2).get();
  const out = [];
  q.forEach((d) => {
    const v = d.data() || {};
    if ((Date.now() - (ms(v.pulsoEm) || Number(v.pulsoMs) || 0)) > PULSO_VALIDO_MS) return;
    out.push({ uid: d.id, sessaoId: v.sessaoId || '', nivel: v.nivel || '', inicioMs: ms(v.inicioEm) || Number(v.inicioMs) || 0 });
  });
  out.sort((a, b) => b.inicioMs - a.inicioMs);
  return { ok: true, lives: out.slice(0, n) };
}

/* --------------------------------------------------------- roteamento */
function ehAcao(acao) { return /^live_/.test(String(acao || '')); }

async function tratar(req, res, body) {
  const o = String(req.headers.origin || '');
  if (ORIGENS.indexOf(o) >= 0) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); }
  const acao = String(body.acao || '');

  try {
    /* --- servidor -> servidor: so o moviki/api/live.js --- */
    if (acao === 'live_reservar') {
      if (!segredoOk(req)) { res.status(401).json({ ok: false, erro: 'segredo' }); return; }
      const r = await reservar(body.dados || body);
      res.status(r.erro ? 429 : 200).json(r.erro ? Object.assign({ ok: false }, r) : r);
      return;
    }
    if (acao === 'live_abrir') {
      if (!segredoOk(req)) { res.status(401).json({ ok: false, erro: 'segredo' }); return; }
      const r = await abrir(body.dados || body);
      res.status(r.erro ? 400 : 200).json(r.erro ? Object.assign({ ok: false }, r) : r);
      return;
    }
    if (acao === 'live_ensaio_abrir') {
      if (!segredoOk(req)) { res.status(401).json({ ok: false, erro: 'segredo' }); return; }
      const r = await abrirEnsaio(body.dados || body);
      res.status(r.erro ? 400 : 200).json(r.erro ? Object.assign({ ok: false }, r) : r);
      return;
    }

    /* --- daqui para baixo, lojista logado --- */
    let dec;
    /* 06/10 (plano 2.3): checkRevoked=true. Sessao cancelada (senha trocada, conta desativada pela Guarda, revogada no console) e recusada na hora, em vez de valer ate 1 h. Custa 1 leitura do Auth por chamada; so nas portas de dinheiro e de dono. */
    try { dec = await admin.auth().verifyIdToken(String(body.idToken || ''), true); }
    catch (_) { res.status(401).json({ ok: false, erro: 'sessao' }); return; }

    if (acao === 'live_pulso') {
      const r = await pulso(dec.uid);
      res.status(200).json(r); return;
    }
    if (acao === 'live_saldo') {
      const r = await saldo(dec.uid);
      res.status(200).json(r); return;
    }
    if (acao === 'live_fechar') {
      const r = await fechar(dec.uid, {});
      res.status(200).json(r); return;
    }
    if (acao === 'live_ensaio_pulso') {
      const r = await pulsoEnsaio(dec.uid);
      res.status(200).json(r); return;
    }
    if (acao === 'live_ensaio_fechar') {
      const r = await fecharEnsaio(dec.uid, {});
      res.status(200).json(r); return;
    }

    /* --- dono do Moviki, conferido no servidor --- */
    if (acao === 'live_adm_fechar' || acao === 'live_adm_noar') {
      const adm = await conferirAdmin(db, dec);
      if (!adm.ok) { res.status(adm.status).json({ ok: false, erro: adm.erro, mensagem: adm.mensagem }); return; }
      if (acao === 'live_adm_noar') { res.status(200).json(await noAr(body.limite)); return; }
      const alvo = String((body.dados && body.dados.uid) || body.uid || '');
      if (!/^[A-Za-z0-9]{10,128}$/.test(alvo)) { res.status(400).json({ ok: false, erro: 'uid' }); return; }
      const r = await fechar(alvo, { porMoviki: true, motivo: (body.dados && body.dados.motivo) || body.motivo });
      res.status(200).json(r); return;
    }

    res.status(400).json({ ok: false, erro: 'acao' });
  } catch (e) {
    console.error('livesessao erro', acao, e);
    res.status(500).json({ ok: false, erro: 'interno' });
  }
}

module.exports = {
  ehAcao, tratar,
  _t: { abrir, pulso, fechar, noAr, conferirCota, reservar, freioLive, esperaAte, segredoOk,
        rotuloCiclo, tetoDoPlano, consumoDoCiclo, contarAssistindo, saldo,
        toleranciaDe, espectadoresDoPlano, viradaDoCiclo,
        abrirEnsaio, pulsoEnsaio, fecharEnsaio, podeEnsaiar, contarEnsaioDoDia, infoEnsaio,
        entradaMaisNova, jaFezLiveReal, diaSP,
        COTA_TRIAL, CARENCIA_MS, FREIO, TETO_VIDEO_PADRAO, DELTA_MAX_MS,
        TOLERANCIA_PADRAO, ESPECTADORES_PADRAO, ENSAIO_MIN, ENSAIO_DIA, MARCO_TETO_MS },
};
