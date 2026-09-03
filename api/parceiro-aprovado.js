// api/parceiro-aprovado.js  (repo: moviki-robo)
// Envia o e-mail de BOAS-VINDAS quando o dono aprova um parceiro manualmente,
// ou quando reenvia pelo botão "Reenviar boas-vindas" no painel do dono.
// Segurança: só um ADMIN (documento em /admins/{uid}) consegue disparar — a
// permissão é verificada AQUI no servidor.
// A montagem/envio do e-mail vive em lib/boasVindasParceiro.js — mesma lógica
// usada pela aprovação automática (api/novo-parceiro.js), pra nunca ficar
// dessincronizado.
//
// Env var necessária no Vercel (projeto moviki-robo):
//   RESEND_API_KEY  -> chave da API do provedor de e-mail

const { admin, db } = require('../lib/firebase');
const { enviarBoasVindasParceiro } = require('../lib/boasVindasParceiro');
const { gravarEspelho } = require('../lib/espelhoParceiro');

const ORIGIN_OK = 'https://app.moviki.com.br';

module.exports = async (req, res) => {
  // CORS (o painel do dono roda em app.moviki.com.br)
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_OK);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ ok: false }); return; }

  try {
    const body    = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const idToken = String(body.idToken || '');
    const uid     = String(body.uid || '').replace(/[^a-zA-Z0-9]/g, '');
    const forcar  = body.forcar === true;
    if (!idToken || !uid) { res.status(400).json({ ok: false, erro: 'faltam dados' }); return; }

    // 1) Quem está chamando? E é admin de verdade?
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(idToken); }
    catch (_) { res.status(401).json({ ok: false, erro: 'sessao invalida' }); return; }
    const adminDoc = await db.collection('admins').doc(decoded.uid).get();
    if (!adminDoc.exists) { res.status(403).json({ ok: false, erro: 'sem permissao' }); return; }

    // 2) Carrega o parceiro.
    const parceiroRef  = db.collection('parceiros').doc(uid);
    const parceiroSnap = await parceiroRef.get();
    if (!parceiroSnap.exists) { res.status(404).json({ ok: false, erro: 'parceiro nao encontrado' }); return; }
    const p = parceiroSnap.data();

    // 3) Guarda: só manda pra quem está APROVADO.
    if (p.status !== 'aprovado') { res.status(409).json({ ok: false, erro: 'parceiro nao aprovado' }); return; }

    // 3b) Publica o espelho de verificacao (moviki.com.br/v/apelido).
    // Roda ANTES do e-mail de proposito: o e-mail de boas-vindas ja aponta o
    // parceiro pro proprio link, e chegar nele com a pagina de verificacao
    // ainda vazia seria a pior primeira impressao possivel.
    // Nao lanca e nao interrompe: espelho e vitrine, e-mail e o que importa.
    await gravarEspelho(admin, db, p);

    // 4) Monta e envia (forcar=true ignora boasVindasEnviadoEm e reenvia mesmo assim).
    const r = await enviarBoasVindasParceiro({ admin, parceiroRef, p, forcar });

    if (!r.ok) {
      if (r.motivo === 'sem_config') { res.status(200).json({ ok: false, motivo: 'sem_config' }); return; }
      res.status(502).json({ ok: false, erro: r.erro || 'falha ao enviar e-mail' });
      return;
    }

    res.status(200).json({ ok: true, jaEnviado: r.jaEnviado === true });
  } catch (e) {
    console.error('parceiro-aprovado erro:', e);
    res.status(500).json({ ok: false, erro: 'erro interno' });
  }
};
