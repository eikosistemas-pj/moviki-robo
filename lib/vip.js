/*!
 * MOVIKI lib/vip.js | versao 2026-10-17-vippadrao | antes 2026-10-17-basepropria | repo: moviki-robo
 *
 * BASE PROPRIA MULTICANAL (17/10/2026, P84):
 *  - origem por rede: ?vip=tiktok|instagram|kwai|facebook|youtube|whatsapp (link da bio
 *    de cada rede). Nunca contato importado: a pessoa entra sozinha, com aceite.
 *  - canal da loja (vip_canais/{uid}, so o robo): Canal do WhatsApp, grupo do WhatsApp
 *    ou canal do Telegram. So aparece DEPOIS da inscricao: o contato fica primeiro com
 *    a loja, o canal externo e bonus. Link conferido por padrao fechado (nada de
 *    endereco qualquer na tela do cliente).
 *  - base por live: quem entra pela live leva liveDia; o painel mostra as ultimas lives.
 *
 * LISTA VIP — "ME AVISE DA PROXIMA LIVE" (P70, etapa 4, 03/10/2026)
 * Desde 17/10/2026 (P84) nasce LIGADA para quem tem live (Premium, Enterprise e teste
 * gratis); o dono desliga um lojista gravando recursos/{uid}.listaVip = false.
 *
 * Por que existe: e o que deixa o lojista CRIAR base propria, com permissao,
 * em vez de depender da plataforma onde ele ja vende. A base do marketplace
 * nao e dele (termos do vendedor); esta e, porque a pessoa pediu.
 *
 * Tres canais, um documento por canal em vip/{id} (raiz, sem regra = so o robo):
 *  - e-mail: CONFIRMACAO DUPLA (a pessoa clica no link). Sem isso, qualquer um
 *    inscreve o e-mail de outro e o dominio do Moviki vira spam — o mesmo
 *    dominio que entrega o e-mail de cadastro.
 *  - notificacao do navegador (Web Push, VAPID, SEM conteudo no envio): o
 *    aparelho acorda, o sw-vip.js pergunta aqui o ultimo aviso e mostra. Sem
 *    conteudo nao ha criptografia de mensagem para errar. As chaves VAPID sao
 *    geradas pelo robo na primeira vez e guardadas CIFRADAS em sistema/vapid
 *    (mesma CHECKOUT_CHAVE da chave Pix): nenhuma variavel nova na Vercel.
 *  - WhatsApp: o numero vai para a lista do PROPRIO lojista, que avisa pelo
 *    WhatsApp dele. O Moviki nao manda WhatsApp.
 *
 * Aviso: so com a live NO AR (sessao do servidor viva), no maximo 1 a cada 2 h
 * e 3 por dia por loja. Live e o unico assunto: a lista nao vira canal de
 * propaganda.
 *
 * E-mail tem TETO GLOBAL por dia (VIP_EMAIL_TETO_DIA, padrao 40): o Resend do
 * Moviki divide a cota diaria com o e-mail de cadastro e de pedido.
 *
 * Origem da inscricao (P71, 03/10): 'qr' (QR impresso do painel), 'link'
 * (link fixo moviki.com.br/<slug>?vip=link), 'live' ou 'pagina'. So a origem:
 * nenhum dado pessoal a mais. Os canais de uma mesma inscricao dividem o campo
 * 'pessoa' (aleatorio), para o painel contar PESSOAS e nao canais.
 *
 * LGPD: consentimento com versao e texto gravados; sair por link (e-mail com
 * List-Unsubscribe de um clique), pelo proprio aparelho ou pelo lojista;
 * apagar e DE VERDADE (delete). Exclusao da conta do lojista apaga a lista
 * (api/exclusoes.js). E-mail nao confirmado some em 7 dias.
 */
'use strict';
const crypto = require('crypto');

const VERSAO_TERMO = 'vip-1';
const MAX_POR_LOJA = 2000;
const PUSH_POR_AVISO = 600;
const AVISO_INTERVALO_MS = 2 * 3600000;
const AVISOS_POR_DIA = 3;
const SEM_CONFIRMAR_MS = 7 * 86400000;
const PUSH_HOSTS = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)\//;
const SITE = 'https://www.moviki.com.br';
const ROBO = 'https://moviki-robo.vercel.app';
const EMAIL_DE = 'Moviki <suporte@moviki.com.br>';
const REDES = ['tiktok', 'instagram', 'kwai', 'facebook', 'youtube', 'whatsapp'];
const ORIGENS = ['qr', 'link', 'live', 'pagina'].concat(REDES);

/* Canal externo da loja: so estes tres formatos. Devolve {url, tipo} ou null. */
function canalValido(bruto) {
  let u = String(bruto || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  u = u.replace(/^http:\/\//i, 'https://');
  if (u.length > 120) return null;
  let m;
  if ((m = /^https:\/\/(?:www\.)?whatsapp\.com\/channel\/([A-Za-z0-9]{10,40})$/i.exec(u))) return { url: 'https://whatsapp.com/channel/' + m[1], tipo: 'wpp_canal' };
  if ((m = /^https:\/\/chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{10,40})$/i.exec(u))) return { url: 'https://chat.whatsapp.com/' + m[1], tipo: 'wpp_grupo' };
  if ((m = /^https:\/\/(?:www\.)?(?:t|telegram)\.me\/(\+[A-Za-z0-9_-]{10,40}|joinchat\/[A-Za-z0-9_-]{10,40}|[A-Za-z][A-Za-z0-9_]{4,31})$/i.exec(u))) return { url: 'https://t.me/' + m[1], tipo: 'telegram' };
  return null;
}

function tetoEmailDia() { const s = String(process.env.VIP_EMAIL_TETO_DIA || '').trim(); const v = Number(s); return s !== '' && v >= 0 && v <= 50000 ? Math.floor(v) : 40; }
function hoje() { return new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10); }   // dia de Brasilia
function hash(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function token() { return crypto.randomBytes(12).toString('hex'); }
function b64u(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function escHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function iguais(a, b) { a = String(a || ''); b = String(b || ''); return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }

module.exports = function criar(dep) {
  const { db, admin, txt, ms, trilha, planoDe, recursosDe, cifrar, decifrar, proibido } = dep;
  const FV = admin.firestore.FieldValue;
  const TS = admin.firestore.Timestamp;
  const fetchFn = () => dep.fetch || global.fetch;

  function textoConsentimento(loja) {
    return 'Quero ser avisado(a) quando ' + loja + ' entrar ao vivo. Meus dados ficam com a loja e com o Moviki só para esse aviso, e posso sair quando quiser.';
  }
  function linkSair(id, tok) { return SITE + '/vip/sair/' + id + '-' + tok; }

  async function lojaInfo(uid) {
    const n = await db.collection('negocios').doc(uid).get();
    if (!n.exists) return null;
    const d = n.data() || {};
    const slug = /^[A-Za-z0-9_-]{3,40}$/.test(String(d.slug || '')) ? String(d.slug) : '';
    return { nome: txt(d.nome, 60) || 'loja', slug };
  }

  async function canalDe(uid) {
    try {
      const s = await db.collection('vip_canais').doc(uid).get();
      const c = s.exists ? canalValido((s.data() || {}).url) : null;
      return c;
    } catch (_) { return null; }
  }

  /* A loja so recebe inscricao com a chave ligada E nivel de live (Premium, Enterprise ou teste gratis). */
  async function lojaAberta(uid) {
    const rec = await recursosDe(uid);
    if (!rec.listaVip) return { erro: 'vip_off' };
    if (!(await planoDe(uid))) return { erro: 'vip_off' };
    return { ok: true };
  }

  async function freioIp(ip) {
    const ref = db.collection('checkout_freio').doc('_vip_' + hash(ip || 'x').slice(0, 24));
    const agora = Date.now();
    return db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      let d = s.exists ? s.data() : { ini: agora, n: 0 };
      if (agora - (d.ini || 0) > 3600000) d = { ini: agora, n: 0 };
      if (d.n >= 12) return false;
      tx.set(ref, { ini: d.ini, n: d.n + 1, expiraEm: TS.fromMillis(agora + 86400000) });
      return true;
    });
  }

  /* Reserva n e-mails do teto do dia, numa transacao. Devolve quantos cabem. */
  async function reservarEmails(n) {
    const teto = tetoEmailDia();
    const ref = db.collection('vip_teto').doc(hoje());
    return db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const usados = s.exists ? Number(s.data().n || 0) : 0;
      const cabe = Math.max(0, Math.min(n, teto - usados));
      if (cabe > 0) tx.set(ref, { n: usados + cabe, expiraEm: TS.fromMillis(Date.now() + 3 * 86400000) }, { merge: true });
      return cabe;
    });
  }

  async function mandarEmails(lista) {
    const CHAVE = process.env.RESEND_API_KEY;
    if (!CHAVE || !lista.length) return 0;
    let ok = 0;
    for (let i = 0; i < lista.length; i += 100) {
      const lote = lista.slice(i, i + 100);
      try {
        const r = await fetchFn()('https://api.resend.com/emails/batch', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + CHAVE },
          body: JSON.stringify(lote), signal: AbortSignal.timeout(8000),
        });
        if (r.ok) ok += lote.length; else console.error('vip email lote', r.status);
      } catch (e) { console.error('vip email', e.message); }
    }
    return ok;
  }

  function moldura(titulo, corpoHtml, rodapeHtml) {
    return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0d1b2a">'
      + '<div style="font-weight:700;font-size:18px;margin-bottom:16px">Movi<span style="color:#0066ff">ki</span></div>'
      + '<h1 style="font-size:20px;margin:0 0 12px">' + titulo + '</h1>' + corpoHtml
      + '<p style="font-size:12px;color:#6b7c8f;margin-top:28px;line-height:1.5">' + rodapeHtml + '</p></div>';
  }
  function botao(url, rot) {
    return '<p style="margin:22px 0"><a href="' + escHtml(url) + '" style="background:#0066ff;color:#fff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:700;display:inline-block">' + escHtml(rot) + '</a></p>';
  }

  /* ---------------------------------------------------------- inscricao */
  async function entrar(b, ip) {
    const uid = String(b.lojistaUid || '');
    if (!/^[A-Za-z0-9]{10,128}$/.test(uid)) return { erro: 'dados' };
    if (b.aceite !== true) return { erro: 'aceite' };
    const nome = txt(b.nome, 30);
    if (nome.length < 2) return { erro: 'nome' };
    const email = txt(b.email, 120).toLowerCase();
    if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) return { erro: 'email' };
    let wpp = String(b.whatsapp || '').replace(/\D/g, '').replace(/^0+/, '');
    if (wpp.length >= 12 && wpp.slice(0, 2) === '55') wpp = wpp.slice(2);
    if (wpp && (wpp.length < 10 || wpp.length > 11)) return { erro: 'whatsapp' };
    let push = null;
    if (b.push && typeof b.push === 'object') {
      const ep = String(b.push.endpoint || '');
      if (ep.length > 600 || !PUSH_HOSTS.test(ep)) return { erro: 'push' };
      push = { endpoint: ep };
    }
    if (!email && !wpp && !push) return { erro: 'canal' };

    const aberta = await lojaAberta(uid);
    if (aberta.erro) return aberta;
    if (!(await freioIp(ip))) return { erro: 'freio' };
    const loja = await lojaInfo(uid);
    if (!loja) return { erro: 'dados' };

    const atuais = await db.collection('vip').where('lojistaUid', '==', uid).get();
    if (atuais.size >= MAX_POR_LOJA) return { erro: 'vip_cheia' };
    const origem = ORIGENS.indexOf(b.origem) >= 0 ? b.origem : 'pagina';
    const liveDia = origem === 'live' ? hoje() : '';
    /* mesma pessoa em varios canais: reaproveita o id de pessoa se algum canal ja existia */
    const ids = [];
    if (wpp) ids.push('w' + hash(uid + '|' + wpp).slice(0, 30));
    if (push) ids.push('p' + hash(uid + '|' + push.endpoint).slice(0, 30));
    if (email) ids.push('e' + hash(uid + '|' + email).slice(0, 30));
    let pessoa = '';
    for (const id of ids) { const x = atuais.docs.find((d) => d.id === id); if (x && x.data().pessoa) { pessoa = x.data().pessoa; break; } }
    if (!pessoa) pessoa = token();
    const consentimento = { versao: VERSAO_TERMO, em: FV.serverTimestamp(), origem, texto: textoConsentimento(loja.nome) };
    const res = { ok: true, email: '', whatsapp: false, push: false };
    const extra = liveDia ? { liveDia } : {};

    if (wpp) {
      const id = 'w' + hash(uid + '|' + wpp).slice(0, 30);
      const ref = db.collection('vip').doc(id);
      const s = await ref.get();
      if (s.exists) await ref.set({ nome, consentimento, pessoa }, { merge: true });
      else await ref.set(Object.assign({ lojistaUid: uid, canal: 'whatsapp', nome, whatsapp: wpp, confirmado: true, sairToken: token(), consentimento, origem, pessoa, criadoEm: FV.serverTimestamp() }, extra));
      res.whatsapp = true;
    }
    if (push) {
      const id = 'p' + hash(uid + '|' + push.endpoint).slice(0, 30);
      const ref = db.collection('vip').doc(id);
      const s = await ref.get();
      if (!s.exists) await ref.set(Object.assign({ lojistaUid: uid, canal: 'push', nome, push, pushHash: hash(push.endpoint), confirmado: true, sairToken: token(), consentimento, origem, pessoa, criadoEm: FV.serverTimestamp() }, extra));
      else await ref.set({ pessoa }, { merge: true });
      res.push = true;
    }
    if (email) {
      const id = 'e' + hash(uid + '|' + email).slice(0, 30);
      const ref = db.collection('vip').doc(id);
      const s = await ref.get();
      const d = s.exists ? (s.data() || {}) : null;
      if (d && d.confirmado === true) { await ref.set({ nome, pessoa }, { merge: true }); res.email = 'confirmar'; }
      else {
        /* Mesma resposta para "ja inscrito" e "novo": a tela nao pode servir
           para descobrir quem segue qual loja. */
        res.email = 'confirmar';
        const recente = d && (Date.now() - ms(d.confirmaEnviadoEm)) < 600000;
        if (!recente) {
          const conf = token(), sair = (d && d.sairToken) || token();
          await ref.set(Object.assign({ lojistaUid: uid, canal: 'email', nome, email, confirmado: false, confirmaToken: conf, sairToken: sair, consentimento, origem: (d && d.origem) || origem, pessoa, criadoEm: (d && d.criadoEm) || FV.serverTimestamp(), confirmaEnviadoEm: FV.serverTimestamp() }, (d && d.origem) ? {} : extra), { merge: true });
          const cabe = await reservarEmails(1);
          let foi = 0;
          if (cabe) {
            const url = SITE + '/vip/confirmar/' + id + '-' + conf;
            foi = await mandarEmails([{
              from: EMAIL_DE, to: [email], subject: 'Confirme: aviso das lives de ' + loja.nome,
              html: moldura('Falta um toque', '<p style="line-height:1.6">Você pediu para ser avisado(a) quando <b>' + escHtml(loja.nome) + '</b> entrar ao vivo no Moviki. Confirme para começar a receber.</p>' + botao(url, 'Confirmar meu e-mail'),
                'Se não foi você, ignore este e-mail: sem a confirmação, o endereço é apagado em 7 dias e você não recebe nada.'),
            }]);
          }
          if (!foi) res.emailAtrasado = true;
        }
      }
    }
    await trilha(uid, 'vip_entrou', { canais: [res.whatsapp ? 'whatsapp' : '', res.push ? 'push' : '', res.email ? 'email' : ''].filter(Boolean), origem });
    /* O canal externo da loja so aparece DEPOIS da inscricao. */
    const canal = await canalDe(uid);
    if (canal) res.canal = canal;
    return res;
  }

  function separar(t) {
    const m = /^([epw][0-9a-f]{30})-([0-9a-f]{24})$/.exec(String(t || '').trim());
    return m ? { id: m[1], tok: m[2] } : null;
  }

  async function confirmar(b) {
    const p = separar(b.t);
    if (!p) return { erro: 'link' };
    const ref = db.collection('vip').doc(p.id);
    const s = await ref.get();
    if (!s.exists) return { erro: 'link' };
    const d = s.data() || {};
    if (d.confirmado === true && iguais(d.confirmadoToken, p.tok)) return { ok: true, loja: (await lojaInfo(d.lojistaUid) || {}).nome || '' };
    if (!iguais(d.confirmaToken, p.tok)) return { erro: 'link' };
    if (Date.now() - ms(d.confirmaEnviadoEm) > SEM_CONFIRMAR_MS) { await ref.delete(); return { erro: 'link' }; }
    await ref.update({ confirmado: true, confirmadoEm: FV.serverTimestamp(), confirmaToken: FV.delete(), confirmadoToken: p.tok });
    const loja = await lojaInfo(d.lojistaUid);
    return { ok: true, loja: loja ? loja.nome : '', sair: linkSair(p.id, d.sairToken) };
  }

  async function sair(b) {
    const p = separar(b.t);
    if (!p) return { erro: 'link' };
    const ref = db.collection('vip').doc(p.id);
    const s = await ref.get();
    /* Link de sair ja usado responde ok: sair duas vezes nao e erro. */
    if (!s.exists) return { ok: true, ja: true };
    const d = s.data() || {};
    if (!iguais(d.sairToken, p.tok)) return { erro: 'link' };
    await ref.delete();
    await trilha(d.lojistaUid, 'vip_saiu', { canal: d.canal, por: 'pessoa' });
    const loja = await lojaInfo(d.lojistaUid);
    return { ok: true, loja: loja ? loja.nome : '' };
  }

  /* O aparelho que desligou a notificacao sai da lista daquela loja. */
  async function sairPush(b) {
    const uid = String(b.lojistaUid || '');
    const ep = String(b.endpoint || '');
    if (!/^[A-Za-z0-9]{10,128}$/.test(uid) || !PUSH_HOSTS.test(ep)) return { erro: 'dados' };
    const ref = db.collection('vip').doc('p' + hash(uid + '|' + ep).slice(0, 30));
    const s = await ref.get();
    if (s.exists) { await ref.delete(); await trilha(uid, 'vip_saiu', { canal: 'push', por: 'pessoa' }); }
    return { ok: true };
  }

  /* -------------------------------------------------------- VAPID */
  let vapidCache = null;
  async function vapid() {
    if (vapidCache) return vapidCache;
    const ref = db.collection('sistema').doc('vapid');
    let s = await ref.get();
    if (!s.exists) {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
      const jwk = privateKey.export({ format: 'jwk' });
      const pj = publicKey.export({ format: 'jwk' });
      const pub = b64u(Buffer.concat([Buffer.from([4]), Buffer.from(pj.x, 'base64'), Buffer.from(pj.y, 'base64')]));
      try { await ref.create({ pub, priv: cifrar(JSON.stringify(jwk)), criadoEm: FV.serverTimestamp() }); }
      catch (_) { /* outra chamada criou primeiro: vale a dela */ }
      s = await ref.get();
    }
    const d = s.data() || {};
    const jwk = JSON.parse(decifrar(d.priv));
    vapidCache = { pub: d.pub, key: crypto.createPrivateKey({ key: jwk, format: 'jwk' }) };
    return vapidCache;
  }
  async function chave() {
    try { const v = await vapid(); return { ok: true, chave: v.pub }; }
    catch (e) { console.error('vapid', e.message); return { erro: 'push_indisponivel' }; }
  }
  function jwtVapid(endpoint, v) {
    const aud = new URL(endpoint).origin;
    const cab = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const corpo = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:suporte@moviki.com.br' }));
    const ass = crypto.sign('sha256', Buffer.from(cab + '.' + corpo), { key: v.key, dsaEncoding: 'ieee-p1363' });
    return cab + '.' + corpo + '.' + b64u(ass);
  }
  /* Envio SEM conteudo: o sw-vip.js busca o texto em compra_vip_ultimo. */
  async function mandarPush(endpoint, v) {
    try {
      const r = await fetchFn()(endpoint, {
        method: 'POST',
        headers: { TTL: '3600', Urgency: 'high', 'Content-Length': '0', Authorization: 'vapid t=' + jwtVapid(endpoint, v) + ', k=' + v.pub },
        signal: AbortSignal.timeout(6000),
      });
      if (r.status === 404 || r.status === 410) return 'sumiu';
      return r.ok ? 'ok' : 'falha';
    } catch (e) { return 'falha'; }
  }

  async function ultimo(b) {
    const ep = String(b.endpoint || '');
    const padrao = { ok: true, titulo: 'Moviki', corpo: 'Uma loja que você segue está ao vivo.', url: SITE + '/aovivo' };
    if (!PUSH_HOSTS.test(ep)) return padrao;
    const q = await db.collection('vip').where('pushHash', '==', hash(ep)).limit(50).get();
    let melhor = null;
    for (const d of q.docs) {
      const a = await db.collection('vip_avisos').doc(String(d.data().lojistaUid || '')).get();
      const u = a.exists ? (a.data() || {}).ultimo : null;
      if (u && Date.now() - ms(u.em) < 2 * 3600000 && (!melhor || ms(u.em) > ms(melhor.em))) melhor = u;
    }
    return melhor ? { ok: true, titulo: txt(melhor.titulo, 80), corpo: txt(melhor.corpo, 120), url: String(melhor.url || padrao.url) } : padrao;
  }

  /* --------------------------------------------------------- lojista */
  async function listar(uid) {
    const q = await db.collection('vip').where('lojistaUid', '==', uid).get();
    const agora = Date.now();
    const vivos = [];
    for (const d of q.docs) {
      const x = d.data() || {};
      /* e-mail que nunca confirmou some em 7 dias (LGPD: finalidade nao cumprida) */
      if (x.canal === 'email' && x.confirmado !== true && agora - (ms(x.confirmaEnviadoEm) || ms(x.criadoEm) || agora) > SEM_CONFIRMAR_MS) { try { await d.ref.delete(); } catch (_) {} continue; }
      vivos.push({ id: d.id, ref: d.ref, x });
    }
    return vivos;
  }

  async function lojaVip(uid) {
    const rec = await recursosDe(uid);
    if (!rec.listaVip) return { ok: true, ligado: false };
    const [vivos, loja, av, canal] = await Promise.all([listar(uid), lojaInfo(uid), db.collection('vip_avisos').doc(uid).get(), canalDe(uid)]);
    const cont = { email: 0, emailPendente: 0, push: 0, whatsapp: 0 };
    const whatsapp = [];
    const pessoas = {}, porOrigem = {}, porLive = {};
    ORIGENS.forEach((o) => { porOrigem[o] = 0; });
    vivos.forEach(({ id, x }) => {
      /* conta PESSOAS ativas (e-mail ainda sem confirmar nao conta) e de onde vieram */
      if (!(x.canal === 'email' && x.confirmado !== true)) {
        const k = x.pessoa || id;
        if (!pessoas[k]) {
          pessoas[k] = 1; const o = porOrigem[x.origem] !== undefined ? x.origem : ((x.consentimento && x.consentimento.origem) || 'pagina'); if (porOrigem[o] !== undefined) porOrigem[o]++;
          if (/^\d{4}-\d{2}-\d{2}$/.test(String(x.liveDia || ''))) porLive[x.liveDia] = (porLive[x.liveDia] || 0) + 1;
        }
      }
      if (x.canal === 'email') { if (x.confirmado === true) cont.email++; else cont.emailPendente++; }
      else if (x.canal === 'push') cont.push++;
      else if (x.canal === 'whatsapp') {
        cont.whatsapp++;
        whatsapp.push({ id, nome: txt(x.nome, 30), whatsapp: String(x.whatsapp || ''), em: ms(x.criadoEm), sair: linkSair(id, x.sairToken) });
      }
    });
    whatsapp.sort((a, b2) => b2.em - a.em);
    const a = av.exists ? (av.data() || {}) : {};
    return {
      ok: true, ligado: true, contagem: cont, total: vivos.length, pessoas: Object.keys(pessoas).length, porOrigem, max: MAX_POR_LOJA, whatsapp,
      link: loja && loja.slug ? SITE + '/' + loja.slug + '?vip=link' : '',
      qr: loja && loja.slug ? SITE + '/' + loja.slug + '?vip=qr' : '',
      live: loja && loja.slug ? SITE + '/live/' + loja.slug : '', loja: loja ? loja.nome : '',
      redes: loja && loja.slug ? REDES.reduce((o, r) => { o[r] = SITE + '/' + loja.slug + '?vip=' + r; return o; }, {}) : {},
      canal: canal || null,
      lives: Object.keys(porLive).sort().reverse().slice(0, 6).map((dia) => ({ dia, pessoas: porLive[dia] })),
      ultimoAviso: a.ultimo ? { em: ms(a.ultimo.em), push: Number(a.ultimo.push || 0), email: Number(a.ultimo.email || 0) } : null,
      avisosHoje: a.dia === hoje() ? Number(a.qtd || 0) : 0, avisosPorDia: AVISOS_POR_DIA,
    };
  }

  async function lojaRemover(uid, id) {
    const ref = db.collection('vip').doc(String(id || '').slice(0, 40));
    const s = await ref.get();
    if (!s.exists || s.data().lojistaUid !== uid) return { erro: 'nao_encontrado' };
    await ref.delete();
    await trilha(uid, 'vip_saiu', { canal: s.data().canal, por: 'lojista' });
    return { ok: true };
  }

  /* Canal externo da loja (P84). url vazia apaga. */
  async function lojaCanal(uid, b) {
    const rec = await recursosDe(uid);
    if (!rec.listaVip) return { erro: 'vip_off' };
    const ref = db.collection('vip_canais').doc(uid);
    const bruto = String((b && b.url) || '').trim();
    if (!bruto) { await ref.delete(); await trilha(uid, 'vip_canal', { tipo: '' }); return { ok: true, canal: null }; }
    const c = canalValido(bruto);
    if (!c) return { erro: 'vip_canal' };
    await ref.set({ url: c.url, tipo: c.tipo, em: FV.serverTimestamp() });
    await trilha(uid, 'vip_canal', { tipo: c.tipo });
    return { ok: true, canal: c };
  }

  async function lojaAvisar(uid, b) {
    const rec = await recursosDe(uid);
    if (!rec.listaVip) return { erro: 'vip_off' };
    const chamada = txt(b && b.chamada, 80);
    if (chamada && proibido(chamada)) return { erro: 'termo' };
    const ses = await db.collection('live_sessoes').doc(uid).get();
    const sd = ses.exists ? (ses.data() || {}) : {};
    const pulso = ms(sd.pulsoEm) || Number(sd.pulsoMs) || 0;
    if (!(sd.ativa === true && !sd.encerradaPor && pulso > 0 && Date.now() - pulso < 180000)) return { erro: 'sem_live' };
    const loja = await lojaInfo(uid);
    if (!loja || !loja.slug) return { erro: 'sem_link' };

    /* Freio do aviso, numa transacao: 1 a cada 2 h e 3 por dia. */
    const avRef = db.collection('vip_avisos').doc(uid);
    const url = SITE + '/live/' + loja.slug;
    const titulo = loja.nome + ' está ao vivo agora';
    const corpo = chamada || 'Toque para assistir.';
    const freio = await db.runTransaction(async (tx) => {
      const s = await tx.get(avRef);
      const a = s.exists ? (s.data() || {}) : {};
      const qtd = a.dia === hoje() ? Number(a.qtd || 0) : 0;
      if (qtd >= AVISOS_POR_DIA) return { erro: 'vip_limite_dia' };
      const ult = a.ultimo ? ms(a.ultimo.em) : 0;
      if (ult && Date.now() - ult < AVISO_INTERVALO_MS) return { erro: 'vip_intervalo', proximoEm: ult + AVISO_INTERVALO_MS };
      tx.set(avRef, { dia: hoje(), qtd: qtd + 1, ultimo: { titulo, corpo, url, em: TS.now(), push: 0, email: 0 } }, { merge: true });
      return { ok: true };
    });
    if (freio.erro) return freio;

    const vivos = await listar(uid);
    const res = { ok: true, push: { enviados: 0, falhas: 0, removidos: 0 }, email: { enviados: 0, semCota: 0 }, whatsapp: 0 };
    /* push */
    const pushes = vivos.filter((v) => v.x.canal === 'push').slice(0, PUSH_POR_AVISO);
    if (pushes.length) {
      let v = null;
      try { v = await vapid(); } catch (e) { console.error('vapid', e.message); }
      for (let i = 0; v && i < pushes.length; i += 50) {
        const lote = pushes.slice(i, i + 50);
        const st = await Promise.all(lote.map((p) => mandarPush(String(p.x.push && p.x.push.endpoint), v)));
        for (let k = 0; k < st.length; k++) {
          if (st[k] === 'ok') res.push.enviados++;
          else if (st[k] === 'sumiu') { res.push.removidos++; try { await lote[k].ref.delete(); } catch (_) {} }
          else res.push.falhas++;
        }
      }
    }
    /* e-mail (so confirmado), dentro do teto do dia */
    const emails = vivos.filter((v) => v.x.canal === 'email' && v.x.confirmado === true);
    if (emails.length) {
      const cabe = await reservarEmails(emails.length);
      res.email.semCota = emails.length - cabe;
      const lote = emails.slice(0, cabe).map((v) => {
        const sairUrl = linkSair(v.id, v.x.sairToken);
        return {
          from: EMAIL_DE, to: [String(v.x.email)], subject: titulo,
          html: moldura(escHtml(titulo), '<p style="line-height:1.6">' + escHtml(chamada || 'A live começou agora. Entre para assistir.') + '</p>' + botao(url, 'Assistir agora'),
            'Você recebe este aviso porque pediu, na página de ' + escHtml(loja.nome) + ' no Moviki. <a href="' + escHtml(sairUrl) + '" style="color:#6b7c8f">Sair da lista</a>.'),
          headers: { 'List-Unsubscribe': '<' + ROBO + '/api/pedido?vip_sair=' + v.id + '-' + v.x.sairToken + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        };
      });
      res.email.enviados = await mandarEmails(lote);
    }
    res.whatsapp = vivos.filter((v) => v.x.canal === 'whatsapp').length;
    try { await avRef.set({ ultimo: { push: res.push.enviados, email: res.email.enviados } }, { merge: true }); } catch (_) {}
    await trilha(uid, 'vip_aviso', { push: res.push.enviados, email: res.email.enviados, semCota: res.email.semCota });
    return res;
  }

  return { entrar, confirmar, sair, sairPush, chave, ultimo, lojaVip, lojaRemover, lojaAvisar, lojaCanal, _t: { jwtVapid, vapid, mandarPush, PUSH_HOSTS, tetoEmailDia, separar, textoConsentimento, canalValido, ORIGENS } };
};
