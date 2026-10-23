// api/cancelar-assinatura.js | versao 2026-10-22-cancelar  (repo: moviki-robo)
//
// CANCELAR E DESISTIR PELO PROPRIO PAINEL — 22/10/2026.
//
// Por que existe: a contratacao do Moviki e 100% online (painel), mas cancelar
// e desistir so era possivel pelo WhatsApp ou por e-mail, com uma pessoa. O
// Decreto 7.962/2013 (art. 5º, §1º) garante o arrependimento "pela mesma
// ferramenta utilizada para a contratacao"; a Lei SP 17.832/2023 (arts. 64-66)
// exige cancelar servico continuado pelos mesmos meios da contratacao; e o
// CDC (arts. 39, V e 51, IV) veda dificultar o cancelamento. Cancelar so com
// humano e o padrao que o Procon autua.
//
// Acoes (POST, Authorization: Bearer <idToken>, sessao viva):
//   status   -> o que a tela precisa: plano, ate quando, se ja cancelou,
//               se ainda pode desistir e ate quando
//   cancelar -> para a renovacao no Asaas NA HORA. O plano segue ate o fim do
//               periodo ja pago (clausula 5 dos Termos; o webhook ignora o
//               PAYMENT_DELETED de proposito). Protocolo + e-mail.
//   desistir -> arrependimento: dentro de 7 dias do 1º pagamento (30 dias no
//               Lote Fundador, garantia da clausula 3-A), cancela a renovacao
//               e registra a devolucao INTEGRAL dos pagamentos do prazo.
//               Protocolo + e-mail + aviso ao dono. A devolucao em si:
//                 - com env DESISTENCIA_REEMBOLSO_AUTO = "1": o robo pede o
//                   estorno ao Asaas na hora (POST /payments/{id}/refund);
//                 - sem a env (padrao): o dono devolve pelo Asaas, no prazo da
//                   Politica de Reembolso (ate 7 dias uteis).
//               O webhook PAYMENT_REFUNDED ja devolve o lojista ao teste ou ao
//               Basico e estorna as comissoes.
//
// Nada aqui decide por regra da tela: prazo, valor e pagamentos saem do
// servidor (faturamento/{uid}.pagosLigados, gravado pelo webhook, e o Asaas).

'use strict';

const crypto = require('crypto');
const { admin, db } = require('../lib/firebase');
const { asaas } = require('../lib/asaas');
const { freioUid } = require('../lib/freio');

const ORIGENS_OK = ['https://app.moviki.com.br', 'https://moviki.com.br', 'https://www.moviki.com.br'];
const FV = admin.firestore.FieldValue;
const DIA_MS = 86400000;
const PRAZO_DESISTIR_DIAS = 7;
const PRAZO_FUNDADOR_DIAS = 30;
const EMAIL_FROM = 'Moviki <suporte@moviki.com.br>';

function msDe(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'number') return v;
  const t = Date.parse(v); return Number.isFinite(t) ? t : 0;
}
function dataBR(ms) { return ms ? new Date(ms).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : ''; }
function protocolo(agora) {
  const d = new Date(agora - 3 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
  return 'MVK-' + d + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function telegram(texto) {
  const T = process.env.TELEGRAM_TOKEN, C = process.env.TELEGRAM_CHAT_ID;
  if (!T || !C) return;
  try {
    await fetch('https://api.telegram.org/bot' + T + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: C, text: String(texto).slice(0, 3500), disable_web_page_preview: true }),
    });
  } catch (_) {}
}

async function email(para, assunto, linhas) {
  const chave = process.env.RESEND_API_KEY;
  if (!chave || !para) return false;
  const html = '<div style="font-family:Arial,sans-serif;max-width:520px;color:#0d1b2a;line-height:1.5">' +
    linhas.map((l) => '<p style="margin:0 0 12px">' + l + '</p>').join('') +
    '<p style="margin:18px 0 0;font-size:12px;color:#5b6b80">EIKO SISTEMAS DESENVOLVIMENTO DE SOFTWARE LTDA · CNPJ 68.289.841/0001-02 · ' +
    'suporte@moviki.com.br · (41) 2018-6848</p></div>';
  const text = linhas.map((l) => l.replace(/<[^>]+>/g, '')).join('\n\n');
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, to: [para], subject: assunto, html, text }),
    });
    return r.ok;
  } catch (_) { return false; }
}

/* Situacao calculada so com dado do servidor. */
async function situacao(uid) {
  const [fatS, assS] = await Promise.all([
    db.collection('faturamento').doc(uid).get(),
    db.collection('assinaturas').doc(uid).get(),
  ]);
  const fat = fatS.exists ? (fatS.data() || {}) : {};
  const ass = assS.exists ? (assS.data() || {}) : {};
  const pagos = Object.keys(fat.pagosLigados || {}).map((id) => ({ id, ms: msDe(fat.pagosLigados[id]) })).filter((p) => p.ms > 0).sort((a, b) => a.ms - b.ms);
  const primeiroMs = pagos.length ? pagos[0].ms : 0;
  const fundador = /^fundador/.test(String(ass.periodo || ''));
  const prazoDias = fundador ? PRAZO_FUNDADOR_DIAS : PRAZO_DESISTIR_DIAS;
  const desistirAteMs = primeiroMs ? primeiroMs + prazoDias * DIA_MS : 0;
  const pago = ['pro', 'premium', 'enterprise'].indexOf(String(ass.plano || '')) >= 0 && ass.periodo !== 'trial';
  return {
    fat, ass, pagos, fundador,
    plano: String(ass.plano || 'basico'), periodo: String(ass.periodo || ''),
    venceEmMs: msDe(ass.vence_em),
    temAssinaturaAsaas: !!fat.asaasSubscriptionId,
    parcelado: !!fat.asaasParcelamentoAtual && !fat.asaasSubscriptionId,
    renovacaoCancelada: ass.renovacaoCancelada === true,
    protocolo: ass.cancelamentoProtocolo || null,
    desistenciaPedida: !!ass.desistenciaProtocolo,
    pago,
    primeiroPagamentoMs: primeiroMs,
    desistirAteMs,
    podeDesistir: pago && !!primeiroMs && Date.now() <= desistirAteMs && !ass.desistenciaProtocolo,
  };
}

/* Para a renovacao. Assinatura: DELETE no Asaas (cobrancas futuras e a pendente
   somem; o plano pago segue — PAYMENT_DELETED nao derruba). Parcelamento do
   Fundador nao renova: nada a parar. */
async function pararRenovacao(sit) {
  const sub = sit.fat.asaasSubscriptionId;
  if (!sub) return { ok: true, nada: true };
  try { await asaas('/subscriptions/' + encodeURIComponent(sub), 'DELETE'); return { ok: true, sub }; }
  catch (e) {
    if (e && e.status === 404) return { ok: true, sub, jaNaoExistia: true };
    throw e;
  }
}

async function acaoCancelar(dec, sit, motivo, agora) {
  if (!sit.pago && !sit.temAssinaturaAsaas) return { status: 400, corpo: { ok: false, erro: 'sem_plano', mensagem: 'Você não tem plano pago para cancelar.' } };
  if (sit.renovacaoCancelada) return { status: 200, corpo: { ok: true, jaCancelado: true, protocolo: sit.protocolo, ate: dataBR(sit.venceEmMs) } };
  const r = await pararRenovacao(sit);
  const prot = protocolo(agora);
  await db.collection('assinaturas').doc(sit.uid).set({ renovacaoCancelada: true, cancelamentoProtocolo: prot, canceladoEm: FV.serverTimestamp() }, { merge: true });
  await db.collection('faturamento').doc(sit.uid).set({
    asaasSubscriptionId: FV.delete(),
    cancelamentos: { [prot]: { tipo: 'cancelar', em: FV.serverTimestamp(), sub: r.sub || null, motivo: String(motivo || '').slice(0, 300), via: 'painel' } },
  }, { merge: true });
  const ate = dataBR(sit.venceEmMs);
  await email(dec.email, 'Cancelamento confirmado · protocolo ' + prot, [
    'Olá! Recebemos o cancelamento da renovação do seu plano no Moviki.',
    '<b>Protocolo:</b> ' + prot + '<br><b>Data:</b> ' + dataBR(agora),
    sit.venceEmMs ? 'Seu plano <b>' + esc(sit.plano.toUpperCase()) + '</b> continua ativo até <b>' + ate + '</b>. Depois disso a conta volta ao plano Básico (grátis), sem perder o que você cadastrou. Nenhuma cobrança nova será feita.' : 'Nenhuma cobrança nova será feita.',
    'Quer voltar? É só assinar de novo no painel, quando quiser.',
  ]);
  await telegram('🔕 Lojista cancelou a renovação pelo painel\n\nUid: ' + sit.uid + '\nPlano: ' + sit.plano + ' (' + sit.periodo + ')\nAté: ' + (ate || '?') + '\nProtocolo: ' + prot + (motivo ? '\nMotivo: ' + String(motivo).slice(0, 200) : ''));
  return { status: 200, corpo: { ok: true, protocolo: prot, ate } };
}

async function acaoDesistir(dec, sit, motivo, agora) {
  if (!sit.podeDesistir) {
    return { status: 400, corpo: { ok: false, erro: 'fora_do_prazo', mensagem: sit.desistenciaPedida ? 'A desistência já foi pedida. Acompanhe pelo e-mail.' : 'O prazo para desistir com devolução já passou. Você ainda pode cancelar a renovação.' } };
  }
  const r = await pararRenovacao(sit);
  const prot = protocolo(agora);
  const noPrazo = sit.pagos.filter((p) => p.ms <= sit.desistirAteMs).map((p) => p.id);
  const reembolsoAuto = process.env.DESISTENCIA_REEMBOLSO_AUTO === '1';
  const resultado = {};
  if (reembolsoAuto) {
    for (const payId of noPrazo) {
      try {
        await db.collection('desistencias_estornos').doc(payId).create({ uid: sit.uid, protocolo: prot, em: FV.serverTimestamp() });
      } catch (_) { resultado[payId] = 'ja_pedido'; continue; }
      try { await asaas('/payments/' + encodeURIComponent(payId) + '/refund', 'POST', {}); resultado[payId] = 'estorno_pedido'; }
      catch (e) { resultado[payId] = 'falhou: ' + String((e && e.message) || e).slice(0, 120); }
    }
  }
  await db.collection('assinaturas').doc(sit.uid).set({ renovacaoCancelada: true, cancelamentoProtocolo: prot, desistenciaProtocolo: prot, canceladoEm: FV.serverTimestamp() }, { merge: true });
  await db.collection('faturamento').doc(sit.uid).set({
    asaasSubscriptionId: FV.delete(),
    cancelamentos: { [prot]: { tipo: 'desistir', em: FV.serverTimestamp(), sub: r.sub || null, pagamentos: noPrazo, reembolsoAuto, resultado, motivo: String(motivo || '').slice(0, 300), via: 'painel' } },
  }, { merge: true });
  const prazoTxt = reembolsoAuto ? 'O estorno já foi pedido à instituição de pagamento.' : 'A devolução integral é feita em até 7 dias úteis, pelo mesmo meio do pagamento.';
  await email(dec.email, 'Desistência confirmada · protocolo ' + prot, [
    'Olá! Recebemos a sua desistência da assinatura do Moviki, dentro do prazo.',
    '<b>Protocolo:</b> ' + prot + '<br><b>Data:</b> ' + dataBR(agora),
    prazoTxt + ' No Pix e no boleto o valor volta para a conta de origem; no cartão, o estorno aparece na fatura conforme o prazo do banco emissor.',
    'A renovação foi cancelada e a conta volta ao plano Básico (ou ao teste grátis, se ele ainda estiver em curso) quando a devolução for concluída.',
  ]);
  await telegram('↩️ DESISTÊNCIA (arrependimento) pelo painel\n\nUid: ' + sit.uid + '\nPlano: ' + sit.plano + ' (' + sit.periodo + ')\nPagamentos a devolver: ' + (noPrazo.join(', ') || '?') +
    '\nProtocolo: ' + prot + '\n\n' + (reembolsoAuto ? 'Estorno automático: ' + JSON.stringify(resultado) : '⚠️ DEVOLVA pelo Asaas em até 7 dias úteis (Cobranças > a cobrança > Estornar).'));
  return { status: 200, corpo: { ok: true, protocolo: prot, reembolsoAuto } };
}

module.exports = async (req, res) => {
  const orig = String(req.headers.origin || '');
  res.setHeader('Access-Control-Allow-Origin', ORIGENS_OK.indexOf(orig) >= 0 ? orig : ORIGENS_OK[0]);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  try {
    const authz = String(req.headers.authorization || '');
    const t = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    let dec;
    try { dec = await admin.auth().verifyIdToken(t, true); } catch (_) { res.status(401).json({ ok: false, erro: 'sessao' }); return; }
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const acao = String(body.acao || 'status');
    const sit = await situacao(dec.uid);
    sit.uid = dec.uid;

    if (acao === 'status') {
      res.status(200).json({
        ok: true, plano: sit.plano, periodo: sit.periodo, pago: sit.pago,
        ate: dataBR(sit.venceEmMs), renovacaoCancelada: sit.renovacaoCancelada, protocolo: sit.protocolo,
        parcelado: sit.parcelado, fundador: sit.fundador,
        podeDesistir: sit.podeDesistir, desistirAte: dataBR(sit.desistirAteMs), desistenciaPedida: sit.desistenciaPedida,
      });
      return;
    }
    if (acao !== 'cancelar' && acao !== 'desistir') { res.status(400).json({ ok: false, erro: 'acao' }); return; }
    if (!(await freioUid(admin, db, 'cancelar', dec.uid, 6, 3600000))) { res.status(429).json({ ok: false, erro: 'freio', mensagem: 'Muitas tentativas. Tente de novo em alguns minutos.' }); return; }
    const agora = Date.now();
    const r = acao === 'cancelar' ? await acaoCancelar(dec, sit, body.motivo, agora) : await acaoDesistir(dec, sit, body.motivo, agora);
    res.status(r.status).json(r.corpo);
  } catch (e) {
    console.error('[cancelar-assinatura]', e && e.message);
    await telegram('🚨 Falha no cancelamento pelo painel: ' + String((e && e.message) || e).slice(0, 300));
    res.status(500).json({ ok: false, erro: 'interno', mensagem: 'Não deu para concluir agora. Tente de novo ou fale com a gente: suporte@moviki.com.br.' });
  }
};

module.exports._t = { situacao, protocolo };
