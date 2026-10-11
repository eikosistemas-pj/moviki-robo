/*!
 * MOVIKI lib/vendaMx.js | versao 2026-10-11-vendamx | NOVO | repo: moviki-robo
 *
 * VENDA NO MEXICO — transferencia SPEI para a CLABE da lojista e efectivo al
 * entregar (P76, item M5). Spec: doc "Moviki Mexico - Pagamento por CLABE e
 * material por pais (M5)". Decisoes do Paulo de 11/10/2026: efectivo sim;
 * apartado na live a partir do Premium; a prueba gratis vende ate 40
 * apartados pagos, sem cortar a live que ja esta no ar.
 *
 * ESTADO: DORMENTE. Tudo aqui so roda para negocio com negocios/{uid}.pais
 * === 'MX', campo que so o robo grava (fora do hasOnly). Nenhum negocio tem
 * esse campo hoje. O Brasil passa pelos mesmos caminhos de antes.
 *
 * O QUE CONTINUA IGUAL AO PIX DIRETO DO BRASIL (de proposito)
 *  - o dinheiro vai direto para a conta da lojista: o Moviki nao recebe nada;
 *  - preco, frete e total recalculados no servidor; centavos identificadores;
 *  - "Ya pague" -> 'conferindo', reserva da peca sobe para 24 h;
 *  - quem confirma e a lojista ("Recibi"), pelo mesmo marcarPago('lojista');
 *  - troca da CLABE so com login recente, pausa a venda por 2 h (o mesmo
 *    campo pixTrocadoEm), aviso no Telegram e e-mail a lojista;
 *  - CLABE e celular cifrados com a CHECKOUT_CHAVE; so a mascara volta.
 *
 * O QUE MUDA
 *  - compradora sem documento: nome, sobrenome e WhatsApp +52 (10 digitos);
 *    a trava "uma reserva por pessoa" da oferta usa o telefone;
 *  - prazo do apartado escolhido pela lojista: 30 min, 2 h, 24 h ou 48 h;
 *  - efectivo al entregar (se a lojista ligar): sem dados bancarios, a peca
 *    fica apartada ate 24/48/72 h e a lojista confirma "Recibi el efectivo";
 *  - a compradora pode informar a clave de rastreo e o banco de origem: a
 *    lojista confere no CEP da Banxico antes de confirmar;
 *  - sem envio pelo Brasil (Melhor Envio); entrega local, retirada ou combinada;
 *  - valores em pesos (MXN), dia do pedido no horario da Cidade do Mexico;
 *  - avisos por e-mail em espanhol.
 */
'use strict';

const crypto = require('crypto');
const clabe = require('./clabe');
const pix = require('./pix');

const PLAZOS_MIN = [30, 120, 1440, 2880];
const EFECTIVO_HORAS = [24, 48, 72];
const LIMITE_PRUEBA = 40;                 // apartados PAGOS na prueba gratis (decisao de 11/10)
const LIMITE_PRUEBA_CRIADOS = 80;        // teto de apartados CRIADOS: a lojista que nunca toca em "Recibi" nao vende sem fim
const ABERTOS_POR_TELEFONE = 3;          // apartados aguardando pagamento, por telefone, por negocio
const ABERTOS_POR_REDE = 6;              // idem, por rede (IP com hash)
/* Acoes do painel que a prueba do Mexico pode usar (o resto e do Brasil ou pago). */
const ACOES_PRUEBA = ['loja_recebimento', 'loja_clabe', 'loja_modo', 'loja_pedido', 'loja_entrega', 'loja_estoque', 'loja_comprovante'];
const TERMO_MX_VERSAO = 'MX-2026-10-11';
const POLITICA_MX_VERSAO = 'MX-2026-10-11';

module.exports = function criar(dep) {
  const { db, admin, txt, ms, cifrar, decifrar, chaveCifra, trilha, planoDe, avisarTrocaDeChave,
    emailDoLojista, PIX_LOGIN_RECENTE_MS, prazoDados, DADOS_SEM_VENDA_MS, PEDIDO_RETENCAO_MS,
    avisarLojista } = dep;
  const FV = admin.firestore.FieldValue;

  function minimo() { const v = Number(process.env.CHECKOUT_MIN_MX); return v > 0 ? v : 20; }

  /* Data do pedido no horario da Cidade do Mexico (UTC-6 o ano todo desde 2022). */
  function hojeMx() { return new Date(Date.now() - 6 * 3600000).toISOString().slice(0, 10); }

  async function ehMxEstrito(uid) {
    const s = await db.collection('negocios').doc(String(uid)).get();
    return !!(s.exists && (s.data() || {}).pais === 'MX');
  }
  /* Para leitura (situacao, portao): falha vira "nao e Mexico". Onde a resposta
     decide o que se GRAVA (lojaModo), usa-se o ehMxEstrito, que deixa o erro subir. */
  async function ehMx(uid) { try { return await ehMxEstrito(uid); } catch (_) { return false; } }

  /* Prueba gratis do Mexico: o registro do ativar-trial (plano 'pro',
     periodo 'trial') ainda valendo, num negocio MX. O contador de apartados
     pagos mora em recebimento/{uid}.prueba (so o robo escreve). */
  async function prueba(uid) {
    const [aS, rS, mx] = await Promise.all([
      db.collection('assinaturas').doc(String(uid)).get(),
      db.collection('recebimento').doc(String(uid)).get(),
      ehMx(uid),
    ]);
    const a = aS.exists ? (aS.data() || {}) : {};
    const ativa = mx && a.ativo === true && a.periodo === 'trial' && ms(a.vence_em) > Date.now();
    const pr = (rS.exists && (rS.data() || {}).prueba) || {};
    return { ativa, pagos: Math.max(0, Number(pr.pagos) || 0), criados: Math.max(0, Number(pr.criados) || 0), limiteEm: ms(pr.limiteEm) || 0 };
  }
  /* Portao do painel: o Brasil sai na primeira leitura; qualquer falha = false
     (o lojista sem plano continua recebendo 403, nunca 500). */
  async function pruebaAtiva(uid) {
    try {
      if (!(await ehMxEstrito(uid))) return false;
      return (await prueba(uid)).ativa;
    } catch (_) { return false; }
  }

  /* Quem pode vender no Mexico. Devolve 'premium' | 'enterprise' | 'prueba'
     | 'limite_prueba' | null. A live que ja estava no ar quando o 40o apartado
     foi pago continua vendendo; a proxima live e o cardapio pedem assinatura. */
  async function planoVenda(uid, origem, ses) {
    const p = await planoDe(uid);
    if (p) return p;
    const pr = await prueba(uid);
    if (!pr.ativa) return null;
    if (pr.pagos < LIMITE_PRUEBA && pr.criados < LIMITE_PRUEBA_CRIADOS) return 'prueba';
    if (origem === 'live' && ses) {
      const inicio = ms(ses.inicioEm) || Number(ses.inicioMs) || 0;
      if (inicio && pr.limiteEm && inicio < pr.limiteEm) return 'prueba';
    }
    return 'limite_prueba';
  }

  /* Conta o apartado pago na prueba. Chamado DEPOIS da transacao do
     marcarPago, so quando ela virou o status. Best-effort. */
  async function contarPagoPrueba(uid) {
    const ref = db.collection('recebimento').doc(String(uid));
    try {
      await db.runTransaction(async (tx) => {
        const s = await tx.get(ref);
        const pr = (s.exists && (s.data() || {}).prueba) || {};
        const n = Math.max(0, Number(pr.pagos) || 0) + 1;
        const novo = { pagos: n, atualizadoEm: FV.serverTimestamp() };
        if (n >= LIMITE_PRUEBA && !pr.limiteEm) novo.limiteEm = admin.firestore.Timestamp.now();
        tx.set(ref, { prueba: novo }, { merge: true });
      });
    } catch (e) { console.error('prueba mx', uid, e && e.message); }
  }

  /* Conta o apartado CRIADO na prueba (teto de 80). Best-effort. */
  async function contarCriadoPrueba(uid) {
    try {
      await db.collection('recebimento').doc(String(uid)).set({ prueba: { criados: FV.increment(1) } }, { merge: true });
    } catch (e) { console.error('prueba mx criados', uid, e && e.message); }
  }

  /* Apartados ainda abertos (aguardando e dentro do prazo) desta compradora e
     desta rede. Igualdade em todos os campos: nao precisa de indice composto. */
  async function apartadosAbertos(uid, tel, ipHash) {
    const agora = Date.now();
    const contar = async (campo, valor) => {
      const q = await db.collection('pedidos').where('lojistaUid', '==', uid).where(campo, '==', valor)
        .where('status', '==', 'aguardando').limit(20).get();
      return q.docs.filter((x) => Number((x.data() || {}).validoAte) > agora).length;
    };
    try {
      if (tel && (await contar('comprador.whatsapp', tel)) >= ABERTOS_POR_TELEFONE) return { erro: 'apartados_abertos' };
      if (ipHash && (await contar('ipHash', ipHash)) >= ABERTOS_POR_REDE) return { erro: 'apartados_abertos' };
    } catch (e) { console.error('apartados abertos', uid, e && e.message); return { erro: 'ocupado' }; }
    return { ok: true };
  }

  /* --------------------------------------------------------- compradora */
  function lerComprador(b) {
    const nome = txt(b.nome, 60);
    if (nome.split(' ').filter(Boolean).length < 2) return { erro: 'nome' };
    const tel = clabe.lerCelularMx(b.whatsapp);
    if (!tel) return { erro: 'whatsapp' };
    if (b.aceite !== true) return { erro: 'aceite' };
    return { nome, whatsapp: tel, chaveAbuso: 'tel|' + tel };
  }

  /* Endereco mexicano: codigo postal de 5 digitos (vai em entrega.cp). O
     campo 'cep' do Brasil fica vazio para o lerEndereco nao recusar. */
  function prepararEndereco(b) {
    if (!b || !b.endereco || typeof b.endereco !== 'object') return { b, cp: '' };
    const cp = String(b.endereco.cp || b.endereco.cep || '').replace(/\D/g, '');
    if (cp && cp.length !== 5) return { erro: 'cp' };
    return { b: Object.assign({}, b, { endereco: Object.assign({}, b.endereco, { cep: '', uf: '' }) }), cp };
  }

  function plazoDe(r) { const v = Number(r && r.plazoMin); return PLAZOS_MIN.indexOf(v) >= 0 ? v : 30; }
  function efectivoHorasDe(r) { const v = Number(r && r.efectivoHoras); return EFECTIVO_HORAS.indexOf(v) >= 0 ? v : 48; }
  function pagamentoDe(b) { return b && b.pagamento === 'efectivo' ? 'efectivo' : 'transferencia'; }
  function validadeMin(r, b) { return pagamentoDe(b) === 'efectivo' ? efectivoHorasDe(r) * 60 : plazoDe(r); }

  /* ------------------------------------------------- lojista: CLABE */
  async function lojaClabeSalvar(uid, b, dec) {
    if (!(await ehMx(uid))) return { erro: 'pais' };
    if (!chaveCifra()) return { erro: 'config' };
    const lida = clabe.lerClabe(b.clabe);
    if (!lida.ok) return { erro: 'clabe_' + lida.motivo };
    const titular = txt(b.titular, 60);
    if (titular.split(' ').filter(Boolean).length < 2) return { erro: 'titular' };
    let cel = '';
    if (String(b.celular || '').trim()) {
      cel = clabe.lerCelularMx(b.celular);
      if (!cel) return { erro: 'celular' };
    }

    const ref = db.collection('recebimento').doc(String(uid));
    const antes = await ref.get();
    const ant = antes.exists ? ((antes.data() || {}).clabe || null) : null;
    const tinha = !!(ant && ant.cifrada);
    let mudou = !tinha;
    if (tinha) {
      let clabeAnt = '', celAnt = '';
      try { clabeAnt = decifrar(ant.cifrada); } catch (_) {}
      try { celAnt = ant.celCifrado ? decifrar(ant.celCifrado) : ''; } catch (_) {}
      mudou = clabeAnt !== lida.clabe || celAnt !== cel;
      if (mudou) {
        const authMs = dec && dec.auth_time ? dec.auth_time * 1000 : 0;
        if (!authMs || (Date.now() - authMs) > PIX_LOGIN_RECENTE_MS) {
          return { erro: 'login_recente', mensagem: 'Para cambiar tu CLABE, vuelve a entrar con tu contraseña. Así solo tú decides a dónde va el dinero de tus ventas.' };
        }
      }
    }
    const troca = tinha && mudou;
    /* Como no Pix: a primeira CLABE nao pausa; a troca pausa a venda por 2 h. */
    const marcaTroca = troca ? { pixTrocadoEm: FV.serverTimestamp() } : (tinha ? {} : { pixTrocadoEm: FV.delete() });
    await ref.set(Object.assign({
      uid,
      clabe: {
        cifrada: cifrar(lida.clabe),
        banco: lida.banco,
        mascara: lida.mascara,
        titular,
        celCifrado: cel ? cifrar(cel) : FV.delete(),
        celMascara: cel ? clabe.mascararCelularMx(cel) : FV.delete(),
        salvaEm: FV.serverTimestamp(),
      },
      atualizadoEm: FV.serverTimestamp(),
    }, marcaTroca), { merge: true });

    await trilha(uid, troca ? 'clabe_trocada' : (tinha ? 'clabe_salva' : 'clabe_cadastrada'), { banco: lida.banco.codigo, mascara: lida.mascara, celular: !!cel });
    if (troca) {
      await avisarTrocaDeChave(uid, 'CLABE ' + lida.banco.nome + ' ' + lida.mascara);
      await avisarTrocaClabe(uid, lida.banco.nome + ' ' + lida.mascara);
      try { await dep.espelharRecebimento(uid, (await ref.get()).data() || {}); } catch (_) {}
    }
    return dep.situacaoRecebimento(uid);
  }

  async function avisarTrocaClabe(uid, mascara) {
    try {
      const CHAVE = process.env.RESEND_API_KEY;
      if (!CHAVE) return false;
      const para = await emailDoLojista(uid);
      if (!para) return false;
      const html = caixa(
        '<div style="font-size:19px;font-weight:700;margin-bottom:6px">Cambiaste tu cuenta para recibir</div>' +
        '<p style="font-size:13.5px;color:#c6d8ee;line-height:1.6;margin:12px 0">Desde ahora, el dinero de tus ventas llega a la cuenta <b>' + esc(mascara) + '</b>.</p>' +
        '<p style="font-size:13.5px;color:#ffd36b;background:#3a2a0c;border-radius:10px;padding:10px 12px;line-height:1.55;margin:0 0 16px"><b>Si no fuiste tú</b>, entra al panel ahora, regresa tu CLABE y cambia la contraseña de tu cuenta. Por seguridad, tus ventas quedan en pausa 2 horas.</p>');
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CHAVE },
        body: JSON.stringify({ from: 'Moviki <suporte@moviki.com.br>', to: para, subject: 'Cambiaste tu CLABE — Moviki', html }),
        signal: AbortSignal.timeout(2500),
      });
      return r.ok;
    } catch (e) { console.error('aviso troca clabe', e && e.message); return false; }
  }

  /* ------------------------------------------- lojista: modo e prazo */
  async function lojaModo(uid, b, r) {
    const modo = String(b.modo || 'clabe');
    if (modo !== 'clabe') return { erro: 'modo' };
    if (b.ligado === true) {
      const p = await planoDe(uid);
      if (!p && !(await pruebaAtiva(uid))) return { erro: 'plano' };
      if (!(r.clabe && r.clabe.cifrada)) return { erro: 'sem_clabe' };
      const jaAceitou = r.termoMx && r.termoMx.versao === TERMO_MX_VERSAO;
      if (!jaAceitou && b.aceite !== true) return { erro: 'aceite', termoVersao: TERMO_MX_VERSAO };
    }
    const entrega = ['retirada', 'entrega', 'ambos'].indexOf(String(b.entrega || '')) >= 0 ? String(b.entrega) : (r.entrega || 'retirada');
    const plazoMin = b.plazoMin != null ? Number(b.plazoMin) : plazoDe(r);
    if (PLAZOS_MIN.indexOf(plazoMin) < 0) return { erro: 'plazo' };
    const horas = b.efectivoHoras != null ? Number(b.efectivoHoras) : efectivoHorasDe(r);
    if (EFECTIVO_HORAS.indexOf(horas) < 0) return { erro: 'efectivo_horas' };
    const efectivo = b.efectivo != null ? b.efectivo === true : r.efectivo === true;
    const gravar = { uid, modo, ligado: b.ligado === true, entrega, plazoMin, efectivo, efectivoHoras: horas, atualizadoEm: FV.serverTimestamp() };
    if (b.aceite === true && !(r.termoMx && r.termoMx.versao === TERMO_MX_VERSAO)) {
      gravar.termoMx = { versao: TERMO_MX_VERSAO, em: FV.serverTimestamp() };
      await trilha(uid, 'termo_venda_aceito', { versao: TERMO_MX_VERSAO });
    }
    await db.collection('recebimento').doc(String(uid)).set(gravar, { merge: true });
    await dep.espelharRecebimento(uid, Object.assign({}, r, gravar));
    await trilha(uid, 'recebimento_' + (b.ligado === true ? 'ligado' : 'desligado'), { modo, plazoMin, efectivo });
    return dep.situacaoRecebimento(uid);
  }

  /* Campos a mais no espelho publico (checkout_publico). Nunca a CLABE. */
  function extrasEspelho(r) {
    return { pais: 'MX', moeda: 'MXN', plazoMin: plazoDe(r), efectivo: !!(r && r.efectivo === true), efectivoHoras: efectivoHorasDe(r) };
  }

  /* Campos a mais na situacao do recebimento, so para negocio MX. */
  async function situacaoExtra(uid, d) {
    if (!(await ehMx(uid))) return {};
    const pr = await prueba(uid);
    const c = d.clabe || null;
    return {
      pais: 'MX', moeda: 'MXN',
      clabe: c && c.cifrada ? { tem: true, banco: (c.banco && c.banco.nome) || '', mascara: c.mascara || '', titular: c.titular || '', celular: c.celMascara || '' } : { tem: false },
      plazoMin: plazoDe(d), plazos: PLAZOS_MIN.slice(),
      efectivo: d.efectivo === true, efectivoHoras: efectivoHorasDe(d), efectivoOpcoes: EFECTIVO_HORAS.slice(),
      termoMx: { versao: TERMO_MX_VERSAO, aceito: !!(d.termoMx && d.termoMx.versao === TERMO_MX_VERSAO) },
      prueba: pr.ativa ? { ativa: true, pagos: pr.pagos, limite: LIMITE_PRUEBA, restam: Math.max(0, LIMITE_PRUEBA - pr.pagos) } : { ativa: false },
      minimo: minimo(),
    };
  }

  /* ------------------------------------------------ criar o pedido */
  async function criarPedido(ctx) {
    const { lojistaUid, r, itens, total, comprador, entrega, origem, liveId, negNome, pagamento } = ctx;
    const extra = ctx.extra || {};
    const campos = ctx.campos || {};
    const validadeMinP = Number(campos.validadeMin) || 30;
    const validoAte = Number(campos.validoAte) || (Date.now() + validadeMinP * 60000);
    const pedidoRef = ctx.pedidoRef || db.collection('pedidos').doc();
    const segredo = crypto.randomBytes(16).toString('hex');
    const ehEfectivo = pagamento === 'efectivo';
    if (ehEfectivo && !(r && r.efectivo === true)) return { erro: 'sem_efectivo' };

    let totalFinal = total, centavos = 0, dadosTransf = null;
    if (!ehEfectivo) {
      if (!(r && r.clabe && r.clabe.cifrada)) return { erro: 'indisponivel' };
      let clabeCrua, celCru = '';
      try { clabeCrua = decifrar(r.clabe.cifrada); } catch (e) { return { erro: 'config' }; }
      try { celCru = r.clabe.celCifrado ? decifrar(r.clabe.celCifrado) : ''; } catch (_) { celCru = ''; }
      const lida = clabe.lerClabe(clabeCrua);
      if (!lida.ok) return { erro: 'config' };
      const cu = pix.centavosUnicos(total, pedidoRef.id);
      totalFinal = cu.total; centavos = cu.centavos;
      dadosTransf = {
        banco: lida.banco.nome,
        clabe: lida.clabe,
        beneficiaria: txt(r.clabe.titular, 60),
        monto: totalFinal,
        concepto: clabe.conceptoDe(extra.numero),
        referencia: clabe.referenciaDe(extra.numero),
        celular: celCru ? celCru.replace(/^\+52/, '') : '',
        cep: clabe.CEP_URL,
      };
    }

    const modo = ehEfectivo ? 'efectivo' : 'clabe';
    await pedidoRef.set({
      ...campos, validadeMin: validadeMinP, validoAte,
      lojistaUid, origem, liveId: liveId || '', dia: hojeMx(),
      modo, pais: 'MX', moeda: 'MXN',
      itens, total: totalFinal, totalBase: total, centavos,
      subtotal: extra.subtotal != null ? extra.subtotal : total, frete: extra.frete || 0,
      numero: extra.numero || 0, codigo: extra.codigo || '',
      estoque: extra.estoque || { v: 1, linhas: [] },
      comprador, entrega,
      prueba: ctx.prueba === true,
      ipHash: String(extra.ipHash || ''),
      aceite: { versao: POLITICA_MX_VERSAO, em: FV.serverTimestamp() },
      status: 'aguardando',
      segredoHash: crypto.createHash('sha256').update(segredo).digest('hex'),
      criadoEm: FV.serverTimestamp(),
      expiraEm: admin.firestore.Timestamp.fromMillis(Date.now() + PEDIDO_RETENCAO_MS),
      apagarDadosEm: prazoDados(DADOS_SEM_VENDA_MS),
    });
    await trilha(lojistaUid, 'pedido_criado', { pedido: pedidoRef.id, modo, total: totalFinal, origem, pais: 'MX' });
    if (ctx.prueba === true) await contarCriadoPrueba(lojistaUid);
    await avisarLojista('novo', { lojistaUid, total: totalFinal, itens, entrega, pais: 'MX', modo }, pedidoRef.id);

    const out = {
      ok: true, pedidoId: pedidoRef.id, chave: segredo, total: totalFinal, centavos, moeda: 'MXN',
      subtotal: extra.subtotal != null ? extra.subtotal : total, frete: extra.frete || 0,
      numero: extra.numero || 0, entrega: entrega.tipo,
      itens: itens.map((i) => ({ nome: i.nome, qtd: i.qtd })),
      produto: itens[0] ? itens[0].nome : '', qtd: itens[0] ? itens[0].qtd : 1,
      modo, negocio: negNome, validadeMin: validadeMinP, validoAte,
    };
    if (dadosTransf) out.transferencia = dadosTransf;
    return out;
  }

  /* "Ya pague": clave de rastreo e banco de origem, os dois opcionais. */
  function lerAvisoTransferencia(b) {
    const out = {};
    if (String(b.claveRastreo || '').trim()) {
      const c = clabe.claveRastreoOk(b.claveRastreo);
      if (!c) return { erro: 'clave_rastreo' };
      out.claveRastreo = c;
    }
    if (String(b.bancoOrigem || '').trim()) {
      const bo = clabe.bancoOk(b.bancoOrigem);
      if (!bo) return { erro: 'banco_origem' };
      out.bancoOrigem = bo;
    }
    return { transferencia: out };
  }

  /* ------------------------------------------- e-mails em espanhol */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function caixa(miolo) {
    return '<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#060d18;color:#eaf6ff;padding:26px">' +
      '<div style="max-width:520px;margin:0 auto;background:#0e1c30;border:1px solid #1c3457;border-radius:16px;padding:22px">' + miolo +
      '<a href="https://app.moviki.com.br/" style="display:block;text-align:center;background:#00D4FF;color:#04121f;font-weight:700;font-size:15px;text-decoration:none;padding:14px;border-radius:12px">Abrir el panel</a>' +
      '</div></div>';
  }
  function valorMx(v) { return 'MX$ ' + (Number(v) || 0).toFixed(2); }

  function corpoAviso(tipo, dados) {
    const t = {
      novo:  { assunto: 'Tienes un apartado nuevo de ' + dados.valor, titulo: 'Tienes un apartado nuevo', linha: dados.efectivo ? 'La clienta paga en efectivo al recibir. Confirma en el panel cuando te pague.' : 'La clienta todavía va a pagar. Cuando avise que pagó, revisa tu cuenta y confirma.' },
      pagou: { assunto: 'Una clienta dice que ya te pagó — ' + dados.valor, titulo: 'Una clienta dice que ya te pagó', linha: 'Antes de confirmar, abre la app de tu banco y revisa que llegó el monto EXACTO (los centavos identifican el pedido). Una captura de pantalla no es prueba de pago.' },
      pago:  { assunto: 'Pago confirmado — ' + dados.valor, titulo: 'Pago confirmado', linha: 'Prepara el pedido y márcalo como entregado cuando termines.' },
      estornado: { assunto: 'ATENCIÓN: pago devuelto — ' + dados.valor, titulo: 'El pago de este pedido fue devuelto', linha: 'NO entregues este pedido. Si ya lo entregaste, habla con la clienta.' },
    }[tipo];
    if (!t) return null;
    const alerta = dados.alerta ? '<p style="font-size:13.5px;color:#ffd36b;background:#3a2a0c;border-radius:10px;padding:10px 12px;line-height:1.55;margin:0 0 16px">' + esc(dados.alerta) + '</p>' : '';
    const html = caixa(
      '<div style="font-size:19px;font-weight:700;margin-bottom:6px">' + t.titulo + '</div>' +
      '<div style="font-size:13px;color:#8fa6c4;margin-bottom:16px">' + esc(dados.negocio) + '</div>' +
      '<div style="font-size:30px;font-weight:800;color:#25e39b;letter-spacing:-.5px">' + esc(dados.valor) + '</div>' +
      '<div style="font-size:13.5px;color:#c6d8ee;margin-top:6px">' + esc(dados.itens) + ' &middot; ' + esc(dados.entrega) + '</div>' +
      '<p style="font-size:13.5px;color:#c6d8ee;line-height:1.6;margin:16px 0 20px">' + t.linha + '</p>' + alerta +
      '<p style="font-size:11.5px;color:#8fa6c4;line-height:1.6;margin:0 0 18px">Los datos de la clienta están en el panel, detrás de tu contraseña: no viajan por correo. Moviki no recibe ni transfiere el dinero de esta venta: llega directo a tu cuenta.</p>');
    return { assunto: t.assunto + ' — Moviki', html };
  }
  function dadosAviso(p, negNome) {
    const itens = Array.isArray(p.itens) ? p.itens : [];
    const qtd = itens.reduce((s, i) => s + (Number(i.qtd) || 1), 0);
    return {
      valor: valorMx(p.total),
      itens: qtd + (qtd === 1 ? ' pieza' : ' piezas'),
      entrega: (p.entrega && p.entrega.tipo === 'entrega') ? ((p.entrega.aCombinar === false) ? 'entrega a domicilio' : 'entrega por acordar') : 'recoge en el lugar',
      negocio: negNome || 'Tu negocio',
      efectivo: p.modo === 'efectivo',
      alerta: p.alertaEstoque ? 'Atención: la pieza ya se había vendido a otra persona cuando llegó este pago. Revisa si todavía la tienes antes de separar.'
        : (p.pagouAtrasado ? 'Atención: la clienta pagó después del plazo. Revisa tu cuenta y confirma solo si el dinero llegó.' : ''),
    };
  }

  return {
    LIMITE_PRUEBA, LIMITE_PRUEBA_CRIADOS, ABERTOS_POR_TELEFONE, ABERTOS_POR_REDE, ACOES_PRUEBA, PLAZOS_MIN, EFECTIVO_HORAS, TERMO_MX_VERSAO,
    minimo, hojeMx, ehMx, ehMxEstrito, prueba, apartadosAbertos, pruebaAtiva, planoVenda, contarPagoPrueba,
    lerComprador, prepararEndereco, plazoDe, efectivoHorasDe, pagamentoDe, validadeMin,
    lojaClabeSalvar, lojaModo, extrasEspelho, situacaoExtra, criarPedido, lerAvisoTransferencia,
    corpoAviso, dadosAviso,
  };
};
