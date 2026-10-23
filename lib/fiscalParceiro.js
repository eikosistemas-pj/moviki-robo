// lib/fiscalParceiro.js | versao 2026-10-22-fiscal  (repo: moviki-robo)
//
// DADOS PARA RECEBER DO PARCEIRO — 22/10/2026.
//
// Por que existe: o parceiro so tinha nome e chave Pix. Para pagar comissao a
// Eiko precisa saber QUEM recebe: pessoa fisica (CPF -> recibo com retencao de
// INSS/IR e eSocial) ou juridica (CNPJ -> nota fiscal do parceiro). E o
// Codigo Civil (arts. 3o-5o) exige contratante maior de idade: o programa de
// parceiros e 18+.
//
// Onde fica: parceiros_fiscal/{uid} (sem regra no Firestore = so o robo le e
// grava). O painel recebe so o documento MASCARADO. O espelho
// parceiros/{uid}.fiscalOk / fiscalTipo (gravado pelo Admin SDK) libera o
// botao de saque na tela; a trava de verdade fica no pagar-saque.

'use strict';

const { _t } = require('./pix');

const IDADE_MIN = 18;
const so = (s) => String(s == null ? '' : s).replace(/\D/g, '');

function mascarar(doc) {
  const d = so(doc);
  if (d.length === 11) return '***.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-**';
  if (d.length === 14) return d.slice(0, 2) + '.' + d.slice(2, 5) + '.' + d.slice(5, 8) + '/' + d.slice(8, 12) + '-' + d.slice(12);
  return '';
}

/* Idade completa em anos numa data de referencia (fuso de Brasilia basta: a
   precisao e de dia). nasc = 'AAAA-MM-DD'. */
function idade(nasc, refMs) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(nasc || ''));
  if (!m) return -1;
  const a = +m[1], me = +m[2], di = +m[3];
  const dt = new Date(Date.UTC(a, me - 1, di));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== me - 1 || dt.getUTCDate() !== di) return -1;
  const ref = new Date((refMs || Date.now()) - 3 * 3600000);
  let id = ref.getUTCFullYear() - a;
  if (ref.getUTCMonth() + 1 < me || (ref.getUTCMonth() + 1 === me && ref.getUTCDate() < di)) id--;
  return id;
}

/* Valida o que veio da tela. Devolve { ok, erro, mensagem, dados }. */
function validar(b, refMs) {
  const tipo = b && b.tipo === 'pj' ? 'pj' : (b && b.tipo === 'pf' ? 'pf' : '');
  if (!tipo) return { ok: false, erro: 'tipo', mensagem: 'Escolha se você recebe como pessoa física (CPF) ou jurídica (CNPJ).' };
  const doc = so(b.documento);
  if (tipo === 'pf' && !(doc.length === 11 && _t.cpfValido(doc))) return { ok: false, erro: 'documento', mensagem: 'Confira o CPF: os números não batem.' };
  if (tipo === 'pj' && !(doc.length === 14 && _t.cnpjValido(doc))) return { ok: false, erro: 'documento', mensagem: 'Confira o CNPJ: os números não batem.' };
  const nome = String((b && b.nome) || '').replace(/\s+/g, ' ').trim();
  if (nome.length < 5 || nome.length > 120 || !/\s/.test(nome)) {
    return { ok: false, erro: 'nome', mensagem: tipo === 'pf' ? 'Escreva o nome completo, como está no CPF.' : 'Escreva a razão social, como está no CNPJ.' };
  }
  const dados = { tipo, documento: doc, nome };
  if (tipo === 'pf') {
    const nasc = String((b && b.nascimento) || '').trim();
    const id = idade(nasc, refMs);
    if (id < 0 || id > 110) return { ok: false, erro: 'nascimento', mensagem: 'Informe a data de nascimento.' };
    if (id < IDADE_MIN) return { ok: false, erro: 'menor', mensagem: 'O Programa de Parceiros é só para maiores de 18 anos.' };
    dados.nascimento = nasc;
  } else {
    const resp = String((b && b.responsavel) || '').replace(/\s+/g, ' ').trim();
    if (resp && (resp.length < 5 || resp.length > 120)) return { ok: false, erro: 'responsavel', mensagem: 'Confira o nome do responsável.' };
    if (resp) dados.responsavel = resp;
    dados.mei = b && b.mei === true;
  }
  return { ok: true, dados };
}

/* O documento que o Asaas devolve para a chave Pix vem mascarado
   (ex.: ***.456.789-** ou 12.345.678/0001-90). Confere so os digitos que
   aparecem. Devolve true (bate), false (nao bate) ou null (sem como conferir). */
function docConfere(docCadastrado, docAsaas) {
  const cad = so(docCadastrado);
  const vis = String(docAsaas || '');
  if (!cad || !vis) return null;
  const pad = vis.replace(/[^0-9*]/g, '');
  if (pad.length !== cad.length) return false;
  let vistos = 0;
  for (let i = 0; i < pad.length; i++) {
    if (pad[i] === '*') continue;
    vistos++;
    if (pad[i] !== cad[i]) return false;
  }
  return vistos >= 4 ? true : null;
}

module.exports = { validar, idade, mascarar, docConfere, IDADE_MIN };
