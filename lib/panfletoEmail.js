// lib/panfletoEmail.js | versao 2026-10-20-panfletos | repo: moviki-robo
//
// POR QUE EXISTE
//   O painel do dono monta o panfleto com o QR da Eiko Sistemas (aba
//   "Panfletos com QR", eikoadm01.html) e o Paulo precisa mandar o PDF de
//   impressao direto para a grafica. E-mail com anexo nao sai do navegador
//   (mailto nao anexa arquivo), entao o PDF vem para ca e sai pelo Resend,
//   com o mesmo remetente dos outros e-mails do robo.
//
// QUEM CHAMA
//   So api/funil-dono.js, acao "panfleto_email", depois de conferir que e
//   ADMIN com sessao do Google (lib/admin.js) e passar pelo freio.
//
// TRAVAS
//   - so PDF de verdade (comeca com %PDF-) e ate 3 MB;
//   - ate 3 destinatarios, e-mail com formato valido;
//   - responder vai para o e-mail do dono que mandou (a grafica responde a ele);
//   - nada e gravado no banco: o arquivo passa e vai embora.
// Nada aqui toca em dinheiro.

const EMAIL_FROM = 'Moviki <suporte@moviki.com.br>';
const MAX_BYTES = 3 * 1024 * 1024;
const MAX_DEST = 3;
const EMAIL_OK = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function limpo(s, n) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
}

/* Confere o pedido. Devolve { ok, erro } ou { ok:true, dados } pronto para enviar. */
function validar(b) {
  b = b || {};
  const lista = (Array.isArray(b.para) ? b.para : String(b.para || '').split(/[,;\s]+/))
    .map((e) => String(e || '').trim().toLowerCase()).filter(Boolean);
  const para = lista.filter((e, i) => lista.indexOf(e) === i);
  if (!para.length) return { ok: false, erro: 'para', mensagem: 'Informe o e-mail de quem vai receber.' };
  if (para.length > MAX_DEST) return { ok: false, erro: 'para', mensagem: 'No máximo ' + MAX_DEST + ' e-mails por envio.' };
  const ruim = para.filter((e) => e.length > 120 || !EMAIL_OK.test(e));
  if (ruim.length) return { ok: false, erro: 'para', mensagem: 'E-mail inválido: ' + ruim[0].slice(0, 60) };

  const pdf = String(b.pdf || '').replace(/^data:application\/pdf;base64,/, '').replace(/\s+/g, '');
  if (!pdf || !/^[A-Za-z0-9+/]+=*$/.test(pdf)) return { ok: false, erro: 'pdf', mensagem: 'Arquivo do panfleto não chegou.' };
  const bytes = Math.floor(pdf.length * 3 / 4);
  if (bytes > MAX_BYTES) return { ok: false, erro: 'pdf', mensagem: 'Arquivo grande demais para e-mail.' };
  if (pdf.slice(0, 8) !== 'JVBERi0x' && pdf.slice(0, 7) !== 'JVBERi0') return { ok: false, erro: 'pdf', mensagem: 'O arquivo não é um PDF.' };

  let nome = limpo(b.arquivo, 90).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!nome) nome = 'panfleto-moviki';
  if (!/\.pdf$/.test(nome)) nome += '.pdf';

  return {
    ok: true,
    dados: {
      para,
      pdf,
      arquivo: nome,
      titulo: limpo(b.titulo, 120) || 'Panfleto Moviki',
      mensagem: limpo(b.mensagem, 600),
      sangria: b.sangria === true,
    },
  };
}

function montarHtml(d, remetente) {
  const medida = d.sangria
    ? 'A5 (14,8 x 21 cm) com 3 mm de sangria em cada lado. O arquivo já vem com a sangria: imprimir em 100%, sem reduzir, e refilar no A5.'
    : 'A5 (14,8 x 21 cm). Imprimir em 100%, sem reduzir.';
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"></head>' +
    '<body style="margin:0;padding:24px;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#0b1220">' +
    '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px">' +
    '<p style="margin:0 0 12px;font-size:16px"><b>' + esc(d.titulo) + '</b></p>' +
    (d.mensagem ? '<p style="margin:0 0 14px;font-size:14px;line-height:1.6">' + esc(d.mensagem) + '</p>' : '') +
    '<p style="margin:0 0 6px;font-size:14px"><b>Arquivo para impressão</b> em anexo (PDF, 300 dpi).</p>' +
    '<p style="margin:0 0 6px;font-size:14px;line-height:1.6">Medida: ' + esc(medida) + '</p>' +
    '<p style="margin:0 0 14px;font-size:14px;line-height:1.6">Sugestão de papel: couché 150 g ou mais. O QR code precisa sair nítido: não comprimir a imagem.</p>' +
    '<p style="margin:0;font-size:12px;color:#5b6b7f">Enviado pelo painel do Moviki (EIKO SISTEMAS DESENVOLVIMENTO DE SOFTWARE LTDA, CNPJ 68.289.841/0001-02).' +
    (remetente ? ' Para responder, use: ' + esc(remetente) + '.' : '') + '</p>' +
    '</div></body></html>';
}

function montarTexto(d, remetente) {
  return [
    d.titulo,
    d.mensagem || '',
    'Arquivo para impressão em anexo (PDF, 300 dpi).',
    d.sangria ? 'Medida: A5 (14,8 x 21 cm) com 3 mm de sangria. Imprimir em 100%, sem reduzir, e refilar no A5.' : 'Medida: A5 (14,8 x 21 cm). Imprimir em 100%, sem reduzir.',
    'Papel: couché 150 g ou mais. O QR code precisa sair nítido.',
    remetente ? 'Para responder: ' + remetente : '',
  ].filter(Boolean).join('\n\n');
}

/* Envia. fetchFn injetavel para teste. */
async function enviar(body, quem, opts) {
  opts = opts || {};
  const v = validar(body);
  if (!v.ok) return v;
  const d = v.dados;
  const chave = opts.chave != null ? opts.chave : process.env.RESEND_API_KEY;
  if (!chave) return { ok: false, erro: 'sem_config', mensagem: 'E-mail do robô sem configuração.' };
  const remetente = quem && EMAIL_OK.test(String(quem.email || '')) ? String(quem.email).toLowerCase() : '';
  const para = d.para.slice();
  const cc = (body && body.copia === true && remetente && para.indexOf(remetente) < 0) ? [remetente] : undefined;
  const corpo = {
    from: EMAIL_FROM,
    to: para,
    subject: 'Panfleto para impressão — ' + d.titulo,
    html: montarHtml(d, remetente),
    text: montarTexto(d, remetente),
    attachments: [{ filename: d.arquivo, content: d.pdf }],
  };
  if (cc) corpo.cc = cc;
  if (remetente) corpo.reply_to = remetente;
  const f = opts.fetchFn || fetch;
  let r;
  try {
    r = await f('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + chave, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  } catch (e) {
    console.error('[panfletoEmail] falha de rede', (e && e.message) || e);
    return { ok: false, erro: 'envio', mensagem: 'Não deu para enviar agora. Tente de novo.' };
  }
  if (!r.ok) {
    const det = await r.text().catch(() => '');
    console.error('[panfletoEmail] Resend recusou', r.status, String(det).slice(0, 300));
    return { ok: false, erro: 'envio', mensagem: 'O provedor de e-mail recusou o envio.' };
  }
  return { ok: true, para: d.para, copia: !!cc };
}

module.exports = { enviar, validar, MAX_BYTES, MAX_DEST };
