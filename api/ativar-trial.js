// versao 2026-09-23-verificado (e-mail confirmado conferido no Firebase Auth, nao so no token)
// POST /api/ativar-trial      (repo: moviki-robo · pasta: api/)
// Da 30 dias de Pro gratis pro lojista que acabou de se cadastrar.
//
// -------------------------------------------------------------------------
// REVISAO 15/09/2026 — A PORTA ESTAVA ABERTA.
//
// A versao anterior so perguntava "ja existe assinaturas/{uid}?". Como o uid
// nasce junto com a conta, CONTA NOVA = TRIAL NOVO, sem limite. E-mail nem
// precisava ser confirmado: o painel chamava este endpoint no mesmo segundo do
// createUserWithEmailAndPassword. O ciclo "vendo 30 dias, abro outra conta,
// vendo mais 30" nao esbarrava em nada.
//
// Tres travas entram aqui, todas no servidor:
//
//   1. E-MAIL CONFIRMADO. Sem `email_verified` no token, nao concede — responde
//      { pendenteVerificacao:true } e nao grava nada. O painel ja chama esta
//      rota de novo a cada login enquanto nao ha assinatura (index.html, no
//      onAuthStateChanged), entao o trial entra sozinho quando ele confirmar.
//      NADA no index.html precisa mudar por causa disto.
//
//   2. E-MAIL NORMALIZADO E REGISTRADO PARA SEMPRE. `trials_usados/{hash}` e
//      escrito na mesma transacao da concessao e NUNCA e apagado — nem quando a
//      conta e excluida. Guarda so o hash (LGPD: minimizacao); o e-mail em
//      claro nao entra. A normalizacao mata o truque mais barato que existe:
//      no Gmail, joao.silva+1@gmail.com, joaosilva@gmail.com e
//      j.o.a.o.silva@gmail.com sao a MESMA caixa e hoje valiam tres testes.
//
//   3. DOMINIO DESCARTAVEL. Lista base no codigo, mais a env
//      TRIAL_DOMINIOS_BLOQUEADOS (separada por virgula), que se edita no Vercel
//      sem deploy — mesmo padrao dos termos extras da live.
//
// O QUE ESTA ROTA DELIBERADAMENTE NAO FAZ: barrar cadastro. Quem nao leva o
// trial vira lojista do plano Basico e continua dentro. Aquisicao e o gargalo
// do Moviki; a trava e sobre o BENEFICIO, nunca sobre a porta de entrada.
//
// Continua sendo idempotente e continua nunca lancando erro para o painel.
// -------------------------------------------------------------------------

const crypto = require('crypto');
const { admin, db } = require('../lib/firebase');

const DIAS_TRIAL = 30;

// Provedores de caixa descartavel mais usados no Brasil. A env acrescenta.
const DESCARTAVEIS_BASE = [
  'mailinator.com', 'yopmail.com', 'tempmail.com', 'temp-mail.org',
  'guerrillamail.com', 'sharklasers.com', 'getnada.com', 'trashmail.com',
  '10minutemail.com', 'throwawaymail.com', 'maildrop.cc', 'mohmal.com',
  'emailtemporario.com.br', 'cuvox.de', 'dispostable.com', 'fakemail.net',
  'inbox.lv', 'mailnesia.com', 'spamgourmet.com', 'tempr.email'
];

function dominiosBloqueados() {
  const extra = String(process.env.TRIAL_DOMINIOS_BLOQUEADOS || '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return DESCARTAVEIS_BASE.concat(extra);
}

/* Normaliza o e-mail antes de virar chave.
   - minusculo e sem espaco;
   - Gmail/Googlemail: apaga os pontos do lado esquerdo e tudo depois do '+';
   - demais provedores: so o sufixo '+alias', porque ponto la costuma
     distinguir caixas de verdade e apagar geraria falso positivo. */
function normalizarEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return '';
  let local = e.slice(0, at);
  const dominio = e.slice(at + 1);
  if (!dominio || dominio.indexOf('.') < 0) return '';
  const mais = local.indexOf('+');
  if (mais > 0) local = local.slice(0, mais);
  if (dominio === 'gmail.com' || dominio === 'googlemail.com') {
    local = local.split('.').join('');
    return local + '@gmail.com';
  }
  if (!local) return '';
  return local + '@' + dominio;
}

function hashEmail(emailNorm) {
  const sal = process.env.TRIAL_HASH_SAL || 'moviki-trial-v1';
  return crypto.createHash('sha256').update(sal + '|' + emailNorm).digest('hex');
}

module.exports = async (req, res) => {
  // O painel chama isso do navegador. Liberamos AS DUAS origens da empresa
  // (site e app). So ecoa de volta quando a origem esta na lista — nunca '*'.
  const ORIGENS_PERMITIDAS = ['https://moviki.com.br', 'https://app.moviki.com.br'];
  const origem = req.headers.origin;
  if (ORIGENS_PERMITIDAS.includes(origem)) res.setHeader('Access-Control-Allow-Origin', origem);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Metodo nao permitido' });

  try {
    // Confirma quem e pelo token do Firebase (nao aceita uid solto).
    const authz = req.headers.authorization || '';
    const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : null;
    if (!idToken) return res.status(401).json({ erro: 'Faca login.' });

    const dec = await admin.auth().verifyIdToken(idToken);
    const uid = dec.uid;

    const ref = db.collection('assinaturas').doc(uid);

    // Ja tem assinatura (trial antigo, plano pago, ou qualquer registro):
    // responde igual a versao antiga e nao mexe em nada.
    const snap = await ref.get();
    if (snap.exists) return res.status(200).json({ ok: true, jaExiste: true });

    // ---- TRAVA 1: e-mail confirmado ----
    // Login pelo Google ja chega verificado. Cadastro por e-mail/senha nao —
    // e e exatamente onde a conta descartavel nasce.
    //
    // 23/09/2026 (2026-09-23-verificado): o token do navegador vale 1 hora e
    // carrega o `email_verified` do momento em que foi emitido. Quem acabou
    // de clicar no link de confirmacao chegava aqui com o token velho
    // ("nao confirmado") e ficava ate 1h no Basico, com o cardapio travado —
    // justo na primeira visita vinda do anuncio de "30 dias gratis".
    // Agora, se o token diz "nao confirmado", o robo pergunta ao proprio
    // Firebase Auth (fonte da verdade). Continua falhando FECHADO: sem
    // confirmacao no Auth, nao concede.
    let emailConta = dec.email;
    if (dec.email_verified !== true) {
      let verificadoNoAuth = false;
      try {
        const u = await admin.auth().getUser(uid);
        verificadoNoAuth = !!(u && u.emailVerified === true);
        if (u && u.email) emailConta = u.email;
      } catch (_) { verificadoNoAuth = false; }
      if (!verificadoNoAuth) {
        return res.status(200).json({ ok: true, pendenteVerificacao: true });
      }
    }

    const emailNorm = normalizarEmail(emailConta);
    if (!emailNorm) return res.status(200).json({ ok: true, negado: 'email_invalido' });

    // ---- TRAVA 3: dominio descartavel ----
    const dominio = emailNorm.slice(emailNorm.lastIndexOf('@') + 1);
    if (dominiosBloqueados().indexOf(dominio) >= 0) {
      await db.collection('trial_negado').doc(uid).set({
        motivo: 'dominio_descartavel', dominio,
        em: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(() => {});
      return res.status(200).json({ ok: true, negado: 'dominio_descartavel' });
    }

    // ---- TRAVA 2: este e-mail ja gastou o teste gratis alguma vez? ----
    const chave = hashEmail(emailNorm);
    const refUso = db.collection('trials_usados').doc(chave);

    const vence = new Date();
    vence.setDate(vence.getDate() + DIAS_TRIAL);

    // Transacao: dois leitores simultaneos (duas abas, dois cliques) nao
    // conseguem conceder dois trials para o mesmo hash.
    const saida = await db.runTransaction(async (t) => {
      const [a, u] = await Promise.all([t.get(ref), t.get(refUso)]);
      if (a.exists) return { jaExiste: true };

      if (u.exists) {
        const antes = u.data() || {};
        // Mesmo uid reaparecendo (assinatura apagada a mao pelo dono):
        // deixa passar, porque nao e conta nova.
        if (antes.uid && antes.uid !== uid) {
          t.set(db.collection('trial_negado').doc(uid), {
            motivo: 'email_reutilizado', uidAnterior: antes.uid,
            em: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          return { negado: 'email_reutilizado' };
        }
      }

      t.set(ref, {
        plano: 'pro',
        periodo: 'trial',
        ativo: true,
        origem: 'trial',
        vence_em: admin.firestore.Timestamp.fromDate(vence),
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      });

      // NUNCA APAGAR. Este documento e a memoria do teste gratis: se ele
      // sumir junto com a conta, o ciclo de contas novas volta a funcionar.
      t.set(refUso, {
        uid,
        em: admin.firestore.FieldValue.serverTimestamp(),
        dominio
      }, { merge: true });

      return { trial: true };
    });

    return res.status(200).json(Object.assign({ ok: true }, saida));
  } catch (e) {
    return res.status(500).json({ erro: e.message || 'Erro ao ativar trial' });
  }
};
