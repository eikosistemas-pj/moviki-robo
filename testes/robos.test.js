'use strict';
// Teste da central dos robos (13/10/2026, painel do dono > Robos).
// Sem internet e sem Firebase: cd moviki-robo && node testes/robos.test.js
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');

const SEGREDO = 'segredo-de-teste-dos-robos-com-mais-de-32-caracteres';
const SESSOES = {
  tDono: { uid: 'DonoBBBBBBBBBBBBBBBB', firebase: { sign_in_provider: 'google.com' } },
  tSenha: { uid: 'DonoBBBBBBBBBBBBBBBB', firebase: { sign_in_provider: 'password' } },
  tLoja: { uid: 'LojaAAAAAAAAAAAAAAAA', firebase: { sign_in_provider: 'google.com' } },
};
fake.admin.auth = () => ({ verifyIdToken: async (t) => { if (!SESSOES[t]) throw new Error('token'); return SESSOES[t]; } });
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'x', filename: 'x', loaded: true, exports: { admin: fake.admin, db: fake.db } };
fake.store.set('admins/DonoBBBBBBBBBBBBBBBB', { nome: 'Paulo' });

const h = require(path.join(ROBO, 'api/robos.js'));
let falhas = 0, ok = 0;
function conf(c, msg) { if (c) ok++; else { falhas++; console.log('FALHOU:', msg); } }
function res() { return { c: 0, b: null, h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.c = c; return this; }, json(b) { this.b = b; return this; }, end() { return this; } }; }
async function post(body, auth) {
  const r = res();
  const headers = { origin: 'https://app.moviki.com.br' };
  if (auth) headers.authorization = auth;
  await h({ method: 'POST', headers, body }, r);
  return r;
}
const B = 'Bearer ' + SEGREDO;

(async () => {
  // 1. sem a env: falha fechada
  delete process.env.ROBOS_SECRET;
  let r = await post({ acao: 'relatorio', robo: 'pulso', manchete: 'x' }, B);
  conf(r.c === 503 && r.b.erro === 'robos_sem_segredo', 'sem ROBOS_SECRET tem que recusar (503)');
  process.env.ROBOS_SECRET = 'curto';
  r = await post({ acao: 'relatorio', robo: 'pulso', manchete: 'x' }, 'Bearer curto');
  conf(r.c === 503, 'segredo curto (< 32) tem que recusar');
  process.env.ROBOS_SECRET = SEGREDO;

  // 2. segredo errado / sem cabecalho
  r = await post({ acao: 'relatorio', robo: 'pulso', manchete: 'x' }, 'Bearer errado');
  conf(r.c === 401, 'segredo errado = 401');
  r = await post({ acao: 'relatorio', robo: 'pulso', manchete: 'x' });
  conf(r.c === 401, 'sem cabecalho = 401');

  // 3. robo nao pode usar acao do dono, e vice-versa
  r = await post({ acao: 'marcar', robo: 'pulso' }, B);
  conf(r.c === 400, 'robo nao marca tarefa');
  r = await post({ acao: 'relatorio', idToken: 'tDono', robo: 'pulso' });
  conf(r.c === 400, 'dono nao manda relatorio');

  // 4. relatorio com tarefas
  r = await post({ acao: 'relatorio', robo: 'pulso', gravidade: 'ATENÇÃO', manchete: 'Pulso: <b>Meta</b> sem lead ontem', resumo: 'linha 1\nlinha 2\u0007',
    link: 'javascript:alert(1)', completo: true,
    tarefas: [
      { chave: 'meta-sem-lead', titulo: 'Meta sem lead ontem', gravidade: 'atencao', detalhe: 'Conjunto de cadastro gastou R$ 15 e 0 lead.' },
      { chave: 'google-saldo', titulo: 'Saldo do Google acaba em 3 dias', gravidade: 'critico' },
      { titulo: 'Sem chave explicita' },
    ] }, B);
  conf(r.c === 200 && r.b.novas === 3 && r.b.abertas === 3, 'relatorio cria 3 tarefas: ' + JSON.stringify(r.b));
  const est = fake.store.get('robos_estado/pulso');
  conf(est && est.gravidade === 'atencao', 'gravidade normalizada');
  conf(est && est.manchete.indexOf('<') < 0, 'manchete sem < >');
  conf(est && est.resumo === 'linha 1\nlinha 2', 'resumo mantem quebra e tira controle: ' + JSON.stringify(est && est.resumo));
  conf(est && est.link === '', 'link que nao e https e descartado');

  // 5. painel do dono
  r = await post({ acao: 'painel', idToken: 'tSenha' });
  conf(r.c === 403, 'dono por senha nao ve o painel');
  r = await post({ acao: 'painel', idToken: 'tLoja' });
  conf(r.c === 403, 'nao admin nao ve o painel');
  r = await post({ acao: 'painel', idToken: 'tDono' });
  conf(r.c === 200 && r.b.robos.length >= 23, 'painel lista o catalogo inteiro');
  const pulso = r.b.robos.find((x) => x.id === 'pulso');
  conf(pulso && pulso.situacao === 'atencao' && pulso.relatorioNovo === true && pulso.tarefas.abertas === 3, 'pulso no painel: ' + JSON.stringify(pulso && pulso.tarefas));
  const sentinela = r.b.robos.find((x) => x.id === 'caixa-parceiros');
  conf(sentinela && sentinela.situacao === 'nao_ligado', 'robo novo aparece como nao ligado');
  const vik = r.b.robos.find((x) => x.id === 'vik');
  conf(vik && vik.situacao === 'sem_relatorio', 'robo antigo sem relatorio');
  conf(r.b.tarefas[0].gravidade === 'critico', 'tarefa critica vem primeiro');
  const tSaldo = r.b.tarefas.find((t) => t.chave === 'google-saldo');
  const tMeta = r.b.tarefas.find((t) => t.chave === 'meta-sem-lead');

  // 6. dono marca Vi e Feito
  r = await post({ acao: 'marcar', idToken: 'tDono', tarefa: tMeta.id, status: 'vista' });
  conf(r.c === 200 && r.b.tarefa.status === 'vista' && r.b.tarefa.vistaEm, 'marcar vista');
  r = await post({ acao: 'marcar', idToken: 'tDono', tarefa: tMeta.id, status: 'vista' });
  conf(r.c === 409, 'vista de novo = ja_mudou');
  r = await post({ acao: 'marcar', idToken: 'tDono', tarefa: tSaldo.id, status: 'feita', nota: 'Paguei R$ 200 por Pix' });
  conf(r.c === 200 && r.b.tarefa.status === 'feita' && r.b.tarefa.notaDono === 'Paguei R$ 200 por Pix', 'marcar feita com nota');
  r = await post({ acao: 'marcar', idToken: 'tDono', tarefa: 'pulso__../../admins', status: 'feita' });
  conf(r.c === 400, 'id de tarefa invalido');

  // 7. o robo enxerga o que o dono marcou
  r = await post({ acao: 'pendencias', robo: 'pulso' }, B);
  conf(r.c === 200 && r.b.resumo.vistas === 1 && r.b.resumo.feitas === 1 && r.b.resumo.abertas === 1, 'pendencias do robo: ' + JSON.stringify(r.b.resumo));
  const vistaParaRobo = r.b.tarefas.find((t) => t.chave === 'google-saldo');
  conf(vistaParaRobo && vistaParaRobo.notaDono === 'Paguei R$ 200 por Pix', 'robo ve a nota do dono');
  r = await post({ acao: 'pendencias', robo: 'todos' }, B);
  conf(r.c === 200 && r.b.tarefas.length === 3 && r.b.robos.length === 1, 'Claude ve tudo (todos)');

  // 8. proxima rodada: saldo ainda la (feita -> reaberta), meta piorou (vista -> aberta), sem chave sumiu (completo -> resolvida)
  r = await post({ acao: 'relatorio', robo: 'pulso', gravidade: 'critico', manchete: 'Pulso 2', completo: true,
    tarefas: [ { chave: 'google-saldo', titulo: 'Saldo do Google acaba em 2 dias', gravidade: 'critico' },
               { chave: 'meta-sem-lead', titulo: 'Meta sem lead 2 dias', gravidade: 'critico' } ] }, B);
  conf(r.c === 200 && r.b.reabertas === 2 && r.b.resolvidas === 1 && r.b.novas === 0, 'rodada 2: ' + JSON.stringify(r.b));
  const ts = fake.store.get('robos_tarefas/' + tSaldo.id);
  conf(ts.status === 'aberta' && ts.reaberta === true && ts.vezes === 2, 'feita reaberta quando o robo ainda ve');

  // 9. robo confirma que resolveu
  r = await post({ acao: 'marcar', idToken: 'tDono', tarefa: tSaldo.id, status: 'feita' });
  r = await post({ acao: 'relatorio', robo: 'pulso', gravidade: 'ok', manchete: 'Pulso OK', resolvidas: ['google-saldo'],
    tarefas: [ { chave: 'meta-sem-lead', titulo: 'Meta sem lead 2 dias', gravidade: 'critico' } ] }, B);
  conf(r.c === 200 && r.b.resolvidas === 1, 'resolvidas explicitas');
  conf(fake.store.get('robos_tarefas/' + tSaldo.id).status === 'resolvida', 'feita -> resolvida quando o robo confirma');

  // 10. descartada continua descartada
  r = await post({ acao: 'marcar', idToken: 'tDono', tarefa: tMeta.id, status: 'descartada' });
  conf(r.c === 200, 'descartar');
  r = await post({ acao: 'relatorio', robo: 'pulso', manchete: 'x', tarefas: [ { chave: 'meta-sem-lead', titulo: 'x' } ] }, B);
  conf(fake.store.get('robos_tarefas/' + tMeta.id).status === 'descartada', 'descartada nao volta sozinha');

  // 11. Vi o relatorio inteiro
  await post({ acao: 'relatorio', robo: 'redes', manchete: 'ALARME REDES', gravidade: 'critico', tarefas: [ { chave: 'a', titulo: 'A' }, { chave: 'b', titulo: 'B' } ] }, B);
  r = await post({ acao: 'verRobo', idToken: 'tDono', robo: 'redes' });
  conf(r.c === 200 && r.b.tarefasVistas === 2, 'verRobo marca as abertas como vistas');
  r = await post({ acao: 'painel', idToken: 'tDono' });
  const redes = r.b.robos.find((x) => x.id === 'redes');
  conf(redes.relatorioNovo === false && redes.tarefas.vistas === 2, 'relatorio visto no painel');

  // 12. robo fora do catalogo precisa de nome; id invalido recusado
  r = await post({ acao: 'relatorio', robo: 'robo-futuro', manchete: 'x' }, B);
  conf(r.c === 400 && r.b.erro === 'falta_nome', 'robo novo sem nome');
  r = await post({ acao: 'relatorio', robo: 'robo-futuro', nome: 'Robô futuro', quando: 'toda terça', manchete: 'ok' }, B);
  conf(r.c === 200, 'robo novo com nome');
  r = await post({ acao: 'relatorio', robo: '../admins', manchete: 'x' }, B);
  conf(r.c === 400, 'id de robo invalido');
  r = await post({ acao: 'painel', idToken: 'tDono' });
  conf(r.b.robos.some((x) => x.id === 'robo-futuro' && x.foraDoCatalogo && x.nome === 'Robô futuro'), 'robo fora do catalogo aparece');

  // 13. atrasado
  const t = h._t;
  const dois = Date.now() - 2 * 86400000;
  conf(t.situacao({ freq: 'diario' }, { ultimaEm: dois, gravidade: 'ok' }, Date.now()) === 'atrasado', 'diario sem rodar 2 dias = atrasado');
  conf(t.situacao({ freq: 'semanal' }, { ultimaEm: dois, gravidade: 'ok' }, Date.now()) === 'ok', 'semanal com 2 dias = ok');
  conf(t.situacao({ freq: 'demanda' }, { ultimaEm: 0 }, Date.now()) === 'sem_relatorio', 'sob demanda sem relatorio');

  // 14. custos sugeridos pelos robos (13/10/2026)
  fake.store.set('configuracoes/sistema', { vikPadraoLigado: true, custos: { dolar: 5.4, itens: [ { n: 'Contador', c: 'Fiscal', v: 0, m: 'BRL' } ] } });
  r = await post({ acao: 'custosAtuais', robo: 'vencimentos' }, B);
  conf(r.c === 200 && r.b.salvoNoPainel && r.b.linhas.length === 1 && r.b.linhas[0].nome === 'Contador', 'robo le as linhas do Custos e margem');
  r = await post({ acao: 'custos', robo: 'vencimentos', itens: [
    { chave: 'manychat-pro', nome: 'ManyChat Pro', categoria: 'Ferramenta', valor: 0, moeda: 'BRL', acao: 'incluir', motivo: 'teste ate 23/10' },
    { chave: 'contabilizei', nome: 'Contabilizei', nomePainel: 'Contador', categoria: 'Fiscal', valor: 379, moeda: 'BRL', acao: 'atualizar' },
    { nome: '', valor: 10 }, { nome: 'Caro demais', valor: 999999 },
  ] }, B);
  conf(r.c === 200 && r.b.novas === 2 && r.b.invalidas === 2, 'sugestoes gravadas: ' + JSON.stringify(r.b));
  r = await post({ acao: 'custos', robo: 'vencimentos', itens: [ { chave: 'contabilizei', nome: 'Contabilizei', nomePainel: 'Contador', categoria: 'Fiscal', valor: 379, moeda: 'BRL', acao: 'atualizar' } ] }, B);
  conf(r.b.novas === 1, 'mesma sugestao ainda aberta: so atualiza');
  r = await post({ acao: 'custos', idToken: 'tSenha' });
  conf(r.c === 403, 'custos so com Google');
  r = await post({ acao: 'custos', idToken: 'tDono' });
  conf(r.c === 200 && r.b.abertas.length === 2, 'dono ve 2 sugestoes');
  const cont = r.b.abertas.find((c) => c.chave === 'contabilizei');
  r = await post({ acao: 'custoDecidir', idToken: 'tDono', custo: cont.id, decisao: 'aplicada' });
  conf(r.c === 200 && r.b.custo.status === 'aplicada', 'aplicar');
  r = await post({ acao: 'custoDecidir', idToken: 'tDono', custo: cont.id, decisao: 'recusada' });
  conf(r.c === 409, 'decidir de novo = ja_mudou');
  r = await post({ acao: 'custos', robo: 'vencimentos', itens: [ { chave: 'contabilizei', nome: 'Contabilizei', nomePainel: 'Contador', categoria: 'Fiscal', valor: 379, moeda: 'BRL', acao: 'atualizar' } ] }, B);
  conf(r.b.iguais === 1 && r.b.novas === 0, 'ja aplicada com o mesmo valor: nao volta');
  r = await post({ acao: 'custos', robo: 'vencimentos', itens: [ { chave: 'contabilizei', nome: 'Contabilizei', nomePainel: 'Contador', categoria: 'Fiscal', valor: 395, moeda: 'BRL', acao: 'atualizar' } ] }, B);
  conf(r.b.novas === 1, 'valor mudou: vira sugestao nova');
  r = await post({ acao: 'painel', idToken: 'tDono' });
  conf(r.b.resumo.custosPropostos === 2, 'painel conta as sugestoes abertas');
  r = await post({ acao: 'custoDecidir', idToken: 'tDono', custo: 'c_../x', decisao: 'aplicada' });
  conf(r.c === 400, 'id de custo invalido');

  // 15. ordens do dono (13/10/2026)
  r = await post({ acao: 'ordem', idToken: 'tSenha', robo: 'pulso', texto: 'pausar tudo' });
  conf(r.c === 403, 'ordem so com Google');
  r = await post({ acao: 'ordem', idToken: 'tDono', robo: 'caixa-parceiros', texto: 'conferir os saques' });
  conf(r.c === 400 && r.b.erro === 'robo_sem_gatilho', 'robo sem tarefa agendada nao recebe ordem');
  r = await post({ acao: 'ordem', idToken: 'tDono', robo: 'pulso', texto: '  ' });
  conf(r.c === 400, 'ordem vazia');
  r = await post({ acao: 'ordem', idToken: 'tDono', robo: 'pulso', texto: 'Me diga quanto o Meta gastou ontem e se teve lead.' });
  conf(r.c === 200 && r.b.ordem.status === 'pendente', 'ordem criada');
  const oid = r.b.ordem.id;
  r = await post({ acao: 'ordem', idToken: 'tDono', robo: 'redes', texto: 'Cancela esta' });
  const oid2 = r.b.ordem.id;
  r = await post({ acao: 'ordemCancelar', idToken: 'tDono', ordem: oid2 });
  conf(r.c === 200 && r.b.ordem.status === 'cancelada', 'ordem cancelada antes de sair');
  r = await post({ acao: 'ordensPendentes', robo: 'maestro' }, B);
  conf(r.c === 200 && r.b.ordens.length === 1 && r.b.ordens[0].gatilho === 'trig_01PKDLdqzgGJnWCxU3zCgemG', 'maestro ve a ordem com o gatilho');
  r = await post({ acao: 'ordemEnviada', robo: 'pulso', ordem: oid }, B);
  conf(r.c === 403, 'so o maestro marca enviada');
  r = await post({ acao: 'ordemEnviada', robo: 'maestro', ordem: oid, sessao: 'cse_x' }, B);
  conf(r.c === 200, 'maestro marca enviada');
  r = await post({ acao: 'ordemEnviada', robo: 'maestro', ordem: oid }, B);
  conf(r.c === 409, 'nao envia duas vezes');
  r = await post({ acao: 'ordemCancelar', idToken: 'tDono', ordem: oid });
  conf(r.c === 409, 'nao cancela depois de enviada');
  r = await post({ acao: 'ordemResposta', robo: 'redes', ordem: oid, status: 'cumprida', resposta: 'x' }, B);
  conf(r.c === 403, 'outro robo nao responde');
  r = await post({ acao: 'ordemResposta', robo: 'pulso', ordem: oid, status: 'cumprida', resposta: 'Meta gastou R$ 15,20 e teve 1 lead.' }, B);
  conf(r.c === 200, 'robo responde');
  r = await post({ acao: 'painel', idToken: 'tDono' });
  const o1 = r.b.ordens.find((o) => o.id === oid);
  conf(o1 && o1.status === 'cumprida' && o1.resposta.indexOf('1 lead') > 0, 'painel mostra a resposta');
  conf(r.b.robos.find((x) => x.id === 'pulso').comandavel === true && r.b.robos.find((x) => x.id === 'caixa-parceiros').comandavel === false, 'comandavel');
  conf(r.b.resumo.ordensAbertas === 0, 'nenhuma ordem aberta');

  console.log(falhas ? ('FALHAS: ' + falhas + ' | ok: ' + ok) : ('robos: tudo certo (' + ok + ' conferencias)'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
