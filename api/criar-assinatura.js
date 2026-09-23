// versao 2026-09-23-assinatura (teste gratis pode assinar; sem assinatura duplicada no Asaas)
// POST /api/criar-assinatura
// Chamado pelo painel quando o lojista escolhe um plano.
// Cria (ou reaproveita) o cliente no Asaas, cria a assinatura recorrente e
// devolve o link da primeira cobranca pro lojista pagar (Pix, cartao ou boleto).

const { admin, db } = require('../lib/firebase');
const { asaas, PLANOS } = require('../lib/asaas');

/* Cancela no Asaas a assinatura anterior do mesmo lojista (a que ficou
   abandonada ou vencida). So cancela se ela ainda estiver viva. Nunca derruba
   a assinatura nova: se falhar, avisa o Paulo no Telegram para cancelar a mao
   — o webhook ja ignora os avisos dela, entao o risco que sobra e so o de
   cobranca em dobro se o cliente pagar as duas. */
async function cancelarAnterior(subId, uid) {
  try {
    let viva = true;
    try {
      const s = await asaas('/subscriptions/' + encodeURIComponent(subId), 'GET');
      if (!s || s.deleted === true || String(s.status || '').toUpperCase() !== 'ACTIVE') viva = false;
    } catch (e) {
      if (e && e.status === 404) viva = false; else throw e;
    }
    if (viva) await asaas('/subscriptions/' + encodeURIComponent(subId), 'DELETE');
    await db.collection('faturamento').doc(uid).set({
      assinaturasCanceladas: admin.firestore.FieldValue.arrayUnion(subId),
    }, { merge: true });
  } catch (e) {
    console.error('criar-assinatura: nao cancelou a anterior', subId, (e && e.message) || e);
    await avisarDono(
      '⚠️ Assinatura antiga NAO foi cancelada no Asaas\n\n' +
      'Lojista (uid): ' + uid + '\n' +
      'Assinatura antiga: ' + subId + '\n\n' +
      'O lojista gerou uma cobranca nova. Cancele a antiga no painel do Asaas para ele nao ser cobrado duas vezes.'
    );
  }
}

async function avisarDono(texto) {
  const TOKEN = process.env.TELEGRAM_TOKEN;
  const CHAT = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT) return;
  try {
    await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text: texto, disable_web_page_preview: true }),
    });
  } catch (_) {}
}

module.exports = async (req, res) => {
  // O painel chama isso do navegador. Liberamos AS DUAS origens da empresa
  // (site e app) durante e depois da migração pro subdomínio. Só ecoa de volta
  // quando a origem está na lista — nunca '*', pra não abrir pra qualquer site.
  const ORIGENS_PERMITIDAS = ['https://moviki.com.br', 'https://app.moviki.com.br'];
  const origem = req.headers.origin;
  if (ORIGENS_PERMITIDAS.includes(origem)) res.setHeader('Access-Control-Allow-Origin', origem);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Metodo nao permitido' });

  try {
    // 1) Confirma QUEM e o lojista pelo token do Firebase (nao confia em id solto).
    const authz = req.headers.authorization || '';
    const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : null;
    if (!idToken) return res.status(401).json({ erro: 'Faca login para assinar.' });
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email || (req.body && req.body.email) || undefined;

    // 2) Valida plano/periodo/CPF.
    const { plano, periodo, cpfCnpj, nome, gaClientId, gaSessionId } = req.body || {};
    if (!PLANOS[plano] || !PLANOS[plano][periodo]) {
      return res.status(400).json({ erro: 'Plano ou periodo invalido.' });
    }
    if (!cpfCnpj) return res.status(400).json({ erro: 'CPF ou CNPJ e obrigatorio.' });
    const docNum = String(cpfCnpj).replace(/\D/g, '');
    if (docNum.length !== 11 && docNum.length !== 14) {
      return res.status(400).json({ erro: 'CPF ou CNPJ invalido.' });
    }
    /* TRAVA "JA ATIVO" + TESTE GRATIS — revisao 23/09/2026 (2026-09-23-assinatura)

       O DEFEITO: o teste gratis grava assinaturas/{uid} com ativo:true ate o
       fim dos 30 dias. Esta trava via "ativo" e respondia 409 ("voce ja tem
       um plano ativo, ele renova sozinho") — o lojista em teste, que e o
       cliente mais quente que existe, NAO CONSEGUIA PAGAR. O banner "Assinar
       agora" e os e-mails de fim do teste levavam para esse beco sem saida.

       AGORA:
         - plano PAGO vigente  -> continua 409 (evita cobranca em dobro);
         - TESTE GRATIS vigente -> deixa assinar. A 1a cobranca vence no
           ULTIMO dia do teste (ninguem paga antes de o teste acabar, e quem
           paga antes nao perde os dias que faltam — o webhook soma a partir
           do fim do teste). O documento do teste NAO e tocado aqui: o acesso
           continua ate o pagamento ligar o plano escolhido.
       Falha FECHADA: se a leitura falhar, o erro sobe (antes um catch vazio
       engolia o erro e o robo criava a cobranca mesmo assim). */
    const jaSnap = await db.collection('assinaturas').doc(uid).get();
    const ja = jaSnap.exists ? (jaSnap.data() || {}) : null;
    const jaVenceMs = (ja && ja.vence_em && typeof ja.vence_em.toMillis === 'function') ? ja.vence_em.toMillis() : 0;
    const vigente = !!(ja && ja.ativo === true && (!ja.vence_em || jaVenceMs > Date.now()));
    const emTeste = vigente && ja.periodo === 'trial';
    if (vigente && !emTeste) {
      return res.status(409).json({ erro: 'Voce ja tem um plano ativo — ele renova sozinho. Para trocar de plano, fale com a gente.', motivo: 'ja_ativo' });
    }

    const nomeSeguro = nome ? String(nome).slice(0, 120) : undefined;
    const cfg = PLANOS[plano][periodo];

    // 3) Cliente no Asaas: reaproveita se ja existe (guardado em faturamento/{uid},
    //    colecao privada que so o robo acessa), senao cria e guarda.
    const fatRef = db.collection('faturamento').doc(uid);
    const fatSnap = await fatRef.get();
    let asaasCustomerId = fatSnap.exists ? fatSnap.data().asaasCustomerId : null;

    // Se ja havia um cliente salvo, confirma que ele AINDA existe no Asaas.
    // Um cliente apagado ou de outro ambiente deixaria a assinatura falhar com
    // "Cliente invalido". Se ele sumiu (404), zeramos pra recriar com o CPF atual.
    if (asaasCustomerId) {
      try {
        await asaas('/customers/' + asaasCustomerId, 'GET');
      } catch (e) {
        if (e.status === 404) asaasCustomerId = null;
        else throw e;
      }
    }

    if (!asaasCustomerId) {
      const cli = await asaas('/customers', 'POST', {
        name: nomeSeguro || email || ('Lojista ' + uid.slice(0, 6)),
        cpfCnpj: docNum,
        email,
      });
      asaasCustomerId = cli.id;
      await fatRef.set({ asaasCustomerId, atualizadoEm: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }

    // 4) Cria a assinatura recorrente. externalReference = uid liga tudo de volta
    //    quando o webhook chegar.
    //
    // ASSINATURA DUPLICADA — revisao 23/09/2026 (2026-09-23-assinatura).
    // Antes, cada clique em "Confirmar" criava uma assinatura NOVA no Asaas e a
    // anterior ficava viva: a cobranca abandonada vencia e o aviso de atraso
    // DESLIGAVA quem tinha pago a outra; e o plano liberado era o ultimo
    // escolhido, nao o pago (gerar Pro, clicar em Premium anual e pagar os
    // R$ 39,90 do Pro dava Premium por um ano). Agora:
    //   a) cria a nova e grava ela como a ATUAL em faturamento/{uid};
    //   b) guarda o plano/periodo de CADA assinatura em
    //      faturamento/{uid}.assinaturasAsaas.{id} — o webhook libera o plano
    //      da assinatura que foi PAGA, nao o do ultimo clique;
    //   c) SO DEPOIS cancela a anterior. Nessa ordem, o "cobranca removida"
    //      que o Asaas manda ao cancelar a velha ja chega com a nova gravada
    //      como atual, e o webhook ignora evento de assinatura que nao e a
    //      atual. Se o cancelamento falhar, o Paulo e avisado no Telegram.
    const anteriorId = fatSnap.exists ? String(fatSnap.data().asaasSubscriptionId || '') : '';
    const hoje = new Date().toISOString().slice(0, 10);
    let primeiraCobranca = hoje;
    if (emTeste && jaVenceMs > Date.now()) {
      // Data do fim do teste no fuso de Brasilia (AAAA-MM-DD).
      const fim = new Date(jaVenceMs - 3 * 3600000).toISOString().slice(0, 10);
      if (fim > hoje) primeiraCobranca = fim;
    }
    const assin = await asaas('/subscriptions', 'POST', {
      customer: asaasCustomerId,
      billingType: 'UNDEFINED', // deixa o lojista escolher Pix, cartao ou boleto
      value: cfg.value,
      nextDueDate: primeiraCobranca,
      cycle: cfg.cycle,
      description: 'Moviki ' + plano.toUpperCase() + ' (' + periodo + ')',
      externalReference: uid,
    });
    await fatRef.set({
      asaasSubscriptionId: assin.id,
      assinaturasAsaas: {
        [assin.id]: {
          plano, periodo, valor: cfg.value,
          emTeste: !!emTeste,
          criadaEm: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
    }, { merge: true });

    if (anteriorId && anteriorId !== assin.id) {
      await cancelarAnterior(anteriorId, uid);
    }

    // GA4: guarda os ids da sessao do navegador (mandados pelo painel) pra
    // amarrar a venda quando o pagamento confirmar no webhook. Best-effort:
    // nunca derruba a assinatura.
    try {
      const gaCid = gaClientId ? String(gaClientId).slice(0, 64) : '';
      const gaSid = gaSessionId ? String(gaSessionId).slice(0, 40) : '';
      if (gaCid || gaSid) await fatRef.set({ gaClientId: gaCid, gaSessionId: gaSid }, { merge: true });
    } catch (_) {}

    // 5) Marca no banco como PENDENTE (ativo:false). O webhook liga quando pagar.
    //    assinaturas/{uid} e a colecao publica que o app le pra liberar recursos —
    //    guarda so o essencial, sem ids internos.
    //    EM TESTE GRATIS nao mexe: gravar ativo:false aqui cortaria o teste no
    //    meio. Quem liga o plano escolhido e o webhook, quando o pagamento entrar.
    if (!emTeste) {
      await db.collection('assinaturas').doc(uid).set({
        plano,
        periodo,
        ativo: false,
        atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    // 6) Busca o link da primeira cobranca (o Asaas cria a cobranca logo apos a
    //    assinatura, entao tentamos algumas vezes).
    let invoiceUrl = null;
    for (let i = 0; i < 3 && !invoiceUrl; i++) {
      const pays = await asaas('/subscriptions/' + assin.id + '/payments', 'GET');
      if (pays.data && pays.data[0]) invoiceUrl = pays.data[0].invoiceUrl;
      else await new Promise((r) => setTimeout(r, 1500));
    }

    return res.status(200).json({ ok: true, invoiceUrl, subscriptionId: assin.id, primeiraCobranca, emTeste: !!emTeste });
  } catch (e) {
    console.error('criar-assinatura erro:', e);
    // Erros de validacao vindos do Asaas (4xx) sao seguros de mostrar ("CPF invalido" etc).
    if (e.status && e.status < 500) {
      return res.status(400).json({ erro: e.message || 'Nao foi possivel criar a assinatura.' });
    }
    // Erros internos: mensagem generica pro cliente, detalhe so no log do servidor.
    return res.status(500).json({ erro: 'Erro ao criar a assinatura. Tente de novo em instantes.' });
  }
};
