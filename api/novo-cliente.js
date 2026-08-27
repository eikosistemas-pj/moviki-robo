// api/novo-cliente.js  (repo: moviki-robo)
// Avisa o dono no Telegram quando um COMERCIANTE (lojista) cria conta no app.
// Mesmo padrão do novo-parceiro.js. Segurança: confere o ID token do próprio
// usuário recém-cadastrado (Admin SDK). Idempotente: grava avisos_cliente/{uid}
// e nunca manda duas vezes pro mesmo uid.
//
// Envs necessárias no Vercel (projeto moviki-robo) — já existem:
//   TELEGRAM_TOKEN    -> token do bot (do @BotFather)
//   TELEGRAM_CHAT_ID  -> seu chat_id no Telegram

const { admin, db } = require('../lib/firebase');
const meta = require('../lib/meta');

const ORIGIN_OK   = 'https://app.moviki.com.br';
const PAINEL_DONO = 'https://app.moviki.com.br/eikoadm01.html';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_OK);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ ok: false }); return; }

  try {
    const body    = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const idToken = String(body.idToken || '');
    if (!idToken) { res.status(400).json({ ok: false }); return; }

    // 1) Confere o token do próprio usuário recém-criado.
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(idToken); }
    catch (_) { res.status(200).json({ ok: false }); return; } // token inválido: ignora em silêncio
    const uid   = decoded.uid;
    const email = String(decoded.email || '').trim();

    // 2) Idempotência: um aviso por conta.
    const avisoRef = db.collection('avisos_cliente').doc(uid);
    if ((await avisoRef.get()).exists) { res.status(200).json({ ok: true, jaAvisado: true }); return; }

    // 3) Nome do negócio, se já existir (no cadastro normalmente ainda não existe;
    //    o nome é preenchido depois, na configuração inicial).
    let nome = '';
    try {
      const neg = await db.collection('negocios').doc(uid).get();
      if (neg.exists) nome = String((neg.data() || {}).nome || '').trim();
    } catch (_) {}

    // 3b) Meta (Conversions API): marca o CADASTRO como Lead.
    // Vem ANTES do Telegram de proposito: se as envs do Telegram faltarem, a
    // funcao sai mais abaixo e a medicao teria sido perdida.
    // Idempotente duas vezes: o avisos_cliente/{uid} ja barrou repeticao, e o
    // event_id 'lead_<uid>' faz a propria Meta ignorar duplicata.
    // Enquanto o volume de venda for baixo, e ESTE o evento com material
    // suficiente pra campanha otimizar — Purchase sozinho nao sai do aprendizado.
    // O agente de usuario vem da propria chamada do painel: a Meta exige esse
    // dado em evento marcado como 'website', e aqui existe navegador de verdade.
    try {
      await meta.lead({
        uid, email,
        origem: 'cadastro_comerciante',
        agenteUsuario: String(req.headers['user-agent'] || ''),
      });
    }
    catch (_) {}

    // 4) Manda o aviso no Telegram.
    const TOKEN = process.env.TELEGRAM_TOKEN;
    const CHAT  = process.env.TELEGRAM_CHAT_ID;
    if (!TOKEN || !CHAT) { res.status(200).json({ ok: false, motivo: 'sem_config' }); return; }

    const texto =
      '🛍️ Novo comerciante no Moviki!\n\n' +
      (nome  ? ('Negócio: ' + nome + '\n')  : '') +
      (email ? ('E-mail: '  + email + '\n') : '') +
      'Acabou de criar a conta ✨\n\n' +
      'Ver no painel:\n' + PAINEL_DONO;

    try {
      await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: CHAT, text: texto, disable_web_page_preview: true }),
      });
    } catch (_) {}

    // 5) Marca como avisado (Admin SDK — não passa pelas regras do cliente).
    try { await avisoRef.set({ email, nome, avisadoEm: admin.firestore.FieldValue.serverTimestamp() }); } catch (_) {}

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(200).json({ ok: false });
  }
};
