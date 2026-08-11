// api/lembrete-trial.js  (repo: moviki-robo)
// ROBÔ DE CONVERSÃO DO TRIAL — roda 1x por dia (agendado no vercel.json).
// Procura os testes grátis (assinaturas com periodo:'trial') que estão chegando
// ao fim e manda um e-mail cordial convidando o lojista a assinar.
//
// Manda no máximo 3 e-mails na vida de cada teste, e nunca repete:
//   • faltando ~7 dias  -> aviso "está terminando"      (flag: d7)
//   • faltando ~2 dias  -> aviso "faltam poucos dias"   (flag: d2)
//   • depois de vencer  -> aviso "terminou, reative"    (flag: fim)
// A marca de "já enviei" fica em assinaturas/{uid}.lembretes (gravada pelo
// Admin SDK, então NÃO passa pelas regras do Firestore e não precisa mexer nelas).
//
// Segurança: só roda com o segredo certo. O agendador do Vercel manda o segredo
// no cabeçalho Authorization automaticamente (variável de ambiente CRON_SECRET).
// Dá pra abrir no navegador com ?secret=...&dry=1 pra SIMULAR (nunca envia).
//
// Env vars necessárias no Vercel (projeto moviki-robo):
//   CRON_SECRET     -> um segredo qualquer (inventado por você) que protege o robô
//   RESEND_API_KEY  -> a mesma chave do provedor de e-mail que já usamos
//   FIREBASE_SERVICE_ACCOUNT -> (já existe)

const { admin, db } = require('../lib/firebase');

const EMAIL_FROM = 'Moviki <suporte@moviki.com.br>';
const PAINEL_URL = 'https://app.moviki.com.br';
const SITE       = 'https://moviki.com.br';
const WPP_TEXTO  = '(41) 2018-6848';
const WPP_LINK   = 'https://wa.me/554120186848';
const DIA_MS     = 86400000;

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

module.exports = async (req, res) => {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) { res.status(200).json({ ok: false, motivo: 'sem_config_CRON_SECRET' }); return; }

    const q = req.query || {};
    const viaCabecalho = req.headers.authorization === 'Bearer ' + secret; // é o agendador do Vercel
    const viaQuery     = String(q.secret || '') === secret;                // é você testando no navegador
    if (!viaCabecalho && !viaQuery) { res.status(401).json({ ok: false, erro: 'nao_autorizado' }); return; }

    // Só envia de verdade quando vem do agendador. Query/navegador = sempre simulação (seguro).
    const enviarDeVerdade = viaCabecalho && String(q.dry || '') !== '1';

    const API_KEY = process.env.RESEND_API_KEY;
    if (enviarDeVerdade && !API_KEY) { res.status(200).json({ ok: false, motivo: 'sem_RESEND_API_KEY' }); return; }

    const agora = Date.now();
    const snap = await db.collection('assinaturas').where('periodo', '==', 'trial').get();

    const resultado = { simulacao: !enviarDeVerdade, analisados: 0, enviados: 0, pulados: 0, detalhes: [] };

    for (const docu of snap.docs) {
      const d = docu.data() || {};
      const uid = docu.id;
      resultado.analisados++;

      // Guardas: precisa estar ativo e ter data de vencimento.
      if (d.ativo !== true || !d.vence_em || typeof d.vence_em.toMillis !== 'function') { resultado.pulados++; continue; }

      const dias = Math.ceil((d.vence_em.toMillis() - agora) / DIA_MS);
      const lembretes = d.lembretes || {};

      // Qual aviso cabe agora? (o mais urgente aplicável, um por dia no máximo)
      let flag = null;
      if (dias <= 0 && !lembretes.fim)               flag = 'fim';
      else if (dias >= 1 && dias <= 2 && !lembretes.d2) flag = 'd2';
      else if (dias >= 3 && dias <= 7 && !lembretes.d7) flag = 'd7';
      if (!flag) { resultado.pulados++; continue; }

      // Pega o e-mail (fica no cadastro de acesso) e o nome do negócio.
      let email = '';
      try { const u = await admin.auth().getUser(uid); email = String(u.email || '').trim(); } catch (_) {}
      if (!email) { resultado.pulados++; resultado.detalhes.push({ uid, flag, status: 'sem_email' }); continue; }

      let nome = 'Olá';
      try { const n = await db.collection('negocios').doc(uid).get(); if (n.exists && n.data().nome) nome = String(n.data().nome).trim(); } catch (_) {}

      const dic = Math.max(dias, 0); // dias exibidos nunca negativos
      const msg = montarEmail(flag, nome, dic);

      if (!enviarDeVerdade) {
        resultado.detalhes.push({ uid, flag, dias, email: mascara(email), status: 'simulado' });
        continue;
      }

      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: EMAIL_FROM, to: [email], subject: msg.subject, html: msg.html, text: msg.text }),
        });
        if (!r.ok) {
          const det = await r.text().catch(() => '');
          console.error('resend erro:', r.status, det);
          resultado.detalhes.push({ uid, flag, status: 'falha_envio' });
          continue;
        }
        // Marca como enviado (Admin SDK — não passa pelas regras do cliente).
        await docu.ref.update({ ['lembretes.' + flag]: admin.firestore.FieldValue.serverTimestamp() });
        resultado.enviados++;
        resultado.detalhes.push({ uid, flag, status: 'enviado' });
      } catch (e) {
        console.error('envio erro:', uid, e);
        resultado.detalhes.push({ uid, flag, status: 'erro' });
      }
    }

    res.status(200).json({ ok: true, ...resultado });
  } catch (e) {
    console.error('lembrete-trial erro:', e);
    res.status(500).json({ ok: false, erro: 'erro interno' });
  }
};

// Esconde o meio do e-mail nos relatórios de simulação (ex.: jo***@gmail.com)
function mascara(e) {
  const [u, dom] = String(e).split('@'); if (!dom) return '***';
  return (u.slice(0, 2) + '***') + '@' + dom;
}

function montarEmail(tipo, nome, dias) {
  let subject, titulo, chamada;
  if (tipo === 'fim') {
    subject = 'Seu teste do Moviki terminou — reative em 1 minuto';
    titulo  = 'Seu teste grátis terminou';
    chamada = 'Seu período de teste chegou ao fim. Reative agora pra voltar com tudo no ar antes que seus clientes sintam falta.';
  } else if (tipo === 'd2') {
    subject = 'Faltam poucos dias no seu teste do Moviki';
    titulo  = 'Faltam só ' + dias + (dias === 1 ? ' dia' : ' dias') + ' de teste';
    chamada = 'Seu teste grátis está acabando. Assine agora pra não perder seu espaço no mapa nem o que você já montou.';
  } else { // d7
    subject = 'Seu teste do Moviki está terminando';
    titulo  = 'Seu teste grátis está terminando';
    chamada = 'Faltam poucos dias pro seu teste acabar. Que tal garantir seu lugar no mapa e continuar aparecendo pros clientes?';
  }

  const bullets = [
    'Seu <b>cardápio</b>, <b>promoções</b> e <b>eventos</b> seguem no ar',
    'Você continua aparecendo no <b>mapa</b> pros clientes te acharem',
    'No <b>Premium</b>, sua <b>logo aparece no seu pino do mapa</b> — muito mais destaque',
  ];

  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;color:#1c2a3a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(20,40,80,.08)">

        <tr><td style="background:linear-gradient(135deg,#0c2138,#0e2d54);padding:26px 30px;text-align:center">
          <img src="${SITE}/logo.png" alt="Moviki" height="34" style="height:34px;display:inline-block">
        </td></tr>

        <tr><td style="padding:32px 34px 8px">
          <h1 style="margin:0 0 8px;font-size:22px;color:#0c2138">Olá, ${esc(nome)}! ⏳</h1>
          <p style="margin:0;font-size:17px;color:#0066FF;font-weight:bold">${esc(titulo)}</p>
        </td></tr>

        <tr><td style="padding:14px 34px 0;font-size:15px;line-height:1.6;color:#33465c">
          <p style="margin:0 0 18px">${esc(chamada)}</p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f6ff;border:1px solid #d6e4fb;border-radius:12px;margin:0 0 20px">
            <tr><td style="padding:16px 18px;font-size:14px;line-height:1.7;color:#33465c">
              ${bullets.map(b => '• ' + b).join('<br>')}
            </td></tr>
          </table>

          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 22px">
            <tr><td style="border-radius:11px;background:linear-gradient(135deg,#0066FF,#0aa2c8)">
              <a href="${PAINEL_URL}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none">Assinar agora →</a>
            </td></tr>
          </table>

          <p style="margin:0 0 22px;font-size:13px;color:#64748b;text-align:center">Premium por R$ 49,90/mês (com sua logo no mapa) · ou Pró por R$ 37,90/mês.</p>

          <p style="margin:0 0 6px;font-size:14px;color:#64748b">Qualquer dúvida, é só chamar a gente no WhatsApp:</p>
          <p style="margin:0 0 24px;font-size:15px"><a href="${WPP_LINK}" style="color:#16a34a;font-weight:bold;text-decoration:none">${WPP_TEXTO}</a></p>
        </td></tr>

        <tr><td style="padding:20px 34px;border-top:1px solid #e4e9f0;text-align:center">
          <p style="margin:0 0 4px;font-size:14px;color:#33465c;font-weight:bold">Equipe Moviki</p>
          <p style="margin:0;font-size:12px;color:#94a3b8">O mapa inteligente dos negócios em movimento.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    'Olá, ' + nome + '!',
    '',
    titulo + '.',
    chamada,
    '',
    'Assinando você mantém:',
    '- Seu cardápio, promoções e eventos no ar',
    '- Sua presença no mapa pros clientes te acharem',
    '- No Premium, sua logo aparece no seu pino do mapa (mais destaque)',
    '',
    'Assine agora: ' + PAINEL_URL,
    'Premium R$ 49,90/mês (com logo no mapa) ou Pró R$ 37,90/mês.',
    '',
    'Dúvidas? WhatsApp: ' + WPP_TEXTO + ' (' + WPP_LINK + ')',
    '',
    'Equipe Moviki',
    'O mapa inteligente dos negócios em movimento.',
  ].join('\n');

  return { subject, html, text };
}
