// api/backup.js | versao 2026-10-06-cofre  (repo: moviki-robo)
//
// COPIA SEMANAL DO FIRESTORE PARA O COFRE (plano de seguranca 1.4).
//
// O backup diario do Firebase (7 dias) mora no MESMO projeto do banco. Uma
// conta invadida, ou um engano no console, apaga o banco e os backups juntos.
// Esta funcao manda uma exportacao completa para um bucket em OUTRO projeto
// (moviki-cofre), onde a conta de servico do robo so GRAVA e nao apaga.
//
// Como roda:
//   GET com Authorization: Bearer CRON_SECRET  -> cron da Vercel, segunda 06:00 UTC
//   POST { idToken }                             -> painel do dono (so Google), para rodar na hora
//
// O que faz: pede ao Firestore uma exportacao de TODAS as colecoes para
//   gs://<BACKUP_BUCKET>/firestore/AAAA-MM-DD-HHMM/  e avisa no Telegram que
//   a operacao comecou (o Google termina sozinho em minutos). Guarda o nome da
//   operacao em sistema/backup para conferencia no painel.
//
// Falha FECHADA: sem BACKUP_BUCKET, responde 503 {erro:'config'} e nao faz
// nada — e assim que fica ate o Paulo criar o cofre. Nunca derruba nada.
//
// ENV (projeto Vercel do robo):
//   BACKUP_BUCKET   = nome do bucket no projeto moviki-cofre (ex.: moviki-cofre-firestore)
//   (ja existem) FIREBASE_SERVICE_ACCOUNT, CRON_SECRET, TELEGRAM_TOKEN, TELEGRAM_CHAT_ID
//
// PERMISSOES (console, uma vez):
//   1. Projeto moviki-app > IAM > conta de servico do robo > papel "Cloud Datastore Import Export Admin".
//   2. Projeto moviki-cofre > bucket > permissoes > a MESMA conta de servico com "Storage Object Creator"
//      (criar, nunca apagar). Ligar "retencao" de 90 dias no bucket.
//   3. API "Firestore" ja esta ativa no moviki-app.

const { admin, db } = require('../lib/firebase');
const { conferirAdmin } = require('../lib/admin');
const { bearerConfere } = require('../lib/segredo');

const ORIGENS = ['https://app.moviki.com.br'];
const PROJETO = 'moviki-app';

async function telegram(texto) {
  const TOKEN = process.env.TELEGRAM_TOKEN, CHAT = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT) return;
  try {
    await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text: texto, disable_web_page_preview: true }),
    });
  } catch (_) {}
}

function carimbo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + '-' + p(d.getUTCHours()) + p(d.getUTCMinutes());
}

async function exportar(origem) {
  const bucket = String(process.env.BACKUP_BUCKET || '').trim().replace(/^gs:\/\//, '').replace(/\/+$/, '');
  if (!bucket) return { erro: 'config', mensagem: 'BACKUP_BUCKET nao configurado. Crie o cofre (plano 1.4) e cadastre a env.' };

  const { v1 } = require('@google-cloud/firestore');
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  const cliente = new v1.FirestoreAdminClient({ credentials: { client_email: sa.client_email, private_key: sa.private_key }, projectId: PROJETO });

  const pasta = 'gs://' + bucket + '/firestore/' + carimbo();
  const [op] = await cliente.exportDocuments({
    name: cliente.databasePath(PROJETO, '(default)'),
    outputUriPrefix: pasta,
    collectionIds: [],   // vazio = todas as colecoes
  });
  const nome = String((op && op.name) || '');
  await db.collection('sistema').doc('backup').set({
    ultimaPasta: pasta, ultimaOperacao: nome, origem, pedidoEm: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: true, pasta, operacao: nome };
}

module.exports = async (req, res) => {
  const origem = String(req.headers.origin || '');
  if (ORIGENS.includes(origem)) res.setHeader('Access-Control-Allow-Origin', origem);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    let via = '';
    if (req.method === 'GET') {
      if (!bearerConfere(req, process.env.CRON_SECRET)) { res.status(401).json({ ok: false, erro: 'nao_autorizado' }); return; }
      via = 'cron';
    } else if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      let decoded;
      try { decoded = await admin.auth().verifyIdToken(String(body.idToken || ''), true); }
      catch (_) { res.status(401).json({ ok: false, erro: 'sessao' }); return; }
      const adm = await conferirAdmin(db, decoded);
      if (!adm.ok) { res.status(adm.status).json({ ok: false, erro: adm.erro, mensagem: adm.mensagem }); return; }
      via = 'painel';
    } else { res.status(405).json({ ok: false }); return; }

    const r = await exportar(via);
    if (r.erro) {
      if (via === 'cron') await telegram('⚠️ Backup semanal NAO rodou: ' + r.mensagem);
      res.status(r.erro === 'config' ? 503 : 500).json({ ok: false, erro: r.erro, mensagem: r.mensagem }); return;
    }
    await telegram('🗄 Backup do Firestore iniciado (' + via + ')\n' + r.pasta + '\nO Google termina em alguns minutos. Conferir no bucket do cofre.');
    res.status(200).json(r);
  } catch (e) {
    console.error('backup erro', e && e.message);
    await telegram('⚠️ Backup semanal FALHOU: ' + String((e && e.message) || e).slice(0, 200));
    res.status(500).json({ ok: false, erro: 'interno' });
  }
};
