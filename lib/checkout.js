/*!
 * MOVIKI lib/checkout.js | versao 2026-09-16-livesessao | repo: moviki-robo
 *
 * CHECKOUT DO MOVIKI — LIVE E CARDAPIO, EM TRES MODOS
 * O cliente final paga DENTRO do Moviki, por Pix, e o dinheiro cai na conta
 * do LOJISTA — nunca na da Eiko.
 *
 * OS TRES MODOS (decisao de 14/09/2026)
 *   A) 'pix'      PADRAO. Chave Pix do proprio lojista; o copia-e-cola sai do
 *                 lib/pix.js, aqui no servidor. Sem gateway, sem tarifa, sem
 *                 teto de subconta. A confirmacao e do lojista, que confere o
 *                 extrato pelos centavos identificadores.
 *   B) 'asaas'    UPGRADE. Conta Asaas DO LOJISTA, conectada por chave de API.
 *                 Confirmacao automatica por webhook, tarifa por conta dele.
 *                 Nao usa subconta e nao consome o teto de 10.
 *   C) 'subconta' LEGADO. Subconta Asaas criada pela conta-mae. Continua
 *                 funcionando para quem ja tinha, mas nao e mais o caminho
 *                 oferecido.
 *
 * ONDE SE VENDE
 *   live     — so Enterprise, como sempre foi.
 *   cardapio — Premium e Enterprise. O preco sai do cardapio do lojista, nunca
 *              do navegador.
 *
 * O Moviki nao recebe, nao guarda e nao repassa dinheiro de venda: nao vira
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
 *   recebimento/{uid}       modo em vigor + chave Pix CIFRADA + chave de API
 *                           do Asaas do lojista CIFRADA. Sem match nas regras.
 *   checkout_contas/{uid}   chave da subconta CIFRADA (AES-256-GCM), walletId,
 *                           status. Sem match nas regras: ninguem le pelo app.
 *   checkout_publico/{uid}  { ativo, modo, minimo, entrega } — o que a pagina
 *                           da live e a do cardapio consultam.
 *   pedidos/{id}            o pedido; o lojista le os proprios.
 *   pedidos comprovante     imagem no Storage, gravada pelo Admin SDK, lida
 *                           por link assinado de 20 minutos.
 *   financeiro_trilha/{id}  rastro de tudo que mexe em dinheiro (artigo 9).
 *   checkout_freio/{id}     freio anti-abuso por IP e por negocio.
 *
 * ENVS NOVAS (Vercel do moviki-robo, Production)
 *   CHECKOUT_CHAVE              obrigatoria: frase longa e aleatoria que cifra
 *                               a chave de API de cada subconta. Sem ela nada
 *                               funciona (falha fechada). NUNCA trocar depois
 *                               de criar subconta: a chave antiga fica ilegivel.
 *   ASAAS_WEBHOOK_TOKEN_PEDIDOS opcional: token do webhook das subcontas. Sem
 *                               ela, usa o ASAAS_WEBHOOK_TOKEN de sempre.
 *   CHECKOUT_MIN_PIX            opcional: piso do pedido no modo Pix direto
 *                               (padrao 5). Sem tarifa, o piso pode ser baixo.
 *   CHECKOUT_MIN                opcional: valor minimo do pedido (padrao 20).
 *                               O Asaas cobra R$ 1,99 FIXOS por Pix recebido, da
 *                               subconta do lojista. Em pedido de R$ 5 isso e 40%
 *                               da venda; em R$ 20 e 10%. Por isso o piso de 20.
 *   MOVIKI_TAXA_PCT / MOVIKI_WALLET_ID  opcionais, para o futuro.
 *   RESEND_API_KEY              ja existe no projeto: e por ela que sai o
 *                               aviso de pedido novo para o lojista.
 *
 * ---- 15/09/2026: TOKEN DE WEBHOOK POR SUBCONTA ----
 * O webhook de uma subconta era registrado com o MESMO token para todas elas
 * (ASAAS_WEBHOOK_TOKEN_PEDIDOS). A subconta e aberta com o nome, o CPF e o
 * E-MAIL DO LOJISTA: ele entra no Asaas e le esse token em Integracoes. Com o
 * token na mao, e como o /api/webhook aceitava qualquer token para qualquer
 * evento, dava para postar PAYMENT_RECEIVED com o externalReference de
 * qualquer uid e LIGAR ASSINATURA DE GRACA — para si ou para terceiros — alem
 * de fabricar comissao com o `value` do proprio payload.
 *
 * Agora cada subconta nasce com um token PROPRIO e aleatorio:
 *   - gerado aqui, passado ao Asaas dentro do proprio POST /accounts (campo
 *     `webhooks`, documentado em docs.asaas.com) — uma chamada a menos;
 *   - guardado cifrado em checkout_contas/{uid}.whToken;
 *   - indexado em checkout_tokens/{sha256(token)} -> { uid }, que e como o
 *     api/webhook.js descobre, em uma leitura, de qual subconta veio a chamada.
 * O token de uma subconta so vale para o ramo `pedido:`. Quem faz valer e o
 * api/webhook.js.
 *
 * ROTACAO: `adm_wh_rotacionar` troca o token de uma subconta ja existente sem
 * recriar a conta. E o caminho de saida para as subcontas que nasceram com o
 * token compartilhado. Depois de rotacionar todas, APAGUE a env
 * ASAAS_WEBHOOK_TOKEN_PEDIDOS — enquanto ela existir, o token velho continua
 * sendo aceito no ramo de pedido.
 *
 * ---- 15/09/2026: CONFIRMACAO NO MODO B (asaas conectado) ----
 * confirmarNoAsaas lia SEMPRE checkout_contas/{uid}, que so existe no modo
 * subconta. No modo 'asaas' a chave mora em recebimento/{uid}.asaasChave,
 * entao a funcao devolvia 'erro' para sempre: o comprador pagava, o webhook
 * nao confirmava, o botao Conferir pagamento nao confirmava, e o pedido ficava
 * `aguardando` eternamente. Agora a chave e escolhida pelo `modo` do pedido.
 *
 * ---- 15/09/2026: AVISO DE PEDIDO PARA O LOJISTA ----
 * Ate aqui, pedido novo nao avisava NINGUEM. O unico Telegram do arquivo e o
 * do dono do Moviki, para troca de chave Pix. No Pix direto quem confirma o
 * pagamento e o lojista: sem aviso, a venda so anda se ele estiver com o
 * painel aberto na hora — e o pedido expira em 30 minutos na tela do
 * comprador.
 *
 * POR QUE E-MAIL E NAO WHATSAPP
 * Mandar WhatsApp por conta propria exige a API oficial da Meta (Cloud API):
 * conta business verificada, numero proprio e TEMPLATE APROVADO pela Meta para
 * qualquer mensagem iniciada pela empresa, com custo por conversa. Os atalhos
 * nao-oficiais (bots que abrem sessao de WhatsApp pessoal) sao violacao dos
 * Termos da Meta e custam o numero do lojista. E-mail chega em todo lojista,
 * hoje, sem cadastro nenhum e sem depender de aprovacao de terceiro. O
 * WhatsApp oficial fica registrado como projeto proprio.
 *
 * O QUE O E-MAIL NAO LEVA
 * Nome, telefone e endereco do comprador NAO vao no e-mail. Ele diz o valor,
 * quantos itens, se e retirada ou entrega, e manda abrir o painel. Dado
 * pessoal de terceiro fica atras do login, nao numa caixa de entrada que o
 * lojista abre no meio da rua — e e o que a LGPD chama de minimizacao.
 */
'use strict';

const crypto = require('crypto');
const { admin, db } = require('./firebase');
const pix = require('./pix');

/* FALHA FECHADA — 14/09/2026. Sem ASAAS_BASE_URL, isto aqui caia no SANDBOX
   sem avisar: o comprador via um QR que nunca cairia na conta de ninguem e a
   tela continuava normal. Em producao, a falta da variavel (ou uma variavel
   apontando para o sandbox) passa a derrubar a chamada. */
const SANDBOX_ASAAS = 'https://api-sandbox.asaas.com/v3';
const EH_PRODUCAO = process.env.VERCEL_ENV === 'production';
const BASE = process.env.ASAAS_BASE_URL || SANDBOX_ASAAS;
function conferirAmbiente() {
  if (!EH_PRODUCAO) return;
  if (!process.env.ASAAS_BASE_URL) throw new Error('ASAAS_BASE_URL ausente em producao');
  if (/sandbox/i.test(BASE)) throw new Error('ASAAS_BASE_URL aponta para o SANDBOX em producao');
}
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

/* --------------------------------- token de webhook, um por subconta */
/* O indice vive em checkout_tokens/{sha256(token)}. Guardar o HASH, e nao o
   token, quer dizer que quem conseguir ler a colecao nao consegue assinar
   chamada nenhuma — e a busca continua sendo uma leitura direta, sem varrer. */
function hashToken(t) { return crypto.createHash('sha256').update(String(t || '')).digest('hex'); }
function novoTokenWebhook() { return crypto.randomBytes(24).toString('hex'); }

async function indexarToken(uid, token) {
  await db.collection('checkout_tokens').doc(hashToken(token)).set({
    uid, criadoEm: FV.serverTimestamp(),
  }, { merge: true });
}

/* Usado pelo api/webhook.js. Devolve o uid da subconta dona do token, ou ''.
   Nunca lanca: token desconhecido e caso normal (chamada forjada). */
async function uidPorTokenWebhook(token) {
  const t = String(token || '');
  if (t.length < 20 || t.length > 200) return '';
  try {
    const s = await db.collection('checkout_tokens').doc(hashToken(t)).get();
    return (s.exists && s.data() && s.data().uid) ? String(s.data().uid) : '';
  } catch (e) { return ''; }
}

/* Registra (ou substitui) o webhook de uma subconta com um token novo.
   Idempotente do lado do Asaas: apaga os webhooks que apontam para a nossa URL
   antes de criar o novo, senao o Asaas passaria a entregar em duplicidade. */
async function registrarWebhookSubconta(uid, chaveSubconta, token) {
  try {
    const atuais = await asaas('/webhooks', 'GET', null, chaveSubconta);
    const lista = Array.isArray(atuais && atuais.data) ? atuais.data : [];
    for (const w of lista) {
      if (w && w.url === WEBHOOK_URL && w.id) {
        try { await asaas('/webhooks/' + w.id, 'DELETE', null, chaveSubconta); } catch (_) {}
      }
    }
  } catch (_) { /* listar falhou: segue e cria — duplicata e menos grave que ficar sem */ }
  await asaas('/webhooks', 'POST', {
    name: 'Moviki pedidos', url: WEBHOOK_URL, email: 'suporte@moviki.com.br', enabled: true,
    interrupted: false, apiVersion: 3, authToken: token, sendType: 'SEQUENTIALLY', events: EVENTOS_PAGTO,
  }, chaveSubconta);
  await indexarToken(uid, token);
  await db.collection('checkout_contas').doc(uid).set({
    whToken: cifrar(token), whTokenHash: hashToken(token), whTokenEm: FV.serverTimestamp(),
    webhookOk: true, webhookErro: FV.delete(),
  }, { merge: true });
}

/* Acao do DONO: troca o token de uma subconta que ja existe. O hash antigo
   continua no indice de proposito — apagar abriria uma janela em que um evento
   ja em transito na fila do Asaas chegaria sem dono e seria recusado. */
async function rotacionarWebhook(uid) {
  const ref = db.collection('checkout_contas').doc(uid);
  const s = await ref.get();
  if (!s.exists || !s.data().chave) return { erro: 'sem_conta' };
  if (!chaveCifra()) return { erro: 'config' };
  let chave;
  try { chave = decifrar(s.data().chave); } catch (e) { return { erro: 'config' }; }
  const token = novoTokenWebhook();
  try { await registrarWebhookSubconta(uid, chave, token); }
  catch (e) { return { erro: 'asaas', mensagem: txt(e.message, 200) }; }
  await trilha(uid, 'webhook_rotacionado', {});
  return { ok: true, uid };
}

/* ------------------------------------------------------------ Asaas */
async function asaas(caminho, metodo, corpo, chave) {
  conferirAmbiente();
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

/* SUBCONTA NOVA: FECHADA — decisao do Paulo em 16/09/2026.
   A subconta consome o teto de 10 do periodo de avaliacao regulatoria do
   Asaas. Estourado o teto, o Asaas bloqueia novas subcontas E CANCELA AS
   ASSINATURAS EXISTENTES — ou seja, o dano nao fica na live: chega na
   mensalidade de todo mundo.
   Desde 14/09 (P31) o caminho oferecido e outro: Pix direto do lojista, ou a
   conta Asaas DELE conectada por chave de API, os dois na aba Financeiro do
   painel. A subconta virou LEGADO.
   Quem ja tem continua funcionando: loja_estado e loja_ligar nao mudam.
   Para reabrir, basta virar esta constante — nao ha codigo apagado. */
const SUBCONTA_NOVA_ABERTA = false;

/* --------------------------------------------------- acoes do lojista */
async function lojaCriar(uid, email, b) {
  const ref = db.collection('checkout_contas').doc(uid);
  const ja = await ref.get();
  if (ja.exists && ja.data().chave) return { erro: 'ja_existe' };
  /* A barreira vem ANTES de qualquer validacao e de qualquer chamada ao
     Asaas: conta nova nao se abre mais por aqui. Falha fechada. */
  if (!SUBCONTA_NOVA_ABERTA) return { erro: 'subconta_fechada' };
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

  /* Token PROPRIO desta subconta, gerado antes da criacao para ir junto no
     POST /accounts. Nunca reaproveita env compartilhada. */
  const tokenWh = novoTokenWebhook();

  const corpo = {
    name: nome, email: mail, cpfCnpj: doc, mobilePhone: cel, incomeValue: renda,
    address: endereco, addressNumber: numero, complement: txt(b.complemento, 60) || undefined,
    province: bairro, postalCode: cep,
    webhooks: [{
      name: 'Moviki pedidos', url: WEBHOOK_URL, email: 'suporte@moviki.com.br', enabled: true,
      interrupted: false, apiVersion: 3, authToken: tokenWh, sendType: 'SEQUENTIALLY', events: EVENTOS_PAGTO,
    }],
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
    whToken: cifrar(tokenWh), whTokenHash: hashToken(tokenWh), whTokenEm: FV.serverTimestamp(),
  }, { merge: true });

  /* O INDICE VEM PRIMEIRO. Se o webhook ja tiver sido criado pelo Asaas (o
     campo `webhooks` do POST /accounts) e o indice ainda nao existir, o
     primeiro evento chegaria com token sem dono e seria recusado. Indexar
     antes de qualquer coisa fecha essa janela. */
  try { await indexarToken(uid, tokenWh); }
  catch (e) { console.error('checkout: indice do token falhou', uid, e && e.message); }

  /* O Asaas ja registra o webhook quando ele vem no corpo da criacao. Conferir
     e barato e evita subconta muda: se a lista nao tiver a nossa URL, registra
     aqui. Falha nao derruba nada — compra_status confere o pagamento direto no
     Asaas de qualquer jeito. */
  try {
    let precisa = true;
    try {
      const atuais = await asaas('/webhooks', 'GET', null, r.apiKey);
      const lista = Array.isArray(atuais && atuais.data) ? atuais.data : [];
      precisa = !lista.some((w) => w && w.url === WEBHOOK_URL);
    } catch (_) { precisa = true; }
    if (precisa) await registrarWebhookSubconta(uid, r.apiKey, tokenWh);
    else await ref.set({ webhookOk: true }, { merge: true });
  } catch (e) {
    await ref.set({ webhookOk: false, webhookErro: txt(e.message, 200) }, { merge: true });
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

async function lojaPedido(uid, pedidoId, novo, motivo) {
  if (['entregue', 'cancelado', 'conferir', 'pago', 'recusado'].indexOf(novo) < 0) return { erro: 'status' };
  const ref = db.collection('pedidos').doc(String(pedidoId || '').slice(0, 60));
  const s = await ref.get();
  if (!s.exists || s.data().lojistaUid !== uid) return { erro: 'nao_encontrado' };
  const p = s.data();

  /* Pedido do modo Pix direto tem regras proprias: quem confirma e o lojista,
     e 'conferir' nao faz sentido (nao ha gateway a quem perguntar). */
  if (p.modo === 'pix') {
    if (novo === 'pago' || novo === 'recusado') return lojaPedidoPix(uid, ref.id, novo, motivo);
    if (novo === 'conferir') return { ok: true, status: p.status };
    if (novo === 'cancelado') {
      if (p.status === 'pago' || p.status === 'entregue') return { erro: 'so_aguardando' };
      await ref.set({ status: 'cancelado', canceladoEm: FV.serverTimestamp() }, { merge: true });
      await trilha(uid, 'pedido_cancelado', { pedido: ref.id });
      return { ok: true };
    }
    if (novo === 'entregue') {
      if (p.status !== 'pago') return { erro: 'so_pago' };
      await ref.set({ status: 'entregue', entregueEm: FV.serverTimestamp() }, { merge: true });
      return { ok: true };
    }
    return { erro: 'status' };
  }
  if (novo === 'pago' || novo === 'recusado') return { erro: 'status' };
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
      const chave = await chaveDoPedido(p);
      if (chave) await asaas('/payments/' + p.asaasId, 'DELETE', null, chave);
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

/* Decide o modo de recebimento em vigor para este negocio.
   Compatibilidade: quem ja tinha subconta ligada antes de 14/09/2026 continua
   funcionando sem precisar reconfigurar nada. */
async function modoDoNegocio(uid) {
  const [r, subS] = await Promise.all([
    recebimentoLer(uid),
    db.collection('checkout_contas').doc(uid).get(),
  ]);
  const d = r || {};
  if (d.ligado === true && MODOS.indexOf(d.modo) >= 0) return { modo: d.modo, r: d, sub: subS.exists ? subS.data() : null };
  const sub = subS.exists ? subS.data() : null;
  if (sub && sub.chave && sub.ligado === true && sub.aprovada === true) return { modo: 'subconta', r: d, sub };
  return { modo: '', r: d, sub };
}

/* Le os itens que o comprador mandou. O navegador diz O QUE e QUANTOS; o
   preco sai SEMPRE daqui (Doutrina, artigo 3). */
function lerItensCardapio(neg, lista) {
  const arr = Array.isArray(lista) ? lista.slice(0, 20) : [];
  if (!arr.length) return { erro: 'produto' };
  const itens = [];
  let total = 0;
  for (const linha of arr) {
    const qtd = Math.max(1, Math.min(MAX_QTD, parseInt(linha && linha.qtd, 10) || 1));
    const achado = acharNoCardapio(neg, linha || {});
    if (!achado) return { erro: 'produto' };
    if (achado.erro === 'sem_preco') return { erro: 'sem_preco' };
    if (mvProibido(achado.nome)) return { erro: 'produto' };
    itens.push({ nome: achado.nome, preco: achado.preco, qtd, sku: achado.sku || '' });
    total += achado.preco * qtd;
  }
  return { itens, total: Math.round(total * 100) / 100 };
}

async function compraCriar(b, ip) {
  const lojistaUid = String(b.lojistaUid || '').slice(0, 128);
  if (!/^[A-Za-z0-9]{10,128}$/.test(lojistaUid)) return { erro: 'dados' };

  /* ---- comprador ---- */
  const nome = txt(b.nome, 60), cpf = so(b.cpf), wpp = so(b.whatsapp).replace(/^55(?=\d{10,11}$)/, '');
  if (nome.split(' ').filter(Boolean).length < 2) return { erro: 'nome' };
  if (!cpfValido(cpf)) return { erro: 'cpf' };
  if (wpp.length !== 10 && wpp.length !== 11) return { erro: 'whatsapp' };
  const tipoEntrega = b.entrega === 'entrega' ? 'entrega' : 'retirada';
  const detalhe = txt(b.detalhe, 140);
  if (tipoEntrega === 'entrega' && detalhe.length < 5) return { erro: 'endereco' };
  if (b.aceite !== true) return { erro: 'aceite' };   // LGPD: consentimento explicito

  /* ---- freios: IP e negocio ---- */
  if (!(await freio(ip))) return { erro: 'freio' };
  if (!(await freioNegocio(lojistaUid))) return { erro: 'freio' };

  const origem = b.origem === 'cardapio' ? 'cardapio' : 'live';

  const [estS, negS, blS, termS, sesS] = await Promise.all([
    origem === 'live' ? db.collection('negocios').doc(lojistaUid).collection('estado').doc('live').get() : Promise.resolve(null),
    db.collection('negocios').doc(lojistaUid).get(),
    db.collection('live_bloqueios').doc(lojistaUid).get(),
    db.collection('configuracoes').doc('liveTermos').get(),
    /* AUTORIDADE da live (correcao de 16/09/2026). Desde o b5b de 15/09 quem
       diz se a live esta no ar e `live_sessoes/{uid}`, escrito so pelo Admin
       SDK. O `estado/live` do lojista continua trazendo o CONTEUDO (produtos,
       oferta, preco), mas grava `ativa:false` e `pulso:null` de proposito —
       ler dali para decidir "no ar" recusava 100% das compras da live com
       `live_fora`, mesmo com a transmissao rodando. */
    origem === 'live' ? db.collection('live_sessoes').doc(lojistaUid).get() : Promise.resolve(null),
  ]);

  /* Chave-mestra do dono: desligou, nao nasce cobranca nova. Vale para os
     dois canais — e o interruptor de emergencia do artigo 10. */
  /* O codigo do erro continua 'live_fora' no canal live: e o que a tela atual
     ja sabe traduzir. Trocar isso por um codigo novo deixaria o comprador com
     mensagem generica sem nenhum ganho. */
  if (termS.exists && termS.data().liveDesligada === true) return { erro: origem === 'live' ? 'live_fora' : 'fora' };
  if (blS.exists) { const ate = ms(blS.data().ate); if (!ate || ate > Date.now()) return { erro: 'indisponivel' }; }
  MV_TERMOS_EXTRAS = (termS.exists && Array.isArray(termS.data().extras)) ? termS.data().extras.filter((x) => typeof x === 'string').slice(0, 300) : [];

  const plano = await planoDe(lojistaUid);
  if (!plano) return { erro: 'indisponivel' };
  const neg = negS.exists ? negS.data() : {};

  const { modo, r, sub } = await modoDoNegocio(lojistaUid);
  if (!modo) return { erro: 'indisponivel' };

  /* ---- o que esta sendo comprado ---- */
  let itens, total, ehOferta = false, liveId = '';
  if (origem === 'live') {
    if (plano !== 'enterprise') return { erro: 'indisponivel' };   // live segue so no Enterprise
    const est = estS && estS.exists ? estS.data() : {};
    /* Quem manda e a sessao do servidor, nao o documento do lojista. */
    const ses = sesS && sesS.exists ? (sesS.data() || {}) : {};
    const pulsoSes = ms(ses.pulsoEm) || Number(ses.pulsoMs) || 0;
    const sessaoViva = ses.ativa === true && !ses.encerradaPor && pulsoSes > 0 && (Date.now() - pulsoSes) < 180000;
    if (!sessaoViva) return { erro: 'live_fora' };
    /* O id da live passa a ser o `sessaoId` carimbado pelo servidor na
       abertura. O `inicio` do documento do lojista nao existe mais. */
    liveId = String(ses.sessaoId || '');
    const qtd = Math.max(1, Math.min(MAX_QTD, parseInt(b.qtd, 10) || 1));
    const p = acharProduto(est, String(b.produto || ''));
    if (!p || !(p.preco > 0)) return { erro: 'produto' };
    if (mvProibido(p.nome)) return { erro: 'produto' };
    if (p.oferta && p.estoque > 0 && p.vendidos + qtd > p.estoque) return { erro: 'esgotado' };
    itens = [{ nome: p.nome, preco: p.preco, qtd }];
    total = Math.round(p.preco * qtd * 100) / 100;
    ehOferta = !!p.oferta;
  } else {
    // Cardapio compravel: Premium e Enterprise (decisao de 14/09/2026).
    if (neg.vendaAtiva === false) return { erro: 'indisponivel' };
    const lido = lerItensCardapio(neg, b.itens);
    if (lido.erro) return { erro: lido.erro };
    itens = lido.itens;
    total = lido.total;
  }

  const minimo = minimoDoModo(modo);
  if (total < minimo) return { erro: 'minimo', minimo };

  const negNome = txt(neg.nome || 'Moviki', 60);
  const comprador = { nome, whatsapp: wpp, cpfFinal: cpf.slice(-2) };
  const entrega = { tipo: tipoEntrega, detalhe };

  /* ---- MODO A: Pix direto do lojista ---- */
  if (modo === 'pix') {
    if (!(r && r.pix && r.pix.chaveCifrada)) return { erro: 'indisponivel' };
    const feito = await criarPedidoPix({ lojistaUid, r, itens, total, comprador, entrega, origem, liveId, negNome });
    if (feito.erro) return feito;
    feito.mostrarNome = b.mostrarNome === true;
    if (feito.mostrarNome) await db.collection('pedidos').doc(feito.pedidoId).set({ mostrarNome: true, oferta: ehOferta }, { merge: true });
    else if (ehOferta) await db.collection('pedidos').doc(feito.pedidoId).set({ oferta: true }, { merge: true });
    return feito;
  }

  /* ---- MODOS B e C: cobranca pelo Asaas ---- */
  let chaveConta;
  if (modo === 'asaas') {
    if (!(r && r.asaasChave)) return { erro: 'indisponivel' };
    try { chaveConta = decifrar(r.asaasChave); } catch (e) { return { erro: 'config' }; }
  } else {
    if (!(sub && sub.chave)) return { erro: 'indisponivel' };
    try { chaveConta = decifrar(sub.chave); } catch (e) { return { erro: 'config' }; }
  }

  const pedidoRef = db.collection('pedidos').doc();
  const segredo = crypto.randomBytes(16).toString('hex');
  const descricao = (itens.length === 1
    ? ((itens[0].qtd > 1 ? itens[0].qtd + 'x ' : '') + itens[0].nome)
    : (itens.length + ' itens')) + ' — ' + negNome + (origem === 'live' ? ' (live Moviki)' : ' (Moviki)');

  let cli, pay, qr;
  try {
    cli = await asaas('/customers', 'POST', { name: nome, cpfCnpj: cpf, mobilePhone: wpp, notificationDisabled: true, externalReference: 'mv-cli-' + pedidoRef.id }, chaveConta);
    const corpo = {
      customer: cli.id, billingType: 'PIX', value: total, dueDate: hoje(),
      description: descricao,
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
    lojistaUid, origem, liveId, dia: hoje(), modo,
    itens, total, oferta: ehOferta,
    comprador, entrega, mostrarNome: b.mostrarNome === true,
    aceite: { versao: POLITICA_VERSAO, em: FV.serverTimestamp() },
    status: 'aguardando', asaasId: pay.id, asaasCliente: cli.id,
    segredoHash: crypto.createHash('sha256').update(segredo).digest('hex'),
    criadoEm: FV.serverTimestamp(), expiraEm: admin.firestore.Timestamp.fromMillis(Date.now() + PEDIDO_RETENCAO_MS),
  });
  await trilha(lojistaUid, 'pedido_criado', { pedido: pedidoRef.id, modo, total, origem });
  await avisarLojista('novo', { lojistaUid, total, itens, entrega }, pedidoRef.id);

  return {
    ok: true, pedidoId: pedidoRef.id, chave: segredo, total, modo,
    itens: itens.map((i) => ({ nome: i.nome, qtd: i.qtd })),
    produto: itens[0] ? itens[0].nome : '', qtd: itens[0] ? itens[0].qtd : 1,
    pix: { imagem: String(qr.encodedImage || ''), copiaCola: String(qr.payload || ''), expira: qr.expirationDate || '' },
    negocio: negNome,
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
    /* Leitura na MESMA transacao e ANTES de qualquer escrita: o Firestore
       recusa leitura depois de escrita dentro de runTransaction. */
    const sesPagoS = await tx.get(db.collection('live_sessoes').doc(p.lojistaUid));
    tx.update(pedidoRef, { status: 'pago', pagoEm: FV.serverTimestamp(), alerta: FV.delete(),
      expiraEm: admin.firestore.Timestamp.fromMillis(Date.now() + PEDIDO_RETENCAO_PAGO_MS) });
    const it = (p.itens && p.itens[0]) || {};
    if (p.oferta && ls.exists) {
      const of = ls.data().oferta;
      /* Baixa de estoque so na live que gerou o pedido. Antes a conta era
         `String(ms(ls.data().inicio))`, campo que sumiu do documento do
         lojista — virou '' dos dois lados e dava baixa em qualquer live. */
      const sessaoIdAtual = sesPagoS.exists ? String((sesPagoS.data() || {}).sessaoId || '') : '';
      if (of && of.nome === it.nome && sessaoIdAtual && sessaoIdAtual === p.liveId) {
        tx.update(liveRef, { 'oferta.vendidos': FV.increment(Number(it.qtd) || 1) });
      }
    }
    efeito = p;
  });
  /* Modo Asaas: quem confirma e o banco, nao o lojista — ele so descobre se
     alguem avisar. Sai UMA vez por pedido, porque marcarPago so entrega
     'efeito' na transacao que de fato virou o status. */
  if (efeito) await avisarLojista('pago', efeito, pedidoRef.id);
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

  /* MODO PIX DIRETO: nao existe gateway para perguntar. Quem confirma e o
     lojista, olhando o proprio extrato. O unico automatismo aqui e expirar o
     pedido que ninguem pagou dentro da janela — e mesmo expirado o lojista
     ainda pode confirmar depois, porque Pix que caiu atrasado continua sendo
     Pix que caiu. */
  if (p.modo === 'pix') {
    if (status === 'aguardando' && Date.now() - ms(p.criadoEm) > PEDIDO_VALIDADE_MIN * 60000) {
      await ref.set({ status: 'expirado' }, { merge: true });
      status = 'expirado';
    }
    return { ok: true, status, modo: 'pix' };
  }

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
async function chaveDoPedido(p) {
  /* A chave depende do MODO do pedido. Ler sempre checkout_contas era o
     defeito: no modo 'asaas' esse documento nao existe, e todo pedido pago
     ficava preso em 'aguardando' para sempre. */
  if (p.modo === 'asaas') {
    const r = await db.collection('recebimento').doc(p.lojistaUid).get();
    const d = r.exists ? (r.data() || {}) : {};
    if (!d.asaasChave) return '';
    try { return decifrar(d.asaasChave); } catch (e) { return ''; }
  }
  const c = await db.collection('checkout_contas').doc(p.lojistaUid).get();
  if (!c.exists || !c.data().chave) return '';
  try { return decifrar(c.data().chave); } catch (e) { return ''; }
}

async function confirmarNoAsaas(p, pedidoId) {
  try {
    if (p.modo === 'pix') return 'erro';           // modo A nao tem gateway a quem perguntar
    const chave = await chaveDoPedido(p);
    if (!chave) return 'erro';
    const pay = await asaas('/payments/' + p.asaasId, 'GET', null, chave);
    if (pay.externalReference && pay.externalReference !== 'pedido:' + pedidoId) return 'divergente';
    if (PAGO.indexOf(pay.status) >= 0) {
      if (Math.abs(Number(pay.value) - Number(p.total)) > 0.01) { console.error('checkout: valor divergente', pedidoId, pay.value, p.total); return 'divergente'; }
      return 'pago';
    }
    if (pay.status === 'OVERDUE' || pay.deleted) return 'expirado';
    return 'aguardando';
  } catch (e) { return 'erro'; }
}

/* ============================================================================
   MODO A — PIX DIRETO DO LOJISTA (padrao desde 14/09/2026)
   ============================================================================
   O lojista cadastra a propria chave Pix. O servidor monta o copia-e-cola
   (lib/pix.js) e o dinheiro vai direto para a conta dele: sem gateway, sem
   tarifa, sem subconta e sem o teto de 10 contas do Asaas.

   O que o Moviki NAO consegue neste modo: saber sozinho que o Pix caiu. A
   confirmacao e humana — o comprador avisa que pagou, o lojista confere no
   proprio extrato (pelos centavos identificadores) e confirma no painel.
   Isso esta escrito na tela do lojista, nao escondido.

   Quem pode usar: Premium e Enterprise no cardapio; a live continua so no
   Enterprise (decisao de 14/09).
============================================================================ */

const MODOS = ['pix', 'asaas', 'subconta'];
const MIN_PIX_DIRETO = 5;          // sem tarifa, o piso pode ser baixo
const MIN_COM_GATEWAY = 20;        // R$ 1,99 fixos do Asaas em R$ 20 ja e 10%
const COMPROVANTE_MAX_B64 = 2200000;   // ~1,6 MB de imagem ja comprimida
const STORAGE_BUCKET = 'moviki-app.firebasestorage.app';
const COMPROVANTE_DIAS = 90;
const MAX_ABERTOS_NEGOCIO = 40;    // pedidos aguardando por negocio, por hora

/* TERMO DE VENDA DO LOJISTA — 14/09/2026.
   A decisao de 14/09 e que a responsabilidade pelo pedido e do LOJISTA. Isso
   so se sustenta se ele tiver aceitado, de forma versionada e registrada, antes
   de vender a primeira vez. Aceite que mora so na tela nao prova nada: por isso
   a barreira esta AQUI, no servidor, e nao no botao. */
const TERMO_VENDA_VERSAO = '2026-09-14';

/* Plano do lojista. Devolve 'premium' | 'enterprise' | null. */
async function planoDe(uid) {
  const a = await db.collection('assinaturas').doc(uid).get();
  const d = a.exists ? a.data() : null;
  if (!d || d.ativo !== true) return null;
  const v = ms(d.vence_em);
  if (v && v <= Date.now()) return null;
  const p = String(d.plano || '');
  return (p === 'premium' || p === 'enterprise') ? p : null;
}

/* ------------------------------------------------------ recebimento */

function mascararChave(bruta, tipo) {
  const v = String(bruta || '');
  if (tipo === 'email') {
    const i = v.indexOf('@');
    return i > 1 ? v.slice(0, 2) + '***' + v.slice(i) : '***';
  }
  if (tipo === 'telefone') return '+55 (**) ****-' + v.slice(-4);
  if (tipo === 'cpf' || tipo === 'cnpj') return pix.mascararDoc(v);
  return v.slice(0, 4) + '...' + v.slice(-4);   // aleatoria
}

async function recebimentoLer(uid) {
  const s = await db.collection('recebimento').doc(uid).get();
  return s.exists ? s.data() : null;
}

/* Espelho publico do recebimento: e o que a pagina do cardapio e a da live
   consultam para decidir se mostram o botao de comprar. So o servidor
   escreve. Nunca leva chave, documento nem nada decifravel. */
async function espelharRecebimento(uid, r) {
  const ligado = !!(r && r.ligado === true && MODOS.indexOf(r.modo) >= 0);
  const modo = ligado ? r.modo : '';
  await db.collection('checkout_publico').doc(uid).set({
    ativo: ligado,
    modo,
    minimo: ligado ? minimoDoModo(modo) : 0,
    entrega: (r && r.entrega) || 'retirada',
    atualizadoEm: FV.serverTimestamp(),
  }, { merge: true });
  return ligado;
}

function minimoDoModo(modo) {
  if (modo === 'pix') { const v = Number(process.env.CHECKOUT_MIN_PIX); return v > 0 ? v : MIN_PIX_DIRETO; }
  return valorMin();
}

/* Salva a chave Pix do lojista. A chave vai CIFRADA (AES-256-GCM, mesma
   CHECKOUT_CHAVE das subcontas) e nunca volta para a tela — o painel recebe
   so a mascara. Trocar a chave e evento de seguranca: fica na trilha e o
   lojista recebe aviso. */
async function lojaPixSalvar(uid, b) {
  if (!chaveCifra()) return { erro: 'config' };
  const k = pix.lerChave(b.chave);
  if (!k) return { erro: 'chave' };
  const nome = txt(b.nome, 60);
  if (nome.split(' ').filter(Boolean).length < 2) return { erro: 'nome' };
  const cidade = txt(b.cidade, 40);
  if (cidade.length < 3) return { erro: 'cidade' };
  const doc = so(b.documento);
  if (!(cpfValido(doc) || cnpjValido(doc))) return { erro: 'documento' };

  const ref = db.collection('recebimento').doc(uid);
  const antes = await ref.get();
  const tinha = antes.exists && antes.data().pix && antes.data().pix.chaveCifrada;

  await ref.set({
    uid,
    pix: {
      chaveCifrada: cifrar(k.valor),
      tipo: k.tipo,
      mascara: mascararChave(k.valor, k.tipo),
      nome, cidade, documento: doc, docMascara: pix.mascararDoc(doc),
      salvaEm: FV.serverTimestamp(),
    },
    atualizadoEm: FV.serverTimestamp(),
  }, { merge: true });

  await trilha(uid, tinha ? 'pix_trocado' : 'pix_cadastrado', { tipo: k.tipo, mascara: mascararChave(k.valor, k.tipo) });
  if (tinha) await avisarTrocaDeChave(uid, mascararChave(k.valor, k.tipo));
  return situacaoRecebimento(uid);
}

/* Escolhe o modo e liga/desliga o recebimento. */
async function lojaModo(uid, b) {
  const ref = db.collection('recebimento').doc(uid);
  const s = await ref.get();
  const r = s.exists ? s.data() : {};
  const modo = String(b.modo || r.modo || '');
  if (modo && MODOS.indexOf(modo) < 0) return { erro: 'modo' };

  if (b.ligado === true) {
    const plano = await planoDe(uid);
    if (!plano) return { erro: 'plano' };
    if (modo === 'pix' && !(r.pix && r.pix.chaveCifrada)) return { erro: 'sem_chave' };
    if (modo === 'asaas' && !r.asaasChave) return { erro: 'sem_conta' };
    if (modo === 'subconta') {
      const c = await db.collection('checkout_contas').doc(uid).get();
      if (!c.exists || !c.data().chave || c.data().aprovada !== true) return { erro: 'sem_conta' };
      if (plano !== 'enterprise') return { erro: 'plano' };
    }
    /* O aceite e a ULTIMA porta, de proposito: quando o lojista chega aqui ele
       ja tem chave cadastrada, e a mensagem que falta e sobre o termo, nao
       sobre configuracao. Sem aceite na versao corrente, nao liga — e quando o
       termo mudar de versao, quem aceitou a anterior reaceita antes de voltar
       a vender. */
    const jaAceitou = r.termo && r.termo.versao === TERMO_VENDA_VERSAO;
    if (!jaAceitou && b.aceite !== true) return { erro: 'aceite', termoVersao: TERMO_VENDA_VERSAO };
  }

  const entrega = ['retirada', 'entrega', 'ambos'].indexOf(String(b.entrega || '')) >= 0 ? String(b.entrega) : (r.entrega || 'retirada');
  const gravar = { uid, modo, ligado: b.ligado === true, entrega, atualizadoEm: FV.serverTimestamp() };
  if (b.aceite === true && !(r.termo && r.termo.versao === TERMO_VENDA_VERSAO)) {
    gravar.termo = { versao: TERMO_VENDA_VERSAO, em: FV.serverTimestamp() };
    await trilha(uid, 'termo_venda_aceito', { versao: TERMO_VENDA_VERSAO });
  }
  await ref.set(gravar, { merge: true });
  const novo = Object.assign({}, r, { modo, ligado: b.ligado === true, entrega });
  await espelharRecebimento(uid, novo);
  await trilha(uid, 'recebimento_' + (b.ligado === true ? 'ligado' : 'desligado'), { modo });
  return situacaoRecebimento(uid);
}

/* Conecta a conta Asaas DO PROPRIO LOJISTA (modo B). Nao cria subconta, nao
   consome o teto de 10 e nao poe a EIKO na cadeia de responsabilidade.

   TRES PORTAS antes de guardar a chave, todas por causa do que a chave E: no
   Asaas ela vale para a conta INTEIRA. Guardar chave de conta ainda nao
   aprovada, ou do ambiente de teste, e guardar risco sem receber uma venda em
   troca.
     1. chave de homologacao nao entra — o QR sairia e o dinheiro nunca
        cairia, com a tela dizendo que esta tudo certo;
     2. /myAccount/status precisa voltar general APPROVED — conta em analise
        emite cobranca que ninguem consegue pagar;
     3. /myAccount/commercialInfo e a prova de vida e traz nome e documento
        para a tela, que manda o lojista conferir se a conta e a dele. */
const ASAAS_ETAPAS = {
  commercialInfo: 'os dados da empresa',
  bankAccountInfo: 'a conta bancaria',
  documentation: 'o envio dos documentos',
};

async function lojaAsaasConectar(uid, b) {
  if (!chaveCifra()) return { erro: 'config' };
  if (b && b.remover === true) return lojaAsaasDesconectar(uid);
  /* Clique no botao de abrir conta: nao muda nada, so deixa rastro. E o unico
     jeito de saber depois quantos lojistas a tela de fato mandou para o
     Asaas — numero que o link de indicacao sozinho nao separa por lojista. */
  if (b && b.clique === true) { await trilha(uid, 'asaas_indicacao_clique', {}); return situacaoRecebimento(uid); }

  const chave = String((b && b.chaveApi) || '').trim();
  if (chave.length < 40 || chave.length > 400) return { erro: 'chave' };
  if (/_hmlg_/i.test(chave)) return { erro: 'chave_sandbox' };

  let st;
  try { st = await asaas('/myAccount/status', 'GET', null, chave); }
  catch (e) { return { erro: 'chave_recusada', mensagem: txt(e.message, 160) }; }
  const geral = String((st && st.general) || '').toUpperCase();
  if (geral !== 'APPROVED') {
    const faltando = Object.keys(ASAAS_ETAPAS)
      .filter((k) => String((st && st[k]) || '').toUpperCase() !== 'APPROVED')
      .map((k) => ASAAS_ETAPAS[k]);
    return { erro: 'conta_pendente', status: traduzStatus(geral), faltando: faltando };
  }

  let quem;
  try { quem = await asaas('/myAccount/commercialInfo', 'GET', null, chave); }
  catch (e) { return { erro: 'chave_recusada', mensagem: txt(e.message, 160) }; }
  const doc = so(quem && quem.cpfCnpj);
  const nome = txt((quem && quem.name) || '', 80);

  const antes = await recebimentoLer(uid);
  const trocou = !!(antes && antes.asaasChave);

  await db.collection('recebimento').doc(uid).set({
    uid,
    asaasChave: cifrar(chave),
    asaasNome: nome,
    asaasDoc: pix.mascararDoc(doc),
    asaasStatus: 'aprovado',
    asaasEm: FV.serverTimestamp(),
    atualizadoEm: FV.serverTimestamp(),
  }, { merge: true });
  await trilha(uid, trocou ? 'asaas_trocado' : 'asaas_conectado', { nome: nome });
  if (trocou) await avisarContaAsaas(uid, '\u{1F501} Conta Asaas TROCADA\n\nNegocio: ' + uid + '\nConta agora: ' + nome);
  return situacaoRecebimento(uid);
}

/* Desconecta a conta do lojista e apaga a chave cifrada. Se a venda estiver
   no ar JUSTAMENTE por ela, desliga a venda na mesma escrita: deixar ligado
   sem conta faria o cliente montar o pedido inteiro e bater numa porta
   fechada no fim, que e o pior lugar possivel para descobrir. */
async function lojaAsaasDesconectar(uid) {
  const r = (await recebimentoLer(uid)) || {};
  if (!r.asaasChave) return situacaoRecebimento(uid);
  const desligando = r.modo === 'asaas' && r.ligado === true;
  const gravar = {
    asaasChave: FV.delete(), asaasNome: FV.delete(), asaasDoc: FV.delete(),
    asaasStatus: FV.delete(), asaasEm: FV.delete(),
    atualizadoEm: FV.serverTimestamp(),
  };
  if (desligando) gravar.ligado = false;
  await db.collection('recebimento').doc(uid).set(gravar, { merge: true });
  if (desligando) await espelharRecebimento(uid, Object.assign({}, r, { ligado: false }));
  await trilha(uid, 'asaas_desconectado', { desligouVenda: desligando });
  await avisarContaAsaas(uid, '\u{1F50C} Conta Asaas DESCONECTADA\n\nNegocio: ' + uid + (desligando ? '\nA venda foi desligada junto.' : ''));
  return situacaoRecebimento(uid);
}

/* Trocar ou tirar a conta que recebe o dinheiro e evento de seguranca, igual
   a troca de chave Pix. Vai para o mesmo canal. */
async function avisarContaAsaas(uid, texto) {
  const TOKEN = process.env.TELEGRAM_TOKEN, CHAT = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT) return;
  try {
    await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text: texto + '\n\nSe nao foi o lojista, e invasao.', disable_web_page_preview: true }),
    });
  } catch (_) {}
}

async function situacaoRecebimento(uid) {
  const [r, plano, subS] = await Promise.all([
    recebimentoLer(uid),
    planoDe(uid),
    db.collection('checkout_contas').doc(uid).get(),
  ]);
  const d = r || {};
  return {
    plano: plano || '',
    modo: d.modo || '',
    ligado: d.ligado === true,
    entrega: d.entrega || 'retirada',
    minimo: minimoDoModo(d.modo || 'pix'),
    termo: { versao: TERMO_VENDA_VERSAO, aceito: !!(d.termo && d.termo.versao === TERMO_VENDA_VERSAO) },
    pix: d.pix ? { tem: true, mascara: d.pix.mascara || '', tipo: d.pix.tipo || '', nome: d.pix.nome || '', cidade: d.pix.cidade || '', documento: d.pix.docMascara || '' } : { tem: false },
    asaas: d.asaasChave ? { tem: true, nome: d.asaasNome || '', documento: d.asaasDoc || '', status: d.asaasStatus || 'aprovado', em: ms(d.asaasEm) || 0 } : { tem: false },
    subconta: { tem: !!(subS.exists && subS.data().chave), aprovada: !!(subS.exists && subS.data().aprovada === true) },
  };
}

/* ------------------------------------------------------------ trilha */

/* Artigo 9 da Doutrina: nenhuma mudanca de dinheiro sem rastro. Somente
   escrita, sem match nas regras — ninguem edita nem apaga pela interface. */
async function trilha(uid, evento, dados) {
  try {
    await db.collection('financeiro_trilha').add({
      uid, evento, dados: dados || null,
      em: FV.serverTimestamp(),
      expiraEm: admin.firestore.Timestamp.fromMillis(Date.now() + 5 * 365 * 86400000),
    });
  } catch (e) { console.error('trilha', evento, e.message); }
}

async function avisarTrocaDeChave(uid, mascara) {
  const TOKEN = process.env.TELEGRAM_TOKEN, CHAT = process.env.TELEGRAM_CHAT_ID;
  if (!TOKEN || !CHAT) return;
  try {
    await fetch('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text: '🔑 Chave Pix trocada\n\nNegócio: ' + uid + '\nNova chave: ' + mascara + '\n\nSe não foi o lojista, é invasão.', disable_web_page_preview: true }),
    });
  } catch (_) {}
}

/* ------------------------------------------- aviso de pedido ao lojista */

const EMAIL_DE = 'Moviki <suporte@moviki.com.br>';
const PAINEL_URL = 'https://app.moviki.com.br/';
const AVISOS_POR_HORA = 15;

/* O e-mail sai da conta do lojista no Authentication, nao de um campo que ele
   digita: campo digitado erra, envelhece e e editavel por quem invadir o
   painel. Se por qualquer motivo nao houver e-mail na conta, cai no cadastro
   do negocio. */
async function emailDoLojista(uid) {
  try {
    const u = await admin.auth().getUser(uid);
    const e = String((u && u.email) || '').trim();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return e;
  } catch (_) {}
  try {
    const n = await db.collection('negocios').doc(uid).get();
    const e = String((n.exists && n.data().email) || '').trim();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return e;
  } catch (_) {}
  return '';
}

/* Teto de avisos por hora. O freio de pedidos ja segura 40 por negocio por
   hora; sem este teto, um lojista debaixo de pedido falso levaria ate 80
   e-mails (pedido + aviso de pagamento) e o provedor comecaria a marcar o
   dominio do Moviki como spam — o que derrubaria TODO o e-mail do produto,
   inclusive o de cadastro. Estourado o teto, o aviso para de sair; o painel
   continua mostrando tudo. */
async function freioAviso(uid) {
  const ref = db.collection('checkout_freio').doc('_mail_' + String(uid).slice(0, 100));
  const agora = Date.now();
  try {
    return await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      let d = s.exists ? s.data() : { ini: agora, n: 0 };
      if (agora - (d.ini || 0) > 3600000) d = { ini: agora, n: 0 };
      if (d.n >= AVISOS_POR_HORA) return false;
      tx.set(ref, { ini: d.ini, n: d.n + 1, expiraEm: admin.firestore.Timestamp.fromMillis(agora + 86400000) });
      return true;
    });
  } catch (e) { return false; }   // falha fechada: sem contador, sem enxurrada
}

function corpoAviso(tipo, dados) {
  const t = {
    novo:  { assunto: 'Novo pedido de ' + dados.valor,         titulo: 'Entrou um pedido',            linha: 'O comprador ainda vai pagar. Quando ele avisar, voce confere e confirma.' },
    pagou: { assunto: 'Pagamento avisado — ' + dados.valor,    titulo: 'O comprador disse que pagou', linha: 'Confira o valor EXATO no seu extrato (os centavos identificam o pedido) e confirme no painel. Enquanto voce nao confirmar, o pedido nao esta pago.' },
    pago:  { assunto: 'Pagamento confirmado — ' + dados.valor, titulo: 'Pagamento confirmado',        linha: 'O banco confirmou. Prepare o pedido e marque como entregue quando terminar.' },
  }[tipo];
  if (!t) return null;
  const html =
    '<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#060d18;color:#eaf6ff;padding:26px">' +
      '<div style="max-width:520px;margin:0 auto;background:#0e1c30;border:1px solid #1c3457;border-radius:16px;padding:22px">' +
        '<div style="font-size:19px;font-weight:700;margin-bottom:6px">' + t.titulo + '</div>' +
        '<div style="font-size:13px;color:#8fa6c4;margin-bottom:16px">' + dados.negocio + '</div>' +
        '<div style="font-size:30px;font-weight:800;color:#25e39b;letter-spacing:-.5px">' + dados.valor + '</div>' +
        '<div style="font-size:13.5px;color:#c6d8ee;margin-top:6px">' + dados.itens + ' &middot; ' + dados.entrega + '</div>' +
        '<p style="font-size:13.5px;color:#c6d8ee;line-height:1.6;margin:16px 0 20px">' + t.linha + '</p>' +
        '<a href="' + PAINEL_URL + '" style="display:block;text-align:center;background:#00D4FF;color:#04121f;font-weight:700;font-size:15px;text-decoration:none;padding:14px;border-radius:12px">Abrir o painel</a>' +
        '<p style="font-size:11.5px;color:#8fa6c4;line-height:1.6;margin:18px 0 0">' +
          'Os dados do comprador ficam no painel, atras do seu login — nao viajam por e-mail. ' +
          'O Moviki nao recebe nem repassa o dinheiro desta venda: ele vai direto para a sua conta.' +
        '</p>' +
      '</div>' +
    '</div>';
  return { assunto: t.assunto + ' — Moviki', html };
}

/* Best-effort SEMPRE: aviso que falha nao pode derrubar pedido nem pagamento.
   Todo caminho de erro sai em silencio e o painel continua sendo a fonte. */
async function avisarLojista(tipo, p, pedidoId) {
  try {
    const CHAVE = process.env.RESEND_API_KEY;
    if (!CHAVE) return false;
    const uid = String((p && p.lojistaUid) || '');
    if (!uid) return false;
    if (!(await freioAviso(uid))) return false;
    const para = await emailDoLojista(uid);
    if (!para) return false;

    const itens = Array.isArray(p.itens) ? p.itens : [];
    const qtd = itens.reduce((s, i) => s + (Number(i.qtd) || 1), 0);
    let negNome = '';
    try {
      const n = await db.collection('negocios').doc(uid).get();
      negNome = txt((n.exists && n.data().nome) || '', 60);
    } catch (_) {}

    const c = corpoAviso(tipo, {
      valor: 'R$ ' + (Number(p.total) || 0).toFixed(2).replace('.', ','),
      itens: qtd + (qtd === 1 ? ' item' : ' itens'),
      entrega: (p.entrega && p.entrega.tipo === 'entrega') ? 'entrega combinada' : 'retirada no local',
      negocio: negNome || 'Seu negocio',
    });
    if (!c) return false;

    /* Tempo curto de proposito: o comprador esta parado na tela esperando o
       Pix. Se o Resend nao responder em 2,5 s, o aviso morre e a venda segue —
       o contrario (venda presa esperando e-mail) seria trocar o certo pelo
       acessorio. */
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CHAVE },
      body: JSON.stringify({ from: EMAIL_DE, to: para, subject: c.assunto, html: c.html }),
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) { console.error('aviso pedido', tipo, r.status); return false; }
    await trilha(uid, 'aviso_enviado', { pedido: pedidoId || '', tipo });
    return true;
  } catch (e) {
    console.error('aviso pedido', e.message);
    return false;
  }
}

/* --------------------------------------------------- cardapio compravel */


function semAcento(s) { return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }

/* O cardapio vive como ARRAY dentro de negocios/{uid}. Produto novo ganha
   'sku' quando o painel salva; cardapio antigo nao tem — por isso o casamento
   cai para o nome normalizado. O preco SEMPRE sai daqui, nunca do navegador. */
function acharNoCardapio(neg, ref) {
  const cats = Array.isArray(neg && neg.cardapio) ? neg.cardapio : [];
  const alvoSku = String((ref && ref.sku) || '').slice(0, 40);
  const alvoNome = semAcento((ref && ref.nome) || '');
  for (const c of cats) {
    const itens = Array.isArray(c && c.produtos) ? c.produtos : [];
    for (const p of itens) {
      if (!p || !p.nome) continue;
      const bateSku = alvoSku && String(p.sku || '') === alvoSku;
      const bateNome = !alvoSku && alvoNome && semAcento(p.nome) === alvoNome;
      if (!bateSku && !bateNome) continue;
      const preco = precoNum(p.preco);
      if (!(preco > 0)) return { erro: 'sem_preco' };      // "a partir de", "sob consulta"
      return { nome: txt(p.nome, 60), preco, sku: String(p.sku || ''), categoria: txt(c.categoria, 60) };
    }
  }
  return null;
}

/* -------------------------------------------------------- freio extra */

/* Freio por NEGOCIO: IP sozinho nao segura ataque distribuido, e um negocio
   afogado em pedido falso e um lojista perdido no meio de lixo. */
async function freioNegocio(uid) {
  const ref = db.collection('checkout_freio').doc('_neg_' + String(uid).slice(0, 100));
  const agora = Date.now();
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    let d = s.exists ? s.data() : { ini: agora, n: 0 };
    if (agora - (d.ini || 0) > 3600000) d = { ini: agora, n: 0 };
    if (d.n >= MAX_ABERTOS_NEGOCIO) return false;
    tx.set(ref, { ini: d.ini, n: d.n + 1, expiraEm: admin.firestore.Timestamp.fromMillis(agora + 86400000) });
    return true;
  });
}

/* ------------------------------------------------- criar pedido no Pix direto */

async function criarPedidoPix(ctx) {
  const { lojistaUid, r, itens, total, comprador, entrega, origem, liveId, negNome } = ctx;

  const pedidoRef = db.collection('pedidos').doc();
  const segredo = crypto.randomBytes(16).toString('hex');

  // Centavos identificadores: e o que o lojista procura no extrato.
  const { total: totalFinal, centavos } = pix.centavosUnicos(total, pedidoRef.id);

  let chaveCrua;
  try { chaveCrua = decifrar(r.pix.chaveCifrada); }
  catch (e) { return { erro: 'config' }; }

  const br = pix.brcode({
    chave: chaveCrua,
    nome: r.pix.nome,
    cidade: r.pix.cidade,
    valor: totalFinal,
    txid: pix.txidDe(pedidoRef.id),
  });
  if (!br.ok) return { erro: 'chave' };

  await pedidoRef.set({
    lojistaUid, origem, liveId: liveId || '', dia: hoje(),
    modo: 'pix',
    itens, total: totalFinal, totalBase: total, centavos,
    comprador, entrega,
    aceite: { versao: POLITICA_VERSAO, em: FV.serverTimestamp() },
    status: 'aguardando',
    segredoHash: crypto.createHash('sha256').update(segredo).digest('hex'),
    criadoEm: FV.serverTimestamp(),
    expiraEm: admin.firestore.Timestamp.fromMillis(Date.now() + PEDIDO_RETENCAO_MS),
  });

  await trilha(lojistaUid, 'pedido_criado', { pedido: pedidoRef.id, modo: 'pix', total: totalFinal, origem });
  /* Aguardado, nao solto: em funcao serverless a promessa que ninguem espera e
     cortada no momento em que a resposta sai, e o e-mail simplesmente nao
     chega. O custo e o tempo limite de 2,5 s la dentro. */
  await avisarLojista('novo', { lojistaUid, total: totalFinal, itens, entrega }, pedidoRef.id);

  return {
    ok: true, pedidoId: pedidoRef.id, chave: segredo, total: totalFinal, centavos,
    modo: 'pix',
    pix: {
      copiaCola: br.payload,
      // A tela MOSTRA estes dois. Sao a barreira contra QR trocado por script
      // injetado: o comprador confere no aplicativo do banco antes de pagar.
      recebedor: { nome: r.pix.nome, documento: r.pix.docMascara, chave: r.pix.mascara },
    },
    negocio: negNome,
    validadeMin: PEDIDO_VALIDADE_MIN,
  };
}

/* ------------------------------------- comprador avisa que pagou (modo Pix) */

async function compraPaguei(b) {
  const id = String(b.pedidoId || '').slice(0, 60);
  if (!/^[A-Za-z0-9]{10,60}$/.test(id)) return { erro: 'dados' };
  const ref = db.collection('pedidos').doc(id);
  const s = await ref.get();
  if (!s.exists) return { erro: 'nao_encontrado' };
  const p = s.data();
  if (!confereSegredo(b.chave, p.segredoHash)) return { erro: 'nao_encontrado' };
  if (p.modo !== 'pix') return { erro: 'modo' };
  if (p.status !== 'aguardando' && p.status !== 'conferindo') return { ok: true, status: p.status };

  let comprovante = null;
  if (b.comprovanteBase64) {
    comprovante = await salvarComprovante(id, String(b.comprovanteBase64));
    if (comprovante && comprovante.erro) return comprovante;
  }

  await ref.set(Object.assign({
    status: 'conferindo',
    avisadoEm: FV.serverTimestamp(),
  }, comprovante ? { comprovante: comprovante.caminho } : {}), { merge: true });

  await trilha(p.lojistaUid, 'comprador_avisou', { pedido: id, comComprovante: !!comprovante });
  /* Este e o aviso que realmente importa no Pix direto: enquanto o lojista nao
     confere o extrato e confirma, o pedido nao anda. */
  await avisarLojista('pagou', p, id);
  return { ok: true, status: 'conferindo' };
}

/* Comprovante: entra por POST em base64 e quem grava e o Admin SDK — o
   comprador NAO escreve no Storage. Nome com 32 bytes aleatorios e o link
   que o lojista abre e assinado e curto. Some em 90 dias. */
async function salvarComprovante(pedidoId, b64) {
  if (b64.length > COMPROVANTE_MAX_B64) return { erro: 'comprovante_grande' };
  const m = /^data:(image\/(png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/.exec(b64);
  if (!m) return { erro: 'comprovante' };
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length < 500 || buf.length > 1700000) return { erro: 'comprovante' };
  // Confere pelos bytes, nao pelo que o cliente diz que e.
  const ehPng = buf[0] === 0x89 && buf[1] === 0x50;
  const ehJpg = buf[0] === 0xFF && buf[1] === 0xD8;
  const ehWebp = buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP';
  if (!ehPng && !ehJpg && !ehWebp) return { erro: 'comprovante' };

  const ext = ehPng ? 'png' : (ehJpg ? 'jpg' : 'webp');
  const caminho = 'comprovantes/' + pedidoId + '-' + crypto.randomBytes(16).toString('hex') + '.' + ext;
  try {
    const bucket = admin.storage().bucket(STORAGE_BUCKET);
    await bucket.file(caminho).save(buf, {
      contentType: m[1],
      metadata: { cacheControl: 'private, max-age=0' },
      resumable: false,
    });
  } catch (e) {
    console.error('comprovante storage', e.message);
    return { erro: 'comprovante_falhou' };
  }
  return { caminho };
}

/* Link curto e assinado do comprovante, so para o lojista dono do pedido. */
async function comprovanteLink(uid, pedidoId) {
  const s = await db.collection('pedidos').doc(String(pedidoId || '').slice(0, 60)).get();
  if (!s.exists || s.data().lojistaUid !== uid) return { erro: 'nao_encontrado' };
  const caminho = s.data().comprovante;
  if (!caminho) return { erro: 'sem_comprovante' };
  try {
    const [url] = await admin.storage().bucket(STORAGE_BUCKET).file(caminho)
      .getSignedUrl({ action: 'read', expires: Date.now() + 20 * 60000 });
    return { ok: true, url };
  } catch (e) { return { erro: 'comprovante_falhou' }; }
}

/* ------------------------------- lojista confirma ou recusa (modo Pix) */

async function lojaPedidoPix(uid, pedidoId, novo, motivo) {
  const ref = db.collection('pedidos').doc(String(pedidoId || '').slice(0, 60));
  const s = await ref.get();
  if (!s.exists || s.data().lojistaUid !== uid) return { erro: 'nao_encontrado' };
  const p = s.data();
  if (p.modo !== 'pix') return { erro: 'modo' };

  if (novo === 'pago') {
    /* 'expirado' entra de proposito: a janela de 30 minutos e da TELA do
       comprador, nao do dinheiro. Pix que caiu depois do prazo continua sendo
       Pix que caiu, e o lojista que viu no extrato tem que poder confirmar. */
    if (['aguardando', 'conferindo', 'expirado'].indexOf(p.status) < 0) return { erro: 'so_aguardando' };
    await marcarPago(ref);
    await trilha(uid, 'pedido_confirmado', { pedido: ref.id, total: p.total, por: 'lojista' });
    return { ok: true, status: 'pago' };
  }
  if (novo === 'recusado') {
    if (p.status !== 'conferindo' && p.status !== 'aguardando') return { erro: 'so_aguardando' };
    await ref.set({ status: 'recusado', recusadoEm: FV.serverTimestamp(), recusaMotivo: txt(motivo, 140) }, { merge: true });
    await trilha(uid, 'pedido_recusado', { pedido: ref.id, motivo: txt(motivo, 140) });
    return { ok: true, status: 'recusado' };
  }
  return { erro: 'status' };
}

function confereSegredo(enviada, hashGuardado) {
  if (!hashGuardado) return false;
  const h = crypto.createHash('sha256').update(String(enviada || '')).digest('hex');
  if (h.length !== hashGuardado.length) return false;
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hashGuardado));
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
    if (acao === 'compra_criar' || acao === 'compra_status' || acao === 'compra_paguei') {
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '';
      let r;
      if (acao === 'compra_criar') r = await compraCriar(body, ip);
      else if (acao === 'compra_status') r = await compraStatus(body);
      else r = await compraPaguei(body);
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
    if (acao === 'adm_wh_rotacionar') {
      const a = await db.collection('admins').doc(dec.uid).get();
      if (!a.exists) return erro(res, 403, 'nao_admin');
      const alvo = String((body.dados && body.dados.uid) || body.uid || '');
      if (!/^[A-Za-z0-9]{10,128}$/.test(alvo)) return erro(res, 400, 'uid');
      const r = await rotacionarWebhook(alvo);
      return res.status(r.erro ? 400 : 200).json(r.erro ? Object.assign({ ok: false }, r) : r);
    }
    if (/^adm_/.test(acao)) return erro(res, 400, 'acao');

    /* Financeiro do lojista: Premium e Enterprise. A subconta (loja_criar) e a
       live continuam exclusivas do Enterprise, conferidas logo abaixo. */
    const ACOES_PLANO_PAGO = ['loja_recebimento', 'loja_pix', 'loja_modo', 'loja_asaas', 'loja_comprovante', 'loja_pedido'];
    if (ACOES_PLANO_PAGO.indexOf(acao) >= 0) {
      if (!(await planoDe(dec.uid))) return erro(res, 403, 'nao_pago');
      let rp;
      if (acao === 'loja_recebimento') rp = await situacaoRecebimento(dec.uid);
      else if (acao === 'loja_pix') rp = await lojaPixSalvar(dec.uid, body.dados || {});
      else if (acao === 'loja_modo') rp = await lojaModo(dec.uid, body.dados || {});
      else if (acao === 'loja_asaas') rp = await lojaAsaasConectar(dec.uid, body.dados || {});
      else if (acao === 'loja_comprovante') rp = await comprovanteLink(dec.uid, body.pedidoId);
      else rp = await lojaPedido(dec.uid, body.pedidoId, body.status, body.motivo);
      return res.status(rp.erro ? 400 : 200).json(rp.erro ? Object.assign({ ok: false }, rp) : Object.assign({ ok: true }, rp));
    }

    if (!(await ehEnterprise(dec.uid))) return erro(res, 403, 'nao_enterprise');

    /* Beta fechado: enquanto a lista tiver alguem, so quem esta nela abre
       subconta. Sem isso, um lojista fora do beta queimaria uma das 10 vagas
       do periodo de avaliacao do Asaas. Lista vazia = aberto a todos. */
    if (acao === 'loja_criar' && !(await noBeta(dec.uid))) return erro(res, 403, 'beta');

    let r;
    if (acao === 'loja_estado') r = await situacao(dec.uid);
    else if (acao === 'loja_criar') r = await lojaCriar(dec.uid, dec.email || '', body.dados || {});
    else if (acao === 'loja_ligar') r = await lojaLigar(dec.uid, body.ligado === true);
    else return erro(res, 400, 'acao');
    return res.status(r.erro ? 400 : 200).json(r.erro ? Object.assign({ ok: false }, r) : Object.assign({ ok: true }, r));
  } catch (e) {
    console.error('checkout erro', acao, e);
    return erro(res, 500, 'interno');
  }
}

module.exports = {
  ehAcao, tratar, webhookPedido, uidPorTokenWebhook, rotacionarWebhook,
  _t: { cpfValido, cnpjValido, cifrar, decifrar, acharProduto, acharNoCardapio, precoNum, mvProibido, lerItensCardapio, minimoDoModo, mascararChave, emailDoLojista, freioAviso, corpoAviso, avisarLojista },
};
