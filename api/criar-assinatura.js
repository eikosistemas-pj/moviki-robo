// POST /api/criar-assinatura
// Chamado pelo painel quando o lojista escolhe um plano.
// Cria (ou reaproveita) o cliente no Asaas, cria a assinatura recorrente e
// devolve o link da primeira cobranca pro lojista pagar (Pix, cartao ou boleto).

const { admin, db } = require('../lib/firebase');
const { asaas, PLANOS } = require('../lib/asaas');

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
    const { plano, periodo, cpfCnpj, nome } = req.body || {};
    if (!PLANOS[plano] || !PLANOS[plano][periodo]) {
      return res.status(400).json({ erro: 'Plano ou periodo invalido.' });
    }
    if (!cpfCnpj) return res.status(400).json({ erro: 'CPF ou CNPJ e obrigatorio.' });
    const docNum = String(cpfCnpj).replace(/\D/g, '');
    if (docNum.length !== 11 && docNum.length !== 14) {
      return res.status(400).json({ erro: 'CPF ou CNPJ invalido.' });
    }
    const nomeSeguro = nome ? String(nome).slice(0, 120) : undefined;
    const cfg = PLANOS[plano][periodo];

    // 3) Cliente no Asaas: reaproveita se ja existe (guardado em faturamento/{uid},
    //    colecao privada que so o robo acessa), senao cria e guarda.
    const fatRef = db.collection('faturamento').doc(uid);
    const fatSnap = await fatRef.get();
    let asaasCustomerId = fatSnap.exists ? fatSnap.data().asaasCustomerId : null;

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
    const hoje = new Date().toISOString().slice(0, 10);
    const assin = await asaas('/subscriptions', 'POST', {
      customer: asaasCustomerId,
      billingType: 'UNDEFINED', // deixa o lojista escolher Pix, cartao ou boleto
      value: cfg.value,
      nextDueDate: hoje,
      cycle: cfg.cycle,
      description: 'Moviki ' + plano.toUpperCase() + ' (' + periodo + ')',
      externalReference: uid,
    });
    await fatRef.set({ asaasSubscriptionId: assin.id }, { merge: true });

    // 5) Marca no banco como PENDENTE (ativo:false). O webhook liga quando pagar.
    //    assinaturas/{uid} e a colecao publica que o app le pra liberar recursos —
    //    guarda so o essencial, sem ids internos.
    await db.collection('assinaturas').doc(uid).set({
      plano,
      periodo,
      ativo: false,
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // 6) Busca o link da primeira cobranca (o Asaas cria a cobranca logo apos a
    //    assinatura, entao tentamos algumas vezes).
    let invoiceUrl = null;
    for (let i = 0; i < 3 && !invoiceUrl; i++) {
      const pays = await asaas('/subscriptions/' + assin.id + '/payments', 'GET');
      if (pays.data && pays.data[0]) invoiceUrl = pays.data[0].invoiceUrl;
      else await new Promise((r) => setTimeout(r, 1500));
    }

    return res.status(200).json({ ok: true, invoiceUrl, subscriptionId: assin.id });
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
