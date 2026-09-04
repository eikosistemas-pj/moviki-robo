/*!
 * MOVIKI lib/gauth.js | versao 2026-09-04-gauth1 | repo: moviki (site publico)
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * O App Check protege o Firestore contra quem NAO e um navegador de verdade.
 * O problema: o proprio site tem duas pecas que falam com o Firestore DE
 * SERVIDOR (api/og.js e api/vitrine.js). Requisicao de servidor nao carrega
 * token de App Check — com o enforcement ligado, elas seriam recusadas e todo
 * link de lojista compartilhado viraria cartao cinza.
 *
 * A SAIDA e falar com o Firestore como CONTA DE SERVICO. Chamada autenticada
 * por conta de servico passa por IAM, nao pela chave publica do app: nao e
 * "cliente", entao o App Check nao se aplica a ela — por definicao, nao por
 * gambiarra.
 *
 * POR QUE NAO O firebase-admin
 * O repo do site nao tem package.json e nao tem node_modules. Puxar o
 * firebase-admin so para LER quatro documentos criaria um passo de instalacao
 * no deploy e engordaria o cold start da unica funcao que serve TODA rota
 * /apelido — a rota de entrada de cada negocio. O que o Admin SDK faz aqui e
 * uma coisa so: assinar um JWT e trocar por um token OAuth. O Node ja sabe
 * assinar RS256 sozinho (modulo crypto). Zero dependencia, zero instalacao.
 *
 * A CONTA DE SERVICO E SOMENTE LEITURA (papel "Visualizador do Cloud
 * Datastore"). NAO e a mesma do moviki-robo: aquela tem escrita total e nao
 * pode chegar perto do repo mais exposto do projeto. Se um dia a env vazar,
 * o estrago maximo e ler o que as regras ja deixam ler.
 *
 * ATENCAO PERMANENTE: conta de servico PASSA POR CIMA das regras do Firestore.
 * Quem usar este modulo so pode ler os documentos que ja lia pelo navegador —
 * nunca colecao de dinheiro, nunca campo que a pagina nao mostra.
 *
 * ENV (projeto Vercel do SITE, Production e Preview):
 *   FIREBASE_SA_LEITURA = JSON inteiro da chave da conta de servico
 * Sem a env, tokenLeitura() devolve string vazia e quem chamou cai sozinho no
 * modo antigo (chave publica). E o que mantem o site no ar enquanto a conta
 * nao existe.
 */
'use strict';

const crypto = require('crypto');

/* O token vale 1 hora. A Vercel reaproveita a mesma instancia entre
   requisicoes, entao guardar aqui evita uma ida ao Google a cada chamada.
   Renova 5 min antes de vencer. */
let cache = { token: '', expira: 0 };

function b64url(x) {
  return Buffer.from(x).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function conta() {
  const bruto = process.env.FIREBASE_SA_LEITURA || '';
  if (!bruto.trim()) return null;
  try {
    const sa = JSON.parse(bruto);
    if (!sa || !sa.client_email || !sa.private_key) return null;
    /* Chave colada em variavel de ambiente as vezes chega com \n literais. */
    sa.private_key = String(sa.private_key).replace(/\\n/g, '\n');
    return sa;
  } catch (e) { return null; }
}

function temConta() { return !!conta(); }

/* Devolve um token OAuth de leitura do Firestore, ou '' se nao for possivel.
   NUNCA lanca: falhar aqui tem que degradar para o modo antigo, nao derrubar
   a pagina publica. */
async function tokenLeitura() {
  const agora = Date.now();
  if (cache.token && agora < cache.expira) return cache.token;

  const sa = conta();
  if (!sa) return '';

  const seg = Math.floor(agora / 1000);
  const cabecalho = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const corpo = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: seg,
    exp: seg + 3600
  }));

  let jwt;
  try {
    const assinatura = crypto.createSign('RSA-SHA256')
      .update(cabecalho + '.' + corpo).sign(sa.private_key);
    jwt = cabecalho + '.' + corpo + '.' + b64url(assinatura);
  } catch (e) { return ''; }

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2000);
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer' +
            '&assertion=' + encodeURIComponent(jwt)
    });
    clearTimeout(t);
    if (!r.ok) return '';
    const j = await r.json();
    if (!j || !j.access_token) return '';
    const dura = Math.max(60, (Number(j.expires_in) || 3600) - 300);
    cache = { token: j.access_token, expira: agora + dura * 1000 };
    return cache.token;
  } catch (e) { return ''; }
}

module.exports = { tokenLeitura, temConta };
