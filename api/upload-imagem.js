// api/upload-imagem.js  (repo: moviki-robo)
// Recebe uma imagem (base64) do painel do lojista e sobe no Firebase Storage.
// Três modos:
//   - tipo 'logo' (padrão): grava a URL em negocios/{uid}.markerLogo (logo do pino).
//   - tipo 'produto': NÃO grava nada; só devolve a URL. Quem guarda a URL no item
//     do cardápio é o painel, na hora de salvar (a foto vive dentro do array
//     negocios/{uid}.cardapio, então não passa por aqui pra gravar).
//   - tipo 'parceiro' (10/09/2026): foto de perfil do PARCEIRO. NÃO vai para o
//     Storage — fica guardada como data: URI em parceiros/{uid}.foto e é copiada
//     na hora para o espelho público parceiros_publicos/{slug}.foto, que é o que
//     a página moviki.com.br/v/apelido mostra quando o comerciante lê o QR Code.
//     Mandar imagemBase64 vazio REMOVE a foto (volta a valer a do Instagram).
//     Por que data: e não Storage está explicado em lib/espelhoParceiro.js.
//     Por que passa pelo robô e não é gravado direto pelo painel: a regra do
//     Firestore só deixa o parceiro mexer em nome/pix/aulas — o Admin SDK
//     grava sem depender de publicar regra nova.
// Segurança: o idToken identifica o lojista; ele só mexe nos dados DELE.
// O upload usa Admin SDK (service account) — bypassa regras do Storage/Firestore.
//
// Env necessária no Vercel (projeto moviki-robo): FIREBASE_SERVICE_ACCOUNT
// (IMGBB_API_KEY não é mais necessária — removida)

const { db, admin } = require('../lib/firebase');
const { espelharPorUid } = require('../lib/espelhoParceiro');

const ORIGIN_OK = 'https://app.moviki.com.br';
// Foto de perfil do parceiro: teto do texto data: que o painel manda.
// O painel envia lado de 320px em JPEG e fica perto de 40 KB; 200 KB dá folga
// de sobra e ainda deixa o documento longe do teto de 1 MB do Firestore.
const MAX_FOTO_PARCEIRO = 200000;
const MAX_B64 = 2800000; // ~2 MB de base64 (imagem já vem comprimida do navegador)
// Bucket explícito do projeto (evita auto-detecção falhar)
const STORAGE_BUCKET = 'moviki-app.firebasestorage.app';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_OK);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ ok: false }); return; }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const idToken = String(body.idToken || '');
    const imagemBase64 = String(body.imagemBase64 || '');
    const tipo = String(body.tipo || 'logo'); // 'logo' | 'produto' | 'parceiro'
    const ehParceiro = tipo === 'parceiro';
    // Foto de parceiro é o único caso em que imagem VAZIA é pedido legítimo:
    // é assim que ele remove a foto que escolheu.
    if (!idToken || (!imagemBase64 && !ehParceiro)) { res.status(400).json({ ok: false, erro: 'faltam dados' }); return; }
    if (imagemBase64.length > MAX_B64) { res.status(413).json({ ok: false, erro: 'imagem muito grande' }); return; }

    // Quem é o lojista?
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(idToken); }
    catch (_) { res.status(401).json({ ok: false, erro: 'sessao invalida' }); return; }

    // -----------------------------------------------------------------------
    // FOTO DE PERFIL DO PARCEIRO — 10/09/2026. Não toca no Storage.
    // -----------------------------------------------------------------------
    if (ehParceiro) {
      const foto = imagemBase64.trim();
      if (foto && !/^data:image\/(jpeg|png|webp);base64,/.test(foto)) {
        res.status(400).json({ ok: false, erro: 'formato de imagem nao aceito' }); return;
      }
      if (foto.length > MAX_FOTO_PARCEIRO) {
        res.status(413).json({ ok: false, erro: 'imagem muito grande' }); return;
      }

      // Só quem TEM cadastro de parceiro. Sem esta conferência, um lojista
      // qualquer criaria um documento de parceiro vazio só mandando uma foto.
      const ref = db.collection('parceiros').doc(decoded.uid);
      const snap = await ref.get();
      if (!snap.exists) { res.status(403).json({ ok: false, erro: 'sem cadastro de parceiro' }); return; }

      await ref.set({
        foto,
        fotoEm: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // O espelho é o que a página do QR Code lê. Regravar aqui é o que faz a
      // foto nova aparecer para o comerciante NA HORA, sem esperar a próxima
      // abertura do painel.
      const esp = await espelharPorUid(admin, db, decoded.uid);

      res.status(200).json({ ok: true, foto, espelho: esp.ok === true, slug: esp.slug || null });
      return;
    }

    // tira o prefixo "data:image/...;base64," se vier
    const b64 = imagemBase64.includes(',') ? imagemBase64.split(',').pop() : imagemBase64;

    const ehProduto = tipo === 'produto';
    const pasta = ehProduto ? 'produtos' : 'logos';
    const fileName = `${pasta}/${decoded.uid}/${Date.now()}.jpg`;

    // Upload para Firebase Storage via Admin SDK — bucket EXPLÍCITO
    const bucket = admin.storage().bucket(STORAGE_BUCKET);
    const buffer = Buffer.from(b64, 'base64');
    const file = bucket.file(fileName);

    await file.save(buffer, {
      metadata: {
        contentType: 'image/jpeg',
        cacheControl: 'public,max-age=31536000', // 1 ano
      },
      public: true, // torna o arquivo público (qualquer um com a URL acessa)
    });

    // URL pública do Firebase Storage (formato compatível com CSP das páginas)
    const url = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket.name)}/o/${encodeURIComponent(fileName)}?alt=media`;

    if (ehProduto) {
      // foto de produto: só devolve a URL (o painel guarda dentro do cardapio ao salvar)
      res.status(200).json({ ok: true, url });
      return;
    }

    // logo do pino: grava no doc do próprio lojista (Admin SDK -- não depende das regras)
    await db.collection('negocios').doc(decoded.uid).set({ markerLogo: url }, { merge: true });
    res.status(200).json({ ok: true, url });
  } catch (e) {
    // Log detalhado pra aparecer no console do Vercel (Settings → Functions → View Logs)
    const msg = e?.message || String(e);
    const code = e?.code || 'UNKNOWN';
    console.error('upload-imagem ERRO:', { code, message: msg, stack: e?.stack });
    // Resposta amigável pro painel
    if (code === 'PERMISSION_DENIED' || msg.includes('permission')) {
      res.status(500).json({ ok: false, erro: 'sem permissão no Storage (verifique role Storage Admin no service account)', motivo: 'perm_storage' });
    } else if (code === 'FAILED_PRECONDITION' || msg.includes('billing') || msg.includes('Blaze')) {
      res.status(500).json({ ok: false, erro: 'Firebase Storage requer plano Blaze ativo', motivo: 'sem_blaze' });
    } else if (code === 'NOT_FOUND' || msg.includes('bucket')) {
      res.status(500).json({ ok: false, erro: 'bucket não encontrado (confira nome: moviki-app.firebasestorage.app)', motivo: 'bucket_nao_existe' });
    } else {
      res.status(500).json({ ok: false, erro: 'erro interno no upload', detalhe: msg });
    }
  }
};