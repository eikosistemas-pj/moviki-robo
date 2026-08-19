// api/novo-parceiro.js  (repo: moviki-robo)
// Avisa o dono no Telegram quando entra um parceiro novo (status "pendente").
// Decide, no servidor, se o parceiro já entra "aprovado" (auto) ou fica
// "pendente" (manual), conforme configuracoes/sistema.aprovacaoAutomaticaParceiros.
// Quando entra "aprovado" automático, também dispara o e-mail de boas-vindas
// aqui mesmo — a aprovação automática não passa pelo botão "Aprovar" do painel
// do dono, então é aqui (e só aqui) que esse caminho fica coberto.
//
// Segurança: só age em cima de um parceiro pendente cujo uid bate com o dono do
// idToken (Admin SDK verifica). Escrita de status é sempre via Admin SDK — só o
// robô muda status de parceiro (Regra de Ouro #1 do Mapa Mestre).
//
// Env vars necessárias no Vercel (projeto moviki-robo) — já existem:
//   FIREBASE_SERVICE_ACCOUNT -> Admin SDK (via lib/firebase.js)
//   TELEGRAM_TOKEN           -> token do bot (do @BotFather)
//   TELEGRAM_CHAT_ID         -> seu chat_id no Telegram
//   RESEND_API_KEY           -> e-mail de boas-vindas (via lib/boasVindasParceiro.js)

const { admin, db } = require('../lib/firebase');
const { enviarBoasVindasParceiro } = require('../lib/boasVindasParceiro');

const PAINEL_URL = 'https://app.moviki.com.br/eikoadm01.html';
const ORIGIN_OK  = 'https://app.moviki.com.br';

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

module.exports = async (req, res) => {
  // CORS (a página de cadastro roda em app.moviki.com.br)
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_OK);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ ok: false }); return; }

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

    // 3) Lê configuracoes/sistema pra saber se é pra aprovar sozinho.
    //    Doc novo — se ainda não existir, o padrão é NÃO aprovar automático.
    let auto = false;
    try {
      const cfg = await db.collection('configuracoes').doc('sistema').get();
      auto = cfg.exists ? cfg.data().aprovacaoAutomaticaParceiros === true : false;
    } catch (e) {
      console.error('[novo-parceiro] Falha ao ler configuracoes/sistema, seguindo manual:', e);
    }

    let boasVindasOk = null;

    if (auto) {
      await parceiroRef.update({
        status: 'aprovado',
        aprovadoEm: admin.firestore.FieldValue.serverTimestamp(),
        aprovadoPor: 'automatico',
      });

      // Aprovação automática não passa pelo botão "Aprovar" do painel do dono
      // (que é quem normalmente dispara o e-mail) — então disparamos aqui.
      try {
        const r = await enviarBoasVindasParceiro({
          admin,
          parceiroRef,
          p: Object.assign({}, p, { status: 'aprovado' }),
        });
        boasVindasOk = r.ok === true;
      } catch (e) {
        console.error('[novo-parceiro] Erro ao enviar e-mail de boas-vindas automático:', e);
        boasVindasOk = false;
      }
    }

    // 4) Manda o aviso no Telegram (sem dados sensíveis — a chave Pix NÃO vai).
    const texto = auto
      ? '✅ Parceiro aprovado automaticamente!\n\n' +
        'Nome: ' + nome + '\n' +
        (slug ? 'Apelido: /p/' + slug + '\n' : '') +
        'Status: aprovado (automático)\n\n' +
        'Ver no painel:\n' + PAINEL_URL
      : '🔔 Novo parceiro no Moviki!\n\n' +
        'Nome: ' + nome + '\n' +
        (slug ? 'Apelido: /p/' + slug + '\n' : '') +
        'Status: pendente ⏳\n\n' +
        'Aprovar agora:\n' + PAINEL_URL;

    const telegramOk = await enviarTelegram(texto);

    res.status(200).json({
      ok: true,
      status: auto ? 'aprovado' : 'pendente',
      telegram: telegramOk,
      boasVindas: boasVindasOk,
    });
  } catch (e) {
    console.error('[novo-parceiro] Erro inesperado:', e);
    res.status(200).json({ ok: false });
  }
};
