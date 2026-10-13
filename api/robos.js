// api/robos.js | versao 2026-10-13-custos (sugestoes de custo para o Custos e margem) | antes 2026-10-13-robos  (repo: moviki-robo)
// CENTRAL DOS ROBOS — 13/10/2026 (pedido do Paulo: ver todos os robos
// trabalhando juntos no painel do dono, e o "Vi" / "Feito" marcado no painel
// chegar sozinho aos robos e ao Claude).
//
// QUEM FALA COM ESTE ENDPOINT
//   1. OS ROBOS (tarefas agendadas do Claude, na nuvem). A nuvem nao alcanca
//      moviki-robo.vercel.app; ela chama https://app.moviki.com.br/api/robos,
//      que o vercel.json do moviki-app repassa para ca. Autenticacao:
//      cabecalho "Authorization: Bearer <ROBOS_SECRET>" (env do Vercel deste
//      projeto, 32+ caracteres). Sem a env, NADA passa (falha fechada).
//      Acoes: 'relatorio' (fim da rodada) e 'pendencias' (comeco da rodada).
//   2. O PAINEL DO DONO (eikoadm01.html, aba Robos). So admin com sessao do
//      Google (lib/admin.js, igual aos outros endpoints de dono).
//      Acoes: 'painel', 'marcar' (uma tarefa) e 'verRobo' (relatorio visto).
//   As duas portas nunca se misturam: com idToken so valem as acoes do dono;
//   com o segredo so valem as acoes do robo.
//
// O QUE GRAVA (so Admin SDK; sem regra no Firestore = navegador nao alcanca)
//   robos_estado/{robo}      ultimo relatorio de cada robo (manchete, gravidade,
//                            resumo, link) e quando o dono viu o relatorio.
//   robos_execucoes/{auto}   uma linha por rodada (historico; expiraEm 90 dias
//                            para uma politica de TTL no console, se quiser).
//   robos_tarefas/{id}       cada problema que um robo achou, com a situacao:
//                            aberta -> vista (dono viu) -> feita (dono resolveu)
//                            | resolvida (o proprio robo viu que sumiu)
//                            | descartada (dono mandou ignorar).
//                            id = <robo>__<sha1(chave)>: o robo manda a mesma
//                            chave toda rodada e a tarefa nao se repete.
//
// REGRAS DA TAREFA QUANDO O ROBO REPORTA DE NOVO
//   - aberta/vista: atualiza texto e gravidade; se a gravidade SUBIU e ela
//     estava vista, volta a aberta (o dono viu uma versao mais branda).
//   - feita: o dono disse que resolveu, mas o robo ainda ve o problema ->
//     volta a aberta com "reaberta" (o painel mostra "o robo ainda ve isso").
//   - resolvida: voltou -> aberta.
//   - descartada: continua descartada (so conta as vezes).
//   - completo:true no relatorio = a lista e TUDO o que o robo ve agora; a
//     tarefa aberta/vista/feita que nao veio vira "resolvida".
//
// Nenhum dado de cliente entra aqui: o robo manda texto curto de problema.
// Texto sem controle, sem < >, com teto de tamanho. Link so https.

const crypto = require('crypto');
const { admin, db } = require('../lib/firebase');
const { conferirAdmin } = require('../lib/admin');
const { freioUid } = require('../lib/freio');
const { bearerConfere } = require('../lib/segredo');
const { CATALOGO, POR_ID, prazoMs } = require('../lib/robosCatalogo');

const VERSAO = '2026-10-13-custos';
const ORIGIN_OK = 'https://app.moviki.com.br';
const DIA = 86400000;
const MAX_TAREFAS = 50;          // por relatorio
const MAX_ROBOS_FORA = 30;       // robos fora do catalogo (teto anti-lixo)
const GRAV = { ok: 0, atencao: 1, critico: 2 };
const ABERTOS = ['aberta', 'vista', 'feita'];
const ID_OK = /^[a-z0-9][a-z0-9-]{1,39}$/;
const TAREFA_ID_OK = /^[a-z0-9][a-z0-9-]{1,39}__[a-f0-9]{20}$/;

function txt(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n); }
// texto longo: mantem quebra de linha
function txtLongo(s, n) {
  return String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f<>]/g, ' ')
    .split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trimEnd()).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, n);
}
function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
function gravidade(g) {
  const x = norm(g);
  if (/critic|urgente|grave|alarme/.test(x)) return 'critico';
  if (/atenc|alerta|aviso|lembrete/.test(x)) return 'atencao';
  return 'ok';
}
function link(s) { const u = String(s || '').trim(); return /^https:\/\/[^\s<>"']{3,490}$/.test(u) ? u : ''; }
function msDe(v) {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v === 'number') return v;
  if (v._seconds) return v._seconds * 1000;
  if (v.seconds) return v.seconds * 1000;
  return 0;
}
function tarefaId(robo, chave) { return robo + '__' + crypto.createHash('sha1').update(String(chave)).digest('hex').slice(0, 20); }
function chaveDe(t) {
  const c = txt(t.chave, 120) || txt(t.titulo, 120);
  return norm(c).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
}
function evento(lista, quem, o, agora) {
  const a = Array.isArray(lista) ? lista.slice(-11) : [];
  a.push({ em: agora, quem, o: txt(o, 120) });
  return a;
}
const TS = (ms) => admin.firestore.Timestamp.fromMillis(ms);

/* ---------------------------------------------------------------- ROBO */

async function relatorio(body, agora) {
  const robo = String(body.robo || '').toLowerCase().trim();
  if (!ID_OK.test(robo)) return { status: 400, json: { ok: false, erro: 'robo_invalido' } };
  const cat = POR_ID[robo] || null;
  const refEst = db.collection('robos_estado').doc(robo);
  const estSnap = await refEst.get();
  if (!cat && !estSnap.exists) {
    const fora = await db.collection('robos_estado').where('foraDoCatalogo', '==', true).get();
    if (fora.size >= MAX_ROBOS_FORA) return { status: 409, json: { ok: false, erro: 'robos_demais' } };
    if (!txt(body.nome, 80)) return { status: 400, json: { ok: false, erro: 'falta_nome' } };
  }

  const g = gravidade(body.gravidade);
  const manchete = txt(body.manchete, 220) || '(sem manchete)';
  const resumo = txtLongo(body.resumo, 4000);
  const lk = link(body.link);
  const tarefasIn = Array.isArray(body.tarefas) ? body.tarefas.slice(0, MAX_TAREFAS) : [];
  const resolvidasIn = Array.isArray(body.resolvidas) ? body.resolvidas.slice(0, 100) : [];
  const completo = body.completo === true;

  // tarefas que vieram (dedup por chave)
  const vieram = {};
  for (const t of tarefasIn) {
    if (!t || typeof t !== 'object') continue;
    const chave = chaveDe(t);
    if (!chave) continue;
    vieram[tarefaId(robo, chave)] = {
      chave, titulo: txt(t.titulo, 160) || chave, detalhe: txtLongo(t.detalhe, 1500), gravidade: gravidade(t.gravidade || g),
    };
  }
  const resolvidasIds = {};
  for (const c of resolvidasIn) { const ch = chaveDe({ chave: c }); if (ch) resolvidasIds[tarefaId(robo, ch)] = true; }

  // tarefas atuais do robo (para o completo:true e o resumo)
  const atuaisQ = await db.collection('robos_tarefas').where('robo', '==', robo).get();
  const atuais = {};
  atuaisQ.forEach((d) => { atuais[d.id] = d.data() || {}; });
  // as que vieram e ainda nao estao na consulta (nunca existiram)
  const batch = db.batch();
  let novas = 0, reabertas = 0, resolvidas = 0, atualizadas = 0;
  const final = {};   // situacao de cada tarefa do robo depois deste relatorio
  Object.keys(atuais).forEach((id) => { final[id] = atuais[id].status; });

  for (const id of Object.keys(vieram)) {
    const v = vieram[id];
    const ref = db.collection('robos_tarefas').doc(id);
    const cur = atuais[id];
    if (!cur) {
      novas++;
      batch.set(ref, {
        robo, chave: v.chave, titulo: v.titulo, detalhe: v.detalhe, gravidade: v.gravidade, status: 'aberta',
        criadaEm: TS(agora), atualizadaEm: TS(agora), ultimaVezEm: TS(agora), vezes: 1, reaberta: false,
        eventos: evento([], 'robo', 'achou', agora),
      });
      final[id] = 'aberta';
      continue;
    }
    const upd = { titulo: v.titulo, detalhe: v.detalhe, gravidade: v.gravidade, ultimaVezEm: TS(agora), vezes: (Number(cur.vezes) || 0) + 1 };
    let st = cur.status;
    if (st === 'feita' || st === 'resolvida') {
      st = 'aberta'; upd.reaberta = true; reabertas++; upd.expiraEm = admin.firestore.FieldValue.delete();
      upd.eventos = evento(cur.eventos, 'robo', cur.status === 'feita' ? 'ainda ve o problema depois do Feito' : 'voltou', agora);
    } else if (st === 'vista' && (GRAV[v.gravidade] || 0) > (GRAV[cur.gravidade] || 0)) {
      st = 'aberta'; reabertas++;
      upd.eventos = evento(cur.eventos, 'robo', 'piorou para ' + v.gravidade, agora);
    } else { atualizadas++; }
    upd.status = st;
    final[id] = st;
    if (st !== cur.status) upd.atualizadaEm = TS(agora);
    batch.set(ref, upd, { merge: true });
  }

  for (const id of Object.keys(atuais)) {
    if (vieram[id]) continue;
    const cur = atuais[id];
    if (ABERTOS.indexOf(cur.status) < 0) continue;
    if (resolvidasIds[id] || completo) {
      resolvidas++;
      final[id] = 'resolvida';
      batch.set(db.collection('robos_tarefas').doc(id), {
        status: 'resolvida', resolvidaEm: TS(agora), atualizadaEm: TS(agora), expiraEm: TS(agora + 60 * DIA),
        eventos: evento(cur.eventos, 'robo', cur.status === 'feita' ? 'confirmou que resolveu' : 'nao ve mais', agora),
      }, { merge: true });
    }
  }

  const abertasDepois = Object.keys(final).filter((id) => final[id] === 'aberta' || final[id] === 'vista').length;

  const est = {
    robo, ultimaEm: TS(agora), gravidade: g, manchete, resumo, link: lk,
    execucoes: admin.firestore.FieldValue.increment(1), versao: VERSAO,
  };
  if (!cat) {
    est.foraDoCatalogo = true;
    est.nome = txt(body.nome, 80) || (estSnap.exists ? (estSnap.data() || {}).nome : robo);
    est.quando = txt(body.quando, 60);
    est.area = txt(body.area, 60);
  }
  batch.set(refEst, est, { merge: true });
  batch.set(db.collection('robos_execucoes').doc(), {
    robo, em: TS(agora), gravidade: g, manchete, resumo, link: lk,
    novas, reabertas, resolvidas, abertas: abertasDepois, expiraEm: TS(agora + 90 * DIA),
  });
  await batch.commit();
  return { status: 200, json: { ok: true, versao: VERSAO, robo, novas, reabertas, resolvidas, atualizadas, abertas: abertasDepois } };
}

function tarefaPublica(id, t) {
  return {
    id, robo: t.robo, chave: t.chave, titulo: t.titulo, detalhe: t.detalhe || '', gravidade: t.gravidade || 'ok',
    status: t.status, reaberta: t.reaberta === true, vezes: Number(t.vezes) || 0, notaDono: t.notaDono || '',
    criadaEm: msDe(t.criadaEm) || null, atualizadaEm: msDe(t.atualizadaEm) || null, ultimaVezEm: msDe(t.ultimaVezEm) || null,
    vistaEm: msDe(t.vistaEm) || null, feitaEm: msDe(t.feitaEm) || null, resolvidaEm: msDe(t.resolvidaEm) || null,
    descartadaEm: msDe(t.descartadaEm) || null,
  };
}

// O que o dono marcou. robo = um id (o robo pergunta das proprias tarefas) ou
// 'todos' (o Claude numa conversa pergunta de tudo).
async function pendencias(body, agora) {
  const robo = String(body.robo || '').toLowerCase().trim();
  if (robo !== 'todos' && !ID_OK.test(robo)) return { status: 400, json: { ok: false, erro: 'robo_invalido' } };
  const lista = [];
  const estados = {};
  if (robo === 'todos') {
    const [qa, qr, qe] = await Promise.all([
      db.collection('robos_tarefas').where('status', 'in', ABERTOS).limit(500).get(),
      db.collection('robos_tarefas').where('atualizadaEm', '>=', TS(agora - 14 * DIA)).limit(500).get(),
      db.collection('robos_estado').get(),
    ]);
    const vistos = {};
    [qa, qr].forEach((q) => q.forEach((d) => { if (!vistos[d.id]) { vistos[d.id] = 1; lista.push(tarefaPublica(d.id, d.data() || {})); } }));
    qe.forEach((d) => { estados[d.id] = d.data() || {}; });
  } else {
    const [q, e] = await Promise.all([
      db.collection('robos_tarefas').where('robo', '==', robo).limit(500).get(),
      db.collection('robos_estado').doc(robo).get(),
    ]);
    q.forEach((d) => lista.push(tarefaPublica(d.id, d.data() || {})));
    if (e.exists) estados[robo] = e.data() || {};
  }
  lista.sort((a, b) => (b.atualizadaEm || 0) - (a.atualizadaEm || 0));
  const robos = Object.keys(estados).map((id) => {
    const s = estados[id];
    return { robo: id, ultimaEm: msDe(s.ultimaEm) || null, gravidade: s.gravidade || 'ok', manchete: s.manchete || '',
      relatorioVistoEm: msDe(s.relatorioVistoEm) || null, relatorioVisto: !!(msDe(s.relatorioVistoEm) && msDe(s.relatorioVistoEm) >= msDe(s.ultimaEm)) };
  });
  const conta = (st) => lista.filter((t) => t.status === st).length;
  return { status: 200, json: { ok: true, versao: VERSAO, agora, robos, tarefas: lista,
    resumo: { abertas: conta('aberta'), vistas: conta('vista'), feitas: conta('feita'), descartadas: conta('descartada'), resolvidas: conta('resolvida') } } };
}

/* ---------------------------------------------------------------- DONO */

function situacao(cat, s, agora) {
  if (!s || !msDe(s.ultimaEm)) return cat && cat.novo ? 'nao_ligado' : 'sem_relatorio';
  if (cat && cat.freq !== 'demanda') {
    const p = prazoMs(cat.freq);
    if (p && agora - msDe(s.ultimaEm) > p) return 'atrasado';
  }
  return s.gravidade || 'ok';
}

async function painel(agora) {
  const [qe, qa, qr, qx] = await Promise.all([
    db.collection('robos_estado').get(),
    db.collection('robos_tarefas').where('status', 'in', ABERTOS).limit(500).get(),
    db.collection('robos_tarefas').where('atualizadaEm', '>=', TS(agora - 7 * DIA)).limit(500).get(),
    db.collection('robos_execucoes').orderBy('em', 'desc').limit(60).get(),
  ]);
  const qc = await db.collection('robos_custos').where('status', '==', 'proposta').limit(100).get();
  const est = {};
  qe.forEach((d) => { est[d.id] = d.data() || {}; });
  const tarefas = []; const vistos = {};
  [qa, qr].forEach((q) => q.forEach((d) => { if (!vistos[d.id]) { vistos[d.id] = 1; tarefas.push(tarefaPublica(d.id, d.data() || {})); } }));
  const porRobo = {};
  tarefas.forEach((t) => {
    const r = porRobo[t.robo] || (porRobo[t.robo] = { abertas: 0, vistas: 0, feitas: 0 });
    if (t.status === 'aberta') r.abertas++; else if (t.status === 'vista') r.vistas++; else if (t.status === 'feita') r.feitas++;
  });

  const linha = (id, cat, s) => {
    const sit = situacao(cat, s, agora);
    const ultima = s ? msDe(s.ultimaEm) : 0;
    const visto = s ? msDe(s.relatorioVistoEm) : 0;
    return {
      id, nome: (cat && cat.nome) || (s && s.nome) || id, freq: cat ? cat.freq : '', quando: (cat && cat.quando) || (s && s.quando) || '',
      area: (cat && cat.area) || (s && s.area) || '', faz: (cat && cat.faz) || '', novo: !!(cat && cat.novo), foraDoCatalogo: !cat,
      situacao: sit, gravidade: (s && s.gravidade) || null, manchete: (s && s.manchete) || '', resumo: (s && s.resumo) || '', link: (s && s.link) || '',
      ultimaEm: ultima || null, execucoes: s ? Number(s.execucoes) || 0 : 0,
      relatorioNovo: !!ultima && (!visto || visto < ultima), relatorioVistoEm: visto || null,
      tarefas: porRobo[id] || { abertas: 0, vistas: 0, feitas: 0 },
    };
  };
  const robos = CATALOGO.map((c) => linha(c.id, c, est[c.id]));
  Object.keys(est).filter((id) => !POR_ID[id]).forEach((id) => robos.push(linha(id, null, est[id])));

  const execucoes = [];
  qx.forEach((d) => {
    const x = d.data() || {};
    execucoes.push({ robo: x.robo, em: msDe(x.em) || null, gravidade: x.gravidade || 'ok', manchete: x.manchete || '',
      novas: Number(x.novas) || 0, reabertas: Number(x.reabertas) || 0, resolvidas: Number(x.resolvidas) || 0, abertas: Number(x.abertas) || 0 });
  });
  execucoes.sort((a, b) => (b.em || 0) - (a.em || 0));
  tarefas.sort((a, b) => {
    const oa = a.status === 'aberta' ? 0 : a.status === 'vista' ? 1 : a.status === 'feita' ? 2 : 3;
    const ob = b.status === 'aberta' ? 0 : b.status === 'vista' ? 1 : b.status === 'feita' ? 2 : 3;
    return (oa - ob) || ((GRAV[b.gravidade] || 0) - (GRAV[a.gravidade] || 0)) || ((b.atualizadaEm || 0) - (a.atualizadaEm || 0));
  });
  const resumo = {
    robos: robos.length,
    ligados: robos.filter((r) => r.situacao !== 'nao_ligado').length,
    criticos: robos.filter((r) => r.situacao === 'critico').length,
    atencao: robos.filter((r) => r.situacao === 'atencao').length,
    atrasados: robos.filter((r) => r.situacao === 'atrasado').length,
    relatoriosNovos: robos.filter((r) => r.relatorioNovo).length,
    tarefasAbertas: tarefas.filter((t) => t.status === 'aberta').length,
    custosPropostos: qc.size,
  };
  return { status: 200, json: { ok: true, versao: VERSAO, agora, resumo, robos, tarefas, execucoes } };
}

const DESTINOS = {
  vista: ['aberta'],
  feita: ['aberta', 'vista'],
  descartada: ['aberta', 'vista', 'feita'],
  aberta: ['vista', 'feita', 'descartada', 'resolvida'],
};
const ROTULO = { vista: 'Vi', feita: 'Feito', descartada: 'Ignorar', aberta: 'Reabrir' };

async function marcar(body, uid, agora) {
  const id = String(body.tarefa || '');
  const para = String(body.status || '');
  if (!TAREFA_ID_OK.test(id) || !DESTINOS[para]) return { status: 400, json: { ok: false, erro: 'pedido_invalido' } };
  const ref = db.collection('robos_tarefas').doc(id);
  const out = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return { status: 404, json: { ok: false, erro: 'nao_existe' } };
    const cur = s.data() || {};
    if (DESTINOS[para].indexOf(cur.status) < 0) return { status: 409, json: { ok: false, erro: 'ja_mudou', status: cur.status } };
    const upd = { status: para, atualizadaEm: TS(agora), porUid: uid, eventos: evento(cur.eventos, 'dono', ROTULO[para], agora) };
    if (para === 'vista') upd.vistaEm = TS(agora);
    if (para === 'feita') { upd.feitaEm = TS(agora); if (!cur.vistaEm) upd.vistaEm = TS(agora); upd.reaberta = false; }
    if (para === 'descartada') { upd.descartadaEm = TS(agora); upd.expiraEm = TS(agora + 60 * DIA); }
    if (para === 'aberta') { upd.reaberta = false; upd.expiraEm = admin.firestore.FieldValue.delete(); }
    if (typeof body.nota === 'string') upd.notaDono = txt(body.nota, 500);
    tx.set(ref, upd, { merge: true });
    return { status: 200, json: { ok: true, tarefa: tarefaPublica(id, Object.assign({}, cur, upd)) } };
  });
  return out;
}

// "Vi o relatorio": marca o relatorio do robo como visto e as tarefas abertas
// dele como vistas (o robo e o Claude enxergam na proxima consulta).
async function verRobo(body, uid, agora) {
  const robo = String(body.robo || '').toLowerCase().trim();
  if (!ID_OK.test(robo)) return { status: 400, json: { ok: false, erro: 'robo_invalido' } };
  const [e, q] = await Promise.all([
    db.collection('robos_estado').doc(robo).get(),
    db.collection('robos_tarefas').where('robo', '==', robo).get(),
  ]);
  const batch = db.batch();
  let n = 0;
  q.forEach((d) => {
    const t = d.data() || {};
    if (t.status !== 'aberta') return;
    n++;
    batch.set(d.ref || db.collection('robos_tarefas').doc(d.id), { status: 'vista', vistaEm: TS(agora), atualizadaEm: TS(agora), porUid: uid,
      eventos: evento(t.eventos, 'dono', 'Vi (relatorio)', agora) }, { merge: true });
  });
  if (e.exists) batch.set(db.collection('robos_estado').doc(robo), { relatorioVistoEm: TS(agora) }, { merge: true });
  await batch.commit();
  return { status: 200, json: { ok: true, robo, tarefasVistas: n } };
}

/* ---------------------------------------------------------------- CUSTOS
   13/10/2026 (pedido do Paulo: os custos que entram tambem vao para o
   financeiro). O robo financeiro NAO escreve direto no Custos e margem: ele
   SUGERE (robos_custos/{id}) e o dono aplica com um toque no painel. Quem
   grava em configuracoes/sistema.custos continua sendo so o painel, com o
   login do dono (o mesmo caminho do botao "Salvar tudo").
   Robo: 'custos' (sugerir) e 'custosAtuais' (ler as linhas que ja existem,
   para nao sugerir duplicado). Dono: 'custos' (listar) e 'custoDecidir'. */

const CS_CATS = ['Ferramenta', 'Infra', 'Midia', 'Fiscal', 'Pessoal', 'Estrutura', 'Comercial', 'Outros'];
const CS_ACOES = ['incluir', 'atualizar', 'cancelar'];
const CUSTO_ID_OK = /^c_[a-f0-9]{20}$/;

function custoId(chave) { return 'c_' + crypto.createHash('sha1').update(String(chave)).digest('hex').slice(0, 20); }
function custoPublico(id, c) {
  return {
    id, robo: c.robo || '', chave: c.chave || '', nome: c.nome || '', nomePainel: c.nomePainel || '', categoria: c.categoria || 'Outros',
    valor: Number(c.valor) || 0, moeda: c.moeda === 'USD' ? 'USD' : 'BRL', acao: c.acao || 'incluir', ciclo: c.ciclo || '',
    motivo: c.motivo || '', fonte: c.fonte || '', status: c.status || 'proposta',
    propostaEm: msDe(c.propostaEm) || null, decididaEm: msDe(c.decididaEm) || null,
  };
}

async function custosPropor(body, agora) {
  const robo = String(body.robo || '').toLowerCase().trim();
  if (!ID_OK.test(robo)) return { status: 400, json: { ok: false, erro: 'robo_invalido' } };
  const itens = Array.isArray(body.itens) ? body.itens.slice(0, 30) : [];
  if (!itens.length) return { status: 400, json: { ok: false, erro: 'sem_itens' } };
  let novas = 0, iguais = 0, invalidas = 0;
  const batch = db.batch();
  for (const it of itens) {
    if (!it || typeof it !== 'object') { invalidas++; continue; }
    const nome = txt(it.nome, 60);
    const chave = chaveDe({ chave: it.chave || nome });
    const acao = CS_ACOES.indexOf(String(it.acao || '')) >= 0 ? String(it.acao) : 'incluir';
    const valor = Number(it.valor);
    if (!nome || !chave || !isFinite(valor) || valor < 0 || valor > 100000) { invalidas++; continue; }
    const p = {
      robo, chave, nome, nomePainel: txt(it.nomePainel, 60), acao,
      categoria: CS_CATS.indexOf(String(it.categoria || '')) >= 0 ? String(it.categoria) : 'Outros',
      valor: acao === 'cancelar' ? 0 : Math.round(valor * 100) / 100,
      moeda: it.moeda === 'USD' ? 'USD' : 'BRL',
      ciclo: txt(it.ciclo, 30), motivo: txt(it.motivo, 300), fonte: txt(it.fonte, 200),
    };
    const ref = db.collection('robos_custos').doc(custoId(chave));
    const s = await ref.get();
    const cur = s.exists ? (s.data() || {}) : null;
    const mesmo = cur && cur.nome === p.nome && (cur.nomePainel || '') === p.nomePainel && cur.categoria === p.categoria
      && Number(cur.valor) === p.valor && cur.moeda === p.moeda && cur.acao === p.acao;
    if (cur && mesmo && cur.status !== 'proposta') { iguais++; continue; }
    novas++;
    batch.set(ref, Object.assign({}, p, { status: 'proposta', propostaEm: TS(agora), decididaEm: admin.firestore.FieldValue.delete(),
      expiraEm: admin.firestore.FieldValue.delete() }), { merge: true });
  }
  if (novas) await batch.commit();
  return { status: 200, json: { ok: true, novas, iguais, invalidas } };
}

// Linhas que ja estao no Custos e margem + sugestoes em aberto (o robo le antes de sugerir).
async function custosAtuais() {
  const [cfg, q] = await Promise.all([
    db.collection('configuracoes').doc('sistema').get(),
    db.collection('robos_custos').where('status', '==', 'proposta').limit(100).get(),
  ]);
  const c = cfg.exists ? ((cfg.data() || {}).custos || null) : null;
  const linhas = c && Array.isArray(c.itens) ? c.itens.slice(0, 120).map((it) => ({
    nome: txt(it && it.n, 60), categoria: txt(it && it.c, 20), valor: Number(it && it.v) || 0, moeda: (it && it.m) === 'USD' ? 'USD' : 'BRL',
  })) : null;
  const propostas = [];
  q.forEach((d) => propostas.push(custoPublico(d.id, d.data() || {})));
  return { status: 200, json: { ok: true, salvoNoPainel: !!linhas, dolar: c && typeof c.dolar === 'number' ? c.dolar : null,
    linhas: linhas || [], propostas } };
}

async function custosDono(agora) {
  const [qa, qd] = await Promise.all([
    db.collection('robos_custos').where('status', '==', 'proposta').limit(100).get(),
    db.collection('robos_custos').where('decididaEm', '>=', TS(agora - 30 * DIA)).limit(60).get(),
  ]);
  const abertas = [], decididas = [];
  qa.forEach((d) => abertas.push(custoPublico(d.id, d.data() || {})));
  qd.forEach((d) => { const c = custoPublico(d.id, d.data() || {}); if (c.status !== 'proposta') decididas.push(c); });
  abertas.sort((a, b) => (b.propostaEm || 0) - (a.propostaEm || 0));
  decididas.sort((a, b) => (b.decididaEm || 0) - (a.decididaEm || 0));
  return { status: 200, json: { ok: true, abertas, decididas } };
}

// O painel ja gravou a linha em configuracoes/sistema.custos (caminho do
// "Salvar tudo"); aqui so marca a sugestao como aplicada ou recusada.
async function custoDecidir(body, uid, agora) {
  const id = String(body.custo || '');
  const decisao = String(body.decisao || '');
  if (!CUSTO_ID_OK.test(id) || ['aplicada', 'recusada'].indexOf(decisao) < 0) return { status: 400, json: { ok: false, erro: 'pedido_invalido' } };
  const ref = db.collection('robos_custos').doc(id);
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return { status: 404, json: { ok: false, erro: 'nao_existe' } };
    const cur = s.data() || {};
    if (cur.status !== 'proposta') return { status: 409, json: { ok: false, erro: 'ja_mudou', status: cur.status } };
    tx.set(ref, { status: decisao, decididaEm: TS(agora), porUid: uid, expiraEm: TS(agora + 180 * DIA) }, { merge: true });
    return { status: 200, json: { ok: true, custo: custoPublico(id, Object.assign({}, cur, { status: decisao, decididaEm: agora })) } };
  });
}

/* ---------------------------------------------------------------- PORTA */

function corpo(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (_) { return null; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN_OK);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  try {
    const body = corpo(req);
    if (!body) { res.status(400).json({ ok: false, erro: 'json' }); return; }
    const agora = Date.now();
    const acao = String(body.acao || '');

    // ---- porta do dono (idToken do Google)
    if (body.idToken) {
      if (['painel', 'marcar', 'verRobo', 'custos', 'custoDecidir'].indexOf(acao) < 0) { res.status(400).json({ ok: false, erro: 'acao' }); return; }
      let dec;
      try { dec = await admin.auth().verifyIdToken(String(body.idToken), true); }
      catch (_) { res.status(401).json({ ok: false, erro: 'sessao' }); return; }
      const adm = await conferirAdmin(db, dec);
      if (!adm.ok) { res.status(adm.status).json({ ok: false, erro: adm.erro, mensagem: adm.mensagem }); return; }
      if (!(await freioUid(admin, db, 'robosdono', dec.uid, 240, 3600000))) {
        res.status(429).json({ ok: false, erro: 'freio', mensagem: 'Muitas consultas seguidas. Tente de novo em alguns minutos.' }); return;
      }
      const r = acao === 'painel' ? await painel(agora)
        : acao === 'marcar' ? await marcar(body, dec.uid, agora)
        : acao === 'verRobo' ? await verRobo(body, dec.uid, agora)
        : acao === 'custos' ? await custosDono(agora)
        : await custoDecidir(body, dec.uid, agora);
      res.status(r.status).json(r.json); return;
    }

    // ---- porta dos robos (segredo) — falha FECHADA
    const segredo = process.env.ROBOS_SECRET || '';
    if (segredo.length < 32) { res.status(503).json({ ok: false, erro: 'robos_sem_segredo' }); return; }
    if (!bearerConfere(req, segredo)) { res.status(401).json({ ok: false, erro: 'segredo' }); return; }
    if (['relatorio', 'pendencias', 'custos', 'custosAtuais'].indexOf(acao) < 0) { res.status(400).json({ ok: false, erro: 'acao' }); return; }
    const quem = String(body.robo || 'x').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'x';
    if (!(await freioUid(admin, db, 'robos', quem, 120, 3600000))) {
      res.status(429).json({ ok: false, erro: 'freio' }); return;
    }
    const r = acao === 'relatorio' ? await relatorio(body, agora)
      : acao === 'pendencias' ? await pendencias(body, agora)
      : acao === 'custos' ? await custosPropor(body, agora)
      : await custosAtuais();
    res.status(r.status).json(r.json);
  } catch (e) {
    console.error('[robos]', (e && e.message) || e);
    res.status(500).json({ ok: false, erro: 'interno' });
  }
};

module.exports._t = { custoId, gravidade, chaveDe, tarefaId, situacao, txt, txtLongo, link, VERSAO };
