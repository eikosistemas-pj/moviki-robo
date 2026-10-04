/*!
 * MOVIKI lib/logistica.js | versao 2026-10-04-logistica | NOVO | repo: moviki-robo
 *
 * PARCEIROS LOGISTICOS (P70, etapa 5, 04/10/2026)
 * Motoboy/entregador, transportadora pequena e ponto de coleta se cadastram
 * na pagina publica www.moviki.com.br/entregadores. O dono aprova no painel
 * do dono. O lojista com a chave recursos/{uid}.logistica ligada ve "Quem
 * entrega na sua cidade" e chama pelo WhatsApp.
 *
 * O MOVIKI SO APRESENTA: nao contrata, nao intermedeia, nao recebe nem repassa
 * frete, nao garante entrega. Preco, prazo e responsabilidade sao combinados
 * direto entre lojista e parceiro. Sem vinculo de emprego, sem exclusividade,
 * sem taxa. Isso esta no texto que o parceiro aceita e no painel do lojista.
 *
 * Dados em logistica/{id} (raiz, sem regra = so o robo). id = 'l' + hash do
 * WhatsApp: um cadastro por numero. Recusar APAGA (nao guarda quem foi
 * recusado); suspender esconde dos lojistas. O parceiro sai pelo link que
 * recebe no fim do cadastro (apaga de verdade). O lojista so ve parceiro
 * APROVADO do estado que ele pesquisou (ou que atende varios estados), no
 * maximo 60, com o plano pago e a chave ligada.
 */
'use strict';
const crypto = require('crypto');

const VERSAO_TERMO = 'log-1';
const SITE = 'https://www.moviki.com.br';
const TIPOS = { entregador: 'Entregador (moto, bike ou carro)', transportadora: 'Transportadora ou empresa de entrega', coleta: 'Ponto de coleta ou envio' };
const SERVICOS = { bairro: 'Entrega no bairro', cidade: 'Entrega na cidade', regiao: 'Cidades vizinhas', estados: 'Outros estados', coleta: 'Busca na loja', postagem: 'Leva ao correio ou transportadora' };
const VEICULOS = { bicicleta: 'Bicicleta', moto: 'Moto', carro: 'Carro', van: 'Van ou utilitário', caminhao: 'Caminhão' };
const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];
const STATUS = ['pendente', 'aprovado', 'suspenso'];

function hash(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function token() { return crypto.randomBytes(12).toString('hex'); }
function chaveCidade(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
function iguais(a, b) { a = String(a || ''); b = String(b || ''); return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
function lista(v, dic) { return Array.isArray(v) ? v.filter((x, i, a) => dic[x] && a.indexOf(x) === i).slice(0, 10) : []; }
function textoTermo() {
  return 'Quero aparecer para as lojas do Moviki como parceiro de entrega. Entendo que o Moviki só apresenta: não me contrata, não cobra taxa, não recebe nem repassa pagamento e não garante serviço. Preço, prazo e responsabilidade eu combino direto com cada loja, sem vínculo de emprego nem exclusividade. Autorizo mostrar meu nome, WhatsApp, cidade e serviços às lojas aprovadas, e posso sair quando quiser.';
}

module.exports = function criar(dep) {
  const { db, admin, txt, ms, trilha, planoDe, recursosDe } = dep;
  const FV = admin.firestore.FieldValue;
  const TS = admin.firestore.Timestamp;
  const fetchFn = () => dep.fetch || global.fetch;

  async function freioIp(ip) {
    const ref = db.collection('checkout_freio').doc('_log_' + hash(ip || 'x').slice(0, 24));
    const agora = Date.now();
    return db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      let d = s.exists ? s.data() : { ini: agora, n: 0 };
      if (agora - (d.ini || 0) > 3600000) d = { ini: agora, n: 0 };
      if (d.n >= 6) return false;
      tx.set(ref, { ini: d.ini, n: d.n + 1, expiraEm: TS.fromMillis(agora + 86400000) });
      return true;
    });
  }

  async function avisarDono(d) {
    const TOKEN = process.env.TELEGRAM_TOKEN, CHAT = process.env.TELEGRAM_CHAT_ID;
    if (!TOKEN || !CHAT) return;
    try {
      await fetchFn()('https://api.telegram.org/bot' + TOKEN + '/sendMessage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: CHAT, text: '🚚 Novo parceiro de entrega para aprovar\n\n' + d.nome + ' · ' + (TIPOS[d.tipo] || d.tipo) + '\n' + d.cidade + '/' + d.uf + '\n\nPainel do dono > Parceiros de entrega.', disable_web_page_preview: true }),
        signal: AbortSignal.timeout(3000),
      });
    } catch (_) {}
  }

  function lerCadastro(b) {
    const tipo = String(b.tipo || '');
    if (!TIPOS[tipo]) return { erro: 'tipo' };
    const nome = txt(b.nome, 60);
    if (nome.length < 3) return { erro: 'nome' };
    const responsavel = txt(b.responsavel, 60);
    if (responsavel.length < 3) return { erro: 'responsavel' };
    let wpp = String(b.whatsapp || '').replace(/\D/g, '').replace(/^0+/, '');
    if (wpp.length >= 12 && wpp.slice(0, 2) === '55') wpp = wpp.slice(2);
    if (wpp.length < 10 || wpp.length > 11) return { erro: 'whatsapp' };
    const email = txt(b.email, 120).toLowerCase();
    if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) return { erro: 'email' };
    const cidade = txt(b.cidade, 60);
    if (cidade.length < 2) return { erro: 'cidade' };
    const uf = String(b.uf || '').toUpperCase();
    if (UFS.indexOf(uf) < 0) return { erro: 'uf' };
    const servicos = lista(b.servicos, SERVICOS);
    if (!servicos.length) return { erro: 'servicos' };
    const veiculos = lista(b.veiculos, VEICULOS);
    if (tipo === 'entregador' && !veiculos.length) return { erro: 'veiculos' };
    const atende = txt(b.atende, 200);
    return { tipo, nome, responsavel, whatsapp: wpp, email, cidade, uf, cidadeChave: chaveCidade(cidade), servicos, veiculos, atende };
  }

  /* ---------------------------------------------------------- publico */
  async function entrar(b, ip) {
    if (b.aceite !== true) return { erro: 'aceite' };
    const d = lerCadastro(b);
    if (d.erro) return d;
    if (!(await freioIp(ip))) return { erro: 'freio' };
    const id = 'l' + hash(d.whatsapp).slice(0, 30);
    const ref = db.collection('logistica').doc(id);
    const s = await ref.get();
    if (s.exists) return { erro: 'ja_cadastrado' };
    const sair = token();
    await ref.set(Object.assign({}, d, {
      status: 'pendente', sairToken: sair,
      consentimento: { versao: VERSAO_TERMO, em: FV.serverTimestamp(), texto: textoTermo() },
      criadoEm: FV.serverTimestamp(),
    }));
    await avisarDono(d);
    return { ok: true, sair: SITE + '/entregadores/sair/' + id + '-' + sair };
  }

  async function sair(b) {
    const m = /^(l[0-9a-f]{30})-([0-9a-f]{24})$/.exec(String(b.t || '').trim());
    if (!m) return { erro: 'link' };
    const ref = db.collection('logistica').doc(m[1]);
    const s = await ref.get();
    if (!s.exists) return { ok: true, ja: true };
    if (!iguais(s.data().sairToken, m[2])) return { erro: 'link' };
    await ref.delete();
    return { ok: true };
  }

  /* ------------------------------------------------------------ dono */
  async function admListar(b) {
    const st = STATUS.indexOf(String(b && b.status)) >= 0 ? String(b.status) : 'pendente';
    const q = await db.collection('logistica').where('status', '==', st).limit(300).get();
    const itens = q.docs.map((d) => {
      const x = d.data() || {};
      return { id: d.id, tipo: x.tipo, nome: x.nome, responsavel: x.responsavel, whatsapp: x.whatsapp, email: x.email || '', cidade: x.cidade, uf: x.uf, atende: x.atende || '',
        servicos: x.servicos || [], veiculos: x.veiculos || [], status: x.status, motivo: x.motivo || '', criadoEm: ms(x.criadoEm), aprovadoEm: ms(x.aprovadoEm) };
    }).sort((a, c) => c.criadoEm - a.criadoEm);
    return { ok: true, status: st, itens };
  }

  async function admMudar(adminUid, b) {
    const id = String((b && b.id) || '');
    if (!/^l[0-9a-f]{30}$/.test(id)) return { erro: 'id' };
    const novo = String(b.status || '');
    const ref = db.collection('logistica').doc(id);
    const s = await ref.get();
    if (!s.exists) return { erro: 'nao_encontrado' };
    if (novo === 'recusado') {
      /* Recusar apaga: nao ha por que guardar dado de quem nao vai aparecer. */
      await ref.delete();
      await trilha(adminUid, 'logistica_recusada', { id });
      return { ok: true, status: 'apagado' };
    }
    if (['aprovado', 'suspenso', 'pendente'].indexOf(novo) < 0) return { erro: 'status' };
    const motivo = txt(b.motivo, 200);
    if (novo === 'suspenso' && motivo.length < 3) return { erro: 'motivo' };
    const upd = { status: novo, motivo: novo === 'suspenso' ? motivo : FV.delete(), mudouEm: FV.serverTimestamp(), mudouPor: adminUid };
    if (novo === 'aprovado') upd.aprovadoEm = FV.serverTimestamp();
    await ref.update(upd);
    await trilha(adminUid, 'logistica_' + novo, { id });
    return { ok: true, status: novo };
  }

  /* --------------------------------------------------------- lojista */
  async function lojaListar(uid, b) {
    const rec = await recursosDe(uid);
    if (!rec.logistica) return { ok: true, ligado: false };
    const uf = String((b && b.uf) || '').toUpperCase();
    if (UFS.indexOf(uf) < 0) return { erro: 'uf' };
    const cidade = chaveCidade(b && b.cidade);
    const [q1, q2] = await Promise.all([
      db.collection('logistica').where('status', '==', 'aprovado').where('uf', '==', uf).limit(300).get(),
      db.collection('logistica').where('status', '==', 'aprovado').where('servicos', 'array-contains', 'estados').limit(300).get(),
    ]);
    const vistos = {};
    const itens = [];
    [q1, q2].forEach((q) => q.docs.forEach((d) => {
      if (vistos[d.id]) return; vistos[d.id] = 1;
      const x = d.data() || {};
      if (x.status !== 'aprovado') return;
      const mesmaCidade = !!cidade && x.cidadeChave === cidade;
      const peso = mesmaCidade ? 0 : (x.uf === uf ? 1 : 2);
      itens.push({ peso, id: d.id, tipo: x.tipo, tipoNome: TIPOS[x.tipo] || '', nome: txt(x.nome, 60), responsavel: txt(x.responsavel, 60).split(' ')[0],
        whatsapp: String(x.whatsapp || ''), cidade: txt(x.cidade, 60), uf: x.uf, atende: txt(x.atende, 200),
        servicos: (x.servicos || []).map((k) => SERVICOS[k]).filter(Boolean), veiculos: (x.veiculos || []).map((k) => VEICULOS[k]).filter(Boolean), mesmaCidade });
    }));
    itens.sort((a, c) => a.peso - c.peso || a.nome.localeCompare(c.nome, 'pt-BR'));
    return { ok: true, ligado: true, uf, total: itens.length, itens: itens.slice(0, 60).map((x) => { delete x.peso; return x; }) };
  }

  return { entrar, sair, admListar, admMudar, lojaListar, _t: { lerCadastro, chaveCidade, textoTermo, TIPOS, SERVICOS, VEICULOS } };
};
