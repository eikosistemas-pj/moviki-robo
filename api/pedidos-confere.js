// versao 2026-10-22-marcocivil (+ varredura dos registros de acesso vencidos, 6 meses) | antes 2026-10-03-segredo (CRON_SECRET em tempo constante; erro generico na resposta) | base 2026-09-30-estoque (varredura de pedidos + comprovantes + retencao + reservas de estoque vencidas)
// GET /api/pedidos-confere  (cron a cada 5 minutos, protegido por CRON_SECRET)
//
// Confere no Asaas os pedidos da live e do cardapio que ainda estao
// "aguardando" nos modos com gateway (conta Asaas do lojista e subconta).
// Motivo: no modo 'asaas' nenhum aviso automatico do Asaas chega ate o robo.
// Sem esta varredura, o pedido so virava "pago" se o comprador estivesse com
// a pagina aberta — quem pagava pelo app do banco e fechava a tela deixava o
// pedido parado para sempre, sem e-mail de pago e sem "Marcar entregue".
// Pix direto (modo 'pix') fica de fora: la quem confirma e o lojista.
//
// Env (Vercel do moviki-robo): CRON_SECRET.

const checkout = require('../lib/checkout');
const { bearerConfere } = require('../lib/segredo');
const RA = require('../lib/registroAcesso');
const { admin, db } = require('../lib/firebase');

module.exports = async (req, res) => {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) { res.status(200).json({ ok: false, motivo: 'sem_config_CRON_SECRET' }); return; }
    // So pelo cabecalho que a propria Vercel manda no cron (segredo fora da URL e dos logs).
    if (!bearerConfere(req, secret)) { res.status(401).json({ ok: false, erro: 'nao_autorizado' }); return; }

    const r = await checkout.varrerPedidosGateway(40);
    /* 23/09 (rodada 3): uma vez por dia (06:00-06:04 UTC) apaga comprovantes Pix com mais de 90 dias. */
    const agora = new Date();
    if (agora.getUTCHours() === 6 && agora.getUTCMinutes() < 5) {
      try { r.comprovantes = await checkout.limparComprovantesAntigos(300); } catch (e) { r.comprovantesErro = (e && e.message) || 'falha'; }
    }
    /* 26/09: retencao dos dados do comprador. Segura a si mesma em 1 vez por
       hora (marca no Firestore), entao nao depende da frequencia deste cron. */
    try { r.retencao = await checkout.varrerRetencao(100); } catch (e) { r.retencaoErro = (e && e.message) || 'falha'; }
    /* 30/09/2026 (P53): reserva de estoque vencida devolve a peca; Pix
       direto abandonado vira 'expirado'. */
    try { r.reservas = await checkout.varrerReservas(150); } catch (e) { r.reservasErro = (e && e.message) || 'falha'; }
    /* 22/10/2026 (Marco Civil art. 15): registro de acesso vencido (6 meses)
       e apagado — guardar alem disso sem ordem judicial fere a LGPD. Segura a
       si mesmo em 1 vez por hora. */
    try { r.registrosAcesso = await RA.varrer(admin, db, 400); } catch (e) { r.registrosAcessoErro = (e && e.message) || 'falha'; }
    res.status(200).json(Object.assign({ ok: true }, r));
  } catch (e) {
    console.error('pedidos-confere erro:', e);
    res.status(200).json({ ok: false, erro: 'falha_interna' }); // 03/10: detalhe so no log da Vercel
  }
};
