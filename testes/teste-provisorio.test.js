'use strict';
// Teste provisorio (14/10/2026): 7 dias antes de confirmar o e-mail, 30 depois.
// Sem internet e sem Firebase:  cd moviki-robo && node testes/teste-provisorio.test.js
process.env.TRIAL_HASH_SAL = 'sal-de-teste';
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'x', filename: 'x', loaded: true, exports: { admin: fake.admin, db: fake.db } };
const { store, Timestamp } = fake;

// Contas do Auth falso: uid -> { email, emailVerified }
const contas = {};
fake.admin.auth = () => ({
  verifyIdToken: async (tk) => {
    const c = contas[tk]; if (!c) throw new Error('token');
    return { uid: tk, email: c.email, email_verified: c.tokenVelho ? false : c.emailVerified };
  },
  getUser: async (uid) => { const c = contas[uid]; if (!c) throw new Error('nao'); return { uid, email: c.email, emailVerified: c.emailVerified }; },
  getUsers: async (ids) => ({ users: ids.map(i => contas[i.uid] && Object.assign({ uid: i.uid }, contas[i.uid])).filter(Boolean) }),
});

const ativar = require(path.join(ROBO, 'api/ativar-trial.js'));
const T = ativar._t;
const live = require(path.join(ROBO, 'lib/livesessao.js'))._t;
const L = require(path.join(ROBO, 'api/lembrete-trial.js'))._t;

let ok = 0, falhas = 0;
function conf(c, msg) { if (c) ok++; else { falhas++; console.log('FALHOU:', msg); } }
const DIA = 86400000;

async function chamar(uid) {
  const req = { method: 'POST', headers: { authorization: 'Bearer ' + uid, origin: 'https://app.moviki.com.br' } };
  let status = 0, corpo = null;
  const res = { setHeader() {}, status(s) { status = s; return this; }, json(j) { corpo = j; return this; }, end() { return this; } };
  await ativar(req, res);
  return { status, corpo };
}
const assin = (uid) => store.get('assinaturas/' + uid);
const venceDias = (uid) => (assin(uid).vence_em.toMillis() - Date.now()) / DIA;

(async () => {
  // ---- funcao pura ----
  const agora = Date.UTC(2026, 9, 14, 12);
  conf(T.venceConfirmado(0, agora) === agora + 30 * DIA, 'sem provisorio: 30 dias a partir de agora');
  conf(T.venceConfirmado(agora - 3 * DIA, agora) === agora + 27 * DIA, 'confirmou no 3o dia: 30 dias contados do inicio');
  conf(T.venceConfirmado(agora - 40 * DIA, agora) === agora + 7 * DIA, 'confirmou muito tarde: ainda leva 7 dias');

  // ---- 1. cadastro sem confirmar: provisorio de 7 dias ----
  contas.lojaAaaaaaaa1 = { email: 'Maria.Silva+x@gmail.com', emailVerified: false };
  let r = await chamar('lojaAaaaaaaa1');
  conf(r.status === 200 && r.corpo.trial === true && r.corpo.provisorio === true, 'sem confirmar recebe provisorio');
  conf(assin('lojaAaaaaaaa1').provisorio === true && assin('lojaAaaaaaaa1').periodo === 'trial', 'grava provisorio:true e periodo trial');
  conf(Math.abs(venceDias('lojaAaaaaaaa1') - 7) < 0.01, 'provisorio vence em 7 dias');
  const usados = [...store.keys()].filter(k => k.startsWith('trials_usados/'));
  const provs = [...store.keys()].filter(k => k.startsWith('trials_provisorios/'));
  conf(usados.length === 0, 'provisorio NAO queima trials_usados');
  conf(provs.length === 1, 'provisorio grava trials_provisorios');

  // chamar de novo sem confirmar nao muda nada
  const venceAntes = assin('lojaAaaaaaaa1').vence_em.toMillis();
  r = await chamar('lojaAaaaaaaa1');
  conf(r.corpo.jaExiste === true && r.corpo.provisorio === true, 'repetir sem confirmar: jaExiste + provisorio');
  conf(assin('lojaAaaaaaaa1').vence_em.toMillis() === venceAntes, 'repetir nao estende o provisorio');

  // ---- 2. live aberta bloqueada, ensaio liberado ----
  const rl = await live.reservar({ uid: 'lojaAaaaaaaa1', periodo: 'trial', nivel: 'premium' });
  conf(rl.erro === 'email_nao_confirmado', 'provisorio nao abre live publica');
  const re = await live.reservar({ uid: 'lojaAaaaaaaa1', periodo: 'trial', nivel: 'premium', ensaio: true });
  conf(re.erro !== 'email_nao_confirmado', 'provisorio pode ensaiar');

  // ---- 3. confirmou: vira 30 dias contados do inicio ----
  // simula que o provisorio comecou ha 3 dias
  const a = assin('lojaAaaaaaaa1');
  a.inicioTeste = Timestamp.fromMillis(Date.now() - 3 * DIA);
  a.lembretes = { algo: 'x' };
  store.set('assinaturas/lojaAaaaaaaa1', a);
  contas.lojaAaaaaaaa1.emailVerified = true; contas.lojaAaaaaaaa1.tokenVelho = true;   // token velho, Auth ja confirmado
  r = await chamar('lojaAaaaaaaa1');
  conf(r.corpo.trial === true && r.corpo.confirmado === true, 'confirmou: trial confirmado');
  conf(assin('lojaAaaaaaaa1').provisorio === undefined, 'confirmou: some o provisorio');
  conf(Math.abs(venceDias('lojaAaaaaaaa1') - 27) < 0.01, 'confirmou no 3o dia: faltam 27 dias');
  conf(assin('lojaAaaaaaaa1').lembretes && assin('lojaAaaaaaaa1').lembretes.algo === 'x', 'confirmou: guarda o que o documento ja tinha');
  conf([...store.keys()].filter(k => k.startsWith('trials_usados/')).length === 1, 'confirmou: grava trials_usados');
  const rl2 = await live.reservar({ uid: 'lojaAaaaaaaa1', periodo: 'trial', nivel: 'premium' });
  conf(rl2.erro !== 'email_nao_confirmado', 'confirmado abre live publica');
  r = await chamar('lojaAaaaaaaa1');
  conf(r.corpo.jaExiste === true && !r.corpo.provisorio, 'depois de confirmado: jaExiste');

  // ---- 4. mesma caixa em outra conta (Gmail com ponto): sem teste nenhum ----
  contas.lojaBbbbbbbbb2 = { email: 'mariasilva@gmail.com', emailVerified: false };
  r = await chamar('lojaBbbbbbbbb2');
  conf(r.corpo.negado === 'email_reutilizado', 'e-mail que ja usou os 30 dias nao ganha provisorio');
  conf(!assin('lojaBbbbbbbbb2'), 'nada gravado em assinaturas');

  // ---- 5. apaga a conta e cria de novo sem confirmar: sem segundo provisorio ----
  contas.lojaCcccccccc3 = { email: 'joao@empresa.com.br', emailVerified: false };
  await chamar('lojaCcccccccc3');
  conf(assin('lojaCcccccccc3') && assin('lojaCcccccccc3').provisorio === true, 'joao ganha provisorio');
  contas.lojaDdddddddd4 = { email: 'joao+2@empresa.com.br', emailVerified: false };
  r = await chamar('lojaDdddddddd4');
  conf(r.corpo.pendenteVerificacao === true && !assin('lojaDdddddddd4'), 'segunda conta do mesmo e-mail sem confirmar nao ganha provisorio');
  contas.lojaDdddddddd4.emailVerified = true;
  r = await chamar('lojaDdddddddd4');
  conf(r.corpo.trial === true && Math.abs(venceDias('lojaDdddddddd4') - 30) < 0.01, 'confirmando, a segunda conta leva os 30 dias (o provisorio nao queimou)');

  // ---- 6. dominio descartavel continua barrado ----
  contas.lojaEeeeeeeee5 = { email: 'x@mailinator.com', emailVerified: false };
  r = await chamar('lojaEeeeeeeee5');
  conf(r.corpo.negado === 'dominio_descartavel' && !assin('lojaEeeeeeeee5'), 'descartavel sem provisorio');

  // ---- 7. Google (ja confirmado): 30 dias direto ----
  contas.lojaFfffffffff6 = { email: 'ana@gmail.com', emailVerified: true };
  r = await chamar('lojaFfffffffff6');
  conf(r.corpo.trial === true && !assin('lojaFfffffffff6').provisorio && Math.abs(venceDias('lojaFfffffffff6') - 30) < 0.01, 'confirmado de cara: 30 dias, sem provisorio');

  // ---- 8. pendencia do criar-assinatura continua sendo substituida ----
  store.set('assinaturas/lojaGgggggggg7', { plano: 'premium', periodo: 'mensal', ativo: false });
  contas.lojaGgggggggg7 = { email: 'bia@gmail.com', emailVerified: false };
  r = await chamar('lojaGgggggggg7');
  conf(r.corpo.provisorio === true && assin('lojaGgggggggg7').plano === 'pro', 'pendencia vira provisorio');

  // ---- 9. regua de e-mails ----
  const ag = Date.now();
  conf(L.decidirFlag({ ativo: true, periodo: 'trial', provisorio: true, vence_em: Timestamp.fromMillis(ag + 2 * DIA) }, ag) === null, 'provisorio nao recebe aviso de fim de teste');
  conf(L.decidirFlag({ ativo: true, periodo: 'trial', provisorio: true, vence_em: Timestamp.fromMillis(ag - 5 * DIA) }, ag) === null, 'provisorio vencido nao recebe convite de volta');
  const cad = (dias, l) => ({ avisadoEm: Timestamp.fromMillis(ag - dias * DIA), confirmaLembretes: l || {} });
  conf(L.decidirConfirma(cad(5.5, { c1: 1, c2: 1 }), ag) === 'c3', 'dia 5 com c2 enviado: c3');
  conf(L.decidirConfirma(cad(5.5, { c1: 1, c2: 1, c3: 1 }), ag) === null, 'c3 so 1 vez');
  conf(L.decidirConfirma(cad(5.5, { c1: 1 }), ag) === 'c2', 'dia 5 sem c2: manda o c2 antes');
  const m = L.montarConfirmacao('c1', 'Loja', 'https://x', { venceMs: ag + 6.5 * DIA }, ag);
  conf(/já começou/.test(m.subject) && /em 7 dias/.test(m.text), 'texto do provisorio diz que o teste comecou e quando acaba');
  const m3 = L.montarConfirmacao('c3', 'Loja', 'https://x', { venceMs: ag + 0.5 * DIA }, ag);
  conf(/amanhã/.test(m3.subject), 'c3 diz que acaba amanha');
  const mv = L.montarConfirmacao('c1', 'Loja', 'https://x', null, ag);
  conf(/Falta 1 passo/.test(mv.subject), 'sem provisorio, texto antigo');

  console.log(falhas ? ('FALHAS ' + falhas + ' / OK ' + ok) : ('TUDO OK (' + ok + ' conferencias)'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
