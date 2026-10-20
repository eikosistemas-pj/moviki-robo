'use strict';
// Agendamento de servico com sinal no Pix (P85 Fase 2b, 20/10/2026). Sem internet e sem Firebase:
// cd moviki-robo && node testes/agenda.test.js
process.env.CHECKOUT_CHAVE = 'uma-frase-longa-e-aleatoria-de-teste-1234567890';
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'x', filename: 'x', loaded: true, exports: { admin: fake.admin, db: fake.db } };
const ck = require(path.join(ROBO, 'lib/checkout.js'));
const T = ck._t;
const { store } = fake;
let falhas = 0, ok = 0;
function conf(c, msg) { if (c) { ok++; } else { falhas++; console.log('FALHOU:', msg); } }
const d = (p) => store.get(p);
const UID = 'lojistaAAAAAAAAAAA1';
// Segunda, 19/10/2026, 08:00 em Brasilia
const FIXO = Date.parse('2026-10-19T08:00:00-03:00');
let desloc = 0; Date.now = () => FIXO + desloc;
const H = 3600000;
function base(modo) {
  store.clear(); desloc = 0;
  store.set('assinaturas/' + UID, { ativo: true, plano: 'premium' });
  store.set('negocios/' + UID, { nome: 'Barbearia Teste', horarios: { seg: '08:00-10:00', ter: '09:00-12:00', qua: '', qui: '09:00-12:00', sex: '09:00-12:00', sab: '', dom: '' } });
  store.set('recebimento/' + UID, { ligado: true, modo: modo || 'pix', entrega: 'retirada', pix: { chaveCifrada: T.cifrar('loja@teste.com'), nome: 'Barbearia', cidade: 'Joao Pessoa', docMascara: '***', mascara: 'x', tipo: 'email' } });
  store.set('configuracoes/liveTermos', {});
}
const SERV = [{ nome: 'Corte', dur: 30, preco: '40', sinal: '10' }, { nome: 'Barba', dur: 60, preco: '30', sinal: '' }];
let ipn = 0;
const ip = () => '7.7.' + Math.floor(++ipn / 200) + '.' + (ipn % 200);
const comp = (w, extra) => Object.assign({ nome: 'Joao Silva', cpf: '52998224725', whatsapp: w || '11999998888', aceite: true, lojistaUid: UID }, extra || {});

(async () => {
  // --- configuracao
  base('asaas');
  let r = await T.lojaAgenda(UID, { ativo: true, servicos: SERV });
  conf(r.erro === 'sinal_so_pix', 'sinal exige o Pix direto: ' + JSON.stringify(r));
  base();
  r = await T.lojaAgenda(UID, { ativo: true, servicos: [{ nome: 'Corte', dur: 45, preco: '40' }] });
  conf(r.erro === 'servico_duracao', 'duracao fora da lista recusa');
  r = await T.lojaAgenda(UID, { ativo: true, servicos: [{ nome: 'Corte', dur: 30, preco: '40', sinal: '50' }] });
  conf(r.erro === 'servico_sinal', 'sinal maior que o preco recusa');
  r = await T.lojaAgenda(UID, { ativo: true, servicos: [] });
  conf(r.erro === 'servicos_vazio', 'ligar sem servico recusa');
  r = await T.lojaAgenda(UID, { ativo: true, servicos: SERV, antecedenciaMin: 60, diasFrente: 14 });
  conf(r.ok && d('recebimento/' + UID).agendaCfg.servicos.length === 2 && d('checkout_publico/' + UID).agenda.ativo === true, 'salva e espelha: ' + JSON.stringify(r));
  const [corte, barba] = d('checkout_publico/' + UID).agenda.servicos;
  conf(corte.sinal === 10 && barba.sinal === 0 && /^[a-z0-9]{8}$/.test(corte.id), 'servicos com id e sinal: ' + JSON.stringify(corte));
  r = await T.lojaAgenda(UID, { ativo: true, servicos: [Object.assign({}, corte, { preco: '45' }), barba] });
  conf(d('recebimento/' + UID).agendaCfg.servicos[0].id === corte.id, 'editar mantem o id do servico');

  // --- horarios livres
  r = await T.agendaLivres({ lojistaUid: UID, servico: corte.id, dia: '2026-10-20' }, ip());
  conf(r.ok && r.horas.join(',') === '09:00,09:30,10:00,10:30,11:00,11:30', 'terca 09-12 com corte de 30 min: ' + JSON.stringify(r));
  r = await T.agendaLivres({ lojistaUid: UID, servico: barba.id, dia: '2026-10-20' }, ip());
  conf(r.horas.join(',') === '09:00,09:30,10:00,10:30,11:00', 'barba de 60 min nao passa do fechamento: ' + JSON.stringify(r.horas));
  r = await T.agendaLivres({ lojistaUid: UID, servico: corte.id, dia: '2026-10-21' }, ip());
  conf(r.ok && r.horas.length === 0 && r.aberto === false, 'quarta fechada');
  r = await T.agendaLivres({ lojistaUid: UID, servico: corte.id, dia: '2026-10-19' }, ip());
  conf(r.horas.join(',') === '09:00,09:30', 'hoje respeita 1 h de antecedencia: ' + JSON.stringify(r.horas));
  r = await T.agendaLivres({ lojistaUid: UID, servico: corte.id, dia: '2026-11-20' }, ip());
  conf(r.erro === 'dia', 'alem dos 14 dias recusa');
  r = await T.agendaLivres({ lojistaUid: UID, servico: corte.id, dia: '2026-10-18' }, ip());
  conf(r.erro === 'dia', 'dia que ja passou recusa');

  // --- agendar com sinal
  r = await T.agendaCriar(Object.assign({ servico: corte.id, dia: '2026-10-20', hora: '09:15' }, comp()), ip());
  conf(r.erro === 'horario', 'horario fora do passo de 30 min recusa');
  r = await T.agendaCriar(Object.assign({ servico: corte.id, dia: '2026-10-20', hora: '09:00' }, comp('11999998888', { cpf: '' })), ip());
  conf(r.erro === 'cpf', 'com sinal o CPF e obrigatorio (Pix)');
  r = await T.agendaCriar(Object.assign({ servico: corte.id, dia: '2026-10-20', hora: '09:00' }, comp()), ip());
  conf(r.ok && r.modo === 'pix' && Math.floor(r.total) === 10 && r.pix && r.agenda.restante === 35, 'sinal de R$ 10 no Pix, restante 35: ' + JSON.stringify(r).slice(0, 240));
  const id1 = r.pedidoId, ch1 = r.chave;
  const p1 = d('pedidos/' + id1);
  conf(p1.origem === 'agenda' && p1.agenda.hora === '09:00' && p1.status === 'aguardando' && /Sinal: Corte \(20\/10 09h00\)/.test(p1.itens[0].nome), 'pedido do sinal: ' + p1.itens[0].nome);
  r = await T.agendaLivres({ lojistaUid: UID, servico: corte.id, dia: '2026-10-20' }, ip());
  conf(r.horas[0] === '09:30', 'horario preso some da lista: ' + r.horas.join(','));
  r = await T.agendaCriar(Object.assign({ servico: corte.id, dia: '2026-10-20', hora: '09:00' }, comp('11988887777')), ip());
  conf(r.erro === 'horario_ocupado', 'segunda pessoa no mesmo horario: ' + JSON.stringify(r));
  r = await T.agendaCriar(Object.assign({ servico: barba.id, dia: '2026-10-20', hora: '08:30' }, comp('11988887777')), ip());
  conf(r.erro === 'horario', 'antes de abrir recusa');
  r = await T.agendaLivres({ lojistaUid: UID, servico: barba.id, dia: '2026-10-20' }, ip());
  conf(r.horas.indexOf('09:00') < 0 && r.horas[0] === '09:30', 'barba de 60 min nao sobrepoe o corte: ' + r.horas.join(','));
  r = await T.compraStatus({ pedidoId: id1, chave: ch1 });
  conf(r.ok && r.agenda && r.agenda.hora === '09:00' && r.agenda.desmarcarAte === Date.parse('2026-10-20T07:00:00-03:00'), 'status mostra o agendamento: ' + JSON.stringify(r.agenda));

  // Pix pago: horario fica fixo mesmo depois do prazo do Pix
  r = await T.lojaPedido(UID, id1, 'pago');
  conf(r.ok && d('pedidos/' + id1).status === 'pago', 'lojista confirma o sinal: ' + JSON.stringify(r));
  desloc = 3 * H;
  r = await T.agendaLivres({ lojistaUid: UID, servico: corte.id, dia: '2026-10-20' }, ip());
  conf(r.horas[0] === '09:30', 'pago continua ocupado depois do prazo do Pix');
  r = await T.lojaPedido(UID, id1, 'entregue');
  conf(r.ok && d('pedidos/' + id1).status === 'entregue', 'Atendido (entregue) na retirada');

  // Pix nao pago solta o horario sozinho
  desloc = 0;
  r = await T.agendaCriar(Object.assign({ servico: corte.id, dia: '2026-10-20', hora: '10:00' }, comp('11977776666')), ip());
  const id2 = r.pedidoId;
  desloc = 2 * H;
  r = await T.agendaLivres({ lojistaUid: UID, servico: corte.id, dia: '2026-10-20' }, ip());
  conf(r.horas.indexOf('10:00') >= 0, 'Pix nao pago solta o horario: ' + r.horas.join(','));
  r = await T.agendaCriar(Object.assign({ servico: corte.id, dia: '2026-10-20', hora: '10:00' }, comp('11966665555')), ip());
  conf(r.ok, 'outra pessoa pega o horario solto');
  r = await T.lojaPedido(UID, id2, 'pago');
  conf(r.ok && d('pedidos/' + id2).alerta === 'horario_ocupado', 'Pix pago atrasado com horario tomado sai com alerta');

  // "Ja paguei" segura o horario 24 h
  desloc = 0;
  r = await T.agendaCriar(Object.assign({ servico: corte.id, dia: '2026-10-22', hora: '09:00' }, comp('11955554444')), ip());
  const id3 = r.pedidoId, ch3 = r.chave;
  r = await T.compraPaguei({ pedidoId: id3, chave: ch3 });
  desloc = 3 * H;
  r = await T.agendaLivres({ lojistaUid: UID, servico: corte.id, dia: '2026-10-22' }, ip());
  conf(r.horas[0] === '09:30', '"Ja paguei" segura o horario: ' + r.horas.join(','));
  r = await T.lojaPedido(UID, id3, 'recusado', 'nao caiu');
  r = await T.agendaLivres({ lojistaUid: UID, servico: corte.id, dia: '2026-10-22' }, ip());
  conf(r.horas[0] === '09:00', 'Pix recusado solta o horario');

  // --- sem sinal
  desloc = 0;
  r = await T.agendaCriar(Object.assign({ servico: barba.id, dia: '2026-10-23', hora: '10:00' }, comp('11944443333', { cpf: '' })), ip());
  conf(r.ok && r.modo === 'agenda' && r.total === 0 && !r.pix, 'sem sinal nao pede CPF nem Pix: ' + JSON.stringify(r).slice(0, 200));
  const id4 = r.pedidoId, ch4 = r.chave;
  const p4 = d('pedidos/' + id4);
  conf(p4.status === 'pago' && p4.semSinal === true && p4.modo === 'agenda' && p4.total === 0, 'nasce pago, total 0');
  desloc = 48 * H;
  r = await T.agendaLivres({ lojistaUid: UID, servico: corte.id, dia: '2026-10-23' }, ip());
  conf(r.horas.indexOf('10:00') < 0 && r.horas.indexOf('10:30') < 0 && r.horas.indexOf('11:00') >= 0, 'sem sinal ocupa os 2 passos para sempre: ' + r.horas.join(','));
  r = await T.compraStatus({ pedidoId: id4, chave: ch4 });
  conf(r.ok && r.modo === 'agenda' && r.status === 'pago' && r.agenda.servico === 'Barba', 'status do agendamento sem sinal');

  // --- desmarcar
  r = await T.agendaDesmarcar({ pedidoId: id4, chave: 'errada' });
  conf(r.erro === 'nao_encontrado', 'chave errada nao desmarca');
  r = await T.agendaDesmarcar({ pedidoId: id4, chave: ch4 });
  conf(r.ok && !r.devolverSinal && d('pedidos/' + id4).status === 'cancelado' && d('pedidos/' + id4).canceladoPor === 'cliente', 'desmarca sem sinal: ' + JSON.stringify(r));
  r = await T.agendaLivres({ lojistaUid: UID, servico: corte.id, dia: '2026-10-23' }, ip());
  conf(r.horas.indexOf('10:00') >= 0, 'desmarcado solta o horario');

  desloc = 0;
  r = await T.agendaCriar(Object.assign({ servico: corte.id, dia: '2026-10-23', hora: '11:00' }, comp('11933332222')), ip());
  const id5 = r.pedidoId, ch5 = r.chave;
  await T.lojaPedido(UID, id5, 'pago');
  r = await T.agendaDesmarcar({ pedidoId: id5, chave: ch5 });
  conf(r.ok && r.devolverSinal === true && d('pedidos/' + id5).sinalDevolver === true && d('pedidos/' + id5).alerta === 'devolver_sinal', 'sinal pago: lojista avisado para devolver');

  r = await T.agendaCriar(Object.assign({ servico: corte.id, dia: '2026-10-20', hora: '11:00' }, comp('11922221111')), ip());
  const id6 = r.pedidoId, ch6 = r.chave;
  desloc = Date.parse('2026-10-20T09:30:00-03:00') - FIXO;
  r = await T.agendaDesmarcar({ pedidoId: id6, chave: ch6 });
  conf(r.erro === 'desmarcar_tarde', 'menos de 2 h antes nao desmarca: ' + JSON.stringify(r));

  // lojista cancela agendamento sem sinal
  desloc = 0;
  r = await T.agendaCriar(Object.assign({ servico: barba.id, dia: '2026-10-26', hora: '09:00' }, comp('11911110000', { cpf: '' })), ip());
  const id7 = r.pedidoId;
  r = await T.lojaPedido(UID, id7, 'cancelado', 'vou viajar');
  conf(r.ok && d('pedidos/' + id7).status === 'cancelado' && d('pedidos/' + id7).canceladoPor === 'lojista', 'lojista cancela o horario');
  r = await T.agendaLivres({ lojistaUid: UID, servico: barba.id, dia: '2026-10-26' }, ip());
  conf(r.horas[0] === '08:00', 'cancelado pelo lojista solta o horario: ' + r.horas.join(','));

  // agenda desligada
  await T.lojaAgenda(UID, { ativo: false, servicos: SERV });
  r = await T.agendaLivres({ lojistaUid: UID, servico: corte.id, dia: '2026-10-20' }, ip());
  conf(r.erro === 'agenda_indisponivel', 'agenda desligada');
  store.set('assinaturas/' + UID, { ativo: false, plano: 'basico' });
  await T.lojaAgenda(UID, { ativo: true, servicos: SERV });
  r = await T.agendaCriar(Object.assign({ servico: barba.id, dia: '2026-10-20', hora: '09:00' }, comp('11900001111', { cpf: '' })), ip());
  conf(r.erro === 'agenda_indisponivel', 'sem plano com pedidos nao agenda');

  console.log(falhas ? falhas + ' falha(s), ' + ok + ' ok' : 'agenda: ' + ok + ' conferencias ok');
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
