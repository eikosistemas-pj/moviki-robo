// api/excluir-conta.js  (repo: moviki-robo)
// Registra um PEDIDO de exclusão de conta feito pelo lojista dentro do app.
// Modelo escolhido: SOLICITAÇÃO — o pedido é registrado, o dono é avisado no
// Telegram e o usuário recebe um e-mail de confirmação. A exclusão de fato
// (apagar dados + cancelar assinatura) é confirmada pelo dono em até 48h.
//
// Segurança: confere o ID token do próprio usuário (Admin SDK) e grava o
// pedido via Admin SDK (não passa pelas regras do cliente). Idempotente: se já
// houver um pedido aberto para o mesmo uid, não duplica nem re-notifica.
//
// Env vars (já existentes no projeto moviki-robo):
//   TELEGRAM_TOKEN, TELEGRAM_CHAT_ID  -> aviso pro dono
//   RESEND_API_KEY                    -> e-mail de confirmação pro usuário (opcional)

const { admin, db } = require('../lib/firebase');

const ORIGIN_OK   = 'https://app.moviki.com.br';
const EMAIL_FROM  = 'Moviki <suporte@moviki.com.br>';
const PAINEL_DONO = 'https://app.moviki.com.br/eikoadm01.html';
const WPP_TEXTO   = '(41) 2018-6848';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_OK);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ ok: false }); return; }

  try {
    const body    = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const idToken = String(body.idToken || '');
    if (!idToken) { res.status(400).json({ ok: false, erro: 'faltam dados' }); return; }

    // 1) Quem está pedindo?
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(idToken); }
    catch (_) { res.status(401).json({ ok: false, erro: 'sessao invalida' }); return; }
    const uid   = decoded.uid;
    const email = String(decoded.email || '').trim();

    // 2) Nome do negócio (só pra facilitar sua vida no aviso) — opcional.
    let nome = '';
    try {
      const neg = await db.collection('negocios').doc(uid).get();
      if (neg.exists) nome = String((neg.data() || {}).nome || '').trim();
    } catch (_) {}

    // 3) Registra o pedido (idempotente).
    const ref  = db.collection('exclusoes').doc(uid);
    const snap = await ref.get();
    const jaAberto = snap.exists && (snap.data() || {}).status === 'solicitado';
    if (!jaAberto) {
      await ref.set({
        uid,
        email,
        nome,
        status: 'solicitado',
        solicitadoEm: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    // 4) Avisa o dono no Telegram (só na 1ª vez).
    const TOKEN = process.env.TELEGRAM_TOKEN;
    const CHAT  = process.env.TELEGRAM_CHAT_ID;
    if (TOKEN && CHAT && !jaAberto) {
      const texto =
        '🗑️ Pedido de EXCLUSÃO de conta\n\n' +
        'Negócio: ' + (nome || '(sem nome)') + '\n' +
        (email ? ('E-mail: ' + email + '\n') : '') +
        'UID: ' + uid + '\n\n' +
        'Confirme/execute em até 48h.\n' + PAINEL_DONO;
      try {
        await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: CHAT, text: texto, disable_web_page_preview: true }),
        });
      } catch (_) {}
    }

    // 5) E-mail de confirmação pro usuário (só na 1ª vez, se houver e-mail e chave).
    const API_KEY = process.env.RESEND_API_KEY;
    if (API_KEY && email && !jaAberto) {
      const texto = [
        'Olá!',
        '',
        'Recebemos seu pedido para excluir sua conta no Moviki. Sua conta e seus dados serão excluídos em até 48 horas.',
        'Se você tiver uma assinatura ativa, ela será cancelada nesse processo.',
        '',
        'Mudou de ideia? É só responder este e-mail ou falar com a gente no WhatsApp ' + WPP_TEXTO + ' antes disso.',
        '',
        'Equipe Moviki',
        'O mapa inteligente dos negócios em movimento.',
      ].join('\n');
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: EMAIL_FROM,
            to: [email],
            subject: 'Recebemos seu pedido de exclusão de conta',
            text: texto,
          }),
        });
      } catch (_) {}
    }

    res.status(200).json({ ok: true, jaSolicitado: jaAberto });
  } catch (e) {
    console.error('excluir-conta erro:', e);
    res.status(500).json({ ok: false, erro: 'erro interno' });
  }
};
