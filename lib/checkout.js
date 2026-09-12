/*!
 * MOVIKI lib/checkout.js | versao 2026-09-12-beta1 | repo: moviki-robo
 *
 * CHECKOUT PIX DA LIVE (plano Enterprise)
 * O cliente final paga DENTRO do Moviki, por Pix, e o dinheiro cai na conta
 * do LOJISTA — nunca na da Eiko.
 *
 * COMO O DINHEIRO ANDA
 * Cada lojista Enterprise ganha uma SUBCONTA Asaas propria, criada pela conta
 * principal do Moviki. A cobranca e emitida PELA SUBCONTA, em nome dele. O
 * Moviki nao recebe, nao guarda e nao repassa dinheiro de venda: nao vira
 * intermediador de pagamento. A taxa do Moviki no lancamento e 0%; quando
 * existir, entra por split (MOVIKI_TAXA_PCT + MOVIKI_WALLET_ID) — o split so
 * e montado se as duas envs existirem e a taxa for maior que zero.
 *
 * ONDE ISTO RODA
 * Nao e endpoint: o projeto esta no teto de 12 funcoes. Entra como ETAPA de
 * dois arquivos que ja existem:
 *   api/pontos.js  -> acoes 'loja_*' (lojista logado) e 'compra_*' (cliente)
 *   api/webhook.js -> pagamentos com externalReference 'pedido:<id>'
 *
 * DADOS (so o Admin SDK escreve)
 *   checkout_contas/{uid}   chave da subconta CIFRADA (AES-256-GCM), walletId,
 *                           status. Sem match nas regras: ninguem le pelo app.
 *   checkout_publico/{uid}  { ativo } — o que a pagina da live consulta.
 *   pedidos/{id}            o pedido; o lojista le os proprios (regra v23).
 *   checkout_freio/{id}     freio anti-abuso por IP.
 *
 * ENVS NOVAS (Vercel do moviki-robo, Production)
 *   CHECKOUT_CHAVE              obrigatoria: frase longa e aleatoria que cifra
 *                               a chave de API de cada subconta. Sem ela nada
 *                               funciona (falha fechada). NUNCA trocar depois
 *                               de criar subconta: a chave antiga fica ilegivel.
 *   ASAAS_WEBHOOK_TOKEN_PEDIDOS opcional: token do webhook das subcontas. Sem
 *                               ela, usa o ASAAS_WEBHOOK_TOKEN de sempre.
 *   CHECKOUT_MIN                opcional: valor minimo do pedido (padrao 20).
 *                               O Asaas cobra R$ 1,99 FIXOS por Pix recebido, da
 *                               subconta do lojista. Em pedido de R$ 5 isso e 40%
 *                               da venda; em R$ 20 e 10%. Por isso o piso de 20.
 *   MOVIKI_TAXA_PCT / MOVIKI_WALLET_ID  opcionais, para o futuro.
 */
'use strict';

const crypto = require('crypto');
const { admin, db } = require('./firebase');

const BASE = process.env.ASAAS_BASE_URL || 'https://api-sandbox.asaas.com/v3';
const KEY_MAE = process.env.ASAAS_API_KEY;
const FV = admin.firestore.FieldValue;
const ORIGENS = ['https://app.moviki.com.br', 'https://moviki.com.br', 'https://www.moviki.com.br'];
const WEBHOOK_URL = 'https://moviki-robo.vercel.app/api/webhook';
const EVENTOS_PAGTO = ['PAYMENT_CREATED', 'PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_OVERDUE',
  'PAYMENT_DELETED', 'PAYMENT_REFUNDED', 'PAYMENT_UPDATED'];
const PAGO = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'];
const MAX_QTD = 10;
const PEDIDO_VALIDADE_MIN = 30;   // janela do Pix na tela do comprador
/* Retencao do DOCUMENTO do pedido, que e outra coisa: se o expiraEm valesse a
   janela do Pix, uma politica de TTL no Firestore apagaria pedido PAGO meia
   hora depois — e um pagamento que cai atrasado nao acharia o documento.
   Abandonado some em 7 dias; pago fica 5 anos (prazo do CDC). */
const PEDIDO_RETENCAO_MS = 7 * 86400000;
const PEDIDO_RETENCAO_PAGO_MS = 5 * 365 * 86400000;
const POLITICA_VERSAO = '2026-09-11';   // versao de Termos/Privacidade aceita no checkout

  /* ---- FILTRO DE CONTEUDO DA LIVE — 11/09/2026 ----
     Mesma lista, byte a byte, em 5 lugares: estudio (moviki-app/live.html),
     pagina publica (moviki/live.html), painel do dono (eikoadm01.html) e
     servidores (moviki/api/live.js e moviki-robo/lib/checkout.js). A fonte e uma so; mudou aqui, muda nos 4.
     Termos EXTRAS o dono cadastra no painel (configuracoes/liveTermos) sem
     precisar de deploy. Filtro de palavra nao pega tudo: e a primeira
     barreira. As outras sao o aceite das regras, a denuncia e o botao de
     encerrar do dono. */
  const MV_TERMOS={"grupos":{"drogas":["maconha","cocaina","crack","oxi","lsd","ecstasy","mdma","haxixe","skunk","heroina","ketamina","lanca perfume","cogumelo magico","cogumelos magicos","psilocibina","thc","cbd","entorpecente","entorpecentes"],"armas":["arma de fogo","armas de fogo","pistola","pistolas","revolver","revolveres","fuzil","fuzis","espingarda","espingardas","carabina","metralhadora","submetralhadora","municao","municoes","simulacro","explosivo","explosivos","dinamite","granada","soco ingles","taser","arma de choque","spray de pimenta","silenciador"],"sexual":["sexo","porno","pornografia","conteudo adulto","nude","nudes","pack de fotos","acompanhante","acompanhantes","garota de programa","garoto de programa","programa sexual","onlyfans","xvideos","sexo ao vivo","erotico","erotica","sex shop","vibrador","novinha","novinhas"],"medicamentos":["anabolizante","anabolizantes","esteroide","esteroides","sibutramina","ozempic","mounjaro","semaglutida","tirzepatida","tarja preta","receita controlada","rivotril","clonazepam","ritalina","zolpidem","viagra","cytotec","misoprostol","abortivo"],"tabaco":["vape","vapes","pod descartavel","cigarro eletronico","cigarros eletronicos","juul","cigarro","cigarros","tabaco"],"fraude":["dinheiro falso","nota falsa","notas falsas","cedula falsa","cartao clonado","cartoes clonados","documento falso","cnh falsa","rg falso","diploma falso","atestado falso","conta hackeada","dados de cartao","roubado","roubada","roubados","furtado","furtada"],"apostas":["bet365","rifa","rifas","sorteio","sorteios","jogo do bicho","aposta","apostas","bet","cassino","tigrinho","fortune tiger","bingo"],"animais":["animal silvestre","animais silvestres","trafico de animais"],"golpe":["piramide financeira","renda garantida","lucro garantido","dinheiro facil"]},"excecoes":["pistola de agua","pistola de cola","pistola de pintura","pistola de ar","pistola de solda","sexo do bebe","beijo roubado","beijos roubados","bingo de sabores"]};
  let MV_TERMOS_EXTRAS=[];
  const MV_LEET={'0':'o','@':'a','4':'a','1':'i','!':'i','3':'e','$':'s'};
  /* digito vira letra so ENTRE letras (c0caina -> cocaina), sem estragar bet365 */
  function mvNormaliza(s){return (' '+String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/([a-z])([0@41!3$]+)(?=[a-z]|[^a-z0-9]|$)/g,(m,a,d)=>a+d.split('').map(c=>MV_LEET[c]).join('')).replace(/[^a-z0-9]+/g,' ')+' ');}
  function mvProibido(s){
    let n=mvNormaliza(s);
    MV_TERMOS.excecoes.forEach(e=>{n=n.split(' '+e+' ').join(' ');});
    for(const g in MV_TERMOS.grupos)for(const t of MV_TERMOS.grupos[g])if(n.includes(' '+t+' '))return {grupo:g,termo:t};
    for(const t of MV_TERMOS_EXTRAS){const x=mvNormaliza(t).trim();if(x&&n.includes(' '+x+' '))return {grupo:'extra',termo:x};}
    return null;
  }


/* ---------------------------------------------------------------- util */
function valorMin() { const v = Number(process.env.CHECKOUT_MIN); return v > 0 ? v : 20; }
function so(d) { return String(d == null ? '' : d).replace(/\D/g, ''); }
function txt(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }
function hoje() { return new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10); }
function precoNum(v) {
  const t = String(v == null ? '' : v).replace(/^R\$\s*/i, '').trim();
  if (!/^\d{1,5}([.,]\d{1,2})?$/.test(t)) return NaN;
  return Math.round(parseFloat(t.replace(',', '.')) * 100) / 100;
}
function ms(t) { return t && typeof t.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : 0); }
function erro(res, cod, e, extra) { return res.status(cod).json(Object.assign({ ok: false, erro: e }, extra || {})); }

function cpfValido(c) {
  c = so(c); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  let s = 0; for (let i = 0; i < 9; i++) s += +c[i] * (10 - i);
  let d = (s * 10) % 11 % 10; if (d !== +c[9]) return false;
  s = 0; for (let i = 0; i < 10; i++) s += +c[i] * (11 - i);
  d = (s * 10) % 11 % 10; return d === +c[10];
}
function cnpjValido(c) {
  c = so(c); if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const calc = (n) => { let s = 0, p = n - 7; for (let i = 0; i < n; i++) { s += +c[i] * p--; if (p < 2) p = 9; } const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return calc(12) === +c[12] && calc(13) === +c[13];
}

/* ------------------------------------------------ cifra da chave da subconta */
function chaveCifra() {
  const f = process.env.CHECKOUT_CHAVE || '';
  if (f.length < 24) return null;                 // falha fechada
  return crypto.createHash('sha256').update(f).digest();
}
function cifrar(t) {
  const k = chaveCifra(); if (!k) throw new Error('CHECKOUT_CHAVE ausente');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const e = Buffer.concat([c.update(String(t), 'utf8'), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), e.toString('base64')].join('.');
}
function decifrar(s) {
  const k = chaveCifra(); if (!k) throw new Error('CHECKOUT_CHAVE ausente');
  const [iv, tag, e] = String(s || '').split('.');
  const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(e, 'base64')), d.final()]).toString('utf8');
}

/* ------------------------------------------------------------ Asaas */
async function asaas(caminho, metodo, corpo, chave) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  let r;
  try {
    r = await fetch(BASE + caminho, {
      method: metodo || 'GET', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Moviki/1.0 (Node.js)', access_token: chave || KEY_MAE },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
  } catch (e) { clearTimeout(t); const x = new Error('asaas_rede'); x.status = 0; throw x; }
  clearTimeout(t);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (data.errors && data.errors[0] && data.errors[0].description) || ('Asaas HTTP ' + r.status);
    console.error('checkout asaas', metodo, caminho.split('/')[1], r.status, msg);
    const x = new Error(msg); x.status = r.status; throw x;
  }
  return data;
}

/* ---------------------------------------------------------- planos */
async function ehEnterprise(uid) {
  const a = await db.collection('assinaturas').doc(uid).get();
  const d = a.exists ? a.data() : null;
  if (!d || d.ativo !== true || d.plano !== 'enterprise') return false;
  const v = ms(d.vence_em);
  return !v || v > Date.now();
}

/* Espelho publico: a pagina da live so mostra "Comprar com Pix" se isto
   disser ativo. Quem escreve e so o servidor. */
async function espelhar(uid, conta) {
  const ativo = !!(conta && conta.ligado === true && conta.aprovada === true);
  await db.collection('checkout_publico').doc(uid).set({ ativo, atualizadoEm: FV.serverTimestamp() }, { merge: true });
  return ativo;
}

/* --------------------------------------------------- situacao da subconta */
function traduzStatus(v) {
  return { APPROVED: 'aprovado', PENDING: 'pendente', AWAITING_APPROVAL: 'em análise', REJECTED: 'recusado' }[v] || (v ? String(v).toLowerCase() : 'pendente');
}
async function situacao(uid) {
  const ref = db.collection('checkout_contas').doc(uid);
  const s = await ref.get();
  if (!s.exists || !s.data().chave) return { temConta: false };
  const c = s.data();
  let chave; try { chave = decifrar(c.chave); } catch (e) { return { temConta: true, erro: 'cifra' }; }
  let st = null, docs = [];
  try { st = await asaas('/myAccount/status', 'GET', null, chave); } catch (e) { st = null; }
  try {
    const d = await asaas('/myAccount/documents', 'GET', null, chave);
    docs = (d && Array.isArray(d.data) ? d.data : []).map((x) => ({
      titulo: txt(x.title || x.type, 80), descricao: txt(x.description, 200), status: traduzStatus(x.status),
      link: (typeof x.onboardingUrl === 'string' && /^https:\/\//.test(x.onboardingUrl)) ? x.onboardingUrl : '',
    }));
  } catch (e) { docs = []; }
  const aprovada = !!(st && st.general === 'APPROVED');
  if (aprovada !== c.aprovada) await ref.set({ aprovada, statusEm: FV.serverTimestamp() }, { merge: true });
  const conta = Object.assign({}, c, { aprovada });
  const ativo = await espelhar(uid, conta);
  return {
    temConta: true, aprovada, ligado: c.ligado === true, ativo, webhookOk: c.webhookOk === true,
    nome: c.nome || '', documento: c.docMascara || '',
    etapas: st ? {
      comercial: traduzStatus(st.commercialInfo), documentos: traduzStatus(st.documentation),
      bancario: traduzStatus(st.bankAccountInfo), geral: traduzStatus(st.general),
    } : null,
    docs,
  };
}

/* --------------------------------------------------- acoes do lojista */
async function lojaCriar(uid, email, b) {
  const ref = db.collection('checkout_contas').doc(uid);
  const ja = await ref.get();
  if (ja.exists && ja.data().chave) return { erro: 'ja_existe' };
  if (!chaveCifra()) return { erro: 'config' };

  const pj = b.tipo === 'pj';
  const doc = so(b.documento);
  if (pj ? !cnpjValido(doc) : !cpfValido(doc)) return { erro: 'documento' };
  const nome = txt(b.nome, 80);
  if (nome.length < 3) return { erro: 'nome' };
  const mail = txt(b.email || email, 120).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return { erro: 'email' };
  const cel = so(b.celular).replace(/^55(?=\d{10,11}$)/, '');
  if (cel.length !== 11) return { erro: 'celular' };
  const cep = so(b.cep);
  if (cep.length !== 8) return { erro: 'cep' };
  const renda = Number(String(b.renda || '').replace(/\./g, '').replace(',', '.'));
  if (!(renda > 0 && renda < 100000000)) return { erro: 'renda' };
  const nasc = String(b.nascimento || '');
  if (!pj && !/^\d{4}-\d{2}-\d{2}$/.test(nasc)) return { erro: 'nascimento' };
  const TIPOS_PJ = ['MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION'];
  if (pj && TIPOS_PJ.indexOf(b.tipoEmpresa) < 0) return { erro: 'tipoEmpresa' };
  const endereco = txt(b.endereco, 120), numero = txt(b.numero, 12), bairro = txt(b.bairro, 60);
  if (!endereco || !numero || !bairro) return { erro: 'endereco' };

  const corpo = {
    name: nome, email: mail, cpfCnpj: doc, mobilePhone: cel, incomeValue: renda,
    address: endereco, addressNumber: numero, complement: txt(b.complemento, 60) || undefined,
    province: bairro, postalCode: cep,
  };
  if (pj) corpo.companyType = b.tipoEmpresa; else corpo.birthDate = nasc;

  /* Marca ANTES de chamar o Asaas: se a funcao cair no meio, o dono sabe
     que houve tentativa (a chave da subconta so vem UMA vez, na resposta). */
  await ref.set({ uid, criandoEm: FV.serverTimestamp() }, { merge: true });
  let r;
  try { r = await asaas('/accounts', 'POST', corpo); }
  catch (e) { await ref.set({ ultimoErro: txt(e.message, 200) }, { merge: true }); return { erro: 'asaas', mensagem: txt(e.message, 200) }; }
  if (!r || !r.apiKey || !r.walletId) { console.error('checkout: subconta sem apiKey', r && r.id); return { erro: 'asaas', mensagem: 'O Asaas não devolveu a chave da conta.' }; }
  console.log('checkout: subconta criada', uid, r.id, r.walletId);   // rastro para recuperar pelo suporte
  await ref.set({
    uid, chave: cifrar(r.apiKey), walletId: r.walletId, contaId: r.id,
    nome, tipo: pj ? 'pj' : 'pf', docMascara: pj ? doc.slice(0, 2) + '.***.***/****-' + doc.slice(-2) : '***.***.***-' + doc.slice(-2),
    email: mail, ligado: false, aprovada: false, criadaEm: FV.serverTimestamp(), ultimoErro: FV.delete(),
  }, { merge: true });

  /* Webhook da subconta -> o mesmo /api/webhook do robo. Falha aqui nao
     derruba nada: o compra_status confere o pagamento direto no Asaas. */
  const tokenWh = process.env.ASAAS_WEBHOOK_TOKEN_PEDIDOS || process.env.ASAAS_WEBHOOK_TOKEN || '';
  if (tokenWh) {
    try {
      await asaas('/webhooks', 'POST', {
        name: 'Moviki pedidos', url: WEBHOOK_URL, email: 'suporte@moviki.com.br', enabled: true,
        interrupted: false, apiVersion: 3, authToken: tokenWh, sendType: 'SEQUENTIALLY', events: EVENTOS_PAGTO,
      }, r.apiKey);
      await ref.set({ webhookOk: true }, { merge: true });
    } catch (e) { await ref.set({ webhookOk: false, webhookErro: txt(e.message, 200) }, { merge: true }); }
  }
  return situacao(uid);
}

async function lojaLigar(uid, ligado) {
  const ref = db.collection('checkout_contas').doc(uid);
  const s = await ref.get();
  if (!s.exists || !s.data().chave) return { erro: 'sem_conta' };
  await ref.set({ ligado: ligado === true }, { merge: true });
  return situacao(uid);
}

async function lojaPedido(uid, pedidoId, novo) {
  if (['entregue', 'cancelado', 'conferir'].indexOf(novo) < 0) return { erro: 'status' };
  const ref = db.collection('pedidos').doc(String(pedidoId || '').slice(0, 60));
  const s = await ref.get();
  if (!s.exists || s.data().lojistaUid !== uid) return { erro: 'nao_encontrado' };
  const p = s.data();
  /* 'conferir': o lojista pergunta ao Asaas se o Pix caiu. E o plano B do
     plano B — cobre o comprador que fechou a tela e um webhook que falhou. */
  if (novo === 'conferir') {
    if (p.status !== 'aguardando') return { ok: true, status: p.status };
    const st = await confirmarNoAsaas(p, ref.id);
    if (st === 'pago') { await marcarPago(ref); return { ok: true, status: 'pago' }; }
    if (st === 'expirado') { await ref.set({ status: 'expirado' }, { merge: true }); return { ok: true, status: 'expirado' }; }
    if (st === 'erro') return { erro: 'asaas', mensagem: 'O Asaas não respondeu. Tente de novo.' };
    if (st === 'divergente') return { ok: true, status: 'divergente' };
    return { ok: true, status: 'aguardando' };
  }
  if (novo === 'cancelado') {
    if (p.status !== 'aguardando') return { erro: 'so_aguardando' };
    try {
      const c = await db.collection('checkout_contas').doc(uid).get();
      await asaas('/payments/' + p.asaasId, 'DELETE', null, decifrar(c.data().chave));
    } catch (e) { /* ja expirada/apagada no Asaas: segue cancelando aqui */ }
  }
  if (novo === 'entregue' && p.status !== 'pago') return { erro: 'so_pago' };
  await ref.set({ status: novo, [novo + 'Em']: FV.serverTimestamp() }, { merge: true });
  return { ok: true };
}

/* --------------------------------------------------- acoes do cliente */
async function freio(ip) {
  const h = crypto.createHash('sha256').update(String(ip || 'x')).digest('hex').slice(0, 24);
  const ref = db.collection('checkout_freio').doc('_ip_' + h);
  const agora = Date.now();
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    let d = s.exists ? s.data() : { ini: agora, n: 0 };
    if (agora - (d.ini || 0) > 600000) d = { ini: agora, n: 0 };
    if (d.n >= 30) return false;   // 4G usa IP compartilhado (CGNAT): folga para varios compradores
    tx.set(ref, { ini: d.ini, n: d.n + 1, expiraEm: admin.firestore.Timestamp.fromMillis(agora + 86400000) });
    return true;
  });
}

/* O preco NUNCA vem do navegador: sai do estado da live, que so o dono
   escreve. Oferta relampago ativa manda sobre o preco da live, que manda
   sobre o preco do cardapio. */
function acharProduto(est, nome) {
  const lista = [].concat(Array.isArray(est.sacola) ? est.sacola : [], est.fixado ? [est.fixado] : []);
  const p = lista.find((x) => x && x.nome === nome);
  if (!p) return null;
  const of = est.oferta;
  const ofOk = of && of.nome === nome && ms(of.fimEm) > Date.now();
  const preco = ofOk ? precoNum(of.precoPor) : precoNum(p.precoLive || p.preco);
  return { nome: txt(p.nome, 60), preco, oferta: !!ofOk, estoque: ofOk ? Number(of.estoque || 0) : 0, vendidos: ofOk ? Number(of.vendidos || 0) : 0 };
}

async function compraCriar(b, ip) {
  const lojistaUid = String(b.lojistaUid || '').slice(0, 128);
  if (!/^[A-Za-z0-9]{10,128}$/.test(lojistaUid)) return { erro: 'dados' };
  const nome = txt(b.nome, 60), cpf = so(b.cpf), wpp = so(b.whatsapp).replace(/^55(?=\d{10,11}$)/, '');
  const qtd = Math.max(1, Math.min(MAX_QTD, parseInt(b.qtd, 10) || 1));
  if (nome.split(' ').filter(Boolean).length < 2) return { erro: 'nome' };
  if (!cpfValido(cpf)) return { erro: 'cpf' };
  if (wpp.length !== 10 && wpp.length !== 11) return { erro: 'whatsapp' };
  const tipoEntrega = b.entrega === 'entrega' ? 'entrega' : 'retirada';
  const detalhe = txt(b.detalhe, 140);
  if (tipoEntrega === 'entrega' && detalhe.length < 5) return { erro: 'endereco' };
  if (b.aceite !== true) return { erro: 'aceite' };   // LGPD: consentimento explicito

  if (!(await freio(ip))) return { erro: 'freio' };

  const [estS, contaS, pubS, blS, termS] = await Promise.all([
    db.collection('negocios').doc(lojistaUid).collection('estado').doc('live').get(),
    db.collection('checkout_contas').doc(lojistaUid).get(),
    db.collection('negocios').doc(lojistaUid).get(),
    db.collection('live_bloqueios').doc(lojistaUid).get(),
    db.collection('configuracoes').doc('liveTermos').get(),
  ]);
  /* Chave-mestra do dono: live desligada = nao nasce cobranca nova. */
  if (termS.exists && termS.data().liveDesligada === true) return { erro: 'live_fora' };
  if (blS.exists) { const ate = ms(blS.data().ate); if (!ate || ate > Date.now()) return { erro: 'indisponivel' }; }
  MV_TERMOS_EXTRAS = (termS.exists && Array.isArray(termS.data().extras)) ? termS.data().extras.filter((x) => typeof x === 'string').slice(0, 300) : [];
  const est = estS.exists ? estS.data() : {};
  if (!(est.ativa === true && Date.now() - ms(est.pulso) < 180000)) return { erro: 'live_fora' };
  if (!(await ehEnterprise(lojistaUid))) return { erro: 'indisponivel' };
  const conta = contaS.exists ? contaS.data() : null;
  if (!conta || !conta.chave || conta.ligado !== true || conta.aprovada !== true) return { erro: 'indisponivel' };

  const p = acharProduto(est, String(b.produto || ''));
  if (!p || !(p.preco > 0)) return { erro: 'produto' };
  if (mvProibido(p.nome)) return { erro: 'produto' };
  if (p.oferta && p.estoque > 0 && p.vendidos + qtd > p.estoque) return { erro: 'esgotado' };
  const total = Math.round(p.preco * qtd * 100) / 100;
  if (total < valorMin()) return { erro: 'minimo', minimo: valorMin() };

  const chaveConta = decifrar(conta.chave);
  const negNome = txt((pubS.exists && pubS.data().nome) || 'Moviki', 60);
  const pedidoRef = db.collection('pedidos').doc();
  const segredo = crypto.randomBytes(16).toString('hex');

  let cli, pay, qr;
  try {
    cli = await asaas('/customers', 'POST', { name: nome, cpfCnpj: cpf, mobilePhone: wpp, notificationDisabled: true, externalReference: 'mv-cli-' + pedidoRef.id }, chaveConta);
    const corpo = {
      customer: cli.id, billingType: 'PIX', value: total, dueDate: hoje(),
      description: (qtd > 1 ? qtd + 'x ' : '') + p.nome + ' — ' + negNome + ' (live Moviki)',
      externalReference: 'pedido:' + pedidoRef.id,
    };
    const taxa = Number(process.env.MOVIKI_TAXA_PCT || 0), wallet = process.env.MOVIKI_WALLET_ID || '';
    if (taxa > 0 && taxa < 50 && wallet) corpo.split = [{ walletId: wallet, percentualValue: taxa }];
    pay = await asaas('/payments', 'POST', corpo, chaveConta);
    qr = await asaas('/payments/' + pay.id + '/pixQrCode', 'GET', null, chaveConta);
  } catch (e) {
    return { erro: 'asaas', mensagem: e.status === 0 ? 'O banco não respondeu. Tente de novo.' : txt(e.message, 160) };
  }

  await pedidoRef.set({
    lojistaUid, liveId: String(ms(est.inicio) || ''), dia: hoje(),
    itens: [{ nome: p.nome, preco: p.preco, qtd }], total, oferta: p.oferta,
    comprador: { nome, whatsapp: wpp, cpfFinal: cpf.slice(-2) },
    entrega: { tipo: tipoEntrega, detalhe }, mostrarNome: b.mostrarNome === true,
    aceite: { versao: POLITICA_VERSAO, em: FV.serverTimestamp() },
    status: 'aguardando', asaasId: pay.id, asaasCliente: cli.id,
    segredoHash: crypto.createHash('sha256').update(segredo).digest('hex'),
    criadoEm: FV.serverTimestamp(), expiraEm: admin.firestore.Timestamp.fromMillis(Date.now() + PEDIDO_RETENCAO_MS),
  });
  return {
    ok: true, pedidoId: pedidoRef.id, chave: segredo, total, produto: p.nome, qtd,
    pix: { imagem: String(qr.encodedImage || ''), copiaCola: String(qr.payload || ''), expira: qr.expirationDate || '' },
    validadeMin: PEDIDO_VALIDADE_MIN,
  };
}

/* Marca pago UMA vez (transacao): baixa o estoque da oferta e, se o
   comprador deixou, poe "Fulano comprou" no chat — prova social que e
   verdade, porque so nasce de pagamento confirmado. */
async function marcarPago(pedidoRef) {
  let efeito = null;
  await db.runTransaction(async (tx) => {
    const s = await tx.get(pedidoRef);
    if (!s.exists) return;
    const p = s.data();
    if (p.status === 'pago' || p.status === 'entregue') return;
    const liveRef = db.collection('negocios').doc(p.lojistaUid).collection('estado').doc('live');
    const ls = await tx.get(liveRef);
    tx.update(pedidoRef, { status: 'pago', pagoEm: FV.serverTimestamp(), alerta: FV.delete(),
      expiraEm: admin.firestore.Timestamp.fromMillis(Date.now() + PEDIDO_RETENCAO_PAGO_MS) });
    const it = (p.itens && p.itens[0]) || {};
    if (p.oferta && ls.exists) {
      const of = ls.data().oferta;
      if (of && of.nome === it.nome && String(ms(ls.data().inicio)) === p.liveId) {
        tx.update(liveRef, { 'oferta.vendidos': FV.increment(Number(it.qtd) || 1) });
      }
    }
    efeito = p;
  });
  if (efeito && efeito.mostrarNome) {
    try {
      const primeiro = String((efeito.comprador && efeito.comprador.nome) || '').split(' ')[0].slice(0, 20);
      const it = (efeito.itens && efeito.itens[0]) || {};
      await db.collection('negocios').doc(efeito.lojistaUid).collection('livechat').add({
        nome: primeiro, texto: String(it.nome || '').slice(0, 100), tipo: 'venda',
        criadoEm: FV.serverTimestamp(), expiraEm: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 86400000),
      });
    } catch (e) { console.error('checkout chat venda', e.message); }
  }
  return !!efeito;
}

async function compraStatus(b) {
  const id = String(b.pedidoId || '').slice(0, 60);
  if (!/^[A-Za-z0-9]{10,60}$/.test(id)) return { erro: 'dados' };
  const ref = db.collection('pedidos').doc(id);
  const s = await ref.get();
  if (!s.exists) return { erro: 'nao_encontrado' };
  const p = s.data();
  const h = crypto.createHash('sha256').update(String(b.chave || '')).digest('hex');
  if (!p.segredoHash || h.length !== p.segredoHash.length || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(p.segredoHash))) return { erro: 'nao_encontrado' };
  let status = p.status;
  /* Plano B do webhook: se ainda esta aguardando, pergunta ao Asaas
     (no maximo a cada 8 s por pedido). */
  if (status === 'aguardando' && Date.now() - ms(p.conferidoEm) > 8000) {
    await ref.set({ conferidoEm: admin.firestore.Timestamp.now() }, { merge: true });
    const st = await confirmarNoAsaas(p, id);
    if (st === 'pago') { await marcarPago(ref); status = 'pago'; }
    else if (st === 'expirado') { await ref.set({ status: 'expirado' }, { merge: true }); status = 'expirado'; }
  }
  return { ok: true, status };
}

/* Confere o pagamento DIRETO no Asaas, com a chave da subconta: status,
   valor e referencia. Nenhum aviso de "pago" e aceito sem esta conferencia
   (Guia de Seguranca, item 1). Devolve 'pago' | 'expirado' | 'aguardando' |
   'divergente' | 'erro'. */
async function confirmarNoAsaas(p, pedidoId) {
  try {
    const c = await db.collection('checkout_contas').doc(p.lojistaUid).get();
    if (!c.exists || !c.data().chave) return 'erro';
    const pay = await asaas('/payments/' + p.asaasId, 'GET', null, decifrar(c.data().chave));
    if (pay.externalReference && pay.externalReference !== 'pedido:' + pedidoId) return 'divergente';
    if (PAGO.indexOf(pay.status) >= 0) {
      if (Math.abs(Number(pay.value) - Number(p.total)) > 0.01) { console.error('checkout: valor divergente', pedidoId, pay.value, p.total); return 'divergente'; }
      return 'pago';
    }
    if (pay.status === 'OVERDUE' || pay.deleted) return 'expirado';
    return 'aguardando';
  } catch (e) { return 'erro'; }
}

/* ------------------------------------------------------- webhook */
async function webhookPedido(tipo, pay) {
  const id = String(pay.externalReference || '').slice(7);
  if (!/^[A-Za-z0-9]{10,60}$/.test(id)) return { ignorado: 'id' };
  const ref = db.collection('pedidos').doc(id);
  const s = await ref.get();
  if (!s.exists) return { ignorado: 'pedido' };
  if (s.data().asaasId && pay.id && s.data().asaasId !== pay.id) return { ignorado: 'cobranca' };
  if (tipo === 'PAYMENT_RECEIVED' || tipo === 'PAYMENT_CONFIRMED') {
    const st = await confirmarNoAsaas(s.data(), id);
    if (st === 'pago') { await marcarPago(ref); return { pedido: id, status: 'pago' }; }
    if (st === 'divergente') await ref.set({ alerta: 'divergente', alertaEm: FV.serverTimestamp() }, { merge: true });
    /* 200 mesmo sem confirmar: devolver erro faria o Asaas pausar a fila da
       subconta. A tela do comprador e o botao do lojista conferem de novo. */
    return { pedido: id, naoConfirmado: st };
  }
  const mapa = { PAYMENT_OVERDUE: 'expirado', PAYMENT_DELETED: 'cancelado', PAYMENT_REFUNDED: 'estornado' };
  if (mapa[tipo]) {
    const atual = s.data().status;
    if (!(mapa[tipo] !== 'estornado' && (atual === 'pago' || atual === 'entregue'))) await ref.set({ status: mapa[tipo], [mapa[tipo] + 'Em']: FV.serverTimestamp() }, { merge: true });
    return { pedido: id, status: mapa[tipo] };
  }
  return { ignorado: tipo };
}

/* ----------------------------------------------------- roteador HTTP
   Chamado pelo api/pontos.js ANTES da exigencia de login dele. Devolve
   true quando tratou a requisicao. */
/* Lista de liberacao do beta, em configuracoes/liveTermos.liveBeta.
   Vazia ou ausente = todo mundo. Falha ABERTA de proposito: se o documento
   nao puder ser lido, nao e este o lugar de barrar venda — as portas de
   dinheiro sao outras. */
async function noBeta(uid) {
  try {
    const t = await db.collection('configuracoes').doc('liveTermos').get();
    const l = t.exists && Array.isArray(t.data().liveBeta) ? t.data().liveBeta : [];
    return !l.length || l.indexOf(uid) >= 0;
  } catch (e) { return true; }
}

/* ---------------------------------------------------- conferencia do dono
   Chamada SO DE LEITURA: lista as subcontas da conta-mae. Nao cria, nao
   cobra, nao altera nada. Serve para responder duas perguntas que so o
   Asaas sabe: a conta ja pode criar subconta por API, e quantas existem
   de verdade (o teto do periodo de avaliacao e 10). */
async function admAsaas() {
  if (!KEY_MAE) return { erro: 'sem_chave' };
  let r;
  try { r = await asaas('/accounts?limit=100', 'GET'); }
  catch (e) {
    if (e.status === 401 || e.status === 403) return { ok: true, liberado: false, motivo: 'permissao', mensagem: txt(e.message, 200) };
    if (e.status === 0) return { erro: 'rede' };
    return { ok: true, liberado: false, motivo: 'erro', status: e.status || 0, mensagem: txt(e.message, 200) };
  }
  const lista = Array.isArray(r && r.data) ? r.data : [];
  return {
    ok: true, liberado: true, total: Number((r && r.totalCount) || lista.length) || lista.length,
    teto: 10,
    contas: lista.slice(0, 100).map((c) => ({
      id: txt(c.id, 40), nome: txt(c.name, 80), doc: txt(String(c.cpfCnpj || '').slice(-4), 4),
      email: txt(c.email, 80), criadoEm: txt(c.dateCreated || c.createdAt || '', 30),
    })),
  };
}

function ehAcao(acao) { return /^(loja|compra|adm)_/.test(String(acao || '')); }

async function tratar(req, res, body) {
  const o = req.headers.origin || '';
  if (ORIGENS.indexOf(o) >= 0) { res.setHeader('Access-Control-Allow-Origin', o); res.setHeader('Vary', 'Origin'); }
  const acao = String(body.acao || '');
  try {
    if (acao === 'compra_criar' || acao === 'compra_status') {
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
      const r = acao === 'compra_criar' ? await compraCriar(body, ip) : await compraStatus(body);
      return res.status(r.erro ? (r.erro === 'freio' ? 429 : 400) : 200).json(r.erro ? Object.assign({ ok: false }, r) : r);
    }
    /* lojista: login + Enterprise conferidos AQUI */
    let dec;
    try { dec = await admin.auth().verifyIdToken(String(body.idToken || '')); } catch (_) { return erro(res, 401, 'sessao'); }

    /* dono do Moviki: conferido em admins/{uid}, no servidor */
    if (acao === 'adm_asaas') {
      const a = await db.collection('admins').doc(dec.uid).get();
      if (!a.exists) return erro(res, 403, 'nao_admin');
      const r = await admAsaas();
      return res.status(r.erro ? 400 : 200).json(r.erro ? Object.assign({ ok: false }, r) : r);
    }
    if (/^adm_/.test(acao)) return erro(res, 400, 'acao');

    if (!(await ehEnterprise(dec.uid))) return erro(res, 403, 'nao_enterprise');

    /* Beta fechado: enquanto a lista tiver alguem, so quem esta nela abre
       subconta. Sem isso, um lojista fora do beta queimaria uma das 10 vagas
       do periodo de avaliacao do Asaas. Lista vazia = aberto a todos. */
    if (acao === 'loja_criar' && !(await noBeta(dec.uid))) return erro(res, 403, 'beta');

    let r;
    if (acao === 'loja_estado') r = await situacao(dec.uid);
    else if (acao === 'loja_criar') r = await lojaCriar(dec.uid, dec.email || '', body.dados || {});
    else if (acao === 'loja_ligar') r = await lojaLigar(dec.uid, body.ligado === true);
    else if (acao === 'loja_pedido') r = await lojaPedido(dec.uid, body.pedidoId, body.status);
    else return erro(res, 400, 'acao');
    return res.status(r.erro ? 400 : 200).json(r.erro ? Object.assign({ ok: false }, r) : Object.assign({ ok: true }, r));
  } catch (e) {
    console.error('checkout erro', acao, e);
    return erro(res, 500, 'interno');
  }
}

module.exports = { ehAcao, tratar, webhookPedido, _t: { cpfValido, cnpjValido, cifrar, decifrar, acharProduto, precoNum, mvProibido } };
