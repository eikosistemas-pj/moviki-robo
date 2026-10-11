'use strict';
// Venda no Mexico (P76 M5, 11/10/2026): modo 'clabe' e efectivo, dormente para o Brasil.
// Sem internet e sem Firebase: cd moviki-robo && node testes/vendamx.test.js
process.env.CHECKOUT_CHAVE = 'uma-frase-longa-e-aleatoria-de-teste-1234567890';
delete process.env.RESEND_API_KEY;
delete process.env.TELEGRAM_TOKEN;
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const fake = require('./fakefs');
require.cache[require.resolve(path.join(ROBO, 'lib/firebase.js'))] = { id: 'x', filename: 'x', loaded: true, exports: { admin: fake.admin, db: fake.db } };
const ck = require(path.join(ROBO, 'lib/checkout.js'));
const T = ck._t;
const MX = T.mx();
const { store, Timestamp } = fake;

let falhas = 0, ok = 0;
function conf(c, msg) { if (c) ok++; else { falhas++; console.log('FALHOU:', msg); } }
const d = (p) => store.get(p);
const agoraS = () => Math.floor(Date.now() / 1000);
const DEC_NOVO = (uid) => ({ uid, auth_time: agoraS() });
const DEC_VELHO = (uid) => ({ uid, auth_time: agoraS() - 3600 });

const MXU = 'lojistaMexicoAAAAAA1';
const BRU = 'lojistaBrasilBBBBBB2';
const CLABE = '012180015555555550';          // BBVA Mexico, digito conferido
const CLABE2 = '638180000100000001';         // Nu Mexico
let ipN = 0;
const ip = () => '10.0.0.' + (++ipN);

function base() {
  store.clear();
  const venc = Timestamp.fromMillis(Date.now() + 20 * 86400000);
  store.set('negocios/' + MXU, { nome: 'Boutique Jacaranda', pais: 'MX', cardapio: [{ categoria: 'Ropa', produtos: [{ nome: 'Blusa Flores', preco: '250', sku: 'blu1' }, { nome: 'Falda Negra', preco: '320', sku: 'fal1' }] }] });
  store.set('negocios/' + BRU, { nome: 'Loja Brasil', cardapio: [{ categoria: 'Roupas', produtos: [{ nome: 'Camiseta', preco: '50', sku: 'cam1' }] }] });
  store.set('assinaturas/' + MXU, { ativo: true, plano: 'pro', periodo: 'trial', origem: 'trial', vence_em: venc });
  store.set('assinaturas/' + BRU, { ativo: true, plano: 'premium', vence_em: venc });
  store.set('configuracoes/liveTermos', {});
  store.set('recebimento/' + BRU, { ligado: true, modo: 'pix', entrega: 'ambos', pix: { chaveCifrada: T.cifrar('loja@teste.com'), nome: 'Loja Brasil', cidade: 'Joao Pessoa', docMascara: '***', mascara: 'lo***@teste.com', tipo: 'email' } });
}
const compraMx = (extra) => Object.assign({ pais: 'MX', lojistaUid: MXU, origem: 'cardapio', nome: 'Ana Lopez', whatsapp: '5512345678', aceite: true, itens: [{ sku: 'blu1', qtd: 1 }], entrega: 'retirada' }, extra || {});
const compraBr = (extra) => Object.assign({ lojistaUid: BRU, origem: 'cardapio', nome: 'Rui Alves', cpf: '52998224725', whatsapp: '11999998888', aceite: true, itens: [{ sku: 'cam1', qtd: 1 }], entrega: 'retirada' }, extra || {});

async function ligarMx(extra) {
  await MX.lojaClabeSalvar(MXU, { clabe: CLABE, titular: 'Ana Maria Lopez', celular: '5598765432' }, DEC_VELHO(MXU));
  return T.lojaModo(MXU, Object.assign({ modo: 'clabe', ligado: true, aceite: true, plazoMin: 120, entrega: 'ambos' }, extra || {}));
}

(async () => {
  /* ---------------------------------------------------- Brasil intacto */
  base();
  let r = await T.compraCriar(compraBr(), ip());
  conf(r.ok && r.modo === 'pix' && r.pix && r.pix.copiaCola, 'BR: compra pelo Pix direto segue igual');
  conf(!r.transferencia && !r.moeda, 'BR: resposta sem campos do Mexico');
  const pedBr = d('pedidos/' + r.pedidoId);
  conf(pedBr.comprador.cpfFinal === '25' && !pedBr.pais, 'BR: pedido com CPF final e sem pais');
  let sit = await T.situacaoRecebimento(BRU);
  conf(sit.plano === 'premium' && !('pais' in sit) && !('clabe' in sit), 'BR: situacao sem campos do Mexico');
  r = await T.lojaModo(BRU, { modo: 'clabe', ligado: true, aceite: true });
  conf(r.erro === 'modo', 'BR: modo clabe nao existe fora do Mexico');
  r = await MX.lojaClabeSalvar(BRU, { clabe: CLABE, titular: 'Ana Maria Lopez' }, DEC_NOVO(BRU));
  conf(r.erro === 'pais', 'BR: nao cadastra CLABE');
  r = await T.compraCriar(compraMx({ lojistaUid: BRU }), ip());
  conf(r.erro === 'dados', 'pedido MX num negocio BR e recusado');
  r = await T.compraCriar(compraBr({ lojistaUid: MXU }), ip());
  conf(r.erro === 'dados', 'pedido BR num negocio MX e recusado');
  conf(T.minimoDoModo('pix') === 5, 'BR: minimo do Pix continua 5');

  /* ---------------------------------------------------- CLABE da lojista */
  base();
  r = await MX.lojaClabeSalvar(MXU, { clabe: '012180015555555551', titular: 'Ana Maria Lopez' }, DEC_NOVO(MXU));
  conf(r.erro === 'clabe_digito', 'CLABE com digito errado recusada');
  r = await MX.lojaClabeSalvar(MXU, { clabe: '01218001555555555', titular: 'Ana Maria Lopez' }, DEC_NOVO(MXU));
  conf(r.erro === 'clabe_tamanho', 'CLABE curta recusada');
  r = await MX.lojaClabeSalvar(MXU, { clabe: CLABE, titular: 'Ana' }, DEC_NOVO(MXU));
  conf(r.erro === 'titular', 'titular com uma palavra recusado');
  r = await MX.lojaClabeSalvar(MXU, { clabe: CLABE, titular: 'Ana Maria Lopez', celular: '123' }, DEC_NOVO(MXU));
  conf(r.erro === 'celular', 'celular invalido recusado');
  r = await MX.lojaClabeSalvar(MXU, { clabe: CLABE, titular: 'Ana Maria Lopez', celular: '+52 55 9876 5432' }, DEC_VELHO(MXU));
  conf(!r.erro && r.clabe && r.clabe.tem && r.clabe.banco === 'BBVA México' && r.clabe.mascara.endsWith('5550'), 'primeira CLABE cadastra sem login recente');
  conf(r.pais === 'MX' && r.plano === 'prueba' && r.prueba.ativa && r.prueba.restam === 40, 'situacao MX mostra a prueba com 40');
  let rec = d('recebimento/' + MXU);
  conf(!JSON.stringify(rec).includes(CLABE) && !JSON.stringify(rec).includes('9876543'), 'CLABE e celular nao ficam em claro');
  conf(T.decifrar(rec.clabe.cifrada) === CLABE, 'CLABE cifrada confere');
  conf(!rec.pixTrocadoEm, 'primeira CLABE nao pausa a venda');
  r = await MX.lojaClabeSalvar(MXU, { clabe: CLABE2, titular: 'Ana Maria Lopez' }, DEC_VELHO(MXU));
  conf(r.erro === 'login_recente', 'troca sem login recente recusada');
  conf(T.decifrar(d('recebimento/' + MXU).clabe.cifrada) === CLABE, 'CLABE nao mudou');
  r = await MX.lojaClabeSalvar(MXU, { clabe: CLABE, titular: 'Ana Maria Lopez', celular: '5598765432' }, DEC_VELHO(MXU));
  conf(!r.erro && !d('recebimento/' + MXU).pixTrocadoEm, 'regravar a mesma CLABE nao e troca');

  /* ---------------------------------------------------- modo e espelho */
  r = await T.lojaModo(MXU, { modo: 'pix', ligado: true, aceite: true });
  conf(r.erro === 'modo', 'MX: modo pix recusado');
  r = await T.lojaModo(MXU, { modo: 'clabe', ligado: true });
  conf(r.erro === 'aceite', 'MX: liga so com o termo aceito');
  r = await T.lojaModo(MXU, { modo: 'clabe', ligado: true, aceite: true, plazoMin: 45 });
  conf(r.erro === 'plazo', 'prazo fora da lista recusado');
  r = await T.lojaModo(MXU, { modo: 'clabe', ligado: true, aceite: true, plazoMin: 120, entrega: 'ambos' });
  conf(!r.erro && r.ligado && r.modo === 'clabe' && r.plazoMin === 120 && r.termoMx.aceito, 'MX liga com prazo de 2 h');
  let pub = d('checkout_publico/' + MXU);
  conf(pub.ativo && pub.modo === 'clabe' && pub.pais === 'MX' && pub.moeda === 'MXN' && pub.plazoMin === 120 && pub.efectivo === false, 'espelho com pais, moeda, prazo e efectivo');
  conf(!JSON.stringify(pub).includes('5555555') && !JSON.stringify(pub).includes('cifrada'), 'espelho sem CLABE');
  conf(pub.minimo === 20, 'minimo em pesos no espelho');

  /* ---------------------------------------------------- compra por transferencia */
  r = await T.compraCriar(compraMx({ whatsapp: '11999998888' }), ip());
  conf(r.erro === 'whatsapp', 'telefone brasileiro recusado no Mexico');
  r = await T.compraCriar(compraMx({ entrega: 'envio' }), ip());
  conf(r.erro === 'sem_envio', 'sem envio pelo Brasil no Mexico');
  r = await T.compraCriar(compraMx({ entrega: 'entrega', endereco: { rua: 'Av. Insurgentes', numero: '10', bairro: 'Roma', cp: '0670' } }), ip());
  conf(r.erro === 'cp', 'codigo postal com 4 digitos recusado');
  r = await T.compraCriar(compraMx(), ip());
  conf(r.ok && r.modo === 'clabe' && r.moeda === 'MXN', 'compra MX nasce no modo clabe');
  conf(r.transferencia && r.transferencia.clabe === CLABE && r.transferencia.banco === 'BBVA México' && r.transferencia.beneficiaria === 'Ana Maria Lopez', 'tela recebe banco, CLABE e titular');
  conf(r.transferencia.concepto === 'MV 0001' && r.transferencia.referencia === '0000001', 'concepto e referencia pelo numero do pedido');
  conf(r.transferencia.celular === '5598765432' && /banxico\.org\.mx\/cep/.test(r.transferencia.cep), 'celular do DiMo e endereco do CEP');
  conf(r.total >= 250 && r.total < 251 && r.transferencia.monto === r.total, 'monto com centavos identificadores');
  conf(r.validadeMin === 120, 'prazo do apartado e o da lojista');
  const pid = r.pedidoId, chave = r.chave;
  let ped = d('pedidos/' + pid);
  conf(ped.pais === 'MX' && ped.moeda === 'MXN' && ped.modo === 'clabe' && ped.prueba === true, 'pedido marcado MX e prueba');
  conf(!('cpfFinal' in ped.comprador) && ped.comprador.whatsapp === '+525512345678', 'compradora sem CPF e com +52');
  conf(/^\d{4}-\d{2}-\d{2}$/.test(ped.dia) && ped.aceite.versao.startsWith('MX-'), 'dia e aceite do Mexico');
  conf(!JSON.stringify(ped).includes(CLABE), 'pedido nao guarda a CLABE');

  /* status e "ya pague" */
  r = await T.compraStatus({ pedidoId: pid, chave });
  conf(r.ok && r.status === 'aguardando' && r.modo === 'clabe', 'status do pedido MX');
  r = await T.compraPaguei({ pedidoId: pid, chave, claveRastreo: 'MB<AN>' });
  conf(r.erro === 'clave_rastreo', 'clave de rastreo com simbolo recusada');
  r = await T.compraPaguei({ pedidoId: pid, chave, bancoOrigem: '555' });
  conf(r.erro === 'banco_origem', 'banco de origem fora da tabela recusado');
  r = await T.compraPaguei({ pedidoId: pid, chave, claveRastreo: 'mban0100261011 0001234', bancoOrigem: '728' });
  conf(r.ok && r.status === 'conferindo', 'ya pague vai para conferindo');
  ped = d('pedidos/' + pid);
  conf(ped.transferencia.claveRastreo === 'MBAN01002610110001234' && ped.transferencia.bancoOrigem.nome === 'Spin by OXXO', 'clave e banco guardados');

  /* recibi */
  r = await T.lojaPedido(MXU, pid, 'pago');
  conf(r.ok && r.status === 'pago', 'Recibi marca pago');
  ped = d('pedidos/' + pid);
  conf(ped.confirmadoPor === 'lojista', 'pago na palavra da lojista');
  conf(d('recebimento/' + MXU).prueba.pagos === 1, 'apartado pago conta na prueba');
  r = await T.lojaPedido(MXU, pid, 'pago');
  conf(d('recebimento/' + MXU).prueba.pagos === 1, 'confirmar de novo nao conta duas vezes');

  /* retencao */
  await T.apagarDadosDoComprador(fake.db.collection('pedidos').doc(pid), d('pedidos/' + pid));
  ped = d('pedidos/' + pid);
  conf(!ped.transferencia && !ped.comprador.whatsapp, 'retencao apaga clave de rastreo e WhatsApp');

  /* ---------------------------------------------------- efectivo */
  r = await T.compraCriar(compraMx({ pagamento: 'efectivo' }), ip());
  conf(r.erro === 'sem_efectivo', 'efectivo so com a lojista ligando');
  await T.lojaModo(MXU, { modo: 'clabe', ligado: true, efectivo: true, efectivoHoras: 72 });
  conf(d('checkout_publico/' + MXU).efectivo === true && d('checkout_publico/' + MXU).efectivoHoras === 72, 'espelho mostra efectivo de 72 h');
  r = await T.compraCriar(compraMx({ pagamento: 'efectivo', entrega: 'entrega', endereco: { rua: 'Av. Insurgentes Sur', numero: '10', bairro: 'Roma Norte', cp: '06700' } }), ip());
  conf(r.ok && r.modo === 'efectivo' && !r.transferencia && r.validadeMin === 72 * 60, 'efectivo sem dados bancarios e com 72 h');
  const pidE = r.pedidoId, chaveE = r.chave;
  ped = d('pedidos/' + pidE);
  conf(ped.entrega.cp === '06700' && ped.entrega.cep === '', 'codigo postal guardado em entrega.cp');
  conf(ped.centavos === 0 && ped.total === ped.totalBase, 'efectivo sem centavos identificadores');
  r = await T.compraPaguei({ pedidoId: pidE, chave: chaveE });
  conf(r.erro === 'modo', 'efectivo nao tem ya pague');
  r = await T.lojaPedido(MXU, pidE, 'pago');
  conf(r.ok && d('recebimento/' + MXU).prueba.pagos === 2, 'Recibi el efectivo marca pago e conta');

  /* ---------------------------------------------------- vencimento */
  r = await T.compraCriar(compraMx(), ip());
  const pidV = r.pedidoId;
  await fake.db.collection('pedidos').doc(pidV).set({ validoAte: Date.now() - 1000 }, { merge: true });
  const rv = await T.varrerPedidosGateway(10);
  conf(d('pedidos/' + pidV).status === 'expirado' && rv.pixVencidos >= 1, 'apartado sem pagamento vence no cron');

  /* ---------------------------------------------------- limite da prueba */
  await fake.db.collection('recebimento').doc(MXU).set({ prueba: { pagos: 40, limiteEm: Timestamp.fromMillis(Date.now() - 60000) } }, { merge: true });
  r = await T.compraCriar(compraMx(), ip());
  conf(r.erro === 'limite_prueba', 'cardapio para depois de 40 pagos na prueba');
  // live que comecou ANTES do limite segue vendendo; a que comecou depois, nao
  store.set('negocios/' + MXU + '/estado/live', { sacola: [{ nome: 'Blusa Flores', preco: '250' }] });
  store.set('live_sessoes/' + MXU, { ativa: true, pulsoEm: Timestamp.now(), sessaoId: 'ses1', inicioEm: Timestamp.fromMillis(Date.now() - 3600000) });
  r = await T.compraCriar(compraMx({ origem: 'live', produto: 'Blusa Flores', itens: undefined }), ip());
  conf(r.ok, 'live no ar desde antes do limite continua vendendo');
  store.set('live_sessoes/' + MXU, { ativa: true, pulsoEm: Timestamp.now(), sessaoId: 'ses2', inicioEm: Timestamp.now() });
  r = await T.compraCriar(compraMx({ origem: 'live', produto: 'Blusa Flores', itens: undefined }), ip());
  conf(r.erro === 'limite_prueba', 'live nova depois do limite pede assinatura');

  /* Premium no Mexico vende na live (no Brasil, so Enterprise) */
  store.set('assinaturas/' + MXU, { ativo: true, plano: 'premium', vence_em: Timestamp.fromMillis(Date.now() + 86400000) });
  r = await T.compraCriar(compraMx({ origem: 'live', produto: 'Blusa Flores', itens: undefined }), ip());
  conf(r.ok, 'MX: Premium vende na live');
  conf(d('pedidos/' + r.pedidoId).prueba === false, 'pedido de assinante nao conta na prueba');
  store.set('negocios/' + BRU + '/estado/live', { sacola: [{ nome: 'Camiseta', preco: '50' }] });
  store.set('live_sessoes/' + BRU, { ativa: true, pulsoEm: Timestamp.now(), sessaoId: 'sesb', inicioEm: Timestamp.now() });
  r = await T.compraCriar(compraBr({ origem: 'live', produto: 'Camiseta', itens: undefined }), ip());
  conf(r.erro === 'indisponivel', 'BR: Premium continua sem venda na live');

  /* ---------------------------------------------------- troca da CLABE pausa a venda */
  r = await MX.lojaClabeSalvar(MXU, { clabe: CLABE2, titular: 'Ana Maria Lopez' }, DEC_NOVO(MXU));
  conf(!r.erro && d('recebimento/' + MXU).pixTrocadoEm, 'troca com login recente marca a pausa');
  conf(d('checkout_publico/' + MXU).pixPausadoAte && d('checkout_publico/' + MXU).pixPausadoAte.toMillis() > Date.now(), 'espelho mostra a pausa');
  r = await T.compraCriar(compraMx(), ip());
  conf(r.erro === 'pix_pausado' && /pausa/.test(r.mensagem), 'venda pausada por 2 h, com aviso em espanhol');

  /* pausa da CLABE nao trava o efectivo */
  r = await T.compraCriar(compraMx({ pagamento: 'efectivo', whatsapp: '5511112222' }), ip());
  conf(r.ok && r.modo === 'efectivo', 'efectivo segue durante a pausa da CLABE');

  /* ---------------------------------------------------- revisao de 11/10 */
  base();
  await ligarMx({ efectivo: true });
  // apartados abertos por telefone (3) e por rede (6)
  for (let i = 0; i < 3; i++) { r = await T.compraCriar(compraMx(), ip()); conf(r.ok, 'apartado aberto ' + (i + 1)); }
  r = await T.compraCriar(compraMx(), ip());
  conf(r.erro === 'apartados_abertos', '4o apartado aberto do mesmo telefone recusado');
  const seqAntes = (d('pedido_seq/' + MXU) || {}).n;
  r = await T.compraCriar(compraMx({ whatsapp: '5533334444' }), ip());
  conf(r.ok, 'outra compradora segue comprando');
  const redeFixa = '200.1.1.1';
  for (let i = 0; i < 6; i++) { await T.compraCriar(compraMx({ whatsapp: '55' + String(40000000 + i) }), redeFixa); }
  r = await T.compraCriar(compraMx({ whatsapp: '5549999999' }), redeFixa);
  conf(r.erro === 'apartados_abertos', '7o apartado aberto da mesma rede recusado');
  conf(seqAntes >= 3, 'sequencia de pedidos andou');
  // teto de criados na prueba (a lojista que nunca confirma)
  await fake.db.collection('recebimento').doc(MXU).set({ prueba: { pagos: 0, criados: 80 } }, { merge: true });
  r = await T.compraCriar(compraMx({ whatsapp: '5577778888' }), ip());
  conf(r.erro === 'limite_prueba', 'prueba para em 80 apartados criados mesmo sem nenhum pago');
  await fake.db.collection('recebimento').doc(MXU).set({ prueba: { criados: 10 } }, { merge: true });
  r = await T.compraCriar(compraMx({ whatsapp: '5577778888' }), ip());
  conf(r.ok && d('recebimento/' + MXU).prueba.criados === 11, 'apartado criado conta no teto da prueba');
  // retencao apaga o codigo postal
  r = await T.compraCriar(compraMx({ whatsapp: '5566665555', entrega: 'entrega', endereco: { rua: 'Av. Insurgentes Sur', numero: '10', bairro: 'Roma Norte', cp: '06700' } }), ip());
  await T.apagarDadosDoComprador(fake.db.collection('pedidos').doc(r.pedidoId), d('pedidos/' + r.pedidoId));
  conf(!('cp' in d('pedidos/' + r.pedidoId).entrega), 'retencao apaga o codigo postal');
  // lojaModo MX com modo antigo 'pix' gravado
  await fake.db.collection('recebimento').doc(MXU).set({ modo: 'pix' }, { merge: true });
  r = await T.lojaModo(MXU, { ligado: true, plazoMin: 30 });
  conf(!r.erro && r.modo === 'clabe', 'lojaModo MX ignora modo antigo gravado');

  /* portao do painel */
  function resFake() { const o = { code: 0, body: null, headers: {} }; o.status = (c) => { o.code = c; return o; }; o.json = (b) => { o.body = b; return o; }; o.setHeader = (k, v) => { o.headers[k] = v; }; return o; }
  async function chamar(uid, acao, dados) { const res = resFake(); await ck.tratar({ headers: {} }, res, { acao, idToken: uid, dados: dados || {} }); return res; }
  store.set('negocios/BrSemPlanoCCCCCCC3', { nome: 'Sem plano' });
  let rs = await chamar('BrSemPlanoCCCCCCC3', 'loja_clabe', { clabe: CLABE, titular: 'Ana Maria Lopez' });
  conf(rs.code === 403 && rs.body.erro === 'nao_pago', 'BR sem plano: loja_clabe da 403');
  rs = await chamar('BrSemPlanoCCCCCCC3', 'loja_recebimento');
  conf(rs.code === 403, 'BR sem plano: recebimento continua 403');
  rs = await chamar(MXU, 'loja_pix', { chave: 'a@b.com' });
  conf(rs.code === 403, 'prueba MX: loja_pix bloqueado');
  rs = await chamar(MXU, 'loja_asaas', {});
  conf(rs.code === 403, 'prueba MX: loja_asaas bloqueado');
  rs = await chamar(MXU, 'loja_recebimento');
  conf(rs.code === 200 && rs.body.pais === 'MX' && rs.body.plano === 'prueba', 'prueba MX: recebimento liberado');
  store.set('assinaturas/' + MXU, { ativo: true, plano: 'pro', periodo: 'trial', vence_em: Timestamp.fromMillis(Date.now() - 1000) });
  rs = await chamar(MXU, 'loja_recebimento');
  conf(rs.code === 403, 'prueba vencida da 403');

  /* ---------------------------------------------------- e-mails em espanhol */
  const em = MX.corpoAviso('pagou', MX.dadosAviso({ total: 250.37, itens: [{ qtd: 1 }], entrega: { tipo: 'retirada' }, modo: 'clabe' }, 'Boutique <b>'));
  conf(/MX\$ 250\.37/.test(em.html) && !/R\$/.test(em.html) && /captura de pantalla/.test(em.html), 'aviso em espanhol e em pesos');
  conf(!/<b>'/.test(em.html) && /&lt;b&gt;/.test(em.html), 'nome do negocio escapado no e-mail');

  console.log(falhas ? ('FALHAS: ' + falhas + ' de ' + (ok + falhas)) : ('OK ' + ok + ' / FALHAS 0'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
