// api/parceiro-fiscal.js | versao 2026-10-22-fiscal  (repo: moviki-robo)
//
// DADOS PARA RECEBER DO PARCEIRO (Meus dados > Dados para receber) — 22/10/2026.
// Regras em lib/fiscalParceiro.js. POST, Authorization: Bearer <idToken>.
//   acao 'ver'    -> { completo, tipo, documento (mascarado), nome, nascimento?, mei? }
//   acao 'salvar' -> grava parceiros_fiscal/{uid} e o espelho parceiros/{uid}.fiscalOk
//   acao 'nota_saque' {saqueId, chave} -> parceiro CNPJ informa a chave de acesso
//              da NFS-e (50 digitos) que emitiu para a Eiko no pedido de saque
//   acao 'relatorio' {competencia:'AAAA-MM'} -> SO O DONO (sessao Google, admins):
//              pagamentos do mes com documento completo, retencoes e notas, para a
//              Contabilizei (recibo/eSocial do PF, entrada da nota do PJ)
// Trocar o documento depois de salvo avisa o dono no Telegram: e o sinal de
// conta tomada (troca documento + Pix e pede saque).

'use strict';

const { admin, db } = require('../lib/firebase');
const { freioUid } = require('../lib/freio');
const F = require('../lib/fiscalParceiro');
const RET = require('../lib/retencaoPF');
const { conferirAdmin } = require('../lib/admin');

const ORIGENS_OK = ['https://app.moviki.com.br', 'https://moviki.com.br', 'https://www.moviki.com.br'];
const FV = admin.firestore.FieldValue;

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

function visao(d) {
  if (!d || !d.documento) return { completo: false };
  const v = { completo: true, tipo: d.tipo, documento: F.mascarar(d.documento), nome: d.nome || '' };
  if (d.tipo === 'pf' && d.nascimento) v.nascimento = String(d.nascimento).split('-').reverse().join('/');
  if (d.tipo === 'pj') { v.mei = d.mei === true; if (d.responsavel) v.responsavel = d.responsavel; }
  return v;
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
    const uid = dec.uid;
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const acao = String(body.acao || 'ver');

    if (acao === 'relatorio') {
      const adm = await conferirAdmin(db, dec);
      if (!adm.ok) { res.status(adm.status || 403).json({ ok: false, erro: adm.erro, mensagem: adm.mensagem }); return; }
      const comp = /^\d{4}-\d{2}$/.test(String(body.competencia || '')) ? String(body.competencia) : RET.competencia();
      const sq = await db.collection('saques').where('status', '==', 'pago').get();
      const linhas = [];
      const cacheF = {}, cacheP = {};
      for (const d of sq.docs) {
        const s = d.data() || {};
        const em = s.pagoEm && typeof s.pagoEm.toMillis === 'function' ? s.pagoEm.toMillis() : 0;
        if (!em || RET.competencia(em) !== comp) continue;
        const pu = s.parceiroUid;
        if (!(pu in cacheF)) { const f = await db.collection('parceiros_fiscal').doc(pu).get(); cacheF[pu] = f.exists ? f.data() : null; }
        if (!(pu in cacheP)) { const p = await db.collection('parceiros').doc(pu).get(); cacheP[pu] = p.exists ? p.data() : {}; }
        const f = cacheF[pu] || {}, p = cacheP[pu] || {};
        linhas.push({
          saqueId: d.id, pagoEm: new Date(em - 3 * 3600000).toISOString().slice(0, 10),
          parceiro: p.nome || '', apelido: p.slug || '', email: p.email || '',
          tipo: s.fiscalTipo || f.tipo || '', documento: f.documento || '', nomeFiscal: f.nome || '',
          nascimento: f.nascimento || '', mei: f.mei === true,
          bruto: Number(s.valorBruto != null ? s.valorBruto : s.valorPago) || 0,
          inss: Number(s.inssRetido) || 0, irrf: Number(s.irrfRetido) || 0, liquido: Number(s.valorPago) || 0,
          nfseChave: s.nfseChave || '', forma: s.formaPagamento || '', semDadosNaEpoca: !s.fiscalTipo,
        });
      }
      linhas.sort((a, b) => a.pagoEm < b.pagoEm ? -1 : 1);
      res.status(200).json({ ok: true, competencia: comp, linhas });
      return;
    }

    const parcRef = db.collection('parceiros').doc(uid);
    const parcSnap = await parcRef.get();
    if (!parcSnap.exists) { res.status(403).json({ ok: false, erro: 'nao_parceiro' }); return; }
    const fisRef = db.collection('parceiros_fiscal').doc(uid);
    const fisSnap = await fisRef.get();
    const atual = fisSnap.exists ? (fisSnap.data() || {}) : null;

    if (acao === 'ver') {
      res.status(200).json(Object.assign({ ok: true, diaPagamentoPF: RET.diaPagamento() }, visao(atual)));
      return;
    }
    if (acao === 'nota_saque') {
      if (!atual || atual.tipo !== 'pj') { res.status(400).json({ ok: false, erro: 'nao_pj', mensagem: 'A nota fiscal é só para quem recebe com CNPJ.' }); return; }
      const chave = String(body.chave || '').replace(/\D/g, '');
      if (!RET.chaveNfseValida(chave)) { res.status(400).json({ ok: false, erro: 'chave', mensagem: 'A chave de acesso da NFS-e tem 50 números. Confira na nota.' }); return; }
      const sRef = db.collection('saques').doc(String(body.saqueId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'x');
      const sSnap = await sRef.get();
      const sd = sSnap.exists ? (sSnap.data() || {}) : null;
      if (!sd || sd.parceiroUid !== uid) { res.status(404).json({ ok: false, erro: 'saque' }); return; }
      if (sd.status !== 'solicitado') { res.status(409).json({ ok: false, erro: 'saque_fechado', mensagem: 'Este saque já foi pago ou fechado.' }); return; }
      await sRef.set({ nfseChave: chave, nfseInformadaEm: FV.serverTimestamp() }, { merge: true });
      res.status(200).json({ ok: true });
      return;
    }
    if (acao !== 'salvar') { res.status(400).json({ ok: false, erro: 'acao' }); return; }

    if (!(await freioUid(admin, db, 'fiscal_parc', uid, 10, 3600000))) {
      res.status(429).json({ ok: false, erro: 'freio', mensagem: 'Muitas tentativas. Tente de novo em alguns minutos.' }); return;
    }
    const v = F.validar(body);
    if (!v.ok) { res.status(400).json({ ok: false, erro: v.erro, mensagem: v.mensagem }); return; }
    const d = v.dados;
    const trocouDoc = !!(atual && atual.documento && atual.documento !== d.documento);

    const registro = Object.assign({}, d, {
      atualizadoEm: FV.serverTimestamp(),
      historico: FV.arrayUnion({ em: Date.now(), tipo: d.tipo, docFim: d.documento.slice(-4) }),
    });
    if (!atual) registro.criadoEm = FV.serverTimestamp();
    if (d.tipo === 'pf') { registro.responsavel = FV.delete(); registro.mei = FV.delete(); } else { registro.nascimento = FV.delete(); }
    await fisRef.set(registro, { merge: true });
    await parcRef.set({ fiscalOk: true, fiscalTipo: d.tipo, fiscalEm: FV.serverTimestamp() }, { merge: true });

    if (trocouDoc) {
      const p = parcSnap.data() || {};
      await telegram('⚠️ Parceiro TROCOU o CPF/CNPJ de recebimento\n\nParceiro: ' + (p.nome || uid) + ' (' + (p.slug || '') + ')\n' +
        'Antes: ...' + String(atual.documento).slice(-4) + ' → agora: ' + F.mascarar(d.documento) + ' (' + d.tipo.toUpperCase() + ')\n' +
        'Confira com ele por outro canal antes do próximo saque.');
    }
    res.status(200).json(Object.assign({ ok: true }, visao(d)));
  } catch (e) {
    console.error('[parceiro-fiscal]', e && e.message);
    res.status(500).json({ ok: false, erro: 'interno', mensagem: 'Não deu para salvar agora. Tente de novo.' });
  }
};
