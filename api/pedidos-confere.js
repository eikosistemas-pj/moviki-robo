// versao 2026-09-23-rodada3 (varredura de pedidos + limpeza diaria de comprovantes de 90 dias)
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

module.exports = async (req, res) => {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) { res.status(200).json({ ok: false, motivo: 'sem_config_CRON_SECRET' }); return; }
    // So pelo cabecalho que a propria Vercel manda no cron (segredo fora da URL e dos logs).
    if (req.headers.authorization !== 'Bearer ' + secret) { res.status(401).json({ ok: false, erro: 'nao_autorizado' }); return; }

    const r = await checkout.varrerPedidosGateway(40);
    /* 23/09 (rodada 3): uma vez por dia (06:00-06:04 UTC) apaga comprovantes Pix com mais de 90 dias. */
    const agora = new Date();
    if (agora.getUTCHours() === 6 && agora.getUTCMinutes() < 5) {
      try { r.comprovantes = await checkout.limparComprovantesAntigos(300); } catch (e) { r.comprovantesErro = (e && e.message) || 'falha'; }
    }
    res.status(200).json(Object.assign({ ok: true }, r));
  } catch (e) {
    console.error('pedidos-confere erro:', e);
    res.status(200).json({ ok: false, erro: (e && e.message) ? e.message : 'erro' });
  }
};
