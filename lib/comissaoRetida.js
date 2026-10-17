// versao 2026-10-17-carencia
// lib/comissaoRetida.js  (repo: moviki-robo)
//
// 17/10/2026 — CARENCIA DE 30 DIAS DO LOJISTA-PARCEIRO (decisao do Paulo).
//
// A regra antiga (parceiroPodeGanhar, webhook.js): lojista que tambem e
// parceiro so ganha comissao com a propria assinatura paga. Atrasou um dia,
// a comissao do indicado que pagou naquele dia nem era criada — perdida na
// hora, sem aviso.
//
// A regra nova:
//   - Mensalidade do lojista-parceiro VENCIDA (PAYMENT_OVERDUE de plano pago)
//     -> o webhook grava assinaturas/{uid}.atrasoDesde = vencimento da
//        cobranca que nao foi paga.
//   - Durante 30 dias a contar de atrasoDesde, a comissao gerada para ele NAO
//     se perde: vai para comissoes_retidas/{payId_nN} (status 'retida'). Nao
//     entra em `comissoes`, entao nao aparece como saldo nem pode ser sacada.
//   - Pagou dentro dos 30 dias -> o webhook do pagamento dele cria as
//     comissoes de verdade (mesmo id payId_nN, idempotente) e marca 'liberada'.
//   - Passou dos 30 dias -> 'perdida' (cron do lembrete-trial, e tambem na
//     hora da liberacao, para o prazo valer mesmo se o cron falhar). Comissao
//     gerada depois do prazo, com ele ainda em atraso, nem e retida.
//   - Estorno/chargeback do pagamento do INDICADO -> 'estornada'.
//
// Sem atrasoDesde (teste gratis, Basico, plano cancelado que expirou) vale a
// regra antiga: nao ganha. Parceiro puro (sem negocios/{uid}) sempre ganha.
//
// Colecao nova comissoes_retidas: sem regra no Firestore = so o Admin SDK.

const DIA_MS = 86400000;
const PRAZO_DIAS = 30;

const msDe = (t) => (t && typeof t.toMillis === 'function') ? t.toMillis() : (typeof t === 'number' ? t : 0);

/* Funcao pura (testada): situacao do parceiro para receber comissao agora.
   temNegocio = existe negocios/{uid}; a = assinaturas/{uid} (ou null).
   Devolve { ok:true } | { carencia:true, inicioMs, prazoMs } | { ok:false }. */
function avaliarSituacao(temNegocio, a, agora) {
  if (!temNegocio) return { ok: true, motivo: 'parceiro_puro' };
  if (!a) return { ok: false, motivo: 'sem_assinatura' };
  if (a.periodo === 'trial') return { ok: false, motivo: 'teste_gratis' };
  const venceMs = msDe(a.vence_em);
  const emDia = a.ativo === true && (!venceMs || venceMs > agora);
  if (emDia) return { ok: true, motivo: 'pagante' };
  const inicioMs = msDe(a.atrasoDesde);
  if (!inicioMs) return { ok: false, motivo: 'sem_atraso_registrado' };
  const prazoMs = inicioMs + PRAZO_DIAS * DIA_MS;
  if (agora < prazoMs) return { ok: false, carencia: true, inicioMs, prazoMs, motivo: 'carencia' };
  return { ok: false, motivo: 'prazo_vencido', inicioMs, prazoMs };
}

/* Le o banco e devolve a situacao. Erro de leitura -> nega (falha fechada,
   como o parceiroPodeGanhar sempre fez). */
async function situacaoParceiro(db, puid, agora) {
  try {
    const neg = await db.collection('negocios').doc(puid).get();
    if (!neg.exists) return avaliarSituacao(false, null, agora);
    const a = await db.collection('assinaturas').doc(puid).get();
    return avaliarSituacao(true, a.exists ? (a.data() || {}) : null, agora);
  } catch (e) {
    console.error('situacaoParceiro erro (negando por seguranca):', e);
    return { ok: false, motivo: 'erro' };
  }
}

/* Guarda a comissao que seria creditada. `o` = o mesmo objeto que vai para o
   creditarComissao do webhook. Id payId_nN: reenvio do Asaas nao duplica. */
async function reterComissao(db, admin, o, sit) {
  const valor = Math.round(o.base * o.pct * 100) / 100;
  if (!(valor > 0) || !o.payId) return false;
  const id = o.payId + '_n' + o.nivel;
  try {
    const ja = await db.collection('comissoes').doc(id).get();
    if (ja.exists) return false;
    await db.collection('comissoes_retidas').doc(id).create({
      parceiroUid: o.parceiroUid,
      parceiroSlug: o.parceiroSlug,
      lojistaUid: o.lojistaUid,
      nivel: o.nivel,
      base: o.base,
      percentual: o.pct,
      valor,
      payId: o.payId,
      competencia: o.competencia,
      liberaMs: o.liberaMs || 0,
      status: 'retida',
      atrasoDesdeMs: sit.inicioMs,
      prazoMs: sit.prazoMs,
      prazoEm: admin.firestore.Timestamp.fromMillis(sit.prazoMs),
      criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    });
    return true;
  } catch (e) { return false; /* ja existe (reenvio) */ }
}

/* O lojista-parceiro pagou: libera o que esta retido dentro do prazo e marca
   como perdido o que passou. `creditar` = creditarComissao do webhook. */
async function liberarRetidas(db, admin, parceiroUid, creditar, agora) {
  const r = { liberadas: 0, valorLiberado: 0, perdidas: 0, valorPerdido: 0 };
  const qs = await db.collection('comissoes_retidas').where('parceiroUid', '==', parceiroUid).get();
  if (qs.empty) return r;
  let aprovado = false;
  try {
    const p = await db.collection('parceiros').doc(parceiroUid).get();
    aprovado = p.exists && (p.data() || {}).status === 'aprovado';
  } catch (_) {}
  const TS = admin.firestore.FieldValue.serverTimestamp();
  for (const d of qs.docs) {
    const c = d.data() || {};
    if (c.status !== 'retida') continue;
    const valor = Number(c.valor) || 0;
    if (!aprovado || agora >= (Number(c.prazoMs) || 0)) {
      await d.ref.update({ status: 'perdida', perdidaEm: TS, perdidaMotivo: aprovado ? 'prazo' : 'parceiro_nao_aprovado' });
      r.perdidas++; r.valorPerdido += valor;
      continue;
    }
    await creditar({
      parceiroUid: c.parceiroUid, parceiroSlug: c.parceiroSlug, lojistaUid: c.lojistaUid,
      nivel: c.nivel, base: c.base, pct: c.percentual, payId: c.payId,
      competencia: c.competencia, liberaMs: Math.max(Number(c.liberaMs) || 0, agora),
    });
    await d.ref.update({ status: 'liberada', liberadaEm: TS });
    r.liberadas++; r.valorLiberado += valor;
  }
  r.valorLiberado = Math.round(r.valorLiberado * 100) / 100;
  r.valorPerdido = Math.round(r.valorPerdido * 100) / 100;
  return r;
}

/* Cron: o que passou do prazo vira 'perdida'. Consulta por um campo so
   (status) -> indice automatico. Devolve o perdido agrupado por parceiro,
   para o aviso por e-mail. Em simulacao nao grava. */
async function vencerRetidas(db, admin, agora, gravar) {
  const porParceiro = {};
  const qs = await db.collection('comissoes_retidas').where('status', '==', 'retida').get();
  for (const d of qs.docs) {
    const c = d.data() || {};
    if (agora < (Number(c.prazoMs) || 0)) continue;
    if (gravar) await d.ref.update({ status: 'perdida', perdidaEm: admin.firestore.FieldValue.serverTimestamp(), perdidaMotivo: 'prazo' });
    const p = porParceiro[c.parceiroUid] || (porParceiro[c.parceiroUid] = { qtd: 0, valor: 0, prazoMs: 0 });
    p.qtd++; p.valor = Math.round((p.valor + (Number(c.valor) || 0)) * 100) / 100;
    p.prazoMs = Math.max(p.prazoMs, Number(c.prazoMs) || 0);
  }
  return porParceiro;
}

/* Quanto esta retido hoje para um parceiro (para o e-mail). */
async function totalRetido(db, parceiroUid) {
  const qs = await db.collection('comissoes_retidas').where('parceiroUid', '==', parceiroUid).get();
  let qtd = 0, valor = 0;
  qs.forEach((d) => { const c = d.data() || {}; if (c.status === 'retida') { qtd++; valor += Number(c.valor) || 0; } });
  return { qtd, valor: Math.round(valor * 100) / 100 };
}

/* Estorno/chargeback do pagamento do indicado: a retida daquele pagamento sai. */
async function estornarRetidas(db, admin, payId) {
  if (!payId) return 0;
  const qs = await db.collection('comissoes_retidas').where('payId', '==', payId).get();
  let n = 0;
  for (const d of qs.docs) {
    if ((d.data() || {}).status !== 'retida') continue;
    await d.ref.update({ status: 'estornada', estornadaEm: admin.firestore.FieldValue.serverTimestamp() });
    n++;
  }
  return n;
}

/* Etapa da contagem regressiva do e-mail: faltam <= 30, 21, 14, 7, 3, 1 dias.
   Devolve 0 (fora do prazo) a 6. O cron manda quando a etapa sobe — quem
   chega atrasado recebe so a mais recente, nunca uma rajada. */
const MARCOS_EMAIL = [30, 21, 14, 7, 3, 1];
function diasRestantes(prazoMs, agora) { return Math.ceil((prazoMs - agora) / DIA_MS); }
function etapaAtraso(prazoMs, agora) {
  const dias = diasRestantes(prazoMs, agora);
  if (dias <= 0) return 0;
  return MARCOS_EMAIL.filter((m) => dias <= m).length;
}

module.exports = {
  PRAZO_DIAS, MARCOS_EMAIL,
  avaliarSituacao, situacaoParceiro, reterComissao, liberarRetidas,
  vencerRetidas, totalRetido, estornarRetidas, diasRestantes, etapaAtraso,
};
