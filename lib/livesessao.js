/*!
 * MOVIKI lib/livesessao.js | versao 2026-09-16-tetoplano | repo: moviki-robo
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

const FV = admin.firestore.FieldValue;
const SESSAO_COL = 'live_sessoes';
const PULSO_VALIDO_MS = 180000;        // 3 min sem pulso = acabou (igual a tela)
const CARENCIA_MS = 15 * 60000;        // reabrir dentro disso nao consome cota
const COTA_TRIAL = 2;                  // lives no teste gratis
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

const TETO_VIDEO_PADRAO = { premium: 1500, enterprise: 5000, trial: 300 };

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

  const travado = await freioLive(uid);
  if (travado) return { erro: 'freio', escala: travado.escala, teto: travado.teto, esperaSeg: travado.esperaSeg || 30 };

  const cota = await conferirCota(uid, periodo);
  if (!cota.pode) return { erro: 'cota', usadas: cota.usadas, cota: COTA_TRIAL };

  /* TETO DE VIDEO DO PLANO — pelo mesmo motivo da cota: aqui, ANTES do
     Cloudflare. Recusar depois deixaria a entrada de video ja criada e a cota
     do teste gratis ja consumida por uma live que nao vai acontecer. */
  const termosR = await lerTermos();
  const tetoR = tetoDoPlano(String(b.nivel || ''), periodo, termosR);
  if (tetoR > 0) {
    const cicloR = rotuloCiclo(termosR.cicloDia, Date.now());
    let usadoR = 0;
    try {
      const cs = await refCota(uid).get();
      usadoR = consumoDoCiclo(cs.exists ? cs.data() : null, cicloR);
    } catch (_) { usadoR = 0; }   // nao consegui ler: nao barra
    if (usadoR >= tetoR) {
      return { erro: 'teto_video', usadoMin: Math.round(usadoR), tetoMin: tetoR, ciclo: cicloR };
    }
  }

  /* A cota anda AQUI, e nao no live_abrir: assim uma cota estourada nem chega a
     criar entrada no Cloudflare. O live_abrir recebe `jaReservado` e nao conta
     de novo. */
  if (periodo === 'trial' && !cota.mesmaSessao) {
    await refCota(uid).set({ uid, usadas: FV.increment(1), ultimaAberturaEm: FV.serverTimestamp() }, { merge: true });
  }

  let entradaId = '';
  try {
    const s = await refSessao(uid).get();
    entradaId = (s.exists && s.data() && s.data().entradaId) ? String(s.data().entradaId) : '';
  } catch (_) {}

  const restam = periodo === 'trial'
    ? Math.max(0, COTA_TRIAL - (cota.usadas + (cota.mesmaSessao ? 0 : 1)))
    : null;
  return { ok: true, entradaId, restam, cota: periodo === 'trial' ? COTA_TRIAL : null };
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
    let usadoAb = 0;
    try {
      const cs = await refCota(uid).get();
      usadoAb = consumoDoCiclo(cs.exists ? cs.data() : null, cicloAb);
    } catch (_) { usadoAb = 0; }   // nao consegui ler: nao barra
    if (usadoAb >= tetoAb) {
      return { erro: 'teto_video', usadoMin: Math.round(usadoAb), tetoMin: tetoAb, ciclo: cicloAb };
    }
  }

  const agora = Date.now();
  const sessaoId = uid + '_' + agora;
  await refSessao(uid).set({
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
    encerradaPor: FV.delete(),
    motivoModeracao: FV.delete(),
    fimEm: FV.delete(),
  }, { merge: true });

  /* A cota so anda quando a live e NOVA. Reabertura dentro da carencia nao
     conta — ver o comentario do topo. */
  if (periodo === 'trial' && !jaReservado && !cota.mesmaSessao) {
    await refCota(uid).set({
      uid, usadas: FV.increment(1), ultimaAberturaEm: FV.serverTimestamp(),
    }, { merge: true });
  }

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
  let videoRestamMin = null;

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
          videoMedidoEm: FV.serverTimestamp(),
        }, { merge: true });
        usado = novo;
      }
    } catch (_) { /* nao mediu: nao cobra, e o acumulado que ja existe decide */ }

    if (usado >= teto) {
      await fechar(uid, { motivo: 'teto_video' });
      return {
        ok: true, noAr: false, encerrar: true, motivo: 'teto_video',
        usadoMin: Math.round(usado), tetoMin: teto,
        mensagem: 'Sua live atingiu o limite de minutos de video do plano neste ciclo.',
      };
    }
    videoRestamMin = Math.max(0, Math.round(teto - usado));
  }

  await refSessao(uid).set({ pulsoEm: FV.serverTimestamp(), pulsoMs: agoraP }, { merge: true });
  const restaMs = inicio ? Math.max(0, limite - decorrido) : limite;
  const saida = { ok: true, noAr: true, restamMin: Math.ceil(restaMs / 60000) };
  if (videoRestamMin !== null) saida.videoRestamMin = videoRestamMin;
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

    /* --- daqui para baixo, lojista logado --- */
    let dec;
    try { dec = await admin.auth().verifyIdToken(String(body.idToken || '')); }
    catch (_) { res.status(401).json({ ok: false, erro: 'sessao' }); return; }

    if (acao === 'live_pulso') {
      const r = await pulso(dec.uid);
      res.status(200).json(r); return;
    }
    if (acao === 'live_fechar') {
      const r = await fechar(dec.uid, {});
      res.status(200).json(r); return;
    }

    /* --- dono do Moviki, conferido no servidor --- */
    if (acao === 'live_adm_fechar' || acao === 'live_adm_noar') {
      const a = await db.collection('admins').doc(dec.uid).get();
      if (!a.exists) { res.status(403).json({ ok: false, erro: 'nao_admin' }); return; }
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
        rotuloCiclo, tetoDoPlano, consumoDoCiclo, contarAssistindo,
        COTA_TRIAL, CARENCIA_MS, FREIO, TETO_VIDEO_PADRAO, DELTA_MAX_MS },
};
