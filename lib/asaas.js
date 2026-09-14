// versao 2026-09-14-falhafechada
// Ponte com o Asaas. A chave e a URL vem de variaveis de ambiente do Vercel
// (ASAAS_API_KEY e ASAAS_BASE_URL) — nunca ficam no codigo.
// Sandbox:   https://api-sandbox.asaas.com/v3   (chave $aact_hmlg_...)
// Producao:  https://api.asaas.com/v3           (chave $aact_prod_...)
//
// FALHA FECHADA — 14/09/2026 (Doutrina de Seguranca Financeira, regra de ouro
// "variavel que falta derruba o modulo, nunca rebaixa"):
// antes daqui, a ausencia de ASAAS_BASE_URL caia silenciosamente no SANDBOX.
// Em producao isso e pior do que um erro: as telas continuam funcionando, as
// cobrancas sao emitidas num ambiente de mentira e ninguem paga nada de
// verdade — sem log, sem alerta, sem sintoma visivel. Agora, em producao, a
// falta da variavel (ou uma variavel apontando para o sandbox) derruba a
// chamada com mensagem clara. Fora de producao, o sandbox continua sendo o
// padrao.

const SANDBOX = 'https://api-sandbox.asaas.com/v3';
const EH_PRODUCAO = process.env.VERCEL_ENV === 'production';
const BASE = process.env.ASAAS_BASE_URL || SANDBOX;
const KEY = process.env.ASAAS_API_KEY;

function conferirAmbiente() {
  if (!EH_PRODUCAO) return;
  if (!process.env.ASAAS_BASE_URL) {
    throw new Error('ASAAS_BASE_URL ausente em producao — configure https://api.asaas.com/v3 na Vercel');
  }
  if (/sandbox/i.test(BASE)) {
    throw new Error('ASAAS_BASE_URL aponta para o SANDBOX em producao — cobranca nao seria real');
  }
  if (!KEY) {
    throw new Error('ASAAS_API_KEY ausente em producao');
  }
}

// Tabela de planos. "value" = valor cobrado A CADA ciclo. "dias" so serve
// pra calcular ate quando o plano fica valido depois de um pagamento.
const PLANOS = {
  pro: {
    mensal:     { value: 37.90,  cycle: 'MONTHLY',   dias: 31 },
    trimestral: { value: 99.90,  cycle: 'QUARTERLY', dias: 93 },
    anual:      { value: 379.00, cycle: 'YEARLY',    dias: 366 },
  },
  premium: {
    mensal:     { value: 49.90,  cycle: 'MONTHLY',   dias: 31 },
    trimestral: { value: 134.90, cycle: 'QUARTERLY', dias: 93 },
    anual:      { value: 499.00, cycle: 'YEARLY',    dias: 366 },
  },
  // Enterprise: base cobre ate 3 pontos. So mensal por enquanto (o valor
  // publico e R$99,90/mes). Cada ponto ALEM de 3 e cobrado a parte, como uma
  // assinatura recorrente separada de PONTO_EXTRA (ver abaixo).
  enterprise: {
    mensal:     { value: 99.90,  cycle: 'MONTHLY',   dias: 31 },
  },
};

// Ponto EXTRA do Enterprise (4o ponto em diante): recorrente, cobrado numa
// assinatura SEPARADA por ponto (facilita somar/tirar ponto sem mexer na
// assinatura base). Preco fechado com o Paulo: R$19,90/mes.
const PONTO_EXTRA = { value: 19.90, cycle: 'MONTHLY', dias: 31 };

// Quantos pontos ja vem inclusos na base do Enterprise (nao geram cobranca extra).
const PONTOS_INCLUSOS = 3;

async function asaas(path, method = 'GET', body) {
  conferirAmbiente();
  const resp = await fetch(BASE + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Moviki/1.0 (Node.js)',
      'access_token': KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = (data.errors && data.errors[0] && data.errors[0].description) || ('Asaas HTTP ' + resp.status);
    const err = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  return data;
}

module.exports = { asaas, PLANOS, PONTO_EXTRA, PONTOS_INCLUSOS, conferirAmbiente, EH_PRODUCAO };
