// api/novo-parceiro.js  (repo: moviki-robo)
//
// Tem DOIS papéis nesse arquivo (consolidados aqui de propósito — o plano
// Hobby da Vercel só permite 12 funções em /api, então não criamos um
// endpoint novo pra isso, ver Mapa Mestre seção 1):
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

const { admin, db } = require('../lib/firebase');
const { enviarBoasVindasParceiro } = require('../lib/boasVindasParceiro');

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

    // A aprovação automática NÃO acontece mais aqui na hora — só fica marcada
    // no aviso do Telegram. Quem de fato aprova (respeitando o tempo mínimo
    // de análise) é a varredura do branch 2, chamada pelo agendamento externo.
    const auto = await lerAutoAprovacao();

    const texto = auto
      ? '🔔 Novo parceiro no Moviki!\n\n' +
        'Nome: ' + nome + '\n' +
        (slug ? 'Apelido: /p/' + slug + '\n' : '') +
        'Status: pendente ⏳ (aprovação automática entra em até ' + DELAY_MIN_MINUTOS + ' min)\n\n' +
        'Ver no painel:\n' + PAINEL_URL
      : '🔔 Novo parceiro no Moviki!\n\n' +
        'Nome: ' + nome + '\n' +
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
