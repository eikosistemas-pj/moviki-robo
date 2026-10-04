/*!
 * MOVIKI lib/freteAuto.js | versao 2026-10-04-freteauto | NOVO | repo: moviki-robo
 *
 * FRETE AUTOMATICO PELO MELHOR ENVIO (P70, etapa 6 = "frete nivel 2", 04/10/2026)
 * DESLIGADO POR PADRAO: chave recursos/{uid}.freteAuto (o dono liga) + o
 * lojista conecta o PROPRIO token do Melhor Envio e liga no painel.
 *
 * - A conta e do LOJISTA: o token e dele, a etiqueta ele compra no Melhor
 *   Envio dele, o dinheiro do frete entra no Pix dele junto com os produtos.
 *   O Moviki so CONSULTA o preco (escopo shipping-calculate). Nenhum centavo
 *   passa pela Eiko.
 * - Token guardado CIFRADO em recebimento/{uid}.melhorEnvio (mesma
 *   CHECKOUT_CHAVE da chave Pix e da chave Asaas). Nunca volta ao navegador:
 *   o painel ve so "conectado" e o final.
 * - Peso: o produto marcado "pode ir pelo correio" pode ter o PESO dele
 *   (cardapio, campo pesoEnvio em kg); sem peso, vale o PESO MEDIO POR PECA
 *   do lojista. Medidas: a CAIXA que ele mais usa. Pacote = caixa padrao com
 *   peso = soma de (peso x quantidade), teto 30 kg. A cotacao publica recebe
 *   os itens (o que e e quantos) e le o peso do cardapio NO SERVIDOR; o cache
 *   e pela soma do peso, igual no compra_frete e no compra_criar.
 * - Cotacao publica (compra_frete) com freio por IP e cache de 30 min em
 *   frete_cotacoes/{hash} (raiz, sem regra). O pedido (compra_criar) usa o
 *   MESMO preco que o comprador viu, lido do cache no servidor; sem cache,
 *   cota de novo. O navegador so diz QUAL servico escolheu.
 * - Melhor Envio fora do ar: cai na tabela por regiao do lojista (etapa 2),
 *   se ele tiver preenchido aquela regiao. Sem tabela, 'frete_indisponivel'.
 * - Frete gratis acima de X: a opcao MAIS BARATA sai gratis e as outras
 *   cobram so a diferenca (senao o comprador escolhe a mais cara de graca).
 */
'use strict';
const crypto = require('crypto');

const URL_PADRAO = 'https://melhorenvio.com.br/api/v2/me/shipment/calculate';
const URL_DOCS = 'https://api.melhorenvio.com.br/api/v2/me/shipment/calculate';
const AGENTE = 'Moviki (suporte@moviki.com.br)';
const CACHE_MS = 30 * 60000;
const MAX_OPCOES = 4;
const CEP_TESTE = '01001000';   // Praca da Se, SP: so para conferir o token

function hash(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function num(v, min, max, casas) {
  const n = Number(String(v == null ? '' : v).replace(',', '.'));
  if (!isFinite(n) || n < min || n > max) return null;
  const f = Math.pow(10, casas == null ? 2 : casas);
  return Math.round(n * f) / f;
}
function norm(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
/* Peso do pacote: soma de (peso do produto ou peso medio) x quantidade. */
function pesoDoPacote(neg, itens, pesoItem) {
  const cats = Array.isArray(neg && neg.cardapio) ? neg.cardapio : [];
  let total = 0;
  (Array.isArray(itens) ? itens.slice(0, 40) : []).forEach((it) => {
    const q = Math.max(1, Math.min(200, parseInt(it && it.qtd, 10) || 1));
    const sku = String((it && it.sku) || ''), nome = norm(it && (it.nome || it.produto));
    let p = null;
    for (const c of cats) {
      for (const pr of (Array.isArray(c && c.produtos) ? c.produtos : [])) {
        if (!pr || !pr.nome) continue;
        if ((sku && String(pr.sku || '') === sku) || (nome && norm(pr.nome) === nome)) { p = pr; break; }
      }
      if (p) break;
    }
    const pp = p ? num(p.pesoEnvio, 0.01, 30, 3) : null;
    total += (pp || pesoItem) * q;
  });
  if (!total) total = pesoItem;
  return Math.min(30, Math.max(0.01, Math.round(total * 1000) / 1000));
}
function cepOk(c) { const d = String(c || '').replace(/\D/g, ''); return d.length === 8 ? d : ''; }

/* Configuracao do lojista (recebimento/{uid}.envioAuto). Tudo com teto. */
function lerAutoCfg(raw) {
  const a = raw || {};
  return {
    ligado: a.ligado === true,
    cepOrigem: cepOk(a.cepOrigem),
    pesoItem: num(a.pesoItem, 0.01, 30, 3) || 0.3,
    caixa: {
      alt: num(a.caixa && a.caixa.alt, 1, 100, 0) || 4,
      larg: num(a.caixa && a.caixa.larg, 8, 100, 0) || 12,
      comp: num(a.caixa && a.caixa.comp, 13, 100, 0) || 17,
    },
    acrescimo: num(a.acrescimo, 0, 50) || 0,
    prazoExtra: num(a.prazoExtra, 0, 15, 0) || 0,
    seguro: a.seguro === true,
  };
}

module.exports = function criar(dep) {
  const { db, admin, txt, cifrar, decifrar, trilha } = dep;
  const FV = admin.firestore.FieldValue;
  const TS = admin.firestore.Timestamp;
  const fetchFn = () => dep.fetch || global.fetch;

  function tokenDe(r) {
    const m = r && r.melhorEnvio;
    if (!m || !m.token) return '';
    try { return decifrar(m.token) || ''; } catch (_) { return ''; }
  }
  function autoAtivo(rec, r) {
    if (!(rec && rec.freteAuto && rec.freteBrasil)) return false;
    const c = lerAutoCfg(r && r.envioAuto);
    return c.ligado && !!c.cepOrigem && !!(r && r.melhorEnvio && r.melhorEnvio.token);
  }

  async function chamar(token, corpo) {
    const urls = process.env.MELHORENVIO_URL ? [process.env.MELHORENVIO_URL] : [URL_PADRAO, URL_DOCS];
    let ultimo = { erro: 'cotacao' };
    for (const u of urls) {
      let r;
      try {
        r = await fetchFn()(u, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': AGENTE },
          body: JSON.stringify(corpo),
          signal: AbortSignal.timeout(8000),
        });
      } catch (e) { ultimo = { erro: 'rede' }; continue; }
      if (r.status === 401 || r.status === 403) return { erro: 'token' };
      if (r.status === 404 || r.status >= 500) { ultimo = { erro: 'cotacao', status: r.status }; continue; }
      let j = null;
      try { j = await r.json(); } catch (_) { j = null; }
      if (!r.ok) return { erro: r.status === 422 ? 'pacote' : 'cotacao', status: r.status, mensagem: txt(j && (j.message || j.error), 160) };
      return { ok: true, lista: Array.isArray(j) ? j : [] };
    }
    return ultimo;
  }

  /* Cota no Melhor Envio. Devolve opcoes ja com acrescimo e prazo extra do
     lojista, da mais barata para a mais cara. */
  async function cotar(token, cfg, cepDestino, pesoKg, valor) {
    const peso = Math.min(30, Math.max(0.01, Math.round(pesoKg * 1000) / 1000));
    const pacote = { height: cfg.caixa.alt, width: cfg.caixa.larg, length: cfg.caixa.comp, weight: peso };
    if (cfg.seguro && valor > 0) pacote.insurance = Math.round(valor * 100) / 100;
    const r = await chamar(token, { from: { postal_code: cfg.cepOrigem }, to: { postal_code: cepDestino }, package: pacote, options: { receipt: false, own_hand: false } });
    if (r.erro) return r;
    const opcoes = r.lista
      .filter((s) => s && !s.error && isFinite(Number(s.custom_price || s.price)) && Number(s.custom_price || s.price) > 0)
      .map((s) => {
        const preco = Math.round((Number(s.custom_price || s.price) + cfg.acrescimo) * 100) / 100;
        const dias = Number(s.custom_delivery_time || s.delivery_time) || 0;
        return { id: String(s.id).replace(/[^0-9A-Za-z_-]/g, '').slice(0, 20), nome: txt(s.name, 40), empresa: txt(s.company && s.company.name, 40), preco, prazo: dias ? dias + cfg.prazoExtra : 0 };
      })
      .filter((o) => o.id)
      .sort((a, b) => a.preco - b.preco)
      .slice(0, MAX_OPCOES);
    if (!opcoes.length) return { erro: 'sem_opcao' };
    return { ok: true, opcoes, peso };
  }

  /* Frete gratis acima de X: a mais barata zera, as outras pagam a diferenca. */
  function aplicarGratis(opcoes, gratisAcima, subtotal) {
    if (!(gratisAcima > 0 && subtotal >= gratisAcima) || !opcoes.length) return opcoes.map((o) => Object.assign({}, o));
    const base = opcoes[0].preco;
    return opcoes.map((o) => Object.assign({}, o, { preco: Math.max(0, Math.round((o.preco - base) * 100) / 100), gratis: true }));
  }

  function chaveCache(uid, cep, peso) { return 'c' + hash(uid + '|' + cep + '|' + peso).slice(0, 40); }

  async function cotarComCache(uid, r, cep, peso, valor) {
    const cfg = lerAutoCfg(r.envioAuto);
    /* Com seguro o preco depende do valor declarado: entra na chave. */
    const ref = db.collection('frete_cotacoes').doc(chaveCache(uid, cep, peso.toFixed(3) + (cfg.seguro ? '|' + Number(valor || 0).toFixed(2) : '')));
    try {
      const s = await ref.get();
      if (s.exists) {
        const d = s.data() || {};
        const em = d.em && d.em.toMillis ? d.em.toMillis() : Number(d.emMs) || 0;
        if (Date.now() - em < CACHE_MS && Array.isArray(d.opcoes) && d.opcoes.length && d.seguro === cfg.seguro) return { ok: true, opcoes: d.opcoes, cache: true };
      }
    } catch (_) {}
    const tok = tokenDe(r);
    if (!tok) return { erro: 'token' };
    const c = await cotar(tok, cfg, cep, peso, valor);
    if (c.erro) return c;
    /* Sem o CEP do comprador no documento: a chave ja e um hash. E a colecao
       se limpa sozinha (apaga ate 20 vencidas a cada cotacao nova). */
    try {
      await ref.set({ uid, opcoes: c.opcoes, seguro: cfg.seguro, em: TS.now(), emMs: Date.now(), expiraEm: TS.fromMillis(Date.now() + CACHE_MS) });
      const velhas = await db.collection('frete_cotacoes').where('expiraEm', '<=', TS.now()).limit(20).get();
      await Promise.all(velhas.docs.map((d) => d.ref.delete()));
    } catch (_) {}
    return c;
  }

  async function freioIp(ip) {
    const ref = db.collection('checkout_freio').doc('_fr_' + hash(ip || 'x').slice(0, 24));
    const agora = Date.now();
    return db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      let d = s.exists ? s.data() : { ini: agora, n: 0 };
      if (agora - (d.ini || 0) > 3600000) d = { ini: agora, n: 0 };
      if (d.n >= 60) return false;
      tx.set(ref, { ini: d.ini, n: d.n + 1, expiraEm: TS.fromMillis(agora + 86400000) });
      return true;
    });
  }

  /* ------------------------------------------------------ publico */
  /* ctx = { rec, r, plano, envioAtivo, gratisAcima } montado pelo checkout. */
  async function compraFrete(b, ip, ctx) {
    const uid = String((b && b.lojistaUid) || '');
    const cep = cepOk(b && b.cep);
    if (!cep) return { erro: 'cep' };
    const qtd = Math.max(1, Math.min(200, parseInt(b && b.qtd, 10) || 1));
    if (!ctx || !ctx.plano || !ctx.envioAtivo || !autoAtivo(ctx.rec, ctx.r)) return { erro: 'sem_auto' };
    if (!(await freioIp(ip))) return { erro: 'freio' };
    const sub = Math.max(0, Number(b && b.subtotal) || 0);
    const cfg = lerAutoCfg(ctx.r.envioAuto);
    /* Com itens, o peso sai do cardapio; sem itens (tela antiga), peso medio x pecas. */
    const peso = (Array.isArray(b && b.itens) && b.itens.length) ? pesoDoPacote(ctx.neg, b.itens, cfg.pesoItem) : Math.min(30, Math.round(cfg.pesoItem * qtd * 1000) / 1000);
    const c = await cotarComCache(uid, ctx.r, cep, peso, sub);
    if (c.erro) return { erro: c.erro === 'token' ? 'frete_indisponivel' : (c.erro === 'sem_opcao' ? 'sem_opcao' : 'frete_indisponivel') };
    return { ok: true, cep, qtd, opcoes: aplicarGratis(c.opcoes, ctx.gratisAcima || 0, sub) };
  }

  /* Usado pelo compra_criar: preco do servico escolhido, do cache ou cotado
     agora. Devolve { taxa, nome, prazo } ou { erro } ou { cair: true } para
     o checkout tentar a tabela. */
  async function freteDoPedido(uid, r, neg, itens, cep, servico, subtotal, gratisAcima) {
    const peso = pesoDoPacote(neg, itens, lerAutoCfg(r.envioAuto).pesoItem);
    const c = await cotarComCache(uid, r, cep, peso, subtotal);
    if (c.erro) return c.erro === 'sem_opcao' ? { erro: 'sem_opcao' } : { cair: true };
    const ops = aplicarGratis(c.opcoes, gratisAcima, subtotal);
    const sv = String(servico || '');
    const o = ops.find((x) => x.id === sv);
    if (!o) return { erro: 'frete_escolher' };
    return { taxa: o.preco, nome: (o.empresa ? o.empresa + ' ' : '') + o.nome, prazo: o.prazo ? o.prazo + ' dias úteis' : '', servico: o.id };
  }

  /* ------------------------------------------------------ lojista */
  function situacao(r, rec) {
    const cfg = lerAutoCfg(r && r.envioAuto);
    const m = (r && r.melhorEnvio) || {};
    return { liberado: !!(rec && rec.freteAuto), cfg, conectado: !!m.token, final: txt(m.final, 8), em: m.em && m.em.toMillis ? m.em.toMillis() : 0, ativo: autoAtivo(rec, r) };
  }

  /* Salva configuracao e, se veio, o token (conferido com uma cotacao de
     teste antes de guardar). */
  async function lojaSalvar(uid, b, rec) {
    if (!(rec && rec.freteAuto)) return { erro: 'auto_off' };
    const ref = db.collection('recebimento').doc(uid);
    const s = await ref.get();
    const r = s.exists ? (s.data() || {}) : {};
    if (b && b.desconectar === true) {
      await ref.set({ melhorEnvio: FV.delete(), envioAuto: Object.assign({}, r.envioAuto || {}, { ligado: false }), atualizadoEm: FV.serverTimestamp() }, { merge: true });
      await trilha(uid, 'melhorenvio_desconectado', {});
      const r2 = Object.assign({}, r, { melhorEnvio: null, envioAuto: Object.assign({}, r.envioAuto || {}, { ligado: false }) });
      return { ok: true, auto: situacao(r2, rec), _r: r2 };
    }
    const cepOrigem = cepOk(b && b.cepOrigem);
    if (!cepOrigem) return { erro: 'cep_origem' };
    const pesoItem = num(b.pesoItem, 0.01, 30, 3);
    if (pesoItem === null) return { erro: 'peso' };
    const alt = num(b.alt, 1, 100, 0), larg = num(b.larg, 8, 100, 0), comp = num(b.comp, 13, 100, 0);
    if (alt === null || larg === null || comp === null) return { erro: 'caixa' };
    const acrescimo = String(b.acrescimo == null ? '' : b.acrescimo).trim() === '' ? 0 : num(b.acrescimo, 0, 50);
    if (acrescimo === null) return { erro: 'acrescimo' };
    const prazoExtra = String(b.prazoExtra == null ? '' : b.prazoExtra).trim() === '' ? 0 : num(b.prazoExtra, 0, 15, 0);
    if (prazoExtra === null) return { erro: 'prazo_extra' };
    const cfg = { ligado: b.ligado === true, cepOrigem, pesoItem, caixa: { alt, larg, comp }, acrescimo, prazoExtra, seguro: b.seguro === true };

    const upd = { envioAuto: cfg, atualizadoEm: FV.serverTimestamp() };
    let teste = null;
    const novo = String((b && b.token) || '').trim();
    if (novo) {
      if (novo.length < 40 || novo.length > 4000 || /\s/.test(novo)) return { erro: 'token_formato' };
      const c = await cotar(novo, lerAutoCfg(cfg), CEP_TESTE, pesoItem, 0);
      if (c.erro === 'token') return { erro: 'token' };
      if (c.erro && c.erro !== 'sem_opcao') return { erro: 'melhorenvio_fora' };
      teste = c.opcoes ? c.opcoes.slice(0, 3) : [];
      upd.melhorEnvio = { token: cifrar(novo), final: novo.slice(-6), em: FV.serverTimestamp() };
    }
    if (cfg.ligado && !novo && !(r.melhorEnvio && r.melhorEnvio.token)) return { erro: 'sem_token' };
    await ref.set(upd, { merge: true });
    await trilha(uid, 'frete_auto_config', { ligado: cfg.ligado, token: !!novo });
    const r2 = Object.assign({}, r, { envioAuto: cfg }, novo ? { melhorEnvio: { token: 'x', final: novo.slice(-6) } } : {});
    return { ok: true, auto: situacao(r2, rec), teste, _r: r2 };
  }

  /* Simulacao no painel: o lojista ve o que o cliente vai ver. */
  async function lojaTestar(uid, b, rec) {
    if (!(rec && rec.freteAuto)) return { erro: 'auto_off' };
    const s = await db.collection('recebimento').doc(uid).get();
    const r = s.exists ? (s.data() || {}) : {};
    const cep = cepOk(b && b.cep);
    if (!cep) return { erro: 'cep' };
    const qtd = Math.max(1, Math.min(200, parseInt(b && b.qtd, 10) || 1));
    const tok = tokenDe(r);
    if (!tok) return { erro: 'sem_token' };
    const cfg = lerAutoCfg(r.envioAuto);
    if (!cfg.cepOrigem) return { erro: 'cep_origem' };
    const c = await cotar(tok, cfg, cep, Math.min(30, cfg.pesoItem * qtd), 0);
    if (c.erro) return { erro: c.erro === 'token' ? 'token' : (c.erro === 'sem_opcao' ? 'sem_opcao' : 'melhorenvio_fora') };
    return { ok: true, opcoes: c.opcoes, peso: c.peso };
  }

  return { compraFrete, freteDoPedido, autoAtivo, situacao, lojaSalvar, lojaTestar, _t: { lerAutoCfg, cotar, aplicarGratis, chaveCache, pesoDoPacote } };
};
module.exports.lerAutoCfg = lerAutoCfg;
