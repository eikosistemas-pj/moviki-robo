// versao 2026-09-14-repro1
// GET /api/webhook-reprocessa  (cron de hora em hora, protegido por CRON_SECRET)
//
// Rede de seguranca do webhook do Asaas. Desde 14/09/2026 o /api/webhook
// responde 200 mesmo quando o processamento falha — para a fila do Asaas nunca
// pausar (15 falhas seguidas a derrubam e os eventos somem em 14 dias). Quem
// tenta de novo, entao, somos nos: este arquivo.
//
// Pega os eventos guardados em webhook_eventos com status 'erro' — e os que
// ficaram travados em 'processando' — e chama de novo o MESMO miolo do webhook.
// Toda gravacao de dinheiro la dentro e idempotente por id deterministico
// (comissoes/{payId}_nN com create, faturamento/{uid}/ga/{payId}), entao
// reprocessar e seguro por projeto, nao por sorte.
//
// Env (Vercel do moviki-robo): CRON_SECRET, TELEGRAM_TOKEN, TELEGRAM_CHAT_ID.

const { admin, db } = require('../lib/firebase');
const webhook = require('./webhook');

const COL = webhook.EVENTOS_COL || 'webhook_eventos';
const MAX_POR_RODADA = 20;     // teto por execucao, para nao estourar a duracao
const MAX_TENTATIVAS = 6;      // depois disso so aviso; nao adianta insistir sozinho
const TRAVADO_MS = 10 * 60000; // 'processando' parado ha mais de 10 min

async function avisarDono(texto) {
  const TOKEN = process.env.TELEGRAM_TOKEN;
  const CHAT = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT) return;
  try {
    await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text: texto, disable_web_page_preview: true }),
    });
  } catch (_) {}
}

function ms(t) { return t && typeof t.toMillis === 'function' ? t.toMillis() : 0; }

module.exports = async (req, res) => {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) { res.status(200).json({ ok: false, motivo: 'sem_config_CRON_SECRET' }); return; }

    const q = req.query || {};
    const viaCabecalho = req.headers.authorization === 'Bearer ' + secret;
    const viaQuery = String(q.secret || '') === secret;
    if (!viaCabecalho && !viaQuery) { res.status(401).json({ ok: false, erro: 'nao_autorizado' }); return; }

    const soOlhar = String(q.dry || '') === '1';
    const FV = admin.firestore.FieldValue;
    const agora = Date.now();
    const fila = [];

    // 1) Os que falharam.
    const comErro = await db.collection(COL).where('status', '==', 'erro').limit(MAX_POR_RODADA * 2).get();
    comErro.forEach((d) => {
      const v = d.data() || {};
      if ((v.tentativas || 0) < MAX_TENTATIVAS) fila.push({ ref: d.ref, id: d.id, dados: v });
    });

    // 2) Os que ficaram travados em 'processando' (funcao morreu no meio).
    if (fila.length < MAX_POR_RODADA) {
      const travados = await db.collection(COL).where('status', '==', 'processando').limit(MAX_POR_RODADA).get();
      travados.forEach((d) => {
        const v = d.data() || {};
        const desde = ms(v.atualizadoEm);
        if (desde && (agora - desde) > TRAVADO_MS && (v.tentativas || 0) < MAX_TENTATIVAS) {
          fila.push({ ref: d.ref, id: d.id, dados: v });
        }
      });
    }

    const alvos = fila.slice(0, MAX_POR_RODADA);
    if (soOlhar) {
      res.status(200).json({ ok: true, dry: true, encontrados: fila.length, alvos: alvos.map((a) => a.id) });
      return;
    }

    let recuperados = 0;
    let aindaFalhando = 0;
    const desistidos = [];

    for (const alvo of alvos) {
      const payload = alvo.dados.payload;
      if (!payload || typeof payload !== 'object') {
        try { await alvo.ref.update({ status: 'descartado', erro: 'payload_ausente', atualizadoEm: FV.serverTimestamp() }); } catch (_) {}
        continue;
      }
      try {
        await alvo.ref.update({ status: 'processando', tentativas: FV.increment(1), atualizadoEm: FV.serverTimestamp() });
        const r = await webhook.processarEvento(payload);
        await alvo.ref.update({ status: 'ok', resultado: r || null, concluidoEm: FV.serverTimestamp(), atualizadoEm: FV.serverTimestamp() });
        recuperados++;
      } catch (e) {
        const msg = (e && e.message) ? String(e.message).slice(0, 400) : 'erro';
        aindaFalhando++;
        const tentativas = (alvo.dados.tentativas || 0) + 1;
        try { await alvo.ref.update({ status: 'erro', erro: msg, atualizadoEm: FV.serverTimestamp() }); } catch (_) {}
        if (tentativas >= MAX_TENTATIVAS) desistidos.push(alvo.id + ' — ' + msg);
      }
    }

    if (recuperados > 0 || desistidos.length > 0) {
      await avisarDono(
        '🔁 Reprocessamento do webhook\n\n' +
        'Recuperados: ' + recuperados + '\n' +
        'Ainda falhando: ' + aindaFalhando + '\n' +
        (desistidos.length
          ? ('\n⛔ Chegaram ao limite de tentativas (precisam de olho humano):\n' + desistidos.join('\n'))
          : '')
      );
    }

    res.status(200).json({ ok: true, analisados: alvos.length, recuperados, aindaFalhando, desistidos: desistidos.length });
  } catch (e) {
    console.error('webhook-reprocessa erro:', e);
    res.status(200).json({ ok: false, erro: (e && e.message) ? e.message : 'erro' });
  }
};
