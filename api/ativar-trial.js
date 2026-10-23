// versao 2026-10-23-provip (teste provisorio: no maximo 3 por rede (IP) a cada 24 h; acima disso so confirmando o e-mail)
// anterior: 2026-10-14-provisorio (teste de 7 dias antes de confirmar o e-mail; confirmou, vira 30 dias contados do inicio)
// anterior: 2026-09-25-pendente (clicar em Assinar antes de confirmar o e-mail nao queima mais o teste)
// anterior: 2026-09-23-verificado (e-mail confirmado conferido no Firebase Auth, nao so no token)
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
//   1. E-MAIL CONFIRMADO. (Desde 14/10/2026 vale so para os 30 dias: sem
//      confirmar, o teste e PROVISORIO de 7 dias — ver o bloco de 14/10 abaixo.)
//      Texto original: sem `email_verified` no token, nao concede — responde
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
//
// 14/10/2026 (2026-10-14-provisorio) — TESTE PROVISORIO. Decisao do Paulo
// (09/10, montado em 14/10): 4 de cada 10 cadastros paravam na confirmacao do
// e-mail e saiam sem nunca ver o painel funcionando. A trava 1 mudou de lugar:
//
//   - SEM e-mail confirmado: 7 dias de teste, marcados `provisorio:true`.
//     Vale cardapio, ferramentas do Pro e o ENSAIO (ninguem ve). NAO vale a
//     live aberta ao publico (lib/livesessao.js, reservar) nem assinar (o
//     criar-assinatura ja responde 403). As travas 2 e 3 continuam valendo.
//     O hash do e-mail vai para `trials_provisorios/{hash}` e NAO para
//     `trials_usados`: assim quem cria conta com o e-mail de outra pessoa nao
//     queima o teste de 30 dias dela. `trials_provisorios` tambem nunca e
//     apagado — e o que impede "apago a conta, crio de novo, mais 7 dias".
//   - CONFIRMOU: o mesmo teste passa a valer 30 dias contados do INICIO do
//     provisorio (no minimo 7 dias a partir da confirmacao, para quem confirma
//     tarde) e o hash vai para `trials_usados`, como antes.
// -------------------------------------------------------------------------

const crypto = require('crypto');
const { admin, db } = require('../lib/firebase');
const { freioUid } = require('../lib/freio');

const DIAS_TRIAL = 30;
const DIAS_PROVISORIO = 7;      // teste antes de confirmar o e-mail (14/10/2026)
const DIAS_MINIMO_CONFIRMOU = 7; // quem confirma tarde ainda leva pelo menos isso
const DIA_MS = 86400000;
// 23/10/2026 (Sentinela): o provisorio nao pede e-mail confirmado, entao
// e-mail inventado dava 7 dias de Pro em serie. Teto por rede (hash do IP,
// nunca o IP): acima dele a conta nao ganha provisorio e segue o caminho de
// sempre (confirmar o e-mail e levar os 30 dias). Celular atras de CGNAT
// divide IP; 3 por dia cobre o volume real com folga.
const PROV_POR_IP_DIA = 3;

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

/* Documento de assinaturas/{uid} que conta como "ja teve plano ou teste".
   A pendencia do criar-assinatura (clicou em Assinar e nao pagou) nao conta. */
function jaTemRegistro(snap) {
  if (!snap || !snap.exists) return false;
  const d = snap.data() || {};
  return !!(d.vence_em || d.origem || d.ativo === true || d.testeAte);
}

function ehProvisorio(snap) {
  return !!(snap && snap.exists && (snap.data() || {}).provisorio === true);
}

/* Milissegundos de um Timestamp do Firestore (ou 0). */
function msDe(t) {
  return (t && typeof t.toMillis === 'function') ? t.toMillis() : 0;
}

/* Fim do teste de quem confirmou o e-mail. Puro, testado em
   testes/teste-provisorio.test.js. inicioMs = inicio do provisorio (0 = nao
   havia provisorio, o teste comeca agora). */
function venceConfirmado(inicioMs, agoraMs) {
  const base = inicioMs > 0 ? inicioMs : agoraMs;
  return Math.max(base + DIAS_TRIAL * DIA_MS, agoraMs + DIAS_MINIMO_CONFIRMOU * DIA_MS);
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
    //
    // 25/09/2026: EXCETO a "pendencia" que o criar-assinatura grava quando a
    // pessoa clica em Assinar sem nunca ter tido plano ({plano, periodo,
    // ativo:false}, sem vence_em). Quem vinha do anuncio, cadastrava e clicava
    // em Assinar so para ver o preco ANTES de confirmar o e-mail perdia os 30
    // dias para sempre. Registro com vence_em (teste ja dado ou plano ja pago),
    // com origem, ou ativo continua contando como "ja existe".
    const snap = await ref.get();
    const eraProvisorio = ehProvisorio(snap);
    if (jaTemRegistro(snap) && !eraProvisorio) return res.status(200).json({ ok: true, jaExiste: true });

    // ---- TRAVA 1: e-mail confirmado ----
    // Login pelo Google ja chega verificado. Cadastro por e-mail/senha nao —
    // e e exatamente onde a conta descartavel nasce.
    //
    // 23/09/2026 (2026-09-23-verificado): o token do navegador vale 1 hora e
    // carrega o `email_verified` do momento em que foi emitido. Quem acabou
    // de clicar no link de confirmacao chegava aqui com o token velho
    // ("nao confirmado"). Agora, se o token diz "nao confirmado", o robo
    // pergunta ao proprio Firebase Auth (fonte da verdade).
    //
    // 14/10/2026: sem confirmacao no Auth, o teste passa a ser PROVISORIO (7
    // dias, sem live aberta ao publico e sem assinar) — ver o topo.
    let emailConta = dec.email;
    let verificado = dec.email_verified === true;
    if (!verificado) {
      try {
        const u = await admin.auth().getUser(uid);
        verificado = !!(u && u.emailVerified === true);
        if (u && u.email) emailConta = u.email;
      } catch (_) { verificado = false; }
    }

    // Ja esta no provisorio e continua sem confirmar: nada muda.
    if (eraProvisorio && !verificado) {
      return res.status(200).json({ ok: true, jaExiste: true, provisorio: true });
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
    const refProv = db.collection('trials_provisorios').doc(chave);
    const agora = Date.now();

    // ---- TRAVA 4: provisorio por rede (23/10/2026) ----
    if (!verificado && !eraProvisorio) {
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
      if (ip) {
        const ipH = crypto.createHash('sha256').update('mvk-prov|' + ip).digest('hex').slice(0, 32);
        const pode = await freioUid(admin, db, 'trialprov', ipH, PROV_POR_IP_DIA, DIA_MS);
        if (!pode) return res.status(200).json({ ok: true, pendenteVerificacao: true, motivo: 'provisorio_rede' });
      }
    }

    // Transacao: dois leitores simultaneos (duas abas, dois cliques) nao
    // conseguem conceder dois trials para o mesmo hash.
    const saida = await db.runTransaction(async (t) => {
      const [a, u, p] = await Promise.all([t.get(ref), t.get(refUso), t.get(refProv)]);
      const aProv = ehProvisorio(a);
      if (jaTemRegistro(a) && !aProv) return { jaExiste: true };
      if (aProv && !verificado) return { jaExiste: true, provisorio: true };

      if (u.exists) {
        const antes = u.data() || {};
        // Mesmo uid reaparecendo (assinatura apagada a mao pelo dono):
        // deixa passar, porque nao e conta nova.
        if (antes.uid && antes.uid !== uid) {
          t.set(db.collection('trial_negado').doc(uid), {
            motivo: 'email_reutilizado', uidAnterior: antes.uid,
            em: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
          // Estava no provisorio: ele termina na data dele, sem virar 30 dias.
          if (aProv) {
            t.set(ref, { provisorio: admin.firestore.FieldValue.delete(), negadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          }
          return { negado: 'email_reutilizado' };
        }
      }

      // ---- SEM CONFIRMAR: teste provisorio de 7 dias ----
      if (!verificado) {
        if (p.exists) {
          const antesP = p.data() || {};
          // Outra conta ja levou o provisorio com este e-mail (conta apagada e
          // criada de novo): sem segundo provisorio. Confirmando, leva os 30.
          if (antesP.uid && antesP.uid !== uid) return { pendenteVerificacao: true, motivo: 'provisorio_usado' };
        }
        t.set(ref, {
          plano: 'pro',
          periodo: 'trial',
          ativo: true,
          origem: 'trial',
          provisorio: true,
          inicioTeste: admin.firestore.Timestamp.fromMillis(agora),
          vence_em: admin.firestore.Timestamp.fromMillis(agora + DIAS_PROVISORIO * DIA_MS),
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        });
        // NUNCA APAGAR (mesmo motivo do trials_usados).
        t.set(refProv, { uid, em: admin.firestore.FieldValue.serverTimestamp(), dominio }, { merge: true });
        return { trial: true, provisorio: true, dias: DIAS_PROVISORIO };
      }

      // ---- CONFIRMADO: 30 dias (contados do inicio do provisorio, se houve) ----
      const d = aProv ? (a.data() || {}) : {};
      let inicioMs = 0;
      if (aProv) inicioMs = msDe(d.inicioTeste) || (msDe(d.vence_em) ? msDe(d.vence_em) - DIAS_PROVISORIO * DIA_MS : 0);
      const venceMs = venceConfirmado(inicioMs, agora);
      const dados = {
        plano: 'pro',
        periodo: 'trial',
        ativo: true,
        origem: 'trial',
        inicioTeste: admin.firestore.Timestamp.fromMillis(inicioMs || agora),
        vence_em: admin.firestore.Timestamp.fromMillis(venceMs),
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (aProv) {
        // merge: guarda o que o provisorio ja tinha (lembretes, por exemplo).
        dados.provisorio = admin.firestore.FieldValue.delete();
        dados.confirmadoEm = admin.firestore.FieldValue.serverTimestamp();
        t.set(ref, dados, { merge: true });
      } else {
        // Sem provisorio: substitui a pendencia do criar-assinatura, como antes.
        t.set(ref, dados);
      }

      // NUNCA APAGAR. Este documento e a memoria do teste gratis: se ele
      // sumir junto com a conta, o ciclo de contas novas volta a funcionar.
      t.set(refUso, {
        uid,
        em: admin.firestore.FieldValue.serverTimestamp(),
        dominio
      }, { merge: true });

      return { trial: true, confirmado: aProv };
    });

    return res.status(200).json(Object.assign({ ok: true }, saida));
  } catch (e) {
    return res.status(500).json({ erro: e.message || 'Erro ao ativar trial' });
  }
};

module.exports._t = { venceConfirmado, normalizarEmail, DIAS_PROVISORIO, DIAS_TRIAL };
