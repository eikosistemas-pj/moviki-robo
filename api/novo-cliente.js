// api/novo-cliente.js  (repo: moviki-robo)  | versao 2026-10-09-origem | antes 06/10/2026 plano 2.6
// Avisa o dono no Telegram quando um COMERCIANTE (lojista) cria conta no app.
// Mesmo padrão do novo-parceiro.js. Segurança: confere o ID token do próprio
// usuário recém-cadastrado (Admin SDK). Idempotente: grava avisos_cliente/{uid}
// e nunca manda duas vezes pro mesmo uid.
//
// Envs necessárias no Vercel (projeto moviki-robo) — já existem:
//   TELEGRAM_TOKEN    -> token do bot (do @BotFather)
//   TELEGRAM_CHAT_ID  -> seu chat_id no Telegram
//
// -------------------------------------------------------------------------
// REVISAO 04/09/2026 — atribuicao do Lead ao anuncio.
//
// O Lead ja era disparado desde 27/08 e chegava na Meta como "processado" —
// mas sem o parametro do clique. A Meta nao tinha como ligar aquele cadastro
// a um anuncio, entao a campanha marcava zero conversao mesmo com a CAPI no ar.
//
// Agora a chamada do painel traz fbc/fbp (injetados pelo mvmetrica.js, que
// guarda o identificador do clique em sessionStorage e o carrega no salto de
// moviki.com.br pra app.moviki.com.br) e o IP do cliente sai do proprio req.
//
// Todos os tres sao OPCIONAIS: cadastro organico chega sem fbc e o Lead vai do
// mesmo jeito, so sem credito de campanha. Nada aqui pode barrar um cadastro.
//
// -------------------------------------------------------------------------
// REVISAO 05/09/2026 — O AVISO PASSA A DIZER SE A MEDICAO SAIU.
//
// O DEFEITO: em 05/09 um cadastro de teste passou, o aviso veio com "Origem:
// anuncio da Meta" e o Gerenciador de Eventos ficou VAZIO. Os dois fatos
// convivem porque o lib/meta.js falha calado (medicao nunca derruba cadastro)
// e esta funcao JOGAVA FORA o retorno dele. Saber que o cadastro entrou nao e
// a mesma coisa que saber que ele foi medido — e a diferenca so aparecia dias
// depois, no Gerenciador, com verba de campanha ja gasta.
//
// AGORA o aviso traz o motivo: enviada, sem env, recusada pela Meta com o
// codigo HTTP, ou tempo esgotado. O log continua igual; isto e para o motivo
// chegar a quem consegue agir sem abrir painel de servidor.
// -------------------------------------------------------------------------
// REVISAO 09/10/2026 — DE ONDE VEIO E COMO FALAR COM ELE.
//
// (1) ORIGEM: o aviso so dizia "anuncio da Meta" ou nada. Agora o painel manda
// as UTMs da chegada e o dominio da pagina anterior (window.mvAtrib), o robo
// le a indicacao de parceiro no proprio banco e grava UM canal em
// avisos_cliente/{uid}.origem (lib/origem.js, com teste). O funil do dono soma
// por canal. Dado do navegador: limpo, cortado e so vira etiqueta.
// (2) WHATSAPP: o cadastro pelo quiz pede o WhatsApp do negocio, mas grava o
// negocio DEPOIS de chamar este endpoint. O robo espera ate ~5 s o
// negocios/{uid} aparecer e manda no Telegram o nome e um link wa.me com uma
// mensagem pronta do Paulo — falar com o lojista nas primeiras horas e o que
// mais leva a primeira live. Nao grava o numero em lugar nenhum novo: ele ja
// esta em negocios/{uid}.whatsapp (perfil do negocio, politica item 2/3).
// -------------------------------------------------------------------------

const { admin, db } = require('../lib/firebase');
const { freioUid } = require('../lib/freio');   // 06/10 (plano 2.6)
const meta = require('../lib/meta');
const { classificarOrigem, textoOrigem } = require('../lib/origem');

const ESPERA_NEGOCIO_MS = [0, 2000, 2500];   // ~4,5 s no total, dentro do limite da funcao
const dormir = (ms) => new Promise((ok) => setTimeout(ok, ms));

/* WhatsApp do negocio -> link wa.me com DDI 55. Aceita "81 99999-9999",
   "5581999999999" e similares; devolve '' se nao parecer celular/fixo do BR. */
function linkWhats(numero, nome) {
  let d = String(numero || '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length >= 12 && d.slice(0, 2) === '55') d = d.slice(2);
  if (d.length < 10 || d.length > 11) return '';
  const msg = 'Oi! Aqui é o Paulo, fundador do Moviki. Vi que você criou a conta' +
    (nome ? ' do ' + String(nome).slice(0, 60) : '') +
    ' agora há pouco. Quer que eu te ajude a fazer o ensaio da sua primeira live? Leva 10 minutos.';
  return 'https://wa.me/55' + d + '?text=' + encodeURIComponent(msg);
}

const ORIGIN_OK   = 'https://app.moviki.com.br';
const PAINEL_DONO = 'https://app.moviki.com.br/eikoadm01.html';

// IP real do visitante. Na Vercel o cliente vem no x-forwarded-for; os outros
// dois sao reserva. Cabecalho e dado do cliente, entao o lib/meta.js valida o
// formato antes de mandar — lixo aqui nao vira lixo no conjunto de dados.
function ipDoCliente(req) {
  const h = (req && req.headers) || {};
  return String(
    h['x-forwarded-for'] ||
    h['x-real-ip'] ||
    h['x-vercel-forwarded-for'] ||
    ''
  );
}

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
    /* 06/10 (plano 2.6): freio por conta. Idempotente por uid, mas cada chamada
       gasta Telegram e Meta; em laco, derrubaria o aviso dos cadastros reais. */
    if (!(await freioUid(admin, db, 'novocliente', uid, 5, 3600000))) { res.status(429).json({ ok: false, motivo: 'freio' }); return; }
    const email = String(decoded.email || '').trim();

    // 2) Idempotência: um aviso por conta.
    const avisoRef = db.collection('avisos_cliente').doc(uid);
    if ((await avisoRef.get()).exists) { res.status(200).json({ ok: true, jaAvisado: true }); return; }
    /* 09/10: reserva o aviso ANTES da espera pelo negocio (ate ~4,5 s). Sem
       isto, duas chamadas quase juntas passavam as duas pela conferencia acima
       e o Paulo recebia o mesmo cadastro duas vezes. create() falha se ja
       existe: so a primeira segue. */
    try { await avisoRef.create({ email, nome: '', avisadoEm: admin.firestore.FieldValue.serverTimestamp(), reservado: true }); }
    catch (_) { res.status(200).json({ ok: true, jaAvisado: true }); return; }

    // 3) Origem (09/10): UTMs e pagina anterior vindas do painel + indicacao de
    //    parceiro lida aqui, no banco (o navegador nao decide quem e parceiro).
    let refParceiro = '';
    try {
      const ind = await db.collection('indicacoes').doc(uid).get();
      if (ind.exists) refParceiro = String((ind.data() || {}).ref || '');
    } catch (_) {}
    const origem = classificarOrigem({
      utm: body.utm, ref: body.ref, fbc: body.fbc, origemUrl: body.origemUrl, parceiro: refParceiro,
    });

    // 3b) Meta (Conversions API): marca o CADASTRO como Lead.
    // Vem ANTES do Telegram de proposito: se as envs do Telegram faltarem, a
    // funcao sai mais abaixo e a medicao teria sido perdida.
    // Idempotente duas vezes: o avisos_cliente/{uid} ja barrou repeticao, e o
    // event_id 'lead_<uid>' faz a propria Meta ignorar duplicata.
    // Enquanto o volume de venda for baixo, e ESTE o evento com material
    // suficiente pra campanha otimizar — Purchase sozinho nao sai do aprendizado.
    // O agente de usuario vem da propria chamada do painel: a Meta exige esse
    // dado em evento marcado como 'website', e aqui existe navegador de verdade.
    // fbc/fbp vem do mvmetrica.js e sao o que liga o cadastro ao anuncio.
    let medicao = '';
    try {
      await meta.lead({
        uid, email,
        origem: 'cadastro_comerciante',
        agenteUsuario: String(req.headers['user-agent'] || ''),
        ip: ipDoCliente(req),
        fbc: String(body.fbc || ''),
        fbp: String(body.fbp || ''),
        origemUrl: String(body.origemUrl || ''),
      });
      medicao = meta.ultimoTexto ? meta.ultimoTexto() : '';
    }
    catch (e) {
      medicao = 'Medicao: FALHOU — ' + ((e && e.message) ? String(e.message).slice(0,120) : 'erro');
    }

    // 3c) Nome e WhatsApp do negocio. Pelo quiz, o negocio e gravado logo DEPOIS
    //     desta chamada: espera ate ~4,5 s. Cadastro so com e-mail nao tem
    //     negocio ainda — o aviso sai sem os dois, como antes.
    let nome = '', whats = '';
    for (const ms of ESPERA_NEGOCIO_MS) {
      if (ms) await dormir(ms);
      try {
        const neg = await db.collection('negocios').doc(uid).get();
        if (neg.exists) {
          const n = neg.data() || {};
          nome = String(n.nome || '').trim().slice(0, 80);
          whats = String(n.whatsapp || '');
          break;
        }
      } catch (_) {}
    }
    const zap = linkWhats(whats, nome);

    // 3d) Completa o registro reservado ANTES do Telegram: sem as envs do
    //     Telegram a funcao sai abaixo, e a origem nao pode se perder.
    const veioDeAnuncio = /^fb\.\d\.\d+\./.test(String(body.fbc || ''));
    try {
      await avisoRef.set({
        email, nome,
        origemAnuncio: veioDeAnuncio,
        origem,                       // 09/10: canal do cadastro (lib/origem.js)
        reservado: admin.firestore.FieldValue.delete(),
      }, { merge: true });            // merge: avisadoEm fica o da reserva (hora do cadastro)
    } catch (_) {}

    // 4) Manda o aviso no Telegram.
    const TOKEN = process.env.TELEGRAM_TOKEN;
    const CHAT  = process.env.TELEGRAM_CHAT_ID;
    if (!TOKEN || !CHAT) { res.status(200).json({ ok: false, motivo: 'sem_config' }); return; }

    // Saber que o cadastro veio de anuncio, no proprio aviso, evita ter que
    // abrir o Gerenciador pra descobrir se a campanha esta entregando gente.
    // (veioDeAnuncio e calculado acima, no 3d.)

    /* A linha da medicao so entra quando ha o que dizer. Quando o envio deu
       certo ela e discreta; quando falhou, ela grita — e e assim que se
       descobre medicao quebrada no mesmo dia, e nao na semana seguinte. */
    const linhaMedicao = medicao
      ? ((medicao.indexOf('enviada') > -1 ? '✅ ' : '⚠️ ') + medicao + '\n')
      : '';

    const texto =
      '🛍️ Novo comerciante no Moviki!\n\n' +
      (nome  ? ('Negócio: ' + nome + '\n')  : '') +
      (email ? ('E-mail: '  + email + '\n') : '') +
      'Origem: ' + textoOrigem(origem) + (veioDeAnuncio && origem.canal !== 'anuncio_meta' ? ' · clicou em anúncio da Meta 📣' : '') + '\n' +
      linhaMedicao +
      'Acabou de criar a conta ✨\n\n' +
      (zap ? ('👉 Chamar no WhatsApp agora (mensagem pronta):\n' + zap + '\n\n') : '') +
      'Ver no painel:\n' + PAINEL_DONO;

    try {
      await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: CHAT, text: texto, disable_web_page_preview: true }),
      });
    } catch (_) {}

    // 5) O registro em avisos_cliente/{uid} ja foi reservado (2) e completado (3d).

    res.status(200).json({ ok: true, canal: origem.canal });
  } catch (e) {
    res.status(200).json({ ok: false });
  }
};

module.exports._t = { linkWhats };
