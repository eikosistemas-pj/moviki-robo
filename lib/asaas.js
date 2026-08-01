// Ponte com o Asaas. A chave e a URL vem de variaveis de ambiente do Vercel
// (ASAAS_API_KEY e ASAAS_BASE_URL) — nunca ficam no codigo.
// Sandbox:   https://api-sandbox.asaas.com/v3   (chave $aact_hmlg_...)
// Producao:  https://api.asaas.com/v3           (chave $aact_prod_...)

const BASE = process.env.ASAAS_BASE_URL || 'https://api-sandbox.asaas.com/v3';
const KEY = process.env.ASAAS_API_KEY;

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
};

async function asaas(path, method = 'GET', body) {
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

module.exports = { asaas, PLANOS };
