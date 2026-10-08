// versao 2026-10-07-ativacao1 (P75 fase 0: e-mails da primeira live, descadastro das dicas, Premium como destino; inclui a 2026-10-05-global: pula Paddle e negocio de fora do Brasil; base 2026-10-03-segredo)
// api/lembrete-trial.js  (repo: moviki-robo)
// ROBÔ DE LEMBRETES — roda 1x por dia (agendado no vercel.json).
// Avisa por e-mail quem está pra perder acesso:
//   • TESTE grátis (periodo:'trial') chegando ao fim -> convida a assinar
//        d7 (~7 dias), d2 (~2 dias), fim (venceu) — 1 vez cada na vida do teste
//   • PLANO PAGO chegando ao vencimento -> lembra de garantir o pagamento
//        1 aviso por ciclo, quando faltam <=5 dias; reavisa a cada novo vencimento.
//        (No cartão a renovação é automática; a mensagem é neutra e serve p/ Pix/boleto.)
// A marca de "já enviei" fica em assinaturas/{uid}.lembretes (Admin SDK -> não passa
// pelas regras do Firestore).
//
// 07/10/2026 (P75, fase 0) — SEQUENCIA DA PRIMEIRA LIVE:
//   O robo so falava de PAGAR. Quem se cadastrava e nao fazia a live nunca
//   recebia um empurrao para o que o anuncio vendeu. Agora, durante o teste,
//   enquanto o lojista NAO fez nenhuma live, sai no maximo 1 e-mail por rodada:
//     ativ0 (dias 0 a 2)   sua primeira live em 10 minutos
//     ativ1 (dias 1 a 3)   so se o cardapio esta vazio: cadastre 3 produtos
//     ativ3 (dias 3 a 6)   live de ensaio de 5 minutos, ninguem precisa assistir
//     ativ7 (dias 7 a 9)   como chamar os clientes que voce ja tem
//     ativ10 (dias 10 a 13) ultimo convite
//   Fez live (live_cota.usadas > 0 ou live_sessoes existe) = a sequencia para.
//   Nunca sai no mesmo dia de um aviso de fim de teste. Nenhum texto promete venda.
//   Descadastro em 1 clique (?parar=uid&t=assinatura), sem login, so das dicas:
//   grava assinaturas/{uid}.dicasParar. Os avisos de fim de teste e de cobranca
//   continuam, porque sao sobre a conta.
//   Roda 2x por dia (12h e 21h UTC) para o e-mail do dia 0 nao esperar 24 h.
//
// Env no Vercel (moviki-robo): CRON_SECRET, RESEND_API_KEY, FIREBASE_SERVICE_ACCOUNT.
// Testar (simula, nunca envia): GET ?dry=1 com o cabecalho Authorization: Bearer <CRON_SECRET> (desde 23/09 o segredo nao vale mais na URL)

const { admin, db } = require('../lib/firebase');
const { bearerConfere } = require('../lib/segredo');
const { normalizarApelidos } = require('../lib/trocaApelido');
const crypto = require('crypto');

const EMAIL_FROM = 'Moviki <suporte@moviki.com.br>';
const PAINEL_URL = 'https://app.moviki.com.br';
const SITE       = 'https://moviki.com.br';
const WPP_TEXTO  = '(41) 2018-6848';
const WPP_LINK   = 'https://wa.me/554120186848';
const DIA_MS     = 86400000;
const DIAS_TRIAL = 30;          // o mesmo do api/ativar-trial.js
const ROBO_URL   = 'https://moviki-robo.vercel.app';

/* Sequencia da primeira live: [chave, primeiro dia, ultimo dia]. Dentro da
   janela vale a etapa MAIS RECENTE ainda nao enviada — quem chega atrasado nao
   recebe o e-mail do dia 0 no dia 9. */
const ATIVACAO = [
  ['ativ10', 10, 13],
  ['ativ7',   7,  9],
  ['ativ3',   3,  6],
  ['ativ1',   1,  3],
  ['ativ0',   0,  2],
];

/* Assinatura do link de descadastro. Derivada do CRON_SECRET, que ja existe:
   sem segredo novo na Vercel. Muda junto se o CRON_SECRET mudar. */
function tokenParar(uid) {
  const sec = String(process.env.CRON_SECRET || '');
  if (sec.length < 8) return '';
  return crypto.createHmac('sha256', sec + ':dicas').update(String(uid)).digest('hex').slice(0, 32);
}
function linkParar(uid) {
  const t = tokenParar(uid);
  return t ? (ROBO_URL + '/api/lembrete-trial?parar=' + encodeURIComponent(uid) + '&t=' + t) : '';
}
function paginaSimples(titulo, texto) {
  return '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Moviki</title></head>' +
    '<body style="margin:0;background:#0D1B2A;color:#F2F5F9;font-family:Arial,Helvetica,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">' +
    '<div style="max-width:420px;padding:28px;text-align:center"><h1 style="font-size:22px;margin:0 0 12px">' + esc(titulo) + '</h1>' +
    '<p style="font-size:15px;line-height:1.6;color:#9fb2c6;margin:0">' + esc(texto) + '</p></div></body></html>';
}
async function tratarParar(req, res) {
  const q = req.query || {};
  const uid = String(q.parar || '').slice(0, 128);
  const t = String(q.t || '');
  const esperado = tokenParar(uid);
  let ok = false;
  if (uid && esperado && t.length === esperado.length) {
    try { ok = crypto.timingSafeEqual(Buffer.from(t), Buffer.from(esperado)); } catch (_) { ok = false; }
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!ok) { res.status(400).send(paginaSimples('Link inválido', 'Este link de descadastro não é válido. Se quiser, responda o e-mail que recebeu.')); return; }
  try {
    // update e nao set: so marca quem ja tem registro. Criar assinaturas/{uid}
    // do nada faria o ativar-trial achar que a conta ja teve teste.
    await db.collection('assinaturas').doc(uid).update({
      dicasParar: true,
      dicasPararEm: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.error('parar dicas erro:', e);
    res.status(500).send(paginaSimples('Não deu certo agora', 'Tente de novo em alguns minutos.'));
    return;
  }
  res.status(200).send(paginaSimples('Pronto', 'Você não vai mais receber as dicas de uso do Moviki. Avisos sobre a sua conta e a sua assinatura continuam chegando.'));
}

/* Fez alguma live? Qualquer um dos dois registros basta. Erro de leitura =
   trata como "fez", para nunca mandar convite a quem ja fez. */
async function jaFezLive(uid) {
  try {
    const [c, s] = await Promise.all([
      db.collection('live_cota').doc(uid).get(),
      db.collection('live_sessoes').doc(uid).get(),
    ]);
    if (c.exists && Number((c.data() || {}).usadas) > 0) return true;
    return s.exists;
  } catch (_) { return true; }
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

module.exports = async (req, res) => {
  try {
    // 07/10: descadastro das dicas. Vem do link do e-mail (GET) ou do botao
    // "Cancelar inscricao" do Gmail (POST, List-Unsubscribe-Post). Sem login.
    if ((req.query || {}).parar) { await tratarParar(req, res); return; }

    const secret = process.env.CRON_SECRET;
    if (!secret) { res.status(200).json({ ok: false, motivo: 'sem_config_CRON_SECRET' }); return; }

    const q = req.query || {};
    const viaCabecalho = bearerConfere(req, secret); // 03/10: tempo constante
    const viaQuery     = false; // 23/09 (seguranca): segredo so no cabecalho — na URL ele vai parar em log
    if (!viaCabecalho && !viaQuery) { res.status(401).json({ ok: false, erro: 'nao_autorizado' }); return; }

    const enviarDeVerdade = viaCabecalho && String(q.dry || '') !== '1';

    /* 01/10/2026: indicacao que chegou pelo link VELHO de um parceiro que trocou
       de apelido passa para o apelido novo (lib/trocaApelido.js). Roda antes do
       e-mail e nunca derruba os lembretes. Em ?dry=1 nao grava nada. */
    let apelidos = { simulacao: true };
    if (enviarDeVerdade) {
      try { apelidos = await normalizarApelidos({ db }); }
      catch (e) { console.error('normalizarApelidos erro:', e); apelidos = { erro: true }; }
    }

    const API_KEY = process.env.RESEND_API_KEY;
    if (enviarDeVerdade && !API_KEY) { res.status(200).json({ ok: false, motivo: 'sem_RESEND_API_KEY' }); return; }

    const agora = Date.now();
    // Todas as assinaturas; separa trial x pago no loop.
    const snap = await db.collection('assinaturas').get();

    const resultado = { simulacao: !enviarDeVerdade, analisados: 0, enviados: 0, pulados: 0, detalhes: [] };

    for (const docu of snap.docs) {
      const d = docu.data() || {};
      const uid = docu.id;
      resultado.analisados++;

      if (d.ativo !== true || !d.vence_em || typeof d.vence_em.toMillis !== 'function') { resultado.pulados++; continue; }
      /* 05/10/2026: assinatura da Paddle (fora do Brasil) renova no cartao e a
         Paddle manda os proprios avisos; este e-mail e em portugues e fala do Asaas. */
      if (d.gateway === 'paddle') { resultado.pulados++; continue; }

      const dias = Math.ceil((d.vence_em.toMillis() - agora) / DIA_MS);
      const lembretes = d.lembretes || {};
      const ehTrial = d.periodo === 'trial';

      // Qual aviso cabe agora?
      let flag = null;
      if (ehTrial) {
        if (dias <= 0 && !lembretes.fim)                  flag = 'fim';
        else if (dias >= 1 && dias <= 2 && !lembretes.d2) flag = 'd2';
        else if (dias >= 3 && dias <= 7 && !lembretes.d7) flag = 'd7';
      } else {
        // plano pago: 1 aviso por ciclo, reavisa quando o vencimento muda.
        const venceId = String(d.vence_em.toMillis());
        if (dias >= 0 && dias <= 5 && lembretes.pagoVence !== venceId) flag = 'pago';
      }

      /* 07/10 (P75): sem aviso de fim de teste hoje, ve se cabe um e-mail da
         sequencia da primeira live. So no teste, so longe do fim (8+ dias). */
      let diaTeste = 0;
      if (!flag && ehTrial && dias >= 8 && d.dicasParar !== true) {
        diaTeste = Math.floor((agora - (d.vence_em.toMillis() - DIAS_TRIAL * DIA_MS)) / DIA_MS);
        const etapa = ATIVACAO.find(e => diaTeste >= e[1] && diaTeste <= e[2] && !lembretes[e[0]]);
        if (etapa) flag = etapa[0];
      }
      if (!flag) { resultado.pulados++; continue; }

      /* 05/10/2026: negocio de fora do Brasil fica sem lembrete ate o e-mail
         existir no idioma dele (Fase 2 do P73). Negocio sem pais = Brasil. */
      let negDados = null;
      try { const n = await db.collection('negocios').doc(uid).get(); if (n.exists) negDados = n.data() || {}; } catch (_) {}
      if (String((negDados && negDados.pais) || 'BR').toUpperCase() !== 'BR') { resultado.pulados++; resultado.detalhes.push({ uid, flag, status: 'fora_do_brasil' }); continue; }

      const ehAtivacao = flag.indexOf('ativ') === 0;
      if (ehAtivacao) {
        if (await jaFezLive(uid)) { resultado.pulados++; resultado.detalhes.push({ uid, flag, status: 'ja_fez_live' }); continue; }
        // ativ1 so faz sentido com o cardapio vazio; com produto, pula a etapa.
        const temProduto = !!(negDados && Array.isArray(negDados.cardapio) && negDados.cardapio.length > 0);
        if (flag === 'ativ1' && temProduto) {
          if (enviarDeVerdade) { try { await docu.ref.update({ 'lembretes.ativ1': 'pulado' }); } catch (_) {} }
          resultado.pulados++; resultado.detalhes.push({ uid, flag, status: 'ja_tem_produto' }); continue;
        }
      }

      let email = '';
      try { const u = await admin.auth().getUser(uid); email = String(u.email || '').trim(); } catch (_) {}
      if (!email) { resultado.pulados++; resultado.detalhes.push({ uid, flag, status: 'sem_email' }); continue; }

      let nome = 'Olá';
      if (negDados && negDados.nome) nome = String(negDados.nome).trim();

      const dic = Math.max(dias, 0);
      const parar = ehAtivacao ? linkParar(uid) : '';
      const msg = ehAtivacao ? montarAtivacao(flag, nome, parar, dic, negDados && negDados.slug) : montarEmail(flag, nome, dic);

      if (!enviarDeVerdade) {
        resultado.detalhes.push({ uid, flag, dias, diaTeste, email: mascara(email), status: 'simulado' });
        continue;
      }

      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign(
            { from: EMAIL_FROM, to: [email], subject: msg.subject, html: msg.html, text: msg.text },
            parar ? { headers: { 'List-Unsubscribe': '<' + parar + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } } : {}
          )),
        });
        if (!r.ok) {
          const det = await r.text().catch(() => '');
          console.error('resend erro:', r.status, det);
          resultado.detalhes.push({ uid, flag, status: 'falha_envio' });
          continue;
        }
        if (flag === 'pago') {
          await docu.ref.update({
            'lembretes.pagoVence': String(d.vence_em.toMillis()),
            'lembretes.pagoEm': admin.firestore.FieldValue.serverTimestamp(),
          });
        } else {
          await docu.ref.update({ ['lembretes.' + flag]: admin.firestore.FieldValue.serverTimestamp() });
        }
        resultado.enviados++;
        resultado.detalhes.push({ uid, flag, status: 'enviado' });
      } catch (e) {
        console.error('envio erro:', uid, e);
        resultado.detalhes.push({ uid, flag, status: 'erro' });
      }
    }

    res.status(200).json({ ok: true, ...resultado, apelidos });
  } catch (e) {
    console.error('lembrete erro:', e);
    res.status(500).json({ ok: false, erro: 'erro interno' });
  }
};

function mascara(e) {
  const [u, dom] = String(e).split('@'); if (!dom) return '***';
  return (u.slice(0, 2) + '***') + '@' + dom;
}

function montarEmail(tipo, nome, dias) {
  let subject, titulo, chamada;
  const pago = tipo === 'pago';

  if (tipo === 'fim') {
    subject = 'Seu teste do Moviki terminou — reative em 1 minuto';
    titulo  = 'Seu teste grátis terminou';
    chamada = 'Seu período de teste chegou ao fim. Reative agora pra voltar com tudo no ar antes que seus clientes sintam falta.';
  } else if (tipo === 'd2') {
    subject = 'Faltam poucos dias no seu teste do Moviki';
    titulo  = 'Faltam só ' + dias + (dias === 1 ? ' dia' : ' dias') + ' de teste';
    chamada = 'Seu teste grátis está acabando. Para continuar fazendo live, o plano é o Premium. Se não assinar, sua conta volta ao plano Básico: o link e o pino no mapa continuam no ar e nada do que você montou é apagado.';
  } else if (tipo === 'd7') {
    subject = 'Seu teste do Moviki está terminando';
    titulo  = 'Seu teste grátis está terminando';
    chamada = 'Faltam poucos dias pro seu teste acabar. Para continuar fazendo live, o plano é o Premium. Assinando durante o teste, a 1ª cobrança só vence no último dia dele e você não perde nenhum dia.';
  } else { // pago
    subject = 'Sua assinatura do Moviki está pra vencer';
    titulo  = 'Sua mensalidade vence em ' + dias + (dias === 1 ? ' dia' : ' dias');
    chamada = 'Se você paga por Pix ou boleto, fique de olho no e-mail de cobrança pra continuar no ar sem interrupção. Se paga no cartão, pode relaxar: a renovação é automática.';
  }

  const bullets = pago ? [
    'Seu <b>cardápio</b>, <b>promoções</b> e <b>eventos</b> continuam no ar',
    'Você segue aparecendo no <b>mapa</b> pros clientes te acharem',
    'Sem interrupção: pague a cobrança e nada muda pros seus clientes',
  ] : [
    'Seu <b>cardápio</b>, <b>promoções</b> e <b>eventos</b> seguem no ar',
    'No <b>Premium</b>, o <b>Modo Live</b> continua liberado e o cardápio vende com Pix na sua conta',
    'No <b>Premium</b>, sua <b>logo aparece no seu pino do mapa</b> — muito mais destaque',
  ];

  const ctaTexto = pago ? 'Acessar meu painel →' : 'Assinar agora →';
  const linhaPreco = pago ? '' :
    `<p style="margin:0 0 22px;font-size:13px;color:#64748b;text-align:center">Premium por R$ 69,90/mês, com live e venda pelo cardápio · o Pró (R$ 39,90/mês) não tem live.</p>`;

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
              <a href="${PAINEL_URL}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none">${ctaTexto}</a>
            </td></tr>
          </table>

          ${linhaPreco}

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
    'Olá, ' + nome + '!', '', titulo + '.', chamada, '',
    (pago ? 'Mantendo sua assinatura em dia:' : 'Assinando você mantém:'),
    '- Seu cardápio, promoções e eventos no ar',
    '- Sua presença no mapa pros clientes te acharem',
    (pago ? '- Sem interrupção pros seus clientes' : '- No Premium, a live continua liberada e o cardápio vende com Pix na sua conta'),
    '',
    (pago ? 'Acessar meu painel: ' : 'Assine agora: ') + PAINEL_URL,
    (pago ? '' : 'Premium R$ 69,90/mês, com live e venda pelo cardápio. O Pró (R$ 39,90/mês) não tem live.'),
    '',
    'Dúvidas? WhatsApp: ' + WPP_TEXTO + ' (' + WPP_LINK + ')',
    '', 'Equipe Moviki', 'O mapa inteligente dos negócios em movimento.',
  ].join('\n');

  return { subject, html, text };
}

/* 07/10/2026 (P75) — e-mails da primeira live. Regras: "teste grátis", nunca
   a palavra em inglês; nenhuma promessa de venda; rótulos iguais aos da tela
   (Fazer live, Entrar ao vivo, sacolinha); link de descadastro em todos. */
function montarAtivacao(tipo, nome, parar, diasRestantes, slug) {
  const slugOk = /^[a-z0-9_-]{3,40}$/i.test(String(slug || '')) ? String(slug) : '';
  const linkLive = slugOk ? ('https://www.moviki.com.br/live/' + slugOk) : '';
  let subject, titulo, paragrafos, passos = [], cta = 'Abrir meu painel →', extra = '';

  if (tipo === 'ativ0') {
    subject = 'Sua primeira live em 10 minutos';
    titulo  = 'Sua live já está liberada';
    paragrafos = [
      'No seu teste grátis você tem 2 lives pelo celular, sem instalar nada. O jeito mais rápido de entender o Moviki é fazer a primeira, mesmo que curtinha.',
    ];
    passos = [
      'Abra o painel e toque em <b>Fazer live</b>.',
      'Escolha até 5 produtos para a <b>sacolinha</b>.',
      'Toque em <b>Entrar ao vivo</b> e mande o link para os seus clientes no WhatsApp.',
    ];
    cta = 'Fazer minha primeira live →';
  } else if (tipo === 'ativ1') {
    subject = 'Falta pouco para a sua primeira live';
    titulo  = 'Cadastre 3 produtos';
    paragrafos = [
      'A live mostra na sacolinha os produtos do seu cardápio. Com 3 produtos com foto e preço você já consegue fazer a primeira.',
      'A foto pode ser do próprio celular. Dá para ajustar o enquadramento na hora de enviar.',
    ];
    cta = 'Cadastrar meus produtos →';
  } else if (tipo === 'ativ3') {
    subject = 'Que tal uma live curta hoje?';
    titulo  = 'Não precisa de roteiro';
    paragrafos = [
      'Chame 2 ou 3 clientes de confiança, mostre um produto de cada vez e veja como fica do lado de quem assiste.',
      'Cada live do teste pode durar até 1 hora. Se a conexão cair, reabra em até 15 minutos que continua sendo a mesma live.',
    ];
    cta = 'Fazer live agora →';
  } else if (tipo === 'ativ7') {
    subject = 'Quem vai assistir à sua live?';
    titulo  = 'Os clientes que você já tem';
    paragrafos = [
      'A live do Moviki é para quem já compra de você. Uma mensagem no WhatsApp antes de entrar ao vivo faz diferença. Pode copiar esta:',
    ];
    extra = 'Oi! Hoje às 19h vou fazer uma live mostrando as novidades da loja. É só tocar no link na hora: ' + (linkLive || '(o link da sua live aparece no painel)');
    cta = 'Abrir meu painel →';
  } else { // ativ10
    subject = 'Suas lives grátis ainda estão aqui';
    titulo  = 'Ainda dá tempo';
    paragrafos = [
      'Faltam ' + diasRestantes + ' dias do seu teste grátis e as suas 2 lives continuam disponíveis.',
      'Se alguma coisa travou no caminho, chame a gente no WhatsApp e conte onde parou.',
    ];
    cta = 'Fazer minha primeira live →';
  }

  const pHtml = paragrafos.map(t => '<p style="margin:0 0 16px">' + esc(t) + '</p>').join('');
  const passosHtml = passos.length
    ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0f6ff;border:1px solid #d6e4fb;border-radius:12px;margin:0 0 20px"><tr><td style="padding:16px 18px;font-size:14px;line-height:1.8;color:#33465c">' +
      passos.map((t, i) => (i + 1) + '. ' + t).join('<br>') + '</td></tr></table>'
    : '';
  const extraHtml = extra
    ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6fff8;border:1px dashed #86efac;border-radius:12px;margin:0 0 20px"><tr><td style="padding:16px 18px;font-size:14px;line-height:1.6;color:#14532d">' + esc(extra) + '</td></tr></table>'
    : '';
  const pararHtml = parar
    ? '<p style="margin:10px 0 0;font-size:11px;color:#94a3b8">Você recebe estas dicas porque criou uma conta no Moviki. <a href="' + esc(parar) + '" style="color:#94a3b8">Não quero mais receber dicas</a>.</p>'
    : '';

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
          <h1 style="margin:0 0 8px;font-size:22px;color:#0c2138">Olá, ${esc(nome)}!</h1>
          <p style="margin:0;font-size:17px;color:#0066FF;font-weight:bold">${esc(titulo)}</p>
        </td></tr>
        <tr><td style="padding:14px 34px 0;font-size:15px;line-height:1.6;color:#33465c">
          ${pHtml}
          ${passosHtml}
          ${extraHtml}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 22px">
            <tr><td style="border-radius:11px;background:linear-gradient(135deg,#0066FF,#0aa2c8)">
              <a href="${PAINEL_URL}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none">${esc(cta)}</a>
            </td></tr>
          </table>
          <p style="margin:0 0 6px;font-size:14px;color:#64748b">Dúvida? Chame a gente no WhatsApp:</p>
          <p style="margin:0 0 24px;font-size:15px"><a href="${WPP_LINK}" style="color:#16a34a;font-weight:bold;text-decoration:none">${WPP_TEXTO}</a></p>
        </td></tr>
        <tr><td style="padding:20px 34px;border-top:1px solid #e4e9f0;text-align:center">
          <p style="margin:0 0 4px;font-size:14px;color:#33465c;font-weight:bold">Equipe Moviki</p>
          <p style="margin:0;font-size:12px;color:#94a3b8">Sua loja ao vivo, pelo celular.</p>
          ${pararHtml}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const limpar = (t) => String(t).replace(/<[^>]+>/g, '');
  const text = [
    'Olá, ' + nome + '!', '', titulo + '.', '',
    ...paragrafos, '',
    ...passos.map((t, i) => (i + 1) + '. ' + limpar(t)),
    ...(extra ? ['', extra] : []),
    '', cta.replace(' →', '') + ': ' + PAINEL_URL,
    '', 'Dúvida? WhatsApp: ' + WPP_TEXTO + ' (' + WPP_LINK + ')',
    '', 'Equipe Moviki',
    ...(parar ? ['', 'Não quer mais receber dicas? ' + parar] : []),
  ].join('\n');

  return { subject, html, text };
}
