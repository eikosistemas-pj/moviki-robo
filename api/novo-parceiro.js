// api/novo-parceiro.js  (repo: moviki-robo)
// Avisa o dono no Telegram quando entra um parceiro novo (status "pendente").
// Segurança: só dispara se o Firebase confirmar que existe MESMO um parceiro
// pendente para o uid informado, usando o ID token do próprio usuário recém-cadastrado.
// Env vars necessárias no Vercel (projeto moviki-robo):
//   TELEGRAM_TOKEN    -> token do bot (do @BotFather)
//   TELEGRAM_CHAT_ID  -> seu chat_id no Telegram

const PROJECT_ID = 'moviki-app';
const PAINEL_URL = 'https://app.moviki.com.br/eikoadm01.html';
const ORIGIN_OK  = 'https://app.moviki.com.br';

module.exports = async (req, res) => {
  // CORS (a página de cadastro roda em app.moviki.com.br)
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_OK);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ ok: false }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const idToken = String(body.idToken || '');
    const uid     = String(body.uid || '').replace(/[^a-zA-Z0-9]/g, '');
    if (!idToken || !uid) { res.status(400).json({ ok: false }); return; }

    // 1) Confere no Firebase que existe um parceiro pendente para esse uid.
    //    A leitura usa o token do próprio usuário (as regras só deixam ele ler o doc dele).
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/parceiros/${encodeURIComponent(uid)}`;
    const fsRes = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (!fsRes.ok) { res.status(200).json({ ok: false }); return; } // token inválido / doc inexistente

    const data   = await fsRes.json();
    const f       = (data && data.fields) || {};
    const status  = f.status && f.status.stringValue;
    if (status !== 'pendente') { res.status(200).json({ ok: false }); return; }

    const nome = (f.nome && f.nome.stringValue) || 'Parceiro sem nome';
    const slug = (f.slug && f.slug.stringValue) || '';

    // 2) Manda o aviso no Telegram (sem dados sensíveis — a chave Pix NÃO vai).
    const TOKEN = process.env.TELEGRAM_TOKEN;
    const CHAT  = process.env.TELEGRAM_CHAT_ID;
    if (!TOKEN || !CHAT) { res.status(200).json({ ok: false, motivo: 'sem_config' }); return; }

    const texto =
      '🔔 Novo parceiro no Moviki!\n\n' +
      'Nome: ' + nome + '\n' +
      (slug ? 'Apelido: /p/' + slug + '\n' : '') +
      'Status: pendente ⏳\n\n' +
      'Aprovar agora:\n' + PAINEL_URL;

    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text: texto, disable_web_page_preview: true })
    });

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(200).json({ ok: false });
  }
};
