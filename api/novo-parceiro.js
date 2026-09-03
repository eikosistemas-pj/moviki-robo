// api/novo-parceiro.js  (repo: moviki-robo)
//
// Tem TRÊS papéis nesse arquivo (consolidados aqui de propósito — o plano
// Hobby da Vercel só permite 12 funções em /api, o repo ESTÁ no teto, então
// não criamos um endpoint novo pra isso, ver Mapa Mestre seção 1):
//
// 0) GET ?instagram=<arroba> — SEM login, chamado pelo quiz enquanto o
//    influenciador digita o @ dele. Devolve a foto, o nome e o número de
//    seguidores pra tela mostrar o cartão "é você?". É só vitrine: NADA do
//    que sai daqui é gravado a partir do que o navegador manda de volta.
//    Sem login porque na hora que ele digita o @ ele ainda não tem conta —
//    por isso o freio por IP e o teto diário, dentro de lib/instagram.js.
//
// 1) POST { idToken, uid } — chamado pelo cliente (index.html) logo após o
//    cadastro do parceiro. Confirma o cadastro pendente e avisa no Telegram.
//    NUNCA aprova na hora — mesmo com a aprovação automática ligada, o
//    parceiro fica "pendente" até o robô de varredura (item 2) processá-lo,
//    depois de um tempo mínimo (DELAY_MIN_MINUTOS). Isso é proposital:
//    19/08/2026, a pedido do Paulo, pra aprovação automática não parecer
//    instantânea/robótica.
//
// 2) GET ou POST com ?processarPendentes=1 + Authorization: Bearer
//    CRON_SECRET (ou ?secret=CRON_SECRET) — chamado por um agendamento
//    EXTERNO (GitHub Actions, a cada poucos minutos; o cron nativo da Vercel
//    no plano Hobby só roda 1x/dia, não serve pra isso). Varre parceiros
//    "pendente" com aprovacaoAutomaticaParceiros ligado e criadoEm mais
//    velho que DELAY_MIN_MINUTOS, aprova cada um e dispara o e-mail de
//    boas-vindas — mesmo caminho que a aprovação manual do painel do dono.
//
// Segurança: a escrita de status é sempre via Admin SDK — só o robô muda
// status de parceiro (Regra de Ouro #1 do Mapa Mestre). O branch (1) só age
// em cima do próprio uid autenticado pelo idToken; o branch (2) exige o
// CRON_SECRET (mesmo padrão de api/lembrete-trial.js).
//
// Env vars necessárias no Vercel (projeto moviki-robo) — já existem:
//   FIREBASE_SERVICE_ACCOUNT -> Admin SDK (via lib/firebase.js)
//   TELEGRAM_TOKEN           -> token do bot (do @BotFather)
//   TELEGRAM_CHAT_ID         -> seu chat_id no Telegram
//   RESEND_API_KEY           -> e-mail de boas-vindas (via lib/boasVindasParceiro.js)
//   CRON_SECRET              -> autoriza o branch (2) [já existe, usado por lembrete-trial.js]
//   IG_USER_ID + IG_TOKEN    -> busca do @ do Instagram (via lib/instagram.js).
//                               Faltando qualquer um dos dois, o branch (0)
//                               devolve "sem_config" e o quiz segue sem cartão.

const { admin, db } = require('../lib/firebase');
const { enviarBoasVindasParceiro } = require('../lib/boasVindasParceiro');
const { buscarPerfil } = require('../lib/instagram');
const { gravarEspelho, espelharPorUid } = require('../lib/espelhoParceiro');

const PAINEL_URL = 'https://app.moviki.com.br/eikoadm01.html';
const ORIGIN_OK  = 'https://app.moviki.com.br';
const DELAY_MIN_MINUTOS = 10; // tempo mínimo pendente antes de poder ser aprovado sozinho

async function enviarTelegram(texto) {
  const TOKEN = process.env.TELEGRAM_TOKEN;
  const CHAT  = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT) {
    console.error('[novo-parceiro] TELEGRAM_TOKEN ou TELEGRAM_CHAT_ID ausente.');
    return false;
  }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text: texto, disable_web_page_preview: true }),
    });
    if (!resp.ok) {
      const corpo = await resp.text().catch(() => '');
      console.error('[novo-parceiro] Telegram recusou o envio:', resp.status, corpo);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[novo-parceiro] Erro ao chamar o Telegram:', e);
    return false;
  }
}

async function lerAutoAprovacao() {
  try {
    const cfg = await db.collection('configuracoes').doc('sistema').get();
    return cfg.exists ? cfg.data().aprovacaoAutomaticaParceiros === true : false;
  } catch (e) {
    console.error('[novo-parceiro] Falha ao ler configuracoes/sistema, seguindo manual:', e);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Branch 0: busca do @ do Instagram durante o quiz. SEM login.
//
// Responde sempre 200, sempre com JSON, mesmo quando não achou ou quando o
// token da Meta está errado. O motivo é de produto, não de código: este é o
// único trecho do cadastro que depende de um serviço de fora, e ele fica no
// MEIO do formulário. Se ele devolvesse 4xx/5xx, o cartão sumiria e a tela
// pareceria quebrada bem na hora de fechar o cadastro. Falhou = o campo do @
// vira um campo de texto comum, e ninguém perde o cadastro por causa disso.
// ---------------------------------------------------------------------------
async function buscarInstagram(req, res) {
  const q = req.query || {};

  // IP real por trás da CDN da Vercel. x-forwarded-for vem como
  // "cliente, proxy1, proxy2" — o primeiro é quem interessa.
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || String(req.headers['x-real-ip'] || '')
    || 'desconhecido';

  // MODO DIAGNOSTICO — 03/09/2026.
  // Com ?instagram=natgeo&secret=<CRON_SECRET> a resposta traz a mensagem CRUA
  // que a Meta devolveu, e a busca ignora o cache. Existe porque a primeira
  // versao disto foi ao ar e devolvia "conta pessoal" pra @natgeo: o erro real
  // era de configuracao, mas do lado de fora os dois eram indistinguiveis e
  // nao dava pra descobrir nada sem abrir o log da Vercel.
  // Protegido pelo CRON_SECRET (o mesmo do branch 2) — a mensagem de erro da
  // Meta as vezes cita o nosso id, entao nao pode ficar aberta pra qualquer um.
  const segredo = process.env.CRON_SECRET;
  const diag = !!segredo && String(q.secret || '') === segredo;

  try {
    const r = await buscarPerfil(admin, db, q.instagram, { ip: diag ? null : ip, semCache: diag });

    if (diag) {
      res.status(200).json({
        diagnostico: true,
        ok: r.ok, achou: !!r.achou, motivo: r.motivo || null,
        metaDisse: r.detalhe || null,
        igUserIdConfigurado: (process.env.IG_USER_ID || '(vazio)'),
        tokenTem: (process.env.IG_TOKEN || '').length + ' caracteres',
        nome: r.nome || null, seguidores: r.seguidores || null,
      });
      return;
    }

    if (r.ok && r.achou) {
      res.status(200).json({
        ok: true, achou: true,
        arroba: r.arroba, nome: r.nome, foto: r.foto,
        seguidores: r.seguidores, posts: r.posts, verificado: r.verificado,
      });
      return;
    }

    // achou:false e todos os erros saem iguais pro navegador de propósito:
    // a tela não tem o que fazer de diferente com "conta pessoal" ou "token
    // vencido" — nos dois casos ela some com o cartão e aceita o @ digitado.
    // O motivo vai junto só pra aparecer no log do navegador em teste.
    res.status(200).json({ ok: true, achou: false, motivo: r.motivo || 'nao_achei' });
  } catch (e) {
    console.error('[novo-parceiro] Erro inesperado na busca do Instagram:', e);
    res.status(200).json({ ok: true, achou: false, motivo: 'falha' });
  }
}

// ---------------------------------------------------------------------------
// Branch 3: o parceiro pede pra atualizar o proprio espelho publico.
//
// POR QUE ELE PRECISA EXISTIR: o espelho nasce na aprovacao, mas o campo
// `treinado` so fica verdadeiro DEPOIS, quando ele termina as 8 aulas. Sem
// este branch, ou o espelho ficaria eternamente desatualizado, ou o robo
// teria que varrer todos os parceiros de tempos em tempos — leitura paga,
// crescendo pra sempre, pra atualizar quase nada.
//
// Assim o custo e exato: uma leitura e uma escrita, so quando muda de verdade
// (o painel chama ao concluir as aulas) ou quando o parceiro abre o painel e
// ainda nao tem espelho — que e como os parceiros antigos vao sendo cobertos,
// um por um, sem nenhuma migracao.
//
// Autenticado pelo idToken do PROPRIO parceiro: ele so consegue atualizar o
// espelho dele mesmo, e o conteudo vem do banco, nunca do que ele mandou.
// ---------------------------------------------------------------------------
async function atualizarEspelho(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  try {
    const body    = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const idToken = String(body.idToken || '');
    if (!idToken) { res.status(400).json({ ok: false }); return; }

    let decoded;
    try { decoded = await admin.auth().verifyIdToken(idToken); }
    catch (_) { res.status(200).json({ ok: false }); return; }

    const r = await espelharPorUid(admin, db, decoded.uid);
    res.status(200).json({ ok: r.ok === true, slug: r.slug || null });
  } catch (e) {
    console.error('[novo-parceiro] Erro inesperado no espelho:', e);
    res.status(200).json({ ok: false });
  }
}

// ---------------------------------------------------------------------------
// Branch 2: varredura de pendentes (chamada pelo agendamento externo).
// ---------------------------------------------------------------------------
async function processarPendentes(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret) { res.status(200).json({ ok: false, motivo: 'sem_config_CRON_SECRET' }); return; }

  const q = req.query || {};
  const viaCabecalho = req.headers.authorization === 'Bearer ' + secret;
  const viaQuery     = String(q.secret || '') === secret;
  if (!viaCabecalho && !viaQuery) { res.status(401).json({ ok: false, erro: 'nao_autorizado' }); return; }

  try {
    const auto = await lerAutoAprovacao();
    if (!auto) { res.status(200).json({ ok: true, processados: 0, motivo: 'auto_desligado' }); return; }

    const limite = Date.now() - DELAY_MIN_MINUTOS * 60000;
    const snap = await db.collection('parceiros').where('status', '==', 'pendente').get();

    let processados = 0;
    const detalhes = [];

    for (const doc of snap.docs) {
      const p = doc.data() || {};
      const criadoMs = p.criadoEm && typeof p.criadoEm.toMillis === 'function' ? p.criadoEm.toMillis() : 0;
      if (!criadoMs || criadoMs > limite) continue; // ainda não passou o tempo mínimo

      const parceiroRef = doc.ref;
      try {
        await parceiroRef.update({
          status: 'aprovado',
          aprovadoEm: admin.firestore.FieldValue.serverTimestamp(),
          aprovadoPor: 'automatico',
        });

        // Publica o espelho de verificacao assim que ele passa a valer.
        try{ await gravarEspelho(admin, db, Object.assign({}, p, { status:'aprovado' })); }
        catch(e){ console.error('[novo-parceiro] espelho falhou (segue normal):', e); }

        let boasVindasOk = null;
        try {
          const r = await enviarBoasVindasParceiro({
            admin,
            parceiroRef,
            p: Object.assign({}, p, { status: 'aprovado' }),
          });
          boasVindasOk = r.ok === true;
        } catch (e) {
          console.error('[novo-parceiro] Erro ao enviar e-mail de boas-vindas (varredura):', e);
          boasVindasOk = false;
        }

        const nome = p.nome || 'Parceiro sem nome';
        const slug = p.slug || '';
        await enviarTelegram(
          '✅ Parceiro aprovado automaticamente (após período de análise)!\n\n' +
          'Nome: ' + nome + '\n' +
          (slug ? 'Apelido: /p/' + slug + '\n' : '') +
          'Status: aprovado (automático)\n\n' +
          'Ver no painel:\n' + PAINEL_URL
        );

        processados++;
        detalhes.push({ uid: doc.id, boasVindas: boasVindasOk });
      } catch (e) {
        console.error('[novo-parceiro] Falha ao aprovar', doc.id, e);
      }
    }

    res.status(200).json({ ok: true, processados, detalhes });
  } catch (e) {
    console.error('[novo-parceiro] Erro inesperado na varredura:', e);
    res.status(200).json({ ok: false });
  }
}

// ---------------------------------------------------------------------------
// Branch 1: aviso de cadastro novo (chamado pelo cliente logo após o signup).
// ---------------------------------------------------------------------------
module.exports = async (req, res) => {
  // CORS (a página de cadastro roda em app.moviki.com.br)
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_OK);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const q = req.query || {};
  if (String(q.processarPendentes || '') === '1') { await processarPendentes(req, res); return; }
  if (String(q.instagram || '') !== '')           { await buscarInstagram(req, res);    return; }
  if (String(q.espelho || '') === '1')            { await atualizarEspelho(req, res);   return; }

  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }

  try {
    const body    = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const idToken = String(body.idToken || '');
    const uid     = String(body.uid || '').replace(/[^a-zA-Z0-9]/g, '');
    if (!idToken || !uid) { res.status(400).json({ ok: false }); return; }

    // 1) Confere quem é, pelo token do próprio usuário recém-cadastrado.
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(idToken); }
    catch (_) { res.status(200).json({ ok: false }); return; } // token inválido: ignora em silêncio
    if (decoded.uid !== uid) { res.status(200).json({ ok: false }); return; }

    // 2) Confere no Firestore (Admin SDK) que existe MESMO um parceiro pendente.
    const parceiroRef = db.collection('parceiros').doc(uid);
    const parceiroSnap = await parceiroRef.get();
    if (!parceiroSnap.exists) { res.status(200).json({ ok: false }); return; }

    const p = parceiroSnap.data() || {};
    if (p.status !== 'pendente') { res.status(200).json({ ok: false, jaProcessado: true }); return; }

    const nome = p.nome || 'Parceiro sem nome';
    const slug = p.slug || '';

    // 2b) CARIMBO DO INSTAGRAM (Regra de Ouro #1: dado de valor é escrito pelo
    // servidor, nunca pelo navegador).
    //
    // O quiz já mostrou o cartão com a foto e os seguidores pro influenciador
    // confirmar — mas AQUELE número veio pro navegador dele, e tudo que passa
    // pelo navegador é forjável no F12. Se a gente gravasse o que o cliente
    // manda, qualquer parceiro se cadastraria com 500 mil seguidores e o
    // painel do dono viraria ficção. Então o robô busca DE NOVO, aqui, pelo
    // Admin SDK, e grava o que a própria Meta respondeu.
    //
    // Sai barato: lib/instagram.js tem cache de 7 dias e esse mesmo @ acabou
    // de ser consultado no quiz, segundos atrás — na prática isso é uma
    // leitura de cache, não uma chamada nova pra Meta.
    //
    // semFoto: o cadastro do parceiro não guarda imagem. A foto existe pro
    // cartão do quiz e vive no cache; pendurar base64 em parceiros/{uid} só
    // engordaria o documento à toa.
    //
    // Nada aqui derruba o cadastro: se a Meta estiver fora, o parceiro fica
    // sem os campos ig* e o resto do fluxo segue idêntico.
    let ig = null;
    if (p.arroba) {
      try {
        const r = await buscarPerfil(admin, db, p.arroba, { semFoto: true });
        if (r.ok && r.achou) {
          ig = r;
          await parceiroRef.update({
            igNome:        r.nome || '',
            igSeguidores:  Number(r.seguidores || 0),
            igPosts:       Number(r.posts || 0),
            igVerificado:  r.verificado === true,
            igConferidoEm: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      } catch (e) {
        console.error('[novo-parceiro] Falha ao carimbar o Instagram (segue normal):', e);
      }
    }

    // Linha do Instagram no aviso do Telegram. É o dado que mais importa pra
    // decidir aprovar na hora ou olhar com calma: 200 seguidores e 80 mil
    // seguidores são dois parceiros bem diferentes chegando.
    const linhaIg = ig
      ? '@' + ig.arroba + (ig.verificado ? ' ✔️' : '') +
        ' — ' + Number(ig.seguidores || 0).toLocaleString('pt-BR') + ' seguidores\n'
      : (p.arroba ? String(p.arroba) + ' (não confirmado no Instagram)\n' : '');

    // A aprovação automática NÃO acontece mais aqui na hora — só fica marcada
    // no aviso do Telegram. Quem de fato aprova (respeitando o tempo mínimo
    // de análise) é a varredura do branch 2, chamada pelo agendamento externo.
    const auto = await lerAutoAprovacao();

    const texto = auto
      ? '🔔 Novo parceiro no Moviki!\n\n' +
        'Nome: ' + nome + '\n' +
        linhaIg +
        (slug ? 'Apelido: /p/' + slug + '\n' : '') +
        'Status: pendente ⏳ (aprovação automática entra em até ' + DELAY_MIN_MINUTOS + ' min)\n\n' +
        'Ver no painel:\n' + PAINEL_URL
      : '🔔 Novo parceiro no Moviki!\n\n' +
        'Nome: ' + nome + '\n' +
        linhaIg +
        (slug ? 'Apelido: /p/' + slug + '\n' : '') +
        'Status: pendente ⏳\n\n' +
        'Aprovar agora:\n' + PAINEL_URL;

    const telegramOk = await enviarTelegram(texto);

    res.status(200).json({ ok: true, status: 'pendente', telegram: telegramOk });
  } catch (e) {
    console.error('[novo-parceiro] Erro inesperado:', e);
    res.status(200).json({ ok: false });
  }
};
