// api/pagar-saque.js  (repo: moviki-robo)
// Paga comissão de parceiro por Pix. Só ADMIN (documento em /admins/{uid}) —
// a permissão é conferida AQUI no servidor, não dá para burlar pelo app.
//
// Dois caminhos de entrada:
//   • saqueId    -> paga um PEDIDO DE SAQUE que o parceiro fez.
//   • parceiroUid-> paga DIRETO pela linha do parceiro na tabela de comissões,
//                   sem ele ter pedido nada. O robô abre o registro do saque
//                   sozinho (origem: 'dono') para o histórico não ficar furado.
//
// Três etapas:
//   'conferir' -> descobre o tipo da chave Pix, consulta no Asaas de quem ela é
//                 e devolve o titular + o valor, para o dono conferir ANTES de
//                 mandar o dinheiro. Não grava nada.
//   'pagar'    -> manda o Pix pelo Asaas (POST /transfers), quita as comissões
//                 e fecha o saque.
//   'manual'   -> o dono pagou pelo banco na mão; aqui só registra.
//   'teste'    -> cria UMA comissão de mentira (até R$ 10) para ensaiar o Pix.
//
// Tudo mora neste mesmo arquivo de propósito: o plano gratuito da Vercel
// aceita no máximo 12 arquivos na pasta api, então não dá para abrir um
// endereço novo a cada função.
//
// Trava: acima de TETO_SAQUE_AUTOMATICO o robô se recusa a mandar sozinho.

const { admin, db } = require('../lib/firebase');
const { asaas } = require('../lib/asaas');

const ORIGIN_OK = 'https://app.moviki.com.br';

// Valor máximo que o robô manda sozinho, por pagamento. Acima disso, só manual.
const TETO_SAQUE_AUTOMATICO = 500;

// Quanto tempo um pagamento em curso segura o saque (evita clique duplo).
const TRAVA_MS = 3 * 60 * 1000;

// Valor máximo de uma comissão de TESTE (etapa 'teste').
const VALOR_MAX_TESTE = 10;

/* ---------------------------------------------------------------
   Chave Pix: descobrir o tipo a partir do que o parceiro digitou.
   Devolve uma LISTA de tentativas (mais provável primeiro), porque
   CPF e celular têm os mesmos 11 dígitos — quem desempata é a
   consulta no Asaas.
   --------------------------------------------------------------- */
function cpfValido(c) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(c[i]) * (10 - i);
  let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0;
  if (d1 !== Number(c[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += Number(c[i]) * (11 - i);
  let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0;
  return d2 === Number(c[10]);
}

function candidatosChavePix(bruto) {
  const t = String(bruto || '').trim();
  if (!t) return [];
  if (t.indexOf('@') > -1 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) {
    return [{ tipo: 'EMAIL', chave: t.toLowerCase() }];
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) {
    return [{ tipo: 'EVP', chave: t.toLowerCase() }];
  }
  let d = t.replace(/\D/g, '');
  if (d.length === 13 && d.slice(0, 2) === '55') d = d.slice(2);
  if (d.length === 12 && d.slice(0, 2) === '55') d = d.slice(2);
  if (d.length === 14) return [{ tipo: 'CNPJ', chave: d }];
  if (d.length === 10) return [{ tipo: 'PHONE', chave: d }];
  if (d.length === 11) {
    const pareceCelular = /^[1-9][1-9]9\d{8}$/.test(d);
    const cpfOk = cpfValido(d);
    if (cpfOk && !pareceCelular) return [{ tipo: 'CPF', chave: d }, { tipo: 'PHONE', chave: d }];
    if (pareceCelular && !cpfOk) return [{ tipo: 'PHONE', chave: d }, { tipo: 'CPF', chave: d }];
    if (cpfOk) return [{ tipo: 'CPF', chave: d }, { tipo: 'PHONE', chave: d }];
    return [{ tipo: 'PHONE', chave: d }, { tipo: 'CPF', chave: d }];
  }
  return [];
}

/* ---------------------------------------------------------------
   Quais comissões esse pagamento quita: do parceiro, não pagas, não
   estornadas, criadas até a data de corte e já liberadas nessa data.
   (liberaEm ausente = comissão antiga, tratada como já liberada.)
   --------------------------------------------------------------- */
function ms(x) {
  if (!x) return null;
  if (typeof x.toMillis === 'function') return x.toMillis();
  if (typeof x === 'number') return x;
  return null;
}

function selecionarComissoes(docs, corte) {
  const limiteMs = ms(corte);
  const escolhidas = [];
  let valor = 0;
  docs.forEach((d) => {
    const c = typeof d.data === 'function' ? d.data() : d;
    if (c.pago || c.estornada) return;
    const cMs = ms(c.criadoEm);
    if (limiteMs && cMs && cMs > limiteMs) return;
    const libMs = ms(c.liberaEm);
    if (limiteMs && libMs && libMs > limiteMs) return;
    escolhidas.push(d);
    valor += Number(c.valor) || 0;
  });
  return { escolhidas: escolhidas, valor: Math.round(valor * 100) / 100 };
}

async function consultarTitular(cand) {
  const q = '/pix/addressKeys/external?type=' + encodeURIComponent(cand.tipo) +
            '&key=' + encodeURIComponent(cand.chave);
  const r = await asaas(q, 'GET');
  return {
    tipo: cand.tipo,
    chave: cand.chave,
    titular: (r && (r.name || (r.owner && r.owner.name))) || '',
    documento: (r && (r.cpfCnpj || (r.owner && r.owner.cpfCnpj))) || '',
    banco: (r && r.bank && (r.bank.name || r.bank.ispb)) || '',
  };
}

async function resolverChave(pixBruto) {
  const cands = candidatosChavePix(pixBruto);
  if (!cands.length) { const e = new Error('chave_invalida'); e.code = 'chave_invalida'; throw e; }
  let ultimo = null;
  for (let i = 0; i < cands.length; i++) {
    try { return await consultarTitular(cands[i]); }
    catch (err) { ultimo = err; }
  }
  const e = new Error('chave_nao_encontrada');
  e.code = 'chave_nao_encontrada';
  e.detalhe = (ultimo && ultimo.message) || '';
  throw e;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_OK);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ ok: false }); return; }

  const limpar = (v) => String(v || '').replace(/[^a-zA-Z0-9_-]/g, '');

  try {
    const body        = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const idToken     = String(body.idToken || '');
    const saqueId     = limpar(body.saqueId);
    const uidPedido   = limpar(body.parceiroUid);
    const comprovante = String(body.comprovante || '').slice(0, 200);
    const etapa       = ['conferir', 'pagar', 'manual', 'teste'].indexOf(String(body.etapa || '')) > -1
                          ? String(body.etapa) : 'manual';
    if (!idToken || (!saqueId && !uidPedido)) {
      res.status(400).json({ ok: false, erro: 'faltam dados' }); return;
    }

    // 1) Quem está chamando? É admin de verdade?
    let decoded;
    try { decoded = await admin.auth().verifyIdToken(idToken); }
    catch (_) { res.status(401).json({ ok: false, erro: 'sessao invalida' }); return; }
    const adminDoc = await db.collection('admins').doc(decoded.uid).get();
    if (!adminDoc.exists) { res.status(403).json({ ok: false, erro: 'sem permissao' }); return; }

    // ---------- etapa TESTE: cria uma comissão de mentira para ensaiar ----------
    if (etapa === 'teste') {
      const valorTeste = Math.round((Number(body.valor) || 0) * 100) / 100;
      if (!uidPedido) { res.status(400).json({ ok: false, erro: 'faltam dados' }); return; }
      if (!(valorTeste > 0) || valorTeste > VALOR_MAX_TESTE) {
        res.status(422).json({ ok: false, erro: 'valor_invalido',
          mensagem: 'Use um valor entre R$ 0,01 e R$ ' + VALOR_MAX_TESTE + ',00 para o teste.' });
        return;
      }
      const pSnap = await db.collection('parceiros').doc(uidPedido).get();
      if (!pSnap.exists) { res.status(404).json({ ok: false, erro: 'parceiro nao encontrado' }); return; }
      const p = pSnap.data();
      const agora = new Date();
      const competencia = agora.getUTCFullYear() + '-' + String(agora.getUTCMonth() + 1).padStart(2, '0');
      const marca = 'TESTE_' + Date.now();
      // Nasce SEM liberaEm, ou seja, já liberada para saque.
      await db.collection('comissoes').doc(marca + '_n1').create({
        parceiroUid: uidPedido,
        parceiroSlug: p.slug || null,
        lojistaUid: 'TESTE',
        nivel: 1,
        base: valorTeste,
        percentual: 100,
        valor: valorTeste,
        payId: marca,
        competencia: competencia,
        pago: false,
        estornada: false,
        teste: true,
        criadoEm: admin.firestore.FieldValue.serverTimestamp(),
        criadaPor: decoded.uid,
      });
      res.status(200).json({ ok: true, valor: valorTeste, parceiro: p.nome || '' });
      return;
    }

    // 2) De quem estamos falando e até que data vale o corte.
    const avulso = !saqueId;                 // pagamento direto pela linha do parceiro
    let saqueRef = null, parceiroUid = null, corte = null;

    if (!avulso) {
      saqueRef = db.collection('saques').doc(saqueId);
      const snap = await saqueRef.get();
      if (!snap.exists) { res.status(404).json({ ok: false, erro: 'saque nao encontrado' }); return; }
      const saque = snap.data();
      if (saque.status === 'pago') {
        res.status(200).json({ ok: true, jaPago: true, valorPago: saque.valorPago || 0 });
        return;
      }
      parceiroUid = saque.parceiroUid;
      corte = saque.pedidoEm;
    } else {
      parceiroUid = uidPedido;
      corte = admin.firestore.Timestamp.now();
      // Se o parceiro já pediu saque, paga POR ALI (senão vira pagamento duplo).
      const abertos = await db.collection('saques')
        .where('parceiroUid', '==', parceiroUid)
        .where('status', '==', 'solicitado').get();
      if (!abertos.empty) {
        res.status(409).json({ ok: false, erro: 'pedido_aberto',
          mensagem: 'Este parceiro já tem um pedido de saque em aberto. Pague por "Pedidos de saque", ali em cima.' });
        return;
      }
    }

    // 3) Comissões que esse pagamento quita + valor real.
    const cs = await db.collection('comissoes').where('parceiroUid', '==', parceiroUid).get();
    const sel = selecionarComissoes(cs.docs, corte);
    const valor = sel.valor;

    // ---------- etapa MANUAL: o dono pagou pelo banco, só registra ----------
    if (etapa === 'manual') {
      if (avulso) {
        if (valor <= 0) {
          res.status(409).json({ ok: false, erro: 'sem_valor',
            mensagem: 'Este parceiro não tem comissão liberada para quitar.' }); return;
        }
        saqueRef = db.collection('saques').doc();
      }
      const batch = db.batch();
      sel.escolhidas.forEach((d) => batch.update(d.ref, {
        pago: true,
        pagoEm: admin.firestore.FieldValue.serverTimestamp(),
        saqueId: saqueRef.id,
      }));
      const dadosSaque = {
        status: 'pago',
        pagoEm: admin.firestore.FieldValue.serverTimestamp(),
        valorPago: valor,
        comissoesQuitadas: sel.escolhidas.length,
        comprovante: comprovante || null,
        formaPagamento: 'manual',
        pagoPor: decoded.uid,
      };
      if (avulso) {
        batch.set(saqueRef, Object.assign({
          parceiroUid: parceiroUid,
          valorSolicitado: valor,
          pedidoEm: corte,
          origem: 'dono',
        }, dadosSaque));
      } else {
        batch.update(saqueRef, dadosSaque);
      }
      await batch.commit();
      res.status(200).json({ ok: true, valorPago: valor, qtd: sel.escolhidas.length, forma: 'manual' });
      return;
    }

    // ---------- daqui pra baixo é Pix automático ----------
    if (valor <= 0) {
      res.status(409).json({ ok: false, erro: 'sem_valor',
        mensagem: 'Não há comissão liberada para quitar agora.' });
      return;
    }
    if (valor > TETO_SAQUE_AUTOMATICO) {
      res.status(409).json({ ok: false, erro: 'acima_do_teto', valor: valor, teto: TETO_SAQUE_AUTOMATICO,
        mensagem: 'Valor acima do limite do envio automático (R$ ' + TETO_SAQUE_AUTOMATICO +
                  '). Faça o Pix pelo banco e registre como pago na mão.' });
      return;
    }

    const parcSnap = await db.collection('parceiros').doc(parceiroUid).get();
    const parceiro = parcSnap.exists ? parcSnap.data() : {};
    if (parceiro.status && parceiro.status !== 'aprovado') {
      res.status(409).json({ ok: false, erro: 'parceiro_nao_aprovado',
        mensagem: 'Este parceiro não está aprovado. Confira antes de pagar.' });
      return;
    }

    let dados;
    try { dados = await resolverChave(parceiro.pix); }
    catch (err) {
      res.status(422).json({ ok: false, erro: err.code || 'chave_invalida',
        mensagem: 'Não consegui identificar a chave Pix "' + String(parceiro.pix || '') +
                  '". Confira com o parceiro ou pague pelo banco e registre na mão.' });
      return;
    }

    // ---------- etapa CONFERIR: só devolve para o dono conferir ----------
    if (etapa === 'conferir') {
      res.status(200).json({
        ok: true, etapa: 'conferir', valor: valor, qtd: sel.escolhidas.length,
        chave: dados.chave, tipoChave: dados.tipo,
        titular: dados.titular, documento: dados.documento, banco: dados.banco,
        parceiro: parceiro.nome || '', avulso: avulso,
      });
      return;
    }

    // ---------- etapa PAGAR ----------
    if (avulso) {
      // Abre o registro do saque já travado, para clique duplo não pagar 2x.
      saqueRef = db.collection('saques').doc();
      await saqueRef.set({
        parceiroUid: parceiroUid,
        valorSolicitado: valor,
        status: 'solicitado',
        pedidoEm: corte,
        origem: 'dono',
        pagamentoEmCursoEm: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      // Trava contra clique duplo: quem conseguir marcar primeiro é quem paga.
      try {
        await db.runTransaction(async (tx) => {
          const s = await tx.get(saqueRef);
          const d = s.data() || {};
          if (d.status === 'pago') { const e = new Error('ja_pago'); e.code = 'ja_pago'; throw e; }
          const emCurso = ms(d.pagamentoEmCursoEm);
          if (emCurso && (Date.now() - emCurso) < TRAVA_MS) {
            const e = new Error('em_curso'); e.code = 'em_curso'; throw e;
          }
          tx.update(saqueRef, { pagamentoEmCursoEm: admin.firestore.FieldValue.serverTimestamp() });
        });
      } catch (err) {
        if (err.code === 'ja_pago') { res.status(200).json({ ok: true, jaPago: true }); return; }
        res.status(409).json({ ok: false, erro: 'em_curso',
          mensagem: 'Esse pagamento já está sendo processado. Aguarde alguns instantes e atualize.' });
        return;
      }
    }

    // Manda o Pix. externalReference = id do saque (rastreia lá no Asaas e
    // serve de trava: o Asaas recusa uma segunda transferência com o mesmo).
    let transf;
    try {
      transf = await asaas('/transfers', 'POST', {
        value: valor,
        operationType: 'PIX',
        pixAddressKey: dados.chave,
        pixAddressKeyType: dados.tipo,
        description: 'Moviki - comissao de parceiro',
        externalReference: saqueRef.id,
      });
    } catch (err) {
      // "Saque X já solicitado" = a transferência JÁ EXISTE lá (a 1ª tentativa
      // chegou, só a resposta que se perdeu). Nesse caso o dinheiro pode ter
      // saído: em vez de dar erro, vamos buscar a transferência e seguir com ela.
      const msg = String(err.message || '');
      const jaExiste = /j[áa] solicitad/i.test(msg) || /already/i.test(msg);
      if (jaExiste) {
        try {
          const busca = await asaas('/transfers?externalReference=' +
                                    encodeURIComponent(saqueRef.id), 'GET');
          const achada = (busca && busca.data && busca.data[0]) || null;
          const stA = String((achada && achada.status) || '').toUpperCase();
          if (achada && stA !== 'CANCELLED' && stA !== 'FAILED') transf = achada;
        } catch (_) { /* não achou: cai no erro normal abaixo */ }
      }
      if (!transf) {
        await saqueRef.update({
          pagamentoEmCursoEm: null,
          ultimoErroPagamento: msg.slice(0, 200),
          ultimoErroEm: admin.firestore.FieldValue.serverTimestamp(),
        });
        res.status(502).json({ ok: false, erro: 'asaas',
          mensagem: 'O Asaas recusou a transferência: ' + (msg || 'erro') +
                    '. Nenhum valor saiu e nada foi quitado.' });
        return;
      }
    }

    const st = String((transf && transf.status) || '').toUpperCase();

    // Se a conta Asaas exige aprovação em duas etapas, a transferência nasce
    // NÃO autorizada. O dinheiro ainda não saiu: não quita nada aqui.
    if (transf && transf.authorized === false) {
      await saqueRef.update({
        pagamentoEmCursoEm: null,
        transferenciaId: transf.id || null,
        transferenciaStatus: st || 'AGUARDANDO_AUTORIZACAO',
      });
      res.status(409).json({ ok: false, erro: 'aguardando_autorizacao',
        mensagem: 'A transferência foi criada no Asaas mas precisa da sua autorização lá ' +
                  '(aprovação em duas etapas). Autorize no painel do Asaas e depois registre ' +
                  'aqui em "Já paguei na mão".' });
      return;
    }

    if (st === 'CANCELLED' || st === 'FAILED') {
      await saqueRef.update({
        pagamentoEmCursoEm: null,
        ultimoErroPagamento: 'transferencia ' + st + ' ' + String((transf && transf.failReason) || ''),
        ultimoErroEm: admin.firestore.FieldValue.serverTimestamp(),
      });
      res.status(502).json({ ok: false, erro: 'transferencia_recusada',
        mensagem: 'A transferência foi recusada pelo banco (' + st + '). Nenhum valor saiu.' });
      return;
    }

    // Deu certo: quita comissões e fecha o saque.
    const batch = db.batch();
    sel.escolhidas.forEach((d) => batch.update(d.ref, {
      pago: true,
      pagoEm: admin.firestore.FieldValue.serverTimestamp(),
      saqueId: saqueRef.id,
    }));
    batch.update(saqueRef, {
      status: 'pago',
      pagoEm: admin.firestore.FieldValue.serverTimestamp(),
      valorPago: valor,
      comissoesQuitadas: sel.escolhidas.length,
      comprovante: comprovante || ('Pix Asaas ' + ((transf && transf.id) || '')),
      formaPagamento: 'pix_automatico',
      transferenciaId: (transf && transf.id) || null,
      transferenciaStatus: st || null,
      chavePixPaga: dados.chave,
      titularPago: dados.titular || null,
      pagamentoEmCursoEm: null,
      pagoPor: decoded.uid,
    });
    await batch.commit();

    res.status(200).json({
      ok: true, forma: 'pix_automatico', valorPago: valor, qtd: sel.escolhidas.length,
      transferenciaId: (transf && transf.id) || null, transferenciaStatus: st,
      titular: dados.titular,
    });
  } catch (e) {
    console.error('pagar-saque erro:', e);
    res.status(500).json({ ok: false, erro: 'erro interno' });
  }
};

// exportado só para os testes de lógica
module.exports.candidatosChavePix = candidatosChavePix;
module.exports.selecionarComissoes = selecionarComissoes;
module.exports.TETO_SAQUE_AUTOMATICO = TETO_SAQUE_AUTOMATICO;
