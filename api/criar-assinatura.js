// versao 2026-10-22-cancelar (nova assinatura apaga a marca de renovacao cancelada pelo painel)
// anterior: 2026-10-01-fundador (Lote Fundador: vaga contada no servidor, cobranca no ato, 12x no cartao por cobranca parcelada)
// anterior: 2026-09-25-email (so assina com e-mail confirmado; teste gratis pode assinar; sem assinatura duplicada; trava de clique duplo)
// POST /api/criar-assinatura
// Chamado pelo painel quando o lojista escolhe um plano.
// Cria (ou reaproveita) o cliente no Asaas, cria a assinatura recorrente e
// devolve o link da primeira cobranca pro lojista pagar (Pix, cartao ou boleto).

const { admin, db } = require('../lib/firebase');
const { asaas, PLANOS, FUNDADOR } = require('../lib/asaas');

/* ===========================================================================
   LOTE FUNDADOR — 01/10/2026
   Vagas contadas AQUI, no servidor, num documento so (oferta_fundador/estado,
   colecao na raiz sem regra = so o robo). A vaga e RESERVADA quando a cobranca
   nasce (FUNDADOR.reservaDias) e vira VENDIDA quando o webhook confirma o
   pagamento. Reserva vencida sem pagamento volta sozinha para a conta.
   O mesmo lojista clicando de novo reaproveita a propria vaga. A pagina
   /fundador e o painel leem o placar pelo GET deste mesmo endereco (sem
   login, so numeros: vagas, restam, prazo) e mostram "restam N": numero na
   tela e numero contado.
=========================================================================== */
const ESTADO_FUNDADOR = () => db.collection('oferta_fundador').doc('estado');

function vagasOcupadas(itens, agora) {
  let n = 0;
  Object.keys(itens || {}).forEach((k) => {
    const it = itens[k] || {};
    if (it.pago === true || Number(it.expiraMs || 0) > agora) n++;
  });
  return n;
}

async function reservarVagaFundador(uid, periodo) {
  const agora = Date.now();
  const vagas = Number(FUNDADOR.vagas) || 0;
  return db.runTransaction(async (tx) => {
    const ref = ESTADO_FUNDADOR();
    const s = await tx.get(ref);
    const d = s.exists ? (s.data() || {}) : {};
    const itens = d.itens || {};
    const meu = itens[uid];
    if (meu && meu.pago === true) { const e = new Error('ja_fundador'); e.code = 'ja_fundador'; throw e; }
    const jaTenho = !!(meu && Number(meu.expiraMs || 0) > agora);
    if (!jaTenho && vagasOcupadas(itens, agora) >= vagas) {
      const e = new Error('esgotado'); e.code = 'esgotado'; throw e;
    }
    tx.set(ref, {
      vagas: vagas,
      encerraEm: FUNDADOR.encerraEm,
      itens: { [uid]: { expiraMs: agora + FUNDADOR.reservaDias * 86400000, pago: false, periodo: periodo, reservadoEm: agora } },
      atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  });
}

async function liberarVagaFundador(uid) {
  try {
    await db.runTransaction(async (tx) => {
      const ref = ESTADO_FUNDADOR();
      const s = await tx.get(ref);
      const it = s.exists ? ((s.data() || {}).itens || {})[uid] : null;
      if (it && it.pago !== true) tx.set(ref, { itens: { [uid]: { expiraMs: 0, pago: false } } }, { merge: true });
    });
  } catch (e) { console.error('criar-assinatura: nao liberei a vaga do fundador', uid, (e && e.message) || e); }
}

/* Cancela no Asaas a assinatura anterior do mesmo lojista (a que ficou
   abandonada ou vencida). So cancela se ela ainda estiver viva. Nunca derruba
   a assinatura nova: se falhar, avisa o Paulo no Telegram para cancelar a mao
   — o webhook ja ignora os avisos dela, entao o risco que sobra e so o de
   cobranca em dobro se o cliente pagar as duas. */
/* 01/10/2026 — cobranca parcelada (12x) gerada e NAO paga e cancelada quando
   o lojista gera outra cobranca: o link antigo deixa de aceitar pagamento e a
   parcela vencida dele nunca derruba o plano novo. Parcelamento que ja ligou
   o plano nunca e tocado (nao chega aqui: o lojista pagante recebe ja_ativo). */
async function cancelarParcelamentoPendente(fat, uid) {
  const inst = String((fat && fat.asaasParcelamentoAtual) || '');
  if (!inst) return;
  const reg = ((fat && fat.parcelamentosAsaas) || {})[inst] || {};
  if (reg.ligadoEm) return;
  try {
    try { await asaas('/installments/' + encodeURIComponent(inst), 'DELETE'); }
    catch (e) { if (!(e && e.status === 404)) throw e; }
    await db.collection('faturamento').doc(uid).set({
      parcelamentosCancelados: admin.firestore.FieldValue.arrayUnion(inst),
    }, { merge: true });
  } catch (e) {
    console.error('criar-assinatura: nao cancelou o parcelamento', inst, (e && e.message) || e);
    await avisarDono(
      '⚠️ Parcelamento antigo NAO foi cancelado no Asaas\n\n' +
      'Lojista (uid): ' + uid + '\n' +
      'Parcelamento: ' + inst + '\n\n' +
      'O lojista gerou uma cobranca nova. Cancele o parcelamento antigo no Asaas para ele nao pagar duas vezes.'
    );
  }
}

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

/* Placar publico do Lote Fundador (01/10/2026). So numeros, nenhum uid.
   Cache de 60 s na borda: a pagina pode ter pico sem virar leitura no banco. */
async function placarFundador(res) {
  const vagas = Number(FUNDADOR.vagas) || 0;
  const encerraMs = Date.parse(FUNDADOR.encerraEm);
  let ocupadas = 0;
  try {
    const snap = await ESTADO_FUNDADOR().get();
    ocupadas = snap.exists ? vagasOcupadas((snap.data() || {}).itens, Date.now()) : 0;
  } catch (e) {
    console.error('placar fundador:', (e && e.message) || e);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ erro: 'indisponivel' });
  }
  const restam = Math.max(0, vagas - ocupadas);
  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=120');
  return res.status(200).json({
    vagas, restam, encerraEm: FUNDADOR.encerraEm,
    aberto: restam > 0 && Date.now() <= encerraMs,
    avista: PLANOS.enterprise.fundador.value, parcelas: PLANOS.enterprise.fundador12x.parcelas,
    parcela: PLANOS.enterprise.fundador12x.value, mensal: PLANOS.enterprise.mensal.value,
  });
}

module.exports = async function criarAssinatura(req, res) {
  // O painel chama isso do navegador. Liberamos AS DUAS origens da empresa
  // (site e app) durante e depois da migração pro subdomínio. Só ecoa de volta
  // quando a origem está na lista — nunca '*', pra não abrir pra qualquer site.
  const ORIGENS_PERMITIDAS = ['https://moviki.com.br', 'https://www.moviki.com.br', 'https://app.moviki.com.br'];
  const origem = req.headers.origin;
  if (ORIGENS_PERMITIDAS.includes(origem)) res.setHeader('Access-Control-Allow-Origin', origem);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') return placarFundador(res);
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Metodo nao permitido' });

  try {
    // 1) Confirma QUEM e o lojista pelo token do Firebase (nao confia em id solto).
    const authz = req.headers.authorization || '';
    const idToken = authz.startsWith('Bearer ') ? authz.slice(7) : null;
    if (!idToken) return res.status(401).json({ erro: 'Faca login para assinar.' });
    /* 06/10 (plano 2.3): checkRevoked=true. Sessao cancelada (senha trocada, conta desativada pela Guarda, revogada no console) e recusada na hora, em vez de valer ate 1 h. Custa 1 leitura do Auth por chamada; so nas portas de dinheiro e de dono. */
    const decoded = await admin.auth().verifyIdToken(idToken, true);
    const uid = decoded.uid;
    const email = decoded.email || (req.body && req.body.email) || undefined;

    /* 25/09/2026 (A2): so assina quem ja confirmou o e-mail. Antes, quem
       clicava em Assinar antes de confirmar ganhava uma cobranca vencendo HOJE
       e, ao confirmar, o teste gratis entrava por cima: pagava a mensalidade e
       o ciclo do Asaas nao acompanhava o teste (duas cobrancas em ~1 mes).
       Confirmado o e-mail, o teste entra primeiro e a 1a cobranca vence no fim
       dele. O token pode estar velho (confirmou em outra aba): confere no Auth. */
    let emailOk = decoded.email_verified === true;
    if (!emailOk) {
      try { emailOk = !!(await admin.auth().getUser(uid)).emailVerified; } catch (_) {}
    }
    if (!emailOk) {
      return res.status(403).json({
        erro: 'Confirme o seu e-mail antes de assinar: toque no link que enviamos. Assim você ganha os 30 dias grátis e a 1ª cobrança só vence no fim do teste.',
        motivo: 'email_nao_confirmado',
      });
    }

    // 2) Valida plano/periodo/CPF.
    const { plano, periodo, cpfCnpj, nome, gaClientId, gaSessionId } = req.body || {};
    if (!PLANOS[plano] || !PLANOS[plano][periodo]) {
      return res.status(400).json({ erro: 'Plano ou periodo invalido.' });
    }
    const cfg0 = PLANOS[plano][periodo];
    /* Lote Fundador: prazo para GERAR a cobranca. Depois dele, o periodo deixa de
       existir para quem ainda nao gerou (a pagina e o painel ja escondem). */
    if (cfg0.fundador && Date.now() > Date.parse(FUNDADOR.encerraEm)) {
      return res.status(410).json({ erro: 'O Lote Fundador encerrou. Os outros planos continuam disponíveis.', motivo: 'fundador_encerrado' });
    }
    if (!cpfCnpj) return res.status(400).json({ erro: 'CPF ou CNPJ e obrigatorio.' });
    const docNum = String(cpfCnpj).replace(/\D/g, '');
    if (docNum.length !== 11 && docNum.length !== 14) {
      return res.status(400).json({ erro: 'CPF ou CNPJ invalido.' });
    }
    /* NOTA FISCAL — 22/10/2026. A NFS-e sai no CPF/CNPJ e no endereco do cliente
       no Asaas. Antes: (a) qualquer sequencia de 11/14 digitos passava (a nota
       sairia em nome de terceiro); (b) o cliente nascia sem endereco e o Asaas
       recusa emitir nota sem CEP; (c) cliente ja existente nunca era atualizado.
       Agora: digito verificador conferido, CEP + numero gravados no cliente e
       cliente existente atualizado com o que a pessoa digitou agora. Painel
       antigo sem CEP continua assinando (a nota falha e avisa no Telegram). */
    const _dv = require('../lib/pix')._t;
    if ((docNum.length === 11 && !_dv.cpfValido(docNum)) || (docNum.length === 14 && !_dv.cnpjValido(docNum))) {
      return res.status(400).json({ erro: 'Confira o CPF ou CNPJ: os números não batem.', motivo: 'doc_invalido' });
    }
    const cepNum = String((req.body && req.body.cep) || '').replace(/\D/g, '');
    const numEnd = String((req.body && req.body.numero) || '').trim().slice(0, 10);
    if (cepNum && cepNum.length !== 8) return res.status(400).json({ erro: 'CEP inválido.', motivo: 'cep_invalido' });
    const endCli = cepNum ? { postalCode: cepNum, addressNumber: numEnd || 'S/N' } : {};
    /* Nome que sai na nota (nome completo do CPF ou razao social do CNPJ).
       Antes ia o nome do NEGOCIO (fantasia) junto com o CPF da pessoa. */
    const nomeNota = String((req.body && req.body.nomeNota) || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (nomeNota && nomeNota.length < 5) return res.status(400).json({ erro: 'Escreva o nome completo ou a razão social.', motivo: 'nome_nota' });
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

    /* TRAVA DE CLIQUE DUPLO — 23/09/2026. Duas chamadas ao mesmo tempo (duas
       abas, o banner e o modal) liam a mesma "assinatura anterior" e criavam
       DUAS assinaturas novas; a que sobrava ficava viva cobrando todo mes.
       Agora so uma geracao por lojista por vez: a segunda recebe 429 e a tela
       pede para aguardar. A trava expira sozinha em 60 s se a funcao morrer. */
    const travaRef = db.collection('faturamento').doc(uid);
    const pegouTrava = await db.runTransaction(async (t) => {
      const ts = await t.get(travaRef);
      const ate = ts.exists ? Number((ts.data() || {}).gerandoAssinaturaAte || 0) : 0;
      if (ate > Date.now()) return false;
      t.set(travaRef, { gerandoAssinaturaAte: Date.now() + 60000 }, { merge: true });
      return true;
    });
    if (!pegouTrava) {
      return res.status(429).json({ erro: 'Ja estamos gerando o seu pagamento. Aguarde alguns segundos e tente de novo.', motivo: 'em_andamento' });
    }
    try {

    const nomeSeguro = nome ? String(nome).slice(0, 120) : undefined;
    const cfg = PLANOS[plano][periodo];

    /* Lote Fundador: reserva a vaga ANTES de qualquer cobranca existir. Sem
       vaga, nenhuma cobranca nasce. */
    let vagaReservada = false;
    if (cfg.fundador) {
      try { await reservarVagaFundador(uid, periodo); vagaReservada = true; }
      catch (e) {
        if (e.code === 'esgotado') return res.status(409).json({ erro: 'As vagas do Lote Fundador acabaram. Os outros planos continuam disponíveis.', motivo: 'fundador_esgotado' });
        if (e.code === 'ja_fundador') return res.status(409).json({ erro: 'Você já garantiu o seu Lote Fundador.', motivo: 'ja_fundador' });
        throw e;
      }
    }
    try {

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
    if (asaasCustomerId) {
      try {
        await asaas('/customers/' + asaasCustomerId, 'PUT', Object.assign({ cpfCnpj: docNum }, nomeNota ? { name: nomeNota } : (nome ? { name: String(nome).slice(0, 120) } : {}), endCli));
      } catch (e) { console.error('[criar-assinatura] atualizar cliente', e && e.message); }
    }

    if (!asaasCustomerId) {
      const cli = await asaas('/customers', 'POST', {
        name: nomeNota || nomeSeguro || email || ('Lojista ' + uid.slice(0, 6)),
        cpfCnpj: docNum,
        email,
        ...endCli,
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
    const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
    let primeiraCobranca = hoje;
    /* Lote Fundador: a cobranca vence HOJE, mesmo no teste gratis (o dinheiro
       entra agora); o webhook faz os 12 meses comecarem no fim do teste. */
    if (emTeste && jaVenceMs > Date.now() && !cfg.fundador) {
      // Data do fim do teste no fuso de Brasilia (AAAA-MM-DD).
      const fim = new Date(jaVenceMs - 3 * 3600000).toISOString().slice(0, 10);
      if (fim > hoje) primeiraCobranca = fim;
    }
    /* LOTE FUNDADOR EM 12x NO CARTAO. Assinatura do Asaas nao parcela: aqui
       nasce uma COBRANCA PARCELADA (12 parcelas no cartao, o cartao e digitado
       na pagina do Asaas — nunca passa pelo Moviki). O webhook reconhece as
       parcelas por faturamento/{uid}.parcelamentosAsaas.{installment}. Nao ha
       assinatura atual: a anterior (se houver) e cancelada e o campo sai, para
       um aviso dela nunca derrubar o plano pago em parcelas. */
    if (cfg.parcelado) {
      const pag = await asaas('/payments', 'POST', {
        customer: asaasCustomerId,
        billingType: 'CREDIT_CARD',
        installmentCount: cfg.parcelas,
        installmentValue: cfg.value,
        dueDate: hoje,
        description: 'Moviki ENTERPRISE - Lote Fundador (' + cfg.parcelas + 'x de R$ ' + cfg.value.toFixed(2).replace('.', ',') + ')',
        externalReference: uid,
      });
      const inst = String((pag && pag.installment) || '');
      if (!inst) throw new Error('Asaas nao devolveu o parcelamento');
      await fatRef.set({
        asaasSubscriptionId: admin.firestore.FieldValue.delete(),
        asaasParcelamentoAtual: inst,
        parcelamentosAsaas: {
          [inst]: {
            plano, periodo, valor: cfg.total, parcelas: cfg.parcelas, valorParcela: cfg.value,
            primeiroVencimento: hoje, emTeste: !!emTeste,
            criadaEm: admin.firestore.FieldValue.serverTimestamp(),
          },
        },
      }, { merge: true });
      if (anteriorId) await cancelarAnterior(anteriorId, uid);
      if (fatSnap.exists && String(fatSnap.data().asaasParcelamentoAtual || '') !== inst) await cancelarParcelamentoPendente(fatSnap.data(), uid);
      try { await db.collection('assinaturas').doc(uid).set({ renovacaoCancelada: admin.firestore.FieldValue.delete(), cancelamentoProtocolo: admin.firestore.FieldValue.delete(), desistenciaProtocolo: admin.firestore.FieldValue.delete() }, { merge: true }); } catch (_) {}
      try {
        const gaCid = gaClientId ? String(gaClientId).slice(0, 64) : '';
        const gaSid = gaSessionId ? String(gaSessionId).slice(0, 40) : '';
        if (gaCid || gaSid) await fatRef.set({ gaClientId: gaCid, gaSessionId: gaSid }, { merge: true });
      } catch (_) {}
      if (!emTeste) {
        await db.collection('assinaturas').doc(uid).set({
          plano, periodo, ativo: false,
          atualizadoEm: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      return res.status(200).json({ ok: true, invoiceUrl: pag.invoiceUrl || null, parcelamentoId: inst, primeiraCobranca: hoje, emTeste: !!emTeste, fundador: true });
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
      asaasParcelamentoAtual: admin.firestore.FieldValue.delete(),
      assinaturasAsaas: {
        [assin.id]: {
          plano, periodo, valor: cfg.value,
          emTeste: !!emTeste,
          fundador: !!cfg.fundador,
          criadaEm: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
    }, { merge: true });

    if (anteriorId && anteriorId !== assin.id) {
      await cancelarAnterior(anteriorId, uid);
    }
    /* 22/10/2026: assinou de novo depois de cancelar pelo painel -> a marca de
       renovacao cancelada sai (a tela volta a dizer "renova automaticamente"). */
    try { await db.collection('assinaturas').doc(uid).set({ renovacaoCancelada: admin.firestore.FieldValue.delete(), cancelamentoProtocolo: admin.firestore.FieldValue.delete(), desistenciaProtocolo: admin.firestore.FieldValue.delete() }, { merge: true }); } catch (_) {}
    if (fatSnap.exists) await cancelarParcelamentoPendente(fatSnap.data(), uid);

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

    return res.status(200).json({ ok: true, invoiceUrl, subscriptionId: assin.id, primeiraCobranca, emTeste: !!emTeste, fundador: !!cfg.fundador });
    } catch (eCriar) {
      /* A cobranca nao nasceu: a vaga reservada volta na hora. */
      if (vagaReservada) await liberarVagaFundador(uid);
      throw eCriar;
    }
    } finally {
      try { await travaRef.set({ gerandoAssinaturaAte: 0 }, { merge: true }); } catch (_) {}
    }
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

module.exports.reservarVagaFundador = reservarVagaFundador;
module.exports.liberarVagaFundador = liberarVagaFundador;
module.exports.vagasOcupadas = vagasOcupadas;
