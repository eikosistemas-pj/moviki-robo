// lib/nfse.js | versao 2026-10-22-nfse  (repo: moviki-robo)
//
// NOTA FISCAL DE SERVICO (NFS-e) DAS MENSALIDADES DO MOVIKI — 22/10/2026.
//
// O problema: a EIKO cobra as assinaturas pelo Asaas, mas nenhuma nota fiscal
// era emitida. Em Curitiba todo prestador emite nota de cada servico,
// "independentemente do valor da receita" (Decreto municipal 1.712/2020), e
// desde 01/11/2025 o optante do Simples emite pelo Emissor Nacional (Decreto
// 1.960/2025). Sem nota a receita fica omitida — risco no Simples e na
// prefeitura.
//
// O que este modulo faz: a cada pagamento CONFIRMADO de receita do Moviki
// (mensalidade, anual, Lote Fundador, parcela, ponto extra), agenda no Asaas
// a nota daquele pagamento (POST /v3/invoices com `payment`) e pede a emissao
// na hora (POST /v3/invoices/{id}/authorize). O Asaas manda a nota ao Emissor
// Nacional e avisa o resultado pelo webhook (INVOICE_AUTHORIZED /
// INVOICE_ERROR), tratado em `webhookNota`.
//
// DESLIGADO ATE O DONO CONFIGURAR. So roda com as envs da Vercel do robo:
//   NFSE_ATIVA           = "1"
//   NFSE_SERVICO_CODIGO  = codigo do servico no Emissor Nacional, como o Asaas
//                          pede em `municipalServiceCode` (ex.: o do subitem
//                          1.05 da LC 116 — licenciamento/cessao de uso de
//                          programa de computador). Confirmar com a contabilidade
//                          se o 1.05 esta liberado na inscricao municipal.
//   NFSE_SERVICO_NOME    = descricao do servico (opcional; padrao abaixo)
//   NFSE_ISS             = aliquota de ISS a informar (numero, ex.: 2 ou 5).
//                          No Simples o ISS e pago no DAS; a contabilidade diz
//                          qual aliquota vai na nota.
// Sem NFSE_ATIVA="1" ou sem codigo: nao faz nada e nao quebra nada.
//
// Antes de ligar: no painel do Asaas, Notas Fiscais > Configuracoes
// (certificado A1 da EIKO, regime Simples, inscricao municipal) e, em
// Integracoes > Webhooks, ligar os eventos de nota fiscal no webhook do robo.
//
// IDEMPOTENTE: nfse/{payId} e criado com .create() antes de chamar o Asaas —
// o mesmo pagamento (RECEIVED + CONFIRMED, reprocessamento) nunca gera duas
// notas. Nunca derruba o webhook: tudo em try/catch, erro vira aviso.

'use strict';

const COLECAO = 'nfse';
const NOME_PADRAO = 'Licenciamento de uso de programa de computador (software como servico)';

function cfg() {
  const ativa = process.env.NFSE_ATIVA === '1';
  const codigo = String(process.env.NFSE_SERVICO_CODIGO || '').trim();
  const nome = String(process.env.NFSE_SERVICO_NOME || NOME_PADRAO).trim().slice(0, 250);
  const iss = Number(String(process.env.NFSE_ISS || '').replace(',', '.'));
  return { ativa, codigo, nome, iss: Number.isFinite(iss) && iss >= 0 && iss <= 10 ? iss : null };
}

function ligada() {
  const c = cfg();
  return c.ativa && !!c.codigo && c.iss !== null;
}

/* Data de hoje no fuso de Brasilia (AAAA-MM-DD): a nota e do dia da prestacao. */
function hojeBR(ms) {
  const d = new Date((ms || Date.now()) - 3 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function descricao(o) {
  const plano = String(o.plano || '').toUpperCase();
  const per = o.periodo === 'anual' ? 'anual' : (/^fundador/.test(String(o.periodo || '')) ? 'Lote Fundador' : 'mensal');
  if (o.tipo === 'ponto') return 'Moviki - ponto de venda adicional do plano Enterprise (mensal)';
  return ('Moviki - assinatura do plano ' + (plano || 'pago') + ' (' + per + ')').slice(0, 250);
}

/* Agenda e emite a nota de UM pagamento. o = { asaas, db, admin, payId, valor,
   plano, periodo, tipo: 'assinatura'|'ponto', uid } */
async function emitirNotaDoPagamento(o) {
  try {
    if (!ligada()) return { pulado: 'desligada' };
    const payId = String(o.payId || '');
    const valor = Math.round((Number(o.valor) || 0) * 100) / 100;
    if (!payId || !(valor > 0)) return { pulado: 'sem_valor' };
    const ref = o.db.collection(COLECAO).doc(payId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80));
    try {
      await ref.create({
        uid: o.uid || null, payId, valor, tipo: o.tipo || 'assinatura',
        status: 'agendando', criadoEm: o.admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (_) { return { pulado: 'ja_existe' }; }

    const c = cfg();
    let inv;
    try {
      inv = await o.asaas('/invoices', 'POST', {
        payment: payId,
        serviceDescription: descricao(o),
        observations: 'Cobranca ' + payId + '. Documento emitido por EIKO SISTEMAS DESENVOLVIMENTO DE SOFTWARE LTDA.',
        externalReference: 'nfse:' + payId,
        value: valor,
        deductions: 0,
        effectiveDate: hojeBR(),
        municipalServiceCode: c.codigo,
        municipalServiceName: c.nome,
        taxes: { retainIss: false, iss: c.iss, pis: 0, cofins: 0, csll: 0, inss: 0, ir: 0 },
      });
    } catch (e) {
      await ref.set({ status: 'erro_agendar', erro: String((e && e.message) || e).slice(0, 300) }, { merge: true });
      return { erro: 'agendar', mensagem: String((e && e.message) || e).slice(0, 300) };
    }
    const invId = String((inv && inv.id) || '');
    await ref.set({ invoiceId: invId, status: String((inv && inv.status) || 'SCHEDULED') }, { merge: true });
    if (invId) {
      try {
        const au = await o.asaas('/invoices/' + encodeURIComponent(invId) + '/authorize', 'POST');
        await ref.set({ status: String((au && au.status) || 'SYNCHRONIZED') }, { merge: true });
      } catch (e) {
        // Agendada mas nao antecipada: o Asaas emite na data da nota de qualquer jeito.
        await ref.set({ autorizarErro: String((e && e.message) || e).slice(0, 300) }, { merge: true });
      }
    }
    return { ok: true, invoiceId: invId };
  } catch (e) {
    console.error('[nfse] falha:', (e && e.message) || e);
    return { erro: 'interno' };
  }
}

/* Webhook INVOICE_* do Asaas (so da conta mae). Atualiza nfse/{payId} e
   avisa o dono quando a prefeitura/Emissor Nacional recusa. */
async function webhookNota(tipo, invoice, db, avisar) {
  const inv = invoice || {};
  const payId = String(inv.payment || '');
  const id = payId ? payId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) : '';
  const status = String(inv.status || tipo || '');
  const dados = {
    invoiceId: String(inv.id || ''), status,
    numero: inv.number != null ? String(inv.number) : null,
    pdfUrl: typeof inv.pdfUrl === 'string' ? inv.pdfUrl.slice(0, 500) : null,
    xmlUrl: typeof inv.xmlUrl === 'string' ? inv.xmlUrl.slice(0, 500) : null,
    motivo: typeof inv.statusDescription === 'string' ? inv.statusDescription.slice(0, 500) : null,
    atualizadoEmMs: Date.now(),
  };
  if (id) { try { await db.collection(COLECAO).doc(id).set(dados, { merge: true }); } catch (_) {} }
  if (tipo === 'INVOICE_ERROR' || status === 'ERROR') {
    try {
      await avisar('🧾 Nota fiscal RECUSADA\n\nCobranca: ' + (payId || '?') + '\nNota: ' + (dados.invoiceId || '?') +
        '\nMotivo: ' + (dados.motivo || 'sem detalhe') + '\n\nAbra Notas Fiscais no Asaas, corrija e reemita.');
    } catch (_) {}
  }
  return { ok: true, tratado: 'nota_fiscal', status };
}

module.exports = { emitirNotaDoPagamento, webhookNota, ligada, cfg, _t: { hojeBR, descricao } };
