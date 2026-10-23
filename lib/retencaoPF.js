// lib/retencaoPF.js | versao 2026-10-22-fiscal  (repo: moviki-robo)
//
// RETENCAO NA COMISSAO DE PARCEIRO PESSOA FISICA — 22/10/2026.
//
// Parceiro so com CPF e contribuinte individual: a Eiko (empresa) retem 11% de
// INSS sobre o que paga, limitado ao teto (Lei 8.212, art. 30 e Lei 10.666,
// art. 4o), e o IRRF pela tabela mensal (com o desconto simplificado e a
// reducao da Lei 15.270/2025: ate R$ 5.000 de rendimento no mes, IR zero).
// Por isso o PF recebe UMA vez por mes, a partir do dia 10: a base do INSS e
// da tabela do IR e mensal, e a Contabilizei lanca um recibo por parceiro por
// mes no eSocial (S-1200/S-1210) e na DCTFWeb.
//
// Parceiro com CNPJ: sem retencao aqui (ele emite a NFS-e para a Eiko e
// recolhe o proprio imposto). A chave de acesso da NFS-e (50 digitos) e
// exigida antes de pagar.
//
// Valores em env para atualizar sem codigo quando o governo mudar:
//   INSS_TETO (padrao 8475.55, teto de 2026)
//   PF_DIA_PAGAMENTO (padrao 10)
// CONFERIR com a contabilidade a cada janeiro. O robo calcula; quem declara e
// a Contabilizei, pelo relatorio mensal do painel do dono.

'use strict';

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const TABELA_IR = [
  { ate: 2428.80, aliq: 0, ded: 0 },
  { ate: 2826.65, aliq: 0.075, ded: 182.16 },
  { ate: 3751.05, aliq: 0.15, ded: 394.16 },
  { ate: 4664.68, aliq: 0.225, ded: 675.49 },
  { ate: Infinity, aliq: 0.275, ded: 908.73 },
];
const DESCONTO_SIMPLIFICADO = 607.20;

function tetoInss() {
  const t = Number(String(process.env.INSS_TETO || '').replace(',', '.'));
  return Number.isFinite(t) && t > 1000 ? t : 8475.55;
}
function diaPagamento() {
  const d = parseInt(process.env.PF_DIA_PAGAMENTO || '', 10);
  return d >= 1 && d <= 28 ? d : 10;
}

function irrf(bruto, inss) {
  const base = Math.max(0, bruto - Math.max(inss, DESCONTO_SIMPLIFICADO));
  const f = TABELA_IR.find((x) => base <= x.ate);
  let ir = Math.max(0, base * f.aliq - f.ded);
  if (bruto <= 5000) ir = 0;
  else if (bruto <= 7350) ir = Math.max(0, ir - Math.max(0, 978.62 - 0.133145 * bruto));
  return r2(ir);
}

/* bruto = comissao liberada; fiscal = parceiros_fiscal/{uid}. */
function calcular(fiscal, bruto) {
  const b = r2(bruto);
  if (!fiscal || fiscal.tipo !== 'pf') return { tipo: fiscal ? fiscal.tipo : null, bruto: b, inss: 0, irrf: 0, liquido: b };
  const inss = r2(Math.min(b, tetoInss()) * 0.11);
  const ir = irrf(b, inss);
  return { tipo: 'pf', bruto: b, inss, irrf: ir, liquido: r2(b - inss - ir) };
}

/* Data no fuso de Brasilia. */
function agoraBR(ms) { return new Date((ms || Date.now()) - 3 * 3600000); }
function competencia(ms) { const d = agoraBR(ms); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); }

/* PF: so a partir do dia de pagamento e uma vez por mes. pagos = lista de
   { em: ms } dos saques ja pagos ao parceiro (sem o atual). */
function regraMensal(fiscal, pagos, ms) {
  if (!fiscal || fiscal.tipo !== 'pf') return { ok: true };
  const d = agoraBR(ms), dia = diaPagamento();
  if (d.getUTCDate() < dia) {
    return { ok: false, erro: 'pf_antes_do_dia', mensagem: 'Parceiro pessoa física (CPF) recebe uma vez por mês, a partir do dia ' + dia + ', com o INSS retido. Pague a partir do dia ' + dia + '.' };
  }
  const comp = competencia(ms);
  if ((pagos || []).some((p) => p && p.em && competencia(p.em) === comp)) {
    return { ok: false, erro: 'pf_ja_recebeu_no_mes', mensagem: 'Este parceiro pessoa física (CPF) já recebeu neste mês. O próximo pagamento é a partir do dia ' + dia + ' do mês que vem.' };
  }
  return { ok: true };
}

/* Chave de acesso da NFS-e (padrao nacional: 50 digitos). */
function chaveNfseValida(c) { return /^\d{50}$/.test(String(c || '').replace(/\D/g, '')) ; }

module.exports = { calcular, irrf, regraMensal, competencia, chaveNfseValida, tetoInss, diaPagamento };
