/*!
 * MOVIKI lib/pix.js | versao 2026-09-14-pixdireto | repo: moviki-robo
 *
 * PIX DIRETO — o copia-e-cola e o QR do lojista, montados AQUI, no servidor.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * No modo Pix direto o dinheiro vai do comprador para a conta do lojista sem
 * passar por gateway nenhum: nao ha Asaas, nao ha tarifa, nao ha teto de
 * subconta. O que o Moviki faz e montar o BR Code (o "copia e cola") com a
 * chave que o lojista cadastrou.
 *
 * REGRA DE OURO QUE NASCE COM ELE (Doutrina, artigo 4)
 * O payload e montado SEMPRE no servidor. O navegador recebe a string pronta
 * e so desenha o QR a partir dela. Em setembro de 2026 houve uma onda de
 * lojas virtuais invadidas onde um script injetado trocava o QR do Pix pelo
 * do criminoso — a loja continuava funcionando e ninguem percebia. Montar o
 * payload no cliente e servir esse ataque de bandeja.
 *
 * A defesa que sobrevive ate a um front-end comprometido nao e tecnica, e
 * visual: a tela mostra NOME e DOCUMENTO MASCARADO de quem vai receber, com
 * a instrucao de conferir no aplicativo do banco antes de confirmar. Por isso
 * o recebedor() abaixo devolve esses dois campos junto do payload — eles nao
 * sao enfeite, sao a barreira.
 *
 * CENTAVOS IDENTIFICADORES
 * O Pix direto nao avisa o Moviki quando o dinheiro cai. Para o lojista achar
 * o pagamento no extrato sem caçar nome, cada pedido recebe centavos unicos:
 * R$ 20,00 vira R$ 20,07, o proximo R$ 20,13, e assim por diante. O acrescimo
 * e sempre de no maximo R$ 0,99 e sai do proprio pedido, nunca do bolso do
 * comprador sem aviso — a tela mostra o total final antes de pagar.
 *
 * Sem dependencia externa: BR Code e CRC16 sao escritos aqui.
 */
'use strict';

const crypto = require('crypto');

/* ------------------------------------------------------------ util */

// Remove acento, deixa o que o padrao EMV aceita com seguranca.
function ascii(s, max) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 .,\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max || 99);
}

function so(d) { return String(d == null ? '' : d).replace(/\D/g, ''); }

/* Campo EMV: id + tamanho com 2 digitos + valor. */
function campo(id, valor) {
  const v = String(valor == null ? '' : valor);
  const n = String(v.length).padStart(2, '0');
  if (v.length > 99) throw new Error('pix: campo ' + id + ' longo demais');
  return String(id) + n + v;
}

/* CRC16/CCITT-FALSE — polinomio 0x1021, inicial 0xFFFF, sem reflexao.
   E o que o BR Code exige no campo 63. */
function crc16(str) {
  let crc = 0xFFFF;
  for (let i = 0; i < str.length; i++) {
    crc ^= (str.charCodeAt(i) & 0xFF) << 8;
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/* --------------------------------------------------- chave Pix */

/* Descobre e normaliza o tipo da chave. Devolve null quando nao e chave
   valida — e ai o lojista nao consegue ligar o recebimento, o que e o
   comportamento certo: chave errada e dinheiro indo para o lugar errado. */
function lerChave(bruta) {
  const v = String(bruta == null ? '' : bruta).trim();
  if (!v || v.length > 77) return null;

  // Aleatoria (EVP): uuid
  if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(v)) {
    return { tipo: 'aleatoria', valor: v.toLowerCase(), rotulo: 'chave aleatória' };
  }
  // E-mail
  if (/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v) && v.length <= 77) {
    return { tipo: 'email', valor: v.toLowerCase(), rotulo: 'e-mail' };
  }
  // Telefone: +5583999999999
  const tel = so(v);
  if (/^\+/.test(v) || tel.length === 12 || tel.length === 13) {
    const t = tel.replace(/^55/, '');
    if (t.length === 10 || t.length === 11) return { tipo: 'telefone', valor: '+55' + t, rotulo: 'telefone' };
  }
  if (tel.length === 10 || tel.length === 11) {
    // Ambiguidade real: 11 digitos e CPF e tambem celular com DDD.
    // CPF valido ganha; senao, telefone.
    if (tel.length === 11 && cpfValido(tel)) return { tipo: 'cpf', valor: tel, rotulo: 'CPF' };
    return { tipo: 'telefone', valor: '+55' + tel, rotulo: 'telefone' };
  }
  if (tel.length === 11 && cpfValido(tel)) return { tipo: 'cpf', valor: tel, rotulo: 'CPF' };
  if (tel.length === 14 && cnpjValido(tel)) return { tipo: 'cnpj', valor: tel, rotulo: 'CNPJ' };
  return null;
}

function cpfValido(c) {
  c = so(c); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  let s = 0; for (let i = 0; i < 9; i++) s += +c[i] * (10 - i);
  let d = (s * 10) % 11 % 10; if (d !== +c[9]) return false;
  s = 0; for (let i = 0; i < 10; i++) s += +c[i] * (11 - i);
  d = (s * 10) % 11 % 10; return d === +c[10];
}
function cnpjValido(c) {
  c = so(c); if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (n) => { let s = 0, p = n - 7; for (let i = 0; i < n; i++) { s += +c[i] * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return calc(12) === +c[12] && calc(13) === +c[13];
}

/* Mascara do documento do RECEBEDOR, para o comprador conferir no banco sem
   que o documento inteiro apareca na tela de ninguem. */
function mascararDoc(doc) {
  const d = so(doc);
  if (d.length === 11) return '***.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-**';
  if (d.length === 14) return '**.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/****-' + d.slice(-2);
  return '';
}

/* ------------------------------------------------ centavos identificadores */

/* Gera o total com centavos unicos do dia, para o lojista bater no extrato.
   A sequencia vem do id do pedido (deterministica: o mesmo pedido gera sempre
   o mesmo valor, o que importa quando a funcao roda duas vezes). Nunca passa
   de +R$ 0,99 e nunca diminui o valor. */
function centavosUnicos(total, pedidoId) {
  const base = Math.round(Number(total) * 100);
  if (!(base > 0)) return { total: 0, centavos: 0 };
  const h = crypto.createHash('sha256').update(String(pedidoId || '')).digest();
  const extra = (h[0] << 8 | h[1]) % 100;     // 0..99
  const cent = base + extra;
  return { total: Math.round(cent) / 100, centavos: extra };
}

/* --------------------------------------------------------- BR Code */

/* Monta o copia-e-cola. Parametros:
     chave     chave Pix crua, como o lojista cadastrou
     nome      nome do recebedor (vai no QR, max 25 no padrao)
     cidade    cidade do recebedor (max 15)
     valor     total em reais, ja com os centavos identificadores
     txid      referencia curta, so letras e numeros (max 25)
   Devolve { ok, payload, erro }. */
function brcode(opcoes) {
  const o = opcoes || {};
  const k = lerChave(o.chave);
  if (!k) return { ok: false, erro: 'chave' };

  const nome = ascii(o.nome, 25) || 'MOVIKI';
  const cidade = ascii(o.cidade, 15) || 'BRASIL';
  const valor = Number(o.valor);
  if (!(valor > 0) || valor > 99999999) return { ok: false, erro: 'valor' };
  const txid = String(o.txid || '***').replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';

  const conta = campo('00', 'BR.GOV.BCB.PIX') + campo('01', k.valor);

  let p = '';
  p += campo('00', '01');           // formato do payload
  p += campo('01', '12');           // uso unico: este QR vale para este pedido
  p += campo('26', conta);          // conta do recebedor
  p += campo('52', '0000');         // categoria do estabelecimento
  p += campo('53', '986');          // moeda: real
  p += campo('54', valor.toFixed(2));
  p += campo('58', 'BR');
  p += campo('59', nome);
  p += campo('60', cidade);
  p += campo('62', campo('05', txid));
  p += '6304';                      // o CRC entra logo abaixo, sobre este prefixo

  return { ok: true, payload: p + crc16(p), tipoChave: k.tipo, rotuloChave: k.rotulo };
}

/* Dados que a tela do comprador PRECISA mostrar junto do QR. Ver o cabecalho:
   e a unica defesa que sobrevive a um front-end comprometido. */
function recebedor(conf) {
  const c = conf || {};
  return {
    nome: ascii(c.nome, 60),
    documento: mascararDoc(c.documento),
    tipoChave: (lerChave(c.chave) || {}).rotulo || '',
  };
}

/* Referencia curta e legivel para o txid, derivada do id do pedido. */
function txidDe(pedidoId) {
  return ('MV' + String(pedidoId || '').replace(/[^A-Za-z0-9]/g, '')).slice(0, 25).toUpperCase();
}

module.exports = {
  brcode, lerChave, recebedor, centavosUnicos, txidDe, mascararDoc,
  _t: { crc16, campo, ascii, cpfValido, cnpjValido },
};
