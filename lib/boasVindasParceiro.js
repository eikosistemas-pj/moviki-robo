// lib/boasVindasParceiro.js  (repo: moviki-robo)
// Monta e envia o e-mail de boas-vindas de um parceiro recém-aprovado (via Resend).
// Compartilhado entre api/parceiro-aprovado.js (aprovação manual, painel do dono)
// e api/novo-parceiro.js (aprovação automática) — pra não ter duas cópias do
// mesmo template e os dois fluxos ficarem sempre em sincronia.
//
// Quem chama já garante que o parceiro está com status 'aprovado'; esta função
// só cuida de montar, enviar e marcar boasVindasEnviadoEm. Passe { forcar:true }
// pra reenviar mesmo que boasVindasEnviadoEm já exista.
//
// Env var necessária no Vercel (projeto moviki-robo):
//   RESEND_API_KEY  -> chave da API do provedor de e-mail

const EMAIL_FROM  = 'Moviki <suporte@moviki.com.br>';
const PAINEL_URL  = 'https://app.moviki.com.br/parceiro.html';
const WPP_TEXTO   = '(41) 2018-6848';
const WPP_LINK    = 'https://wa.me/554120186848';
const SITE        = 'https://moviki.com.br';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function enviarBoasVindasParceiro({ admin, parceiroRef, p, forcar = false }) {
  if (p.boasVindasEnviadoEm && !forcar) return { ok: true, jaEnviado: true };

  const email = String(p.email || '').trim();
  if (!email) return { ok: false, erro: 'parceiro sem email' };

  const API_KEY = process.env.RESEND_API_KEY;
  if (!API_KEY) return { ok: false, motivo: 'sem_config' };

  const nome = (p.nome || '').toString().trim() || 'Parceiro';
  const slug = (p.slug || '').toString().trim();
  const linkParceiro = slug ? (SITE + '/p/' + encodeURIComponent(slug)) : SITE;

  const html  = montarHtml({ nome, slug, linkParceiro });
  const texto = montarTexto({ nome, slug, linkParceiro });

  let r;
  try {
    r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [email],
        subject: 'Bem-vindo(a) ao Programa de Parceiros do Moviki 🎉',
        html,
        text: texto,
      }),
    });
  } catch (e) {
    console.error('[boasVindasParceiro] Erro ao chamar o Resend:', e);
    return { ok: false, erro: 'falha ao enviar e-mail' };
  }

  if (!r.ok) {
    const detalhe = await r.text().catch(() => '');
    console.error('[boasVindasParceiro] Resend recusou o envio:', r.status, detalhe);
    return { ok: false, erro: 'falha ao enviar e-mail' };
  }

  await parceiroRef.update({ boasVindasEnviadoEm: admin.firestore.FieldValue.serverTimestamp() });
  return { ok: true };
}

function montarHtml({ nome, slug, linkParceiro }) {
  const linkVisivel = slug ? ('moviki.com.br/p/' + esc(slug)) : 'moviki.com.br';
  return `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:Arial,Helvetica,sans-serif;color:#1c2a3a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f7;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(20,40,80,.08)">

        <tr><td style="background:linear-gradient(135deg,#0c2138,#0e2d54);padding:26px 30px;text-align:center">
          <img src="${SITE}/logo.png" alt="Moviki" height="34" style="height:34px;display:inline-block">
        </td></tr>

        <tr><td style="padding:32px 34px 8px">
          <h1 style="margin:0 0 6px;font-size:22px;color:#0c2138">Olá, ${esc(nome)}! 🎉</h1>
          <p style="margin:0;font-size:16px;color:#0066FF;font-weight:bold">Sua adesão foi aprovada.</p>
        </td></tr>

        <tr><td style="padding:14px 34px 0;font-size:15px;line-height:1.6;color:#33465c">
          <p style="margin:0 0 16px">A partir de agora você é oficialmente um <b>Parceiro Moviki</b>. Seja muito bem-vindo(a) ao programa — é um prazer ter você com a gente.</p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f6ff;border:1px solid #d6e4fb;border-radius:12px;margin:0 0 18px">
            <tr><td style="padding:16px 18px">
              <p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;font-weight:bold">Seu link exclusivo (já está ativo)</p>
              <p style="margin:0"><a href="${linkParceiro}" style="font-size:16px;color:#0066FF;font-weight:bold;text-decoration:none;word-break:break-all">${linkVisivel}</a></p>
            </td></tr>
          </table>

          <p style="margin:0 0 16px">Todo comerciante que se cadastrar por esse link fica ligado a você automaticamente. Você recebe <b>15% da mensalidade dele, todos os meses</b>, enquanto ele continuar cliente — além dos bônus por indicar outros parceiros.</p>

          <p style="margin:0 0 22px">No seu painel você acompanha os cadastros trazidos, o quanto já ganhou e pode <b>pedir seu saque via Pix</b> quando quiser.</p>

          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 26px">
            <tr><td style="border-radius:11px;background:linear-gradient(135deg,#0066FF,#0aa2c8)">
              <a href="${PAINEL_URL}" style="display:inline-block;padding:14px 30px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none">Acessar meu painel →</a>
            </td></tr>
          </table>

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
}

function montarTexto({ nome, slug, linkParceiro }) {
  return [
    'Olá, ' + nome + '!',
    '',
    'Sua adesão foi aprovada. A partir de agora você é oficialmente um Parceiro Moviki. Seja bem-vindo(a)!',
    '',
    'Seu link exclusivo (já ativo): ' + linkParceiro,
    'Todo comerciante que se cadastrar por ele fica ligado a você, e você recebe 15% da mensalidade dele todos os meses, enquanto for cliente — além dos bônus por indicar outros parceiros.',
    '',
    'Acesse seu painel para acompanhar cadastros, ganhos e pedir seu saque via Pix:',
    PAINEL_URL,
    '',
    'Dúvidas? Chame no WhatsApp: ' + WPP_TEXTO + ' (' + WPP_LINK + ')',
    '',
    'Equipe Moviki',
    'O mapa inteligente dos negócios em movimento.',
  ].join('\n');
}

module.exports = { enviarBoasVindasParceiro };
