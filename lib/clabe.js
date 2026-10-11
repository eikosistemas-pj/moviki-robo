/*!
 * MOVIKI lib/clabe.js | versao 2026-10-11-clabe | repo: moviki-robo
 *
 * TRANSFERENCIA POR CLABE (MEXICO) — o equivalente do lib/pix.js fora do Brasil.
 * Spec: doc "Moviki Mexico - Pagamento por CLABE e material por pais (M5)",
 * secao 5. Decisoes de 11/10/2026 em ARQ - Decisoes do pagamento no Mexico.
 *
 * ESTADO: DESLIGADO. Ninguem chama este arquivo ate a abertura do Mexico.
 * Ele so e usado quando o negocio tiver negocios/{uid}.pais === 'MX',
 * campo que so o robo grava. Nada aqui toca o fluxo do Brasil.
 *
 * O QUE ELE FAZ (funcoes puras, sem Firebase e sem internet)
 *  - lerClabe: confere 18 digitos, digito verificador e banco; devolve o
 *    motivo exato da recusa (tamanho | digito | banco) para a tela mostrar
 *    a frase certa em espanhol.
 *  - lerCelularMx: celular do DiMo, 10 digitos, sai em +52.
 *  - conceptoDe / referenciaDe: o que a compradora escreve na transferencia
 *    para a lojista achar o pedido no extrato.
 *  - claveRastreoOk: a clave de rastreo que a compradora pode informar no
 *    "Ya pague" (Doutrina, artigo 8: o comprador escreve o minimo).
 *  - mascararClabe: o que volta para a tela da lojista depois de salvar.
 *
 * REGRA DE OURO QUE ELE HERDA DO PIX (Doutrina, artigo 4)
 * A CLABE completa so sai na resposta da criacao do pedido, montada no
 * servidor, junto com o nome da titular e o banco em texto legivel. Nunca
 * vai para checkout_publico. A lojista guarda cifrada (mesma cifra da chave
 * Pix, CHECKOUT_CHAVE).
 *
 * DIGITO VERIFICADOR (padrao da ABM / Banxico)
 * Pesos 3, 7, 1 repetidos sobre os 17 primeiros digitos; soma-se o ultimo
 * algarismo de cada produto; o digito e (10 - soma % 10) % 10.
 * Exemplo conferido: 032180000118359719.
 *
 * TABELA DE BANCOS
 * Derivada da tabela do pacote clabe-validator 3.2.2 (licenca MIT,
 * Copyright (c) 2017-2026 Individual contributors to CLABE Validator),
 * com nomes curtos para os bancos mais comuns. Conferir contra o catalogo
 * oficial de participantes do SPEI (Banxico) a cada 3 meses e antes da
 * abertura. Banco fora da tabela = CLABE recusada com motivo 'banco'.
 * Ficaram de fora os codigos que nao sao conta: 999 (N/A) e 903 (CoDi Valida).
 */
'use strict';

const BANCOS = Object.freeze({
  '001': 'Banco de México',
  '002': 'Banamex',
  '006': 'Banco Nacional de Comercio Exterior',
  '009': 'Banco Nacional de Obras y Servicios Públicos',
  '012': 'BBVA México',
  '014': 'Santander',
  '019': 'Banco Nacional del Ejército, Fuerza Aérea y Armada',
  '021': 'HSBC',
  '022': 'GE Money Bank',
  '030': 'BanBajío',
  '032': 'IXE Banco',
  '036': 'Inbursa',
  '037': 'Banco Interacciones',
  '042': 'Banca Mifel',
  '044': 'Scotiabank',
  '058': 'Banregio',
  '059': 'Banco Invex',
  '060': 'Bansi',
  '062': 'Banca Afirme',
  '072': 'Banorte',
  '102': 'ABN AMRO Bank México',
  '103': 'American Express Bank (México)',
  '106': 'Bank of America México',
  '108': 'Bank of Tokyo-Mitsubishi UFJ (México)',
  '110': 'Banco J.P. Morgan',
  '112': 'Banco Monex',
  '113': 'Banco Ve por Mas',
  '116': 'ING Bank (México)',
  '124': 'Banco Citi Mexico (formerly Deutsche Bank México)',
  '126': 'Banco Credit Suisse (México)',
  '127': 'Banco Azteca',
  '128': 'Banco Autofin México',
  '129': 'Barclays Bank México',
  '130': 'Banco Compartamos',
  '131': 'Banco Ahorro Famsa',
  '132': 'Banco Multiva',
  '133': 'Banco Actinver',
  '134': 'Banco Wal-Mart de México Adelante',
  '135': 'Nacional Financiera',
  '136': 'Inter Banco',
  '137': 'BanCoppel',
  '138': 'ABC Capital',
  '139': 'UBS Banco',
  '140': 'Banco Fácil',
  '141': 'Volkswagen Bank, Institución de Banca Múltiple',
  '143': 'Consultoría Internacional Banco',
  '145': 'Banco BASE',
  '147': 'Bankaool, Institución de Banca Múltiple',
  '148': 'Banco PagaTodo Institución de Banca Múltiple',
  '150': 'Banco Inmobiliario Mexicano, Institución de Banca Múltiple',
  '151': 'Fundación Dondé Banco',
  '152': 'Banco Bancrea, Institución de Banca Múltiple',
  '154': 'Banco Finterra',
  '155': 'Industrial and Commercial Bank of China',
  '156': 'Banco de Sabadell',
  '157': 'Shinhan Bank',
  '158': 'Mizuho Bank',
  '159': 'Bank of China México',
  '160': 'Banco S3 México',
  '166': 'Banco del Ahorro Nacional y Servicios Financieros',
  '167': 'Hey Banco',
  '168': 'Sociedad Hipotecaria Federal',
  '600': 'Monex Casa de Bolsa',
  '601': 'GBM Grupo Bursátil Mexicano',
  '602': 'Masari Casa de Bolsa',
  '604': 'Inversora Bursátil',
  '605': 'Valué, Casa de Bolsa',
  '606': 'Base Internacional Casa de Bolsa',
  '607': 'Casa de Cambio Tiber',
  '608': 'Vector Casa de Bolsa',
  '610': 'B y B Casa de Cambio',
  '611': 'Intercam Casa de Cambio',
  '613': 'Multivalores Casa de Bolsa, Multiva Gpo. Fin.',
  '614': 'Acciones y Valores Banamex, Casa de Bolsa',
  '615': 'Merrill Lynch México, Casa de Bolsa',
  '616': 'Casa de Bolsa Finamex',
  '617': 'Valores Mexicanos Casa de Bolsa',
  '618': 'Única Casa de Cambio',
  '619': 'MAPFRE Tepeyac',
  '620': 'Profuturo G.N.P., Afore',
  '621': 'Actinver Casa de Bolsa',
  '622': 'Actinver',
  '623': 'Skandia Vida',
  '624': 'Consultoría Internacional Casa de Cambio',
  '626': 'Deutsche Securities',
  '627': 'Zurich Compañía de Seguros',
  '628': 'Zurich Vida, Compañía de Seguros',
  '629': 'Hipotecaria su Casita',
  '630': 'Intercam Casa de Bolsa',
  '631': 'CI Casa de Bolsa',
  '632': 'Bulltick Casa de Bolsa',
  '633': 'Sterling Casa de Cambio',
  '634': 'Fincomún, Servicios Financieros Comunitarios',
  '636': 'HDI Seguros',
  '637': 'OrderExpress Casa de Cambio',
  '638': 'Nu México',
  '640': 'J.P. Morgan Casa de Bolsa',
  '642': 'Operadora de Recursos Reforma',
  '646': 'STP',
  '647': 'Telecomunicaciones de México',
  '648': 'Evercore Casa de Bolsa',
  '649': 'Skandia Operadora',
  '651': 'Seguros Monterrey New York Life',
  '652': 'Solución Asea, Sociedad Financiera Popular',
  '653': 'Kuspit Casa de Bolsa',
  '655': 'JP SofiExpress',
  '656': 'UNAGRA, S.F.P.',
  '659': 'Opciones Empresariales Del Noreste',
  '661': 'Servicios Financieros Alternativos (Klar)',
  '670': 'Libertad Servicios Financieros',
  '674': 'AXA Seguros',
  '677': 'Caja Popular Mexicana',
  '679': 'Financiera Nacional De Desarrollo Agropecuario',
  '680': 'Caja Popular Cristóbal Colón',
  '683': 'Caja de Ahorro de los Telefonistas',
  '684': 'Transfer',
  '685': 'Fondo de Garantía y Fomento para la Agricultura, Ganadería y Avicultura (FONDO)',
  '686': 'Afore InverCap',
  '688': 'Crediclub',
  '689': 'Fondo Mexicano del Petroleo para la Estabilizacion y el Desarrollo',
  '699': 'Fondeadora',
  '703': 'Tesored',
  '706': 'Arcus Financial Intelligence',
  '710': 'NVIO',
  '721': 'albo',
  '722': 'Mercado Pago',
  '723': 'Cuenca',
  '728': 'Spin by OXXO',
  '732': 'Peibo Fintech',
  '734': 'Finco Pay (Finch)',
  '812': 'BBVA México',
  '814': 'Banco Santander',
  '821': 'HSBC México',
  '846': 'STP',
  '901': 'CLS Bank International',
  '902': 'SD. INDEVAL',
});

const PESOS = [3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7];

function so(v) { return String(v == null ? '' : v).replace(/\D/g, ''); }

/* Digito verificador a partir dos 17 primeiros digitos. */
function digitoVerificador(dezessete) {
  const d = so(dezessete);
  if (d.length !== 17) return null;
  let soma = 0;
  for (let i = 0; i < 17; i++) soma += (Number(d[i]) * PESOS[i]) % 10;
  return (10 - (soma % 10)) % 10;
}

/* Le a CLABE digitada ou colada. Aceita espacos, pontos e tracos no meio
   (a tela tira, mas o robo nao confia na tela). Letra no meio = recusa.
   Devolve { ok:true, clabe, banco:{codigo,nome}, praca, mascara }
   ou { ok:false, motivo:'tamanho'|'digito'|'banco' }. */
function lerClabe(bruta) {
  const txt = String(bruta == null ? '' : bruta).trim();
  if (!txt || /[^0-9\s.\-]/.test(txt)) return { ok: false, motivo: 'tamanho' };
  const c = so(txt);
  if (c.length !== 18) return { ok: false, motivo: 'tamanho' };
  if (digitoVerificador(c.slice(0, 17)) !== Number(c[17])) return { ok: false, motivo: 'digito' };
  const codigo = c.slice(0, 3);
  const nome = BANCOS[codigo];
  if (!nome) return { ok: false, motivo: 'banco' };
  return { ok: true, clabe: c, banco: { codigo, nome }, praca: c.slice(3, 6), mascara: mascararClabe(c) };
}

/* O que a lojista ve depois de salvar: so os 4 ultimos digitos. */
function mascararClabe(c) {
  const d = so(c);
  return d.length === 18 ? '•••• ' + d.slice(-4) : '';
}

/* Celular do DiMo: 10 digitos. Aceita +52, 52 e o antigo 521 na frente. */
function lerCelularMx(bruto) {
  let d = so(bruto);
  if (d.length === 13 && d.startsWith('521')) d = d.slice(3);
  else if (d.length === 12 && d.startsWith('52')) d = d.slice(2);
  if (d.length !== 10 || /^0/.test(d) || /^(\d)\1+$/.test(d)) return null;
  return '+52' + d;
}

function mascararCelularMx(e164) {
  const d = so(e164);
  return d.length === 12 ? '+52 •• •••• ' + d.slice(-4) : '';
}

/* Concepto da transferencia: "MV 0042". Cabe em qualquer app de banco
   (o campo aceita ate 40 caracteres; usamos no maximo 10, sem acento). */
function conceptoDe(numero) {
  const n = Math.max(0, Math.floor(Number(numero) || 0)) % 10000000;
  return ('MV ' + String(n).padStart(4, '0')).slice(0, 10);
}

/* Referencia numerica (ate 7 digitos no SPEI): o numero do pedido. */
function referenciaDe(numero) {
  const n = Math.max(0, Math.floor(Number(numero) || 0)) % 10000000;
  return String(n).padStart(7, '0');
}

/* Clave de rastreo informada pela compradora: opcional, so letras e
   numeros, de 6 a 30 caracteres. Devolve maiuscula ou null. */
function claveRastreoOk(bruta) {
  const v = String(bruta == null ? '' : bruta).trim().replace(/\s+/g, '').toUpperCase();
  if (!v) return null;
  return /^[A-Z0-9]{6,30}$/.test(v) ? v : null;
}

/* Banco de origem escolhido pela compradora: so codigo da tabela. */
function bancoOk(codigo) {
  const c = String(codigo == null ? '' : codigo).padStart(3, '0');
  return BANCOS[c] ? { codigo: c, nome: BANCOS[c] } : null;
}

/* Os bancos e carteiras que a cliente da neni mais usa: aparecem primeiro
   no seletor "Desde que banco pagaste?". O resto vem depois, em ordem. */
const COMUNS = ['012', '002', '072', '014', '127', '137', '638', '728', '722', '021', '044', '036', '030', '058', '167', '661', '721', '699'];

function listaBancos() {
  const resto = Object.keys(BANCOS)
    .filter((c) => !COMUNS.includes(c) && !['812', '814', '821', '846'].includes(c))
    .map((codigo) => ({ codigo, nome: BANCOS[codigo] }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'es'));
  return COMUNS.map((codigo) => ({ codigo, nome: BANCOS[codigo] })).concat(resto);
}

/* Pagina oficial do comprovante (CEP) da Banxico. A lojista consulta la. */
const CEP_URL = 'https://www.banxico.org.mx/cep/';

module.exports = {
  lerClabe, mascararClabe, lerCelularMx, mascararCelularMx, conceptoDe, referenciaDe,
  claveRastreoOk, bancoOk, listaBancos, CEP_URL,
  _t: { digitoVerificador, BANCOS, COMUNS, so },
};
