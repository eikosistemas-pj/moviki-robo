/*!
 * MOVIKI lib/checkout.js | versao 2026-10-03-rastreio | base 2026-10-03-envio | repo: moviki-robo
 *
 * ---- 03/10/2026: RASTREIO DO ENVIO E PAGINA DE ACOMPANHAMENTO (P70, etapa 3) ----
 * So existe em pedido de ENVIO (entrega.envio === true), que por sua vez so
 * nasce com a chave freteBrasil ligada: nenhuma chave nova.
 * - loja_rastreio: o lojista informa transportadora + codigo. O codigo e
 *   conferido pelo formato (Correios = AA123456789BR). Pedido pago ou
 *   separando passa sozinho para 'saiu' (na tela de envio: "Enviado").
 * - Link de acompanhamento: www.moviki.com.br/pedido/<pedidoId>-<24 hex>.
 *   O token nasce no primeiro rastreio e e o UNICO jeito de ler o pedido de
 *   fora (acao publica compra_acompanhar). A pagina mostra so o que nao e da pessoa:
 *   loja, numero, etapa, cidade/UF, prazo, transportadora e codigo. Nada de
 *   nome, telefone ou endereco.
 * - Aviso ao cliente: pelo WhatsApp do PROPRIO lojista (botao no painel com a
 *   mensagem pronta). O comprador nao deixa e-mail, e o Moviki nao manda
 *   mensagem em nome da loja.
 * - Sem link livre: transportadora fora da lista mostra so o nome digitado e
 *   o codigo. Link vindo do lojista numa pagina do Moviki seria porta de golpe.
 * - LGPD: o link morre junto com os dados do comprador (apagarDadosDoComprador).
 *
 * ---- 03/10/2026: ENVIO PARA OUTRAS CIDADES POR TABELA (P70, etapa 2) — DESLIGADO POR PADRAO ----
 * O comprador de outra cidade escolhe "Enviar pelo correio/transportadora".
 * - CHAVE POR LOJISTA: recursos/{uid}.freteBrasil (dono liga em adm_recursos).
 * - TABELA DO LOJISTA, SEM PESO: entregaCfg.envio = { ativo, ufOrigem,
 *   mesmoEstado, regioes {N,NE,CO,SE,S}, gratisAcima, prazo }. Valor vazio =
 *   nao envia para la. O frete sai SEMPRE daqui, pela UF do CEP.
 * - O ENVIO E OPCAO DO PRODUTO: so produto com envia:true no cardapio pode ir.
 *   Pastel, bolo, marmita nunca sao marcados (o painel nem mostra a opcao nos
 *   ramos de comida). Carrinho com item local responde item_local + nome.
 * - O pedido sai com entrega.tipo 'entrega' e envio:true: Central, estudio,
 *   etapas e e-mail continuam funcionando; as telas novas mostram "Envio".
 * - Entrega suspensa pelo dono tambem suspende o envio.
 *
 * ---- 03/10/2026: CARRINHO NA LIVE (P70, etapa 1) — DESLIGADO POR PADRAO ----
 * Ate aqui cada produto da live era um pedido, um Pix e um frete: quem levava
 * 3 pecas pagava 3 entregas e o lojista montava 3 pacotes. Agora a live aceita
 * itens[] (como o cardapio ja aceitava): um pedido, um Pix, um frete.
 * - CHAVE POR LOJISTA: recursos/{uid}.carrinho (raiz, so Admin SDK), ligada
 *   pelo dono (acao adm_recursos). Desligada, itens[] na live e recusado com
 *   'carrinho_off' e a tela continua no fluxo de um produto. Espelho publico
 *   em checkout_publico/{uid}.recursos (a tela decide se mostra "Adicionar").
 * - OFERTA NO CARRINHO: no maximo uma, e ela vai SEMPRE para itens[0]. Todo o
 *   caminho da oferta (reserva, marcarPago, mexerReserva) le itens[0]; por
 *   isso a ordem e regra, nao detalhe. Carrinho com oferta vale 10 min.
 * - Linhas repetidas somam (teto MAX_QTD por produto); ate 20 produtos.
 *
 * ---- 30/09/2026 (tarde): ESTOQUE DO PRODUTO E DEPOIS DA LIVE (P53) ----
 * Montado SOBRE a 2026-09-30-reserva (reserva da OFERTA, logo abaixo). A
 * oferta continua com a reserva dela (oferta_reservas); isto aqui e o estoque
 * de cada PRODUTO, que vale para a live e o cardapio juntos.
 * 1) estoque/{uid} (so Admin SDK). O lojista informa "quantas ainda pode
 *    vender" pela acao loja_estoque; produto sem numero = sem controle, como
 *    sempre foi. Espelho publico so com os numeros em
 *    checkout_publico/{uid}.estoque -> "Esgotado"/"Restam N" na live e no
 *    cardapio. O produto da live usa o do cardapio com o MESMO NOME.
 * 2) RESERVA NA CRIACAO do pedido (estoque_reservas/{pedidoId}), ate o prazo
 *    do Pix + 10 min; "Ja paguei" estica para 24 h. Pago fecha a reserva;
 *    vencido, recusado, cancelado ou falha devolvem a peca. Linhas repetidas
 *    do mesmo produto somam (fecha o C4 no cardapio).
 * 3) DEVOLUCAO de venda paga pelo lojista (status 'devolvido', com motivo; a
 *    peca volta se ele marcar). O dinheiro ele devolve pelo banco dele.
 * 4) ESTORNO (e chargeback) de venda paga: peca volta se nao foi entregue,
 *    "comprou" sai do chat, lojista recebe e-mail e o quadro acende.
 * 5) Pago depois de a reserva vencer e a peca ir para outro: baixa assim
 *    mesmo e marca alertaEstoque 'sem_estoque' (mesmo alerta da oferta).
 * 6) FREIO POR NEGOCIO conta so pedido que vai nascer (esgotado nao conta):
 *    120/h no cardapio e 600/h com a live no ar. Eram 40/h, e a live boa
 *    travava no 41o comprador.
 * 7) Pix direto abandonado vence no cron quando passa o prazo, sem depender
 *    de o comprador voltar a tela. RECEIVED_IN_CASH ("recebido em dinheiro",
 *    marcado a mao no Asaas) conta como confirmado pelo LOJISTA (C2).
 *
 * ---- 30/09/2026: RESERVA DA OFERTA E PRAZO DO PIX ----
 * 1) Gerar o Pix de uma oferta relampago com estoque SEGURA a unidade
 *    (oferta_reservas/{chave}). Esgotou entre vendidos + reservadas, o
 *    proximo comprador nao recebe codigo. Detalhe no bloco RESERVA DA OFERTA.
 * 2) Janela do Pix da oferta: 10 min (OFERTA_VALIDADE_MIN). O resto segue 30.
 *    O pedido guarda `validoAte` e a tela recebe o mesmo numero.
 * 3) "Ja paguei" vale tambem para pedido expirado: o copia-e-cola estatico
 *    nao vence no banco, e quem pagou atrasado tem que conseguir avisar. Se a
 *    unidade ja nao estava segura, o pedido ganha `alertaEstoque` e o lojista
 *    e avisado para conferir ou devolver o Pix.
 * 4) Modo Asaas: a cobranca da oferta e cancelada no banco quando a janela
 *    passa (tela do comprador e varredura de 5 min).
 *
 * ---- 26/09/2026 (noite): DADOS DO COMPRADOR ----
 * 1) RETENCAO: contato (WhatsApp) e endereco saem do pedido 90 dias depois
 *    da entrega; pago sem entrega registrada, 180 dias depois do pagamento;
 *    compra que nunca foi paga, 15 dias depois. O prazo mora no pedido
 *    (apagarDadosEm) e a varredura roda no api/pedidos-confere.js.
 * 2) TERMO DE VENDA 2026-09-26: clausula de dados do cliente. Quem ja vende
 *    continua vendendo; o painel pede o aceite da versao nova.
 *
 * ---- 26/09/2026: CENTRAL DE PEDIDOS (F1) ----
 * O pedido deixa de terminar em "pago -> entregue" e ganha a operacao do
 * lojista depois da venda:
 *   - ETAPAS depois do pagamento: separando -> pronto (retirada) ou
 *     saiu (entrega) -> entregue. Todo lugar que perguntava "esta pago?" com
 *     `status === 'pago' || status === 'entregue'` passa a usar PAGOS, senao
 *     um pedido em "separando" voltaria a "expirado" pelo webhook ou sumiria
 *     da conta de vendas.
 *   - FRETE POR BAIRRO, calculado AQUI. O lojista cadastra os bairros que
 *     atende e a taxa de cada um (acao loja_entrega). O navegador diz o
 *     bairro; a taxa sai da tabela do lojista e entra no valor do Pix. Taxa
 *     que viesse da tela seria forjavel no F12, igual ao preco.
 *   - ENDERECO ESTRUTURADO (CEP, rua, numero, complemento, bairro, cidade,
 *     referencia). O texto livre de 140 caracteres continua aceito para quem
 *     nao cadastrou tabela de bairros — ai a entrega segue "a combinar".
 *   - NUMERO CURTO do pedido por negocio (pedido_seq/{uid}, so Admin SDK) e
 *     CODIGO DE 4 DIGITOS que o comprador mostra na retirada ou na entrega.
 *   - Pedido minimo PARA ENTREGA, conferido sobre os itens (sem o frete).
 *   - SUSPENSAO DE ENTREGA PELO DONO (adm_entrega): o Moviki desliga so a
 *     entrega de um lojista (reclamacao de nao entrega, taxa abusiva) sem tirar
 *     a venda dele do ar. Enquanto suspensa, a compra so aceita retirada.
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
const { conferirAdmin } = require('./admin');
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
/* 30/09/2026 (P53): RECEIVED_IN_CASH saiu daqui. E um marcador MANUAL do
   painel do Asaas ("recebido em dinheiro"), sem dinheiro trafegando pelo
   banco: vira pago, mas confirmado pelo lojista ('pago_manual'). */
const PAGO = ['RECEIVED', 'CONFIRMED'];
const MAX_QTD = 10;
/* ---- estoque do produto (30/09/2026, P53) ---- */
const ESTOQUE_FOLGA_MS = 10 * 60000;        // reserva = prazo do Pix + folga do cron
const ESTOQUE_AVISOU_MS = 24 * 3600000;     // comprador disse que pagou: segura ate o lojista conferir
const ESTOQUE_MAX_ITENS = 400;
const ESTOQUE_MAX_QTD = 99999;
const FREIO_NEG_CARDAPIO = 120;             // pedidos criados por hora, por negocio
const FREIO_NEG_LIVE = 600;                 // com a live no ar
/* Tudo que ja e dinheiro na mao do lojista. 'entregue' e o fim. */
const PAGOS = ['pago', 'separando', 'pronto', 'saiu', 'entregue'];
/* Para onde o lojista pode mover um pedido pago (inclusive voltar um passo,
   para desfazer um toque errado). 'pago' nao entra: pago so nasce de
   confirmacao de pagamento, nunca de um clique de etapa. */
const ETAPAS = ['separando', 'pronto', 'saiu', 'entregue'];
const MAX_BAIRROS = 80;
const TAXA_MAX = 200;
const PEDIDO_VALIDADE_MIN = 30;   // janela do Pix na tela do comprador
const OFERTA_VALIDADE_MIN = 10;   // 30/09: janela do Pix da oferta relampago = prazo da reserva
/* Retencao do DOCUMENTO do pedido, que e outra coisa: se o expiraEm valesse a
   janela do Pix, uma politica de TTL no Firestore apagaria pedido PAGO meia
   hora depois — e um pagamento que cai atrasado nao acharia o documento.
   Abandonado some em 7 dias; pago fica 5 anos (prazo do CDC). */
const PEDIDO_RETENCAO_MS = 7 * 86400000;
const PEDIDO_RETENCAO_PAGO_MS = 5 * 365 * 86400000;
const POLITICA_VERSAO = '2026-09-11';   // versao de Termos/Privacidade aceita no checkout
/* RETENCAO DOS DADOS DO COMPRADOR — 26/09/2026, decisao do Paulo.
   Sai do pedido: WhatsApp, sobrenome e o endereco (rua, numero, complemento,
   CEP, referencia). Fica: numero, itens, valores, datas, status, bairro,
   cidade e o primeiro nome — o que o lojista precisa para imposto e para o
   Codigo de Defesa do Consumidor, sem dado que localize a pessoa.
   O documento inteiro continua com o expiraEm (TTL), que e outra conta. */
const DADOS_ENTREGUE_MS = 90 * 86400000;    // depois da entrega
const DADOS_PAGO_MS = 180 * 86400000;       // pago e sem entrega registrada
const DADOS_SEM_VENDA_MS = 15 * 86400000;   // compra que nunca foi paga
function prazoDados(msDaqui) { return admin.firestore.Timestamp.fromMillis(Date.now() + msDaqui); }

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

/* Etapa depois do pagamento (26/09/2026). Vale para os tres modos: o que
   acontece com a mercadoria nao depende de como o dinheiro entrou.
   'pronto' e da retirada e 'saiu' e da entrega — trocar um pelo outro poria o
   cliente para esperar em casa um pedido que esta no balcao. */
async function moverEtapa(uid, ref, p, novo) {
  if (PAGOS.indexOf(p.status) < 0) return { erro: 'so_pago' };
  const ehEntrega = !!(p.entrega && p.entrega.tipo === 'entrega');
  if (novo === 'pronto' && ehEntrega) return { erro: 'etapa' };
  if (novo === 'saiu' && !ehEntrega) return { erro: 'etapa' };
  if (p.status === novo) return { ok: true, status: novo };
  /* O prazo dos dados anda junto: entregue conta 90 dias a partir de agora;
     voltar da entrega (desfazer) devolve o prazo de pago sem entrega. */
  await ref.set({ status: novo, [novo + 'Em']: FV.serverTimestamp(), etapaEm: FV.serverTimestamp(),
    apagarDadosEm: prazoDados(novo === 'entregue' ? DADOS_ENTREGUE_MS : DADOS_PAGO_MS) }, { merge: true });
  await trilha(uid, 'pedido_etapa', { pedido: ref.id, de: p.status, para: novo });
  return { ok: true, status: novo };
}

async function lojaPedido(uid, pedidoId, novo, motivo, voltaEstoque) {
  if (['cancelado', 'conferir', 'pago', 'recusado', 'devolvido'].concat(ETAPAS).indexOf(novo) < 0) return { erro: 'status' };
  const ref = db.collection('pedidos').doc(String(pedidoId || '').slice(0, 60));
  const s = await ref.get();
  if (!s.exists || s.data().lojistaUid !== uid) return { erro: 'nao_encontrado' };
  const p = s.data();

  if (ETAPAS.indexOf(novo) >= 0) return moverEtapa(uid, ref, p, novo);
  /* 30/09/2026 (P53): desfazer venda paga vale para os tres modos. */
  if (novo === 'devolvido') return lojaDevolver(uid, ref, p, motivo, voltaEstoque !== false);

  /* Pedido do modo Pix direto tem regras proprias: quem confirma e o lojista,
     e 'conferir' nao faz sentido (nao ha gateway a quem perguntar). */
  if (p.modo === 'pix') {
    if (novo === 'pago' || novo === 'recusado') return lojaPedidoPix(uid, ref.id, novo, motivo);
    if (novo === 'conferir') return { ok: true, status: p.status };
    if (novo === 'cancelado') {
      if (PAGOS.indexOf(p.status) >= 0) return { erro: 'so_aguardando' };
      await ref.set({ status: 'cancelado', canceladoEm: FV.serverTimestamp() }, { merge: true });
      await mexerReserva(p, ref.id, 'soltar');
      await devolverEstoque(ref.id, 'cancelado');
      await trilha(uid, 'pedido_cancelado', { pedido: ref.id });
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
    if (st === 'pago' || st === 'pago_manual') { await marcarPago(ref, st === 'pago' ? 'gateway' : 'lojista'); return { ok: true, status: 'pago' }; }
    if (st === 'expirado') { await ref.set({ status: 'expirado' }, { merge: true }); await mexerReserva(p, ref.id, 'soltar'); await devolverEstoque(ref.id, 'expirou'); return { ok: true, status: 'expirado' }; }
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
    await ref.set({ status: 'cancelado', canceladoEm: FV.serverTimestamp() }, { merge: true });
    await mexerReserva(p, ref.id, 'soltar');
    await devolverEstoque(ref.id, 'cancelado');
    await trilha(uid, 'pedido_cancelado', { pedido: ref.id });
    return { ok: true };
  }
  return { erro: 'status' };
}

/* DEVOLUCAO DE VENDA PAGA — 30/09/2026 (P53).
   Antes nao existia: o lojista que vendeu sem ter a peca, ou que recebeu a
   mercadoria de volta, deixava o pedido parado em Pagos para sempre (ou o
   marcava "entregue" sem entregar, e o numero de vendas mentia). O dinheiro
   continua fora do Moviki: quem devolve o Pix ao cliente e o proprio lojista,
   pelo banco dele ou pelo Asaas dele — a tela diz isso antes de confirmar. */
async function lojaDevolver(uid, ref, p, motivo, voltaEstoque) {
  if (PAGOS.indexOf(p.status) < 0) return { erro: 'so_pago' };
  const m = txt(motivo, 140);
  if (m.length < 3) return { erro: 'motivo' };
  await ref.set({
    status: 'devolvido', devolvidoEm: FV.serverTimestamp(), etapaEm: FV.serverTimestamp(),
    devolucao: { motivo: m, voltaEstoque: voltaEstoque === true, de: String(p.status || '') },
    apagarDadosEm: prazoDados(DADOS_ENTREGUE_MS),
  }, { merge: true });
  if (voltaEstoque === true) await devolverEstoque(ref.id, 'devolvido');
  await apagarVendaDoChat(p);
  await trilha(uid, 'pedido_devolvido', { pedido: ref.id, de: p.status, total: p.total, voltaEstoque: voltaEstoque === true, motivo: m });
  return { ok: true, status: 'devolvido' };
}

/* ============================================================================
   RASTREIO DO ENVIO — 03/10/2026 (P70, etapa 3)
   ============================================================================ */
const TRANSPORTADORAS = {
  correios: { nome: 'Correios', url: 'https://rastreamento.correios.com.br/app/index.php', re: /^[A-Z]{2}\d{9}[A-Z]{2}$/ },
  jadlog:   { nome: 'Jadlog', url: 'https://www.jadlog.com.br/jadlog/home', re: /^[A-Z0-9]{8,20}$/ },
  loggi:    { nome: 'Loggi', url: 'https://www.loggi.com/rastreador/', re: /^[A-Z0-9-]{6,40}$/ },
  jt:       { nome: 'J&T Express', url: 'https://www.jtexpress.com.br/', re: /^[A-Z0-9]{8,20}$/ },
  outra:    { nome: '', url: '', re: /^[A-Z0-9-]{4,40}$/ },
};
const SEM_ACOMPANHAR = ['aguardando', 'cancelado', 'expirado', 'recusado', 'divergente'];

function novoTokenAcompanhar() { return crypto.randomBytes(12).toString('hex'); }

function lerRastreio(d) {
  const transp = String((d && d.transp) || '');
  const t = TRANSPORTADORAS[transp];
  if (!t) return { erro: 'transportadora' };
  const codigo = String((d && d.codigo) || '').toUpperCase().replace(/\s+/g, '').slice(0, 40);
  if (!t.re.test(codigo)) return { erro: 'codigo_rastreio' };
  let nome = t.nome;
  if (transp === 'outra') {
    nome = txt(d && d.nome, 30);
    if (nome.length < 2) return { erro: 'transportadora_nome' };
  }
  return { transp, nome, codigo };
}

/* O que a pagina publica e o painel mostram da transportadora: o link e
   sempre o da NOSSA lista, nunca o que veio do lojista. */
function rastreioPublico(r) {
  if (!r || !r.codigo) return null;
  const t = TRANSPORTADORAS[r.transp] || TRANSPORTADORAS.outra;
  return { transp: String(r.transp || 'outra'), nome: txt(r.nome || t.nome, 30), codigo: String(r.codigo).slice(0, 40), url: t.url || '' };
}

async function lojaRastreio(uid, pedidoId, d) {
  const ref = db.collection('pedidos').doc(String(pedidoId || '').slice(0, 60));
  const s = await ref.get();
  if (!s.exists || s.data().lojistaUid !== uid) return { erro: 'nao_encontrado' };
  const p = s.data();
  if (!(p.entrega && typeof p.entrega === 'object' && p.entrega.envio === true)) return { erro: 'so_envio' };
  if (PAGOS.indexOf(p.status) < 0) return { erro: 'so_pago' };
  const upd = {};
  let rast = null;
  if (d && d.remover === true) {
    upd['entrega.rastreio'] = FV.delete();
  } else {
    rast = lerRastreio(d);
    if (rast.erro) return rast;
    upd['entrega.rastreio'] = { transp: rast.transp, nome: rast.nome, codigo: rast.codigo, em: FV.serverTimestamp() };
  }
  const tok = /^[0-9a-f]{24}$/.test(String(p.acompanhar || '')) ? p.acompanhar : novoTokenAcompanhar();
  if (tok !== p.acompanhar) upd.acompanhar = tok;
  let status = p.status;
  /* Codigo informado = a mercadoria saiu. Quem ja marcou entregue nao volta. */
  if (rast && (p.status === 'pago' || p.status === 'separando')) {
    status = 'saiu';
    upd.status = 'saiu'; upd.saiuEm = FV.serverTimestamp(); upd.etapaEm = FV.serverTimestamp();
    upd.apagarDadosEm = prazoDados(DADOS_PAGO_MS);
  }
  await ref.update(upd);
  await trilha(uid, rast ? 'pedido_rastreio' : 'pedido_rastreio_removido', { pedido: ref.id, transp: rast ? rast.transp : '', de: p.status, para: status });
  return { ok: true, status, acompanhar: ref.id + '-' + tok, rastreio: rast ? rastreioPublico(rast) : null };
}

const ETAPA_PUBLICA = { pago: 'pago', separando: 'separando', pronto: 'separando', saiu: 'enviado', entregue: 'entregue', devolvido: 'cancelado' };

/* PAGINA PUBLICA DE ACOMPANHAMENTO (sem login). Quem tem o link ve; quem nao
   tem nao acha: o token tem 96 bits e e comparado em tempo constante. */
async function pedidoVer(b) {
  const m = /^([A-Za-z0-9]{10,60})-([0-9a-f]{24})$/.exec(String(b.ref || '').trim());
  if (!m) return { erro: 'nao_encontrado' };
  const s = await db.collection('pedidos').doc(m[1]).get();
  if (!s.exists) return { erro: 'nao_encontrado' };
  const p = s.data() || {};
  const tok = String(p.acompanhar || '');
  if (tok.length !== m[2].length || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(m[2]))) return { erro: 'nao_encontrado' };
  if (SEM_ACOMPANHAR.indexOf(p.status) >= 0) return { erro: 'nao_encontrado' };
  let negocio = '', slug = '';
  try {
    const n = await db.collection('negocios').doc(String(p.lojistaUid || '')).get();
    if (n.exists) { negocio = txt(n.data().nome, 60); slug = /^[a-z0-9-]{3,40}$/.test(String(n.data().slug || '')) ? n.data().slug : ''; }
  } catch (_) {}
  const e = (p.entrega && typeof p.entrega === 'object') ? p.entrega : {};
  const itens = Array.isArray(p.itens) ? p.itens : [];
  return {
    ok: true, negocio, slug,
    numero: Number(p.numero) || 0,
    etapa: ETAPA_PUBLICA[p.status] || 'pago',
    envio: e.envio === true,
    cidade: txt(e.cidade, 60), uf: /^[A-Z]{2}$/.test(String(e.uf || '')) ? e.uf : '',
    prazo: txt(e.prazo, 40),
    itens: itens.slice(0, 20).map((i) => ({ nome: txt(i && i.nome, 60), qtd: Math.max(1, Math.min(99, Number(i && i.qtd) || 1)) })),
    rastreio: rastreioPublico(e.rastreio),
    pagoEm: ms(p.pagoEm) || 0, saiuEm: ms(p.saiuEm) || 0, entregueEm: ms(p.entregueEm) || 0,
  };
}

/* "Fulano comprou" no chat da live so pode existir enquanto a venda existe. */
async function apagarVendaDoChat(p) {
  try {
    const id = String((p && p.chatVendaId) || '');
    if (!/^[A-Za-z0-9]{10,40}$/.test(id) || !p.lojistaUid) return;
    await db.collection('negocios').doc(p.lojistaUid).collection('livechat').doc(id).delete();
  } catch (e) { console.error('chat venda apagar', e.message); }
}

/* ============================================================================
   ESTOQUE DO PRODUTO — 30/09/2026 (P53)
   ============================================================================
   Nao confundir com a RESERVA DA OFERTA (oferta_reservas, bloco proprio): a
   oferta e um teto de unidades de UMA promocao; isto e o estoque do produto,
   que vale para a live e o cardapio juntos.
   estoque/{uid}              { itens: { <chave>: { nome, sku, qtd, res } } }
                              qtd = quanto ainda pode vender (ja sem as reservas)
                              res = quanto esta segurado em Pix aberto
   estoque_reservas/{pedido}  a reserva de UM pedido: linhas, ativa, venceEm
                              (o campo some quando a reserva fecha: e isso que
                              deixa o cron achar as abertas com UM filtro, sem
                              indice composto)
   checkout_publico/{uid}.estoque   espelho publico: { <chave>: disponivel },
                              com tres chaves por item (a propria, 'n:<nome>'
                              e 's:<sku>'): a live so conhece o nome, o
                              cardapio conhece o sku.
   So o Admin SDK escreve nas tres. Sem regra nova no Firestore: estoque e
   estoque_reservas nao tem match (nega o app); checkout_publico ja e leitura
   publica desde a v23.
============================================================================ */
function chaveNome(nome) { return 'n:' + semAcento(nome).slice(0, 80); }
function limpaSku(sku) { return String(sku || '').replace(/[^a-z0-9]/gi, '').slice(0, 40); }
function chaveSku(sku) { const s = limpaSku(sku); return s ? 's:' + s : ''; }

/* A live nao conhece sku: o produto dela vem do cardapio pelo nome. */
function skuPorNome(neg, nome) {
  const alvo = semAcento(nome);
  const cats = Array.isArray(neg && neg.cardapio) ? neg.cardapio : [];
  for (const c of cats) {
    for (const p of (Array.isArray(c && c.produtos) ? c.produtos : [])) {
      if (p && p.nome && semAcento(p.nome) === alvo) return limpaSku(p.sku);
    }
  }
  return '';
}

/* Qual entrada de estoque e a deste item: pela chave guardada, pelo sku e por
   fim pelo nome. A chave NUNCA muda depois de criada — reserva aberta guarda
   a chave, e mudar a chave faria a peca nao voltar. */
function acharEntrada(itens, sku, nome, chave) {
  if (chave && itens[chave]) return chave;
  const s = limpaSku(sku);
  if (s) {
    if (itens['s:' + s]) return 's:' + s;
    for (const k of Object.keys(itens)) { if (itens[k] && limpaSku(itens[k].sku) === s) return k; }
  }
  const kn = chaveNome(nome);
  if (itens[kn]) return kn;
  const alvo = semAcento(nome);
  if (!alvo) return '';
  for (const k of Object.keys(itens)) { if (itens[k] && semAcento(itens[k].nome) === alvo) return k; }
  return '';
}

/* Linhas do pedido somadas por produto: 20 linhas do mesmo item eram 200
   unidades passando pelo teto de 10 (C4 da auditoria). */
function linhasDoPedido(neg, itens) {
  const m = {};
  (Array.isArray(itens) ? itens : []).forEach((i) => {
    if (!i || !i.nome) return;
    const sku = limpaSku(i.sku) || skuPorNome(neg, i.nome);
    const id = chaveSku(sku) || chaveNome(i.nome);
    if (!m[id]) m[id] = { sku, nome: txt(i.nome, 60), n: 0 };
    m[id].n += Math.max(1, Math.floor(Number(i.qtd) || 1));
  });
  return Object.keys(m).map((k) => m[k]);
}

function espelhoEstoque(itens) {
  const pub = {};
  Object.keys(itens || {}).forEach((k) => {
    const e = itens[k] || {};
    const d = Math.max(0, Math.floor(Number(e.qtd) || 0));
    pub[k] = d;
    if (e.nome) pub[chaveNome(e.nome)] = d;
    const ks = chaveSku(e.sku);
    if (ks) pub[ks] = d;
  });
  return pub;
}

function refsEstoque(uid) {
  return {
    est: db.collection('estoque').doc(uid),
    pub: db.collection('checkout_publico').doc(uid),
  };
}
function gravarEstoque(tx, R, itens) {
  /* set SEM merge: tirar o controle de um produto precisa apagar a chave. */
  tx.set(R.est, { itens, atualizadoEm: FV.serverTimestamp() });
  tx.set(R.pub, { estoque: espelhoEstoque(itens), estoqueEm: FV.serverTimestamp() }, { mergeFields: ['estoque', 'estoqueEm'] });
}

/* Reserva o estoque de um pedido que ainda vai nascer.
   Devolve { ok, linhas } ou { erro:'esgotado', nome, restam }. */
async function reservarEstoque(uid, pedidoId, linhas, venceMs) {
  const R = refsEstoque(uid);
  const pre = await R.est.get();
  const itensPre = pre.exists ? ((pre.data() || {}).itens || {}) : {};
  if (!linhas.some((l) => acharEntrada(itensPre, l.sku, l.nome))) return { ok: true, linhas: [] };
  const resRef = db.collection('estoque_reservas').doc(pedidoId);
  return db.runTransaction(async (tx) => {
    const es = await tx.get(R.est);
    const itens = es.exists ? Object.assign({}, (es.data() || {}).itens || {}) : {};
    const usadas = [];
    for (const l of linhas) {
      const k = acharEntrada(itens, l.sku, l.nome);
      if (!k) continue;
      const e = Object.assign({}, itens[k]);
      const disp = Math.floor(Number(e.qtd) || 0);
      if (disp < l.n) return { erro: 'esgotado', nome: l.nome, restam: Math.max(0, disp) };
      e.qtd = disp - l.n;
      e.res = Math.max(0, Math.floor(Number(e.res) || 0)) + l.n;
      itens[k] = e;
      usadas.push({ k, sku: l.sku || '', nome: l.nome, n: l.n });
    }
    if (!usadas.length) return { ok: true, linhas: [] };
    gravarEstoque(tx, R, itens);
    tx.set(resRef, {
      uid, pedido: pedidoId, linhas: usadas, ativa: true,
      criadaEm: FV.serverTimestamp(),
      venceEm: admin.firestore.Timestamp.fromMillis(Number(venceMs) || (Date.now() + 40 * 60000)),
      expiraEm: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 86400000),
    });
    return { ok: true, linhas: usadas };
  });
}

/* Devolve ao estoque o que um pedido segurou ou baixou. Idempotente:
   - reserva ainda aberta (Pix nao pago) -> a peca volta e a reserva fecha;
   - venda paga (baixado) desfeita       -> a peca volta uma vez so.
   Nunca lanca: estoque que falha nao pode travar cancelamento nem webhook. */
async function devolverEstoque(pedidoId, motivo) {
  const id = String(pedidoId || '');
  if (!/^[A-Za-z0-9]{10,60}$/.test(id)) return false;
  const pedRef = db.collection('pedidos').doc(id);
  const resRef = db.collection('estoque_reservas').doc(id);
  try {
    return await db.runTransaction(async (tx) => {
      const ps = await tx.get(pedRef);
      const rs = await tx.get(resRef);
      const p = ps.exists ? (ps.data() || {}) : null;
      const r = rs.exists ? (rs.data() || {}) : null;
      const reservaAberta = !!(r && r.ativa === true);
      const baixado = !!(p && p.estoque && p.estoque.baixado === true && p.estoque.devolvido !== true);
      if (!reservaAberta && !baixado) return false;
      const fonte = reservaAberta ? r : (p.estoque || {});
      const uid = String((r && r.uid) || (p && p.lojistaUid) || '');
      if (!uid) return false;
      const R = refsEstoque(uid);
      const linhas = Array.isArray(fonte.linhas) ? fonte.linhas : [];
      const es = linhas.length ? await tx.get(R.est) : null;
      if (es && es.exists) {
        const itens = Object.assign({}, (es.data() || {}).itens || {});
        let mexeu = false;
        linhas.forEach((l) => {
          const k = acharEntrada(itens, l.sku, l.nome, l.k);
          if (!k) return;                       // o lojista tirou o controle desse produto
          const n = Math.max(0, Math.floor(Number(l.n) || 0));
          const e = Object.assign({}, itens[k]);
          e.qtd = Math.floor(Number(e.qtd) || 0) + n;
          if (reservaAberta) e.res = Math.max(0, Math.floor(Number(e.res) || 0) - n);
          itens[k] = e; mexeu = true;
        });
        if (mexeu) gravarEstoque(tx, R, itens);
      }
      if (reservaAberta) tx.update(resRef, { ativa: false, venceEm: FV.delete(), fim: String(motivo || ''), fimEm: FV.serverTimestamp() });
      else tx.update(pedRef, { 'estoque.devolvido': true, 'estoque.devolvidoEm': FV.serverTimestamp() });
      return true;
    });
  } catch (e) { console.error('estoque devolver', id, e.message); return false; }
}

/* Reserva que ficou aberta com o pedido ja pago (queda no meio do
   marcarPago): fecha como venda, sem devolver a peca. */
async function fecharReservaPaga(pedidoId) {
  const pedRef = db.collection('pedidos').doc(pedidoId);
  const resRef = db.collection('estoque_reservas').doc(pedidoId);
  try {
    await db.runTransaction(async (tx) => {
      const rs = await tx.get(resRef);
      if (!rs.exists || rs.data().ativa !== true) return;
      const r = rs.data() || {};
      const R = refsEstoque(r.uid);
      const linhas = Array.isArray(r.linhas) ? r.linhas : [];
      const es = linhas.length ? await tx.get(R.est) : null;
      if (es && es.exists) {
        const itens = Object.assign({}, (es.data() || {}).itens || {});
        linhas.forEach((l) => {
          const k = acharEntrada(itens, l.sku, l.nome, l.k); if (!k) return;
          const e = Object.assign({}, itens[k]);
          e.res = Math.max(0, Math.floor(Number(e.res) || 0) - (Number(l.n) || 0));
          itens[k] = e;
        });
        gravarEstoque(tx, R, itens);
      }
      tx.update(resRef, { ativa: false, venceEm: FV.delete(), fim: 'pago', fimEm: FV.serverTimestamp() });
      tx.set(pedRef, { estoque: { baixado: true } }, { merge: true });
    });
  } catch (e) { console.error('estoque fechar paga', pedidoId, e.message); }
}

/* Acao do lojista: ajustar o estoque. Cada item chega com o numero que a tela
   MOSTROU (de) e o novo (para); o servidor aplica a DIFERENCA. Assim uma
   venda que caiu entre abrir a tela e salvar nao e apagada pelo numero velho.
   para = null tira o controle do produto (volta a vender sem limite). */
async function lojaEstoque(uid, b) {
  const lista = Array.isArray(b && b.itens) ? b.itens.slice(0, ESTOQUE_MAX_ITENS) : [];
  const mud = [];
  for (const x of lista) {
    const nome = txt(x && x.nome, 60);
    if (!nome) continue;
    const sku = limpaSku(x && x.sku);
    let para = (x && x.para);
    if (para === null || para === undefined || para === '') para = null;
    else {
      para = Number(para);
      if (!Number.isInteger(para) || para < 0 || para > ESTOQUE_MAX_QTD) return { erro: 'estoque_qtd', nome };
    }
    let de = (x && x.de);
    de = (de === null || de === undefined || de === '' || !Number.isFinite(Number(de))) ? null : Math.floor(Number(de));
    mud.push({ nome, sku, para, de });
  }
  const R = refsEstoque(uid);
  if (mud.length) {
    const r = await db.runTransaction(async (tx) => {
      const s = await tx.get(R.est);
      const itens = s.exists ? Object.assign({}, (s.data() || {}).itens || {}) : {};
      for (const m of mud) {
        const k = acharEntrada(itens, m.sku, m.nome);
        if (m.para === null) {
          if (k && Math.floor(Number(itens[k].res) || 0) > 0) return { erro: 'estoque_reservado', nome: m.nome };
          if (k) delete itens[k];
          continue;
        }
        if (!k) { itens[chaveSku(m.sku) || chaveNome(m.nome)] = { nome: m.nome, sku: m.sku, qtd: m.para, res: 0 }; continue; }
        const e = Object.assign({}, itens[k]);
        const atual = Math.floor(Number(e.qtd) || 0);
        const base = (m.de === null) ? atual : m.de;
        e.qtd = Math.max(0, Math.min(ESTOQUE_MAX_QTD, atual + (m.para - base)));
        e.nome = m.nome;
        if (m.sku) e.sku = m.sku;
        itens[k] = e;
      }
      if (Object.keys(itens).length > ESTOQUE_MAX_ITENS) return { erro: 'estoque_muitos', max: ESTOQUE_MAX_ITENS };
      gravarEstoque(tx, R, itens);
      return { ok: true };
    });
    if (r && r.erro) return r;
    await trilha(uid, 'estoque_ajuste', { itens: mud.length });
  }
  const s2 = await R.est.get();
  const itens = s2.exists ? ((s2.data() || {}).itens || {}) : {};
  return {
    ok: true,
    itens: Object.keys(itens).map((k) => {
      const e = itens[k] || {};
      return { k, nome: txt(e.nome, 60), sku: limpaSku(e.sku), qtd: Math.floor(Number(e.qtd) || 0), res: Math.floor(Number(e.res) || 0) };
    }),
  };
}

/* Cron: reserva de estoque vencida. Pix que ninguem pagou devolve a peca; Pix
   direto abandonado vira 'expirado' (sai do topo de Novos). Pedido ja pago
   fecha a reserva como venda. Quem avisou que pagou ganhou prazo maior em
   compraPaguei, entao nao chega aqui antes da hora. */
async function varrerReservas(max) {
  const lim = Math.max(1, Math.min(Number(max) || 100, 300));
  const q = await db.collection('estoque_reservas')
    .where('venceEm', '<=', admin.firestore.Timestamp.fromMillis(Date.now())).limit(lim).get();
  const r = { vistas: q.size, devolvidas: 0, pagas: 0, expirados: 0, erros: 0 };
  for (const d of q.docs) {
    try {
      const ps = await db.collection('pedidos').doc(d.id).get();
      const p = ps.exists ? (ps.data() || {}) : null;
      if (p && PAGOS.indexOf(p.status) >= 0) { await fecharReservaPaga(d.id); r.pagas++; continue; }
      if (p && p.modo === 'pix' && p.status === 'aguardando' && Date.now() > limiteDoPedido(p)) {
        await ps.ref.set({ status: 'expirado', expiradoEm: FV.serverTimestamp() }, { merge: true });
        r.expirados++;
      }
      if (await devolverEstoque(d.id, 'venceu')) r.devolvidas++;
    } catch (e) { r.erros++; }
  }
  return r;
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
  return { nome: txt(p.nome, 60), preco, oferta: !!ofOk, estoque: ofOk ? Number(of.estoque || 0) : 0, vendidos: ofOk ? Number(of.vendidos || 0) : 0,
    reservadas: ofOk && Array.isArray(of.reservas) ? of.reservas.filter((t) => Number(t) > Date.now()).length : 0,
    ofertaNome: ofOk ? String(of.nome) : '', ofertaFimEm: ofOk ? ms(of.fimEm) : 0 };
}

/* ---- RECURSOS LIGADOS POR LOJISTA (03/10/2026, P70) ----
   Recurso novo nasce DESLIGADO e o dono liga por lojista no painel. A
   autoridade e recursos/{uid} (raiz, sem regra: so Admin SDK); o espelho em
   checkout_publico/{uid}.recursos serve so para a tela decidir o que mostra.
   O servidor confere sempre a autoridade, nunca o espelho. */
const RECURSOS = ['carrinho', 'freteBrasil'];
async function recursosDe(uid) {
  try {
    const s = await db.collection('recursos').doc(String(uid).slice(0, 128)).get();
    const d = s.exists ? (s.data() || {}) : {};
    const out = {};
    RECURSOS.forEach((k) => { out[k] = d[k] === true; });
    return out;
  } catch (e) { console.error('recursos', uid, e.message); const out = {}; RECURSOS.forEach((k) => { out[k] = false; }); return out; }
}

async function admRecursos(adminUid, b) {
  const uid = String((b && b.uid) || '');
  if (!/^[A-Za-z0-9]{10,128}$/.test(uid)) return { erro: 'uid' };
  const muda = {};
  RECURSOS.forEach((k) => { if (b && typeof b[k] === 'boolean') muda[k] = b[k]; });
  if (!Object.keys(muda).length) return { erro: 'recurso' };
  await db.collection('recursos').doc(uid).set(Object.assign({}, muda, { atualizadoEm: FV.serverTimestamp(), por: adminUid }), { merge: true });
  const atual = await recursosDe(uid);
  await db.collection('checkout_publico').doc(uid).set({ recursos: atual, atualizadoEm: FV.serverTimestamp() }, { merge: true });
  await trilha(uid, 'recursos', Object.assign({ por: adminUid }, muda));
  return { ok: true, uid, recursos: atual };
}

/* Carrinho da live: le itens[] contra o estado da live. Mesmo contrato do
   lerItensCardapio (o navegador diz O QUE e QUANTOS; preco sai daqui). */
function lerItensLive(est, lista) {
  const arr = Array.isArray(lista) ? lista.slice(0, 20) : [];
  if (!arr.length) return { erro: 'produto' };
  const porNome = {};
  const ordem = [];
  for (const linha of arr) {
    const nome = String((linha && (linha.nome || linha.produto)) || '');
    const p = acharProduto(est, nome);
    if (!p || !(p.preco > 0)) return { erro: 'produto', nome: txt(nome, 60) };
    if (mvProibido(p.nome)) return { erro: 'produto', nome: p.nome };
    const q = Math.max(1, parseInt(linha && linha.qtd, 10) || 1);
    if (!porNome[p.nome]) { porNome[p.nome] = { p, qtd: 0 }; ordem.push(p.nome); }
    porNome[p.nome].qtd = Math.min(MAX_QTD, porNome[p.nome].qtd + q);
  }
  const ofertas = ordem.filter((n) => porNome[n].p.oferta);
  if (ofertas.length > 1) return { erro: 'produto' };
  /* A oferta vai para itens[0]: reserva, pagamento e devolucao da oferta leem dali. */
  const nomes = ofertas.concat(ordem.filter((n) => !porNome[n].p.oferta));
  const itens = [];
  let total = 0, ofertaInfo = null;
  for (const n of nomes) {
    const { p, qtd } = porNome[n];
    if (p.oferta && p.estoque > 0 && p.vendidos + qtd > p.estoque) return { erro: 'esgotado', restam: Math.max(0, p.estoque - p.vendidos) };
    itens.push({ nome: p.nome, preco: p.preco, qtd });
    total += p.preco * qtd;
    if (p.oferta) ofertaInfo = { nome: p.ofertaNome, fimEm: p.ofertaFimEm, estoque: p.estoque };
  }
  return { itens, total: Math.round(total * 100) / 100, ehOferta: !!ofertaInfo, ofertaInfo };
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

/* ------------------------------------------------ entrega e frete (26/09) */

/* A configuracao de entrega mora em recebimento/{uid}.entregaCfg (so Admin
   SDK) e sai espelhada em checkout_publico/{uid} para a tela de compra. */
function lerEntregaCfg(r) {
  const c = (r && r.entregaCfg) || {};
  const bairros = Array.isArray(c.bairros) ? c.bairros.filter((x) => x && x.nome).slice(0, MAX_BAIRROS) : [];
  return {
    bairros: bairros.map((x) => ({ nome: txt(x.nome, 50), taxa: Math.max(0, Math.min(TAXA_MAX, precoNum(x.taxa) || 0)) })),
    minimoEntrega: Math.max(0, Number(c.minimoEntrega) || 0),
    prazo: txt(c.prazo, 40),
    cidade: txt(c.cidade, 40),
    retirada: txt(c.retirada, 120),
  };
}

/* Le o endereco que o comprador mandou. Aceita os dois formatos:
   - estruturado (b.endereco = { cep, rua, numero, complemento, bairro,
     cidade, uf, referencia }) — o das telas novas;
   - texto livre (b.detalhe) — o das telas antigas e de quem nao tem tabela.
   Devolve o objeto que vai para o pedido, ou { erro }. */
function lerEndereco(b, exigeBairro) {
  const e = (b && typeof b.endereco === 'object' && b.endereco) ? b.endereco : null;
  if (!e) {
    if (exigeBairro) return { erro: 'bairro' };
    const detalhe = txt(b && b.detalhe, 140);
    if (detalhe.length < 5) return { erro: 'endereco' };
    return { detalhe };
  }
  const cep = so(e.cep).slice(0, 8);
  if (cep && cep.length !== 8) return { erro: 'cep' };
  const rua = txt(e.rua, 90), numero = txt(e.numero, 12), complemento = txt(e.complemento, 60);
  const bairro = txt(e.bairro, 50), cidade = txt(e.cidade, 40), uf = txt(e.uf, 2).toUpperCase();
  const referencia = txt(e.referencia, 90);
  if (rua.length < 3 || !numero) return { erro: 'endereco' };
  if (bairro.length < 2) return { erro: 'bairro' };
  const end = { cep, rua, numero, complemento, bairro, cidade, uf, referencia };
  end.detalhe = montarDetalhe(end);
  return end;
}

/* Uma linha so, na ordem em que o entregador le: rua e numero primeiro. */
function montarDetalhe(e) {
  const partes = [e.rua + ', ' + e.numero];
  if (e.complemento) partes.push(e.complemento);
  partes.push(e.bairro);
  if (e.cidade) partes.push(e.cidade + (e.uf ? '/' + e.uf : ''));
  if (e.cep) partes.push('CEP ' + e.cep.slice(0, 5) + '-' + e.cep.slice(5));
  if (e.referencia) partes.push('Ref.: ' + e.referencia);
  return partes.join(' - ').slice(0, 300);
}

/* Decide retirada/entrega e a taxa. A taxa SEMPRE sai da tabela do lojista.
   Sem tabela, a entrega continua existindo como era ate 25/09: a combinar,
   sem taxa no Pix. */
function entregaSuspensa(r) { return !!(r && r.entregaSuspensa && r.entregaSuspensa.ativa === true); }

/* ---- ENVIO POR TABELA (03/10/2026, P70 etapa 2) ---- */
const UFS = { AC:'N', AP:'N', AM:'N', PA:'N', RO:'N', RR:'N', TO:'N',
  AL:'NE', BA:'NE', CE:'NE', MA:'NE', PB:'NE', PE:'NE', PI:'NE', RN:'NE', SE:'NE',
  DF:'CO', GO:'CO', MT:'CO', MS:'CO', ES:'SE', MG:'SE', RJ:'SE', SP:'SE', PR:'S', RS:'S', SC:'S' };
const REGIOES = ['N', 'NE', 'CO', 'SE', 'S'];
const TAXA_ENVIO_MAX = 500;
function taxaOuNada(v) {
  const t = String(v == null ? '' : v).trim();
  if (t === '') return null;
  const n = precoNum(t);
  return (n >= 0 && n <= TAXA_ENVIO_MAX) ? Math.round(n * 100) / 100 : undefined;
}
function lerEnvioCfg(c) {
  const e = (c && c.envio) || {};
  const reg = {};
  REGIOES.forEach((k) => { const v = e.regioes && e.regioes[k]; reg[k] = (typeof v === 'number' && v >= 0 && v <= TAXA_ENVIO_MAX) ? v : null; });
  const uf = String(e.ufOrigem || '').toUpperCase();
  return {
    ativo: e.ativo === true,
    ufOrigem: UFS[uf] ? uf : '',
    mesmoEstado: (typeof e.mesmoEstado === 'number' && e.mesmoEstado >= 0 && e.mesmoEstado <= TAXA_ENVIO_MAX) ? e.mesmoEstado : null,
    regioes: reg,
    gratisAcima: Math.max(0, Number(e.gratisAcima) || 0),
    prazo: txt(e.prazo, 40),
  };
}
function freteEnvio(env, uf, subtotal) {
  const u = String(uf || '').toUpperCase();
  if (!UFS[u]) return { erro: 'uf' };
  let t = null;
  if (env.ufOrigem && u === env.ufOrigem && env.mesmoEstado !== null) t = env.mesmoEstado;
  else t = env.regioes[UFS[u]];
  if (t === null || t === undefined) return { erro: 'envio_fora', uf: u };
  if (env.gratisAcima > 0 && subtotal >= env.gratisAcima) t = 0;
  return { taxa: t, regiao: UFS[u] };
}
/* O produto pode ir pelo correio? Decide o CARDAPIO do lojista (envia:true),
   por sku ou pelo nome sem acento (produto da live sem sku). */
function podeEnviar(neg, item) {
  const cats = Array.isArray(neg && neg.cardapio) ? neg.cardapio : [];
  const sku = String((item && item.sku) || '');
  const nome = semAcento((item && item.nome) || '');
  for (const c of cats) {
    for (const p of (Array.isArray(c && c.produtos) ? c.produtos : [])) {
      if (!p || !p.nome) continue;
      if ((sku && String(p.sku || '') === sku) || (nome && semAcento(p.nome) === nome)) return p.envia === true;
    }
  }
  return false;
}

function resolverEntrega(b, r, subtotal, ctx) {
  /* ENVIO (03/10, P70 etapa 2): caminho proprio, nao depende do modo local. */
  if (b && b.entrega === 'envio') {
    const c = ctx || {};
    if (!(c.rec && c.rec.freteBrasil)) return { erro: 'sem_envio' };
    if (entregaSuspensa(r)) return { erro: 'sem_envio' };
    const env = lerEnvioCfg((r && r.entregaCfg) || {});
    if (!env.ativo) return { erro: 'sem_envio' };
    for (const it of (c.itens || [])) { if (!podeEnviar(c.neg, it)) return { erro: 'item_local', nome: txt(it.nome, 60) }; }
    const end = lerEndereco(b, false);
    if (end.erro) return end;
    if (!end.cep || end.cep.length !== 8) return { erro: 'cep' };
    if (!end.cidade || end.cidade.length < 2) return { erro: 'cidade' };
    const fr = freteEnvio(env, end.uf, subtotal);
    if (fr.erro) return fr;
    return { entrega: Object.assign({ tipo: 'entrega', envio: true, taxa: fr.taxa, aCombinar: false, regiao: fr.regiao, prazo: env.prazo }, end), frete: fr.taxa };
  }
  /* Suspensa pelo dono: vale como "so retirada", seja qual for a escolha do
     lojista. */
  const modoCfg = entregaSuspensa(r) ? 'retirada' : String((r && r.entrega) || 'retirada');
  const quer = b.entrega === 'entrega' ? 'entrega' : 'retirada';
  if (quer === 'entrega' && modoCfg === 'retirada') return { erro: 'sem_entrega' };
  if (quer === 'retirada' && modoCfg === 'entrega') return { erro: 'so_entrega' };
  if (quer === 'retirada') return { entrega: { tipo: 'retirada', detalhe: '' }, frete: 0 };

  const cfg = lerEntregaCfg(r);
  const temTabela = cfg.bairros.length > 0;
  const end = lerEndereco(b, temTabela);
  if (end.erro) return end;
  if (cfg.minimoEntrega > 0 && subtotal < cfg.minimoEntrega) return { erro: 'minimo_entrega', minimo: cfg.minimoEntrega };

  let taxa = 0, aCombinar = true;
  if (temTabela) {
    const alvo = semAcento(end.bairro);
    const achado = cfg.bairros.find((x) => semAcento(x.nome) === alvo);
    if (!achado) return { erro: 'bairro_fora' };
    taxa = Math.round(achado.taxa * 100) / 100;
    end.bairro = achado.nome;   // grafia do lojista, que e a que ele reconhece
    if (end.rua) end.detalhe = montarDetalhe(end);
    aCombinar = false;
  }
  return { entrega: Object.assign({ tipo: 'entrega', taxa, aCombinar }, end), frete: taxa };
}

/* Numero curto do pedido, por negocio: "#0042" e o que o lojista fala em voz
   alta no balcao e escreve no saco. Sem regra no Firestore: so o robo le e
   escreve. Se a transacao falhar, o pedido nasce sem numero e as telas usam
   o final do id — numero e conforto, nao pode derrubar venda. */
async function proximoNumero(uid) {
  const ref = db.collection('pedido_seq').doc(String(uid).slice(0, 128));
  try {
    return await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const n = (s.exists ? Number(s.data().n) || 0 : 0) + 1;
      tx.set(ref, { n, em: FV.serverTimestamp() }, { merge: true });
      return n;
    });
  } catch (e) { console.error('pedido_seq', e.message); return 0; }
}

/* Codigo de 4 digitos: o comprador mostra na retirada ou para o entregador.
   Nao vai impresso na comanda (quem pegar o saco leria o codigo). */
function novoCodigo() { return String(crypto.randomInt(1000, 10000)); }

/* ============================================================================
   RESERVA DA OFERTA RELAMPAGO — 30/09/2026
   ============================================================================
   O problema: a baixa de estoque da oferta so acontecia no PAGO. No Pix
   direto o Moviki nao sabe quando o dinheiro cai (quem confirma e o lojista,
   depois), e o copia-e-cola estatico NAO vence no banco. Com 1 unidade, dez
   pessoas geravam o Pix, dez pagavam e o lojista devolvia nove.

   "Vendido quando o primeiro pagar" nao existe no Pix direto: ninguem avisa o
   Moviki desse momento. O que existe e RESERVA NA GERACAO DO PIX:
     - gerar o Pix de uma oferta com estoque SEGURA a unidade;
     - vendidos + reservadas chegou ao estoque: o proximo comprador nao recebe
       codigo nenhum, e fica sabendo quando a unidade pode voltar;
     - a reserva dura a janela do Pix da oferta (OFERTA_VALIDADE_MIN). Nao
       pagou, a unidade volta sozinha, sem cron;
     - "Ja paguei" segura a unidade ate o lojista conferir (teto de 24 h);
     - pago baixa o estoque e desfaz a reserva na MESMA transacao;
     - recusado ou cancelado devolve a unidade na hora;
     - uma reserva por CPF na mesma oferta (o Pix novo substitui o antigo) e
       no maximo RESERVAS_POR_IP por IP — 4G usa IP compartilhado (CGNAT), por
       isso o teto por IP e folgado.
   Quem pagou depois de perder a reserva, com a unidade ja de outro: o pedido
   ganha `alertaEstoque` e o lojista e avisado para conferir ou devolver o Pix.

   Onde mora: oferta_reservas/{chave}, na RAIZ e sem regra (so Admin SDK). A
   chave junta negocio + live + produto + fimEm: cada oferta lancada tem a sua.
   Espelho publico em estado/live -> oferta.reservas: uma lista com o HORARIO
   em que cada unidade reservada volta. Sem pedido, sem CPF, sem IP. A tela de
   quem assiste conta sozinha as que ainda valem, sem leitura nova.
   ============================================================================ */
const RESERVA_CONFERINDO_MS = 24 * 3600000;
const RESERVAS_POR_IP = 4;
const RESERVA_RETENCAO_MS = 7 * 86400000;

function hashCurto(s) { return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 24); }
function chaveReserva(uid, liveId, nome, fimEm) { return hashCurto(['reserva', uid, liveId, nome, Number(fimEm) || 0].join('|')); }
function mesmaOferta(of, nome, fimEm) { return !!(of && nome && of.nome === nome && ms(of.fimEm) === Number(fimEm)); }

/* So as reservas que ainda valem. "Conferindo" tambem tem prazo (24 h). */
function reservasVivas(itens, agora) {
  const out = {};
  Object.keys(itens || {}).forEach((k) => {
    const r = itens[k];
    if (r && Number(r.ate) > agora && Number(r.qtd) > 0) {
      out[k] = { qtd: Number(r.qtd), ate: Number(r.ate), ip: String(r.ip || ''), cpf: String(r.cpf || ''), estado: r.estado === 'conferindo' ? 'conferindo' : 'reservado' };
    }
  });
  return out;
}
function somaReservas(itens) { return Object.keys(itens).reduce((t, k) => t + (Number(itens[k].qtd) || 0), 0); }
/* Espelho publico: um horario por unidade segura. */
function espelhoReservas(itens) {
  const l = [];
  Object.keys(itens).forEach((k) => { for (let i = 0; i < itens[k].qtd && l.length < 999; i++) l.push(itens[k].ate); });
  return l.sort((a, b) => a - b);
}

/* Segura a unidade ANTES de existir codigo Pix. Devolve { ok, substituido }
   ou { erro: 'esgotado' | 'oferta_fim' | 'reserva_limite', ... }. */
async function reservarOferta(o) {
  const ref = db.collection('oferta_reservas').doc(o.chave);
  const liveRef = db.collection('negocios').doc(o.lojistaUid).collection('estado').doc('live');
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    const ls = await tx.get(liveRef);
    const of = ls.exists ? (ls.data() || {}).oferta : null;
    const agora = Date.now();
    if (!mesmaOferta(of, o.nome, o.fimEm) || ms(of.fimEm) <= agora) return { erro: 'oferta_fim' };
    const estoque = Number(of.estoque || 0);
    const vendidos = Number(of.vendidos || 0);
    const itens = reservasVivas(s.exists ? (s.data() || {}).itens : {}, agora);
    /* O Pix novo da mesma pessoa substitui o antigo que ainda nao foi pago. */
    let substituido = '';
    Object.keys(itens).forEach((k) => { if (o.cpf && itens[k].cpf === o.cpf && itens[k].estado === 'reservado') { substituido = k; delete itens[k]; } });
    const doIp = Object.keys(itens).filter((k) => o.ip && itens[k].ip === o.ip && itens[k].estado === 'reservado').length;
    if (doIp >= RESERVAS_POR_IP) return { erro: 'reserva_limite' };
    const reservadas = somaReservas(itens);
    if (vendidos + reservadas + o.qtd > estoque) {
      const volta = Object.keys(itens).filter((k) => itens[k].estado === 'reservado').map((k) => itens[k].ate).sort((a, b) => a - b)[0] || 0;
      return { erro: 'esgotado', restam: Math.max(0, estoque - vendidos - reservadas), reservadas, voltaEm: volta };
    }
    itens[o.pedidoId] = { qtd: o.qtd, ate: o.ate, ip: o.ip, cpf: o.cpf, estado: 'reservado' };
    tx.set(ref, {
      lojistaUid: o.lojistaUid, liveId: o.liveId, nome: o.nome, fimEm: Number(o.fimEm), itens,
      atualizadoEm: FV.serverTimestamp(), expiraEm: admin.firestore.Timestamp.fromMillis(agora + RESERVA_RETENCAO_MS),
    });
    tx.update(liveRef, { 'oferta.reservas': espelhoReservas(itens) });
    return { ok: true, substituido };
  });
}

/* Mexe na reserva de um pedido. acao:
     'soltar'     recusado, cancelado, Pix que nao chegou a nascer;
     'conferindo' "Ja paguei": segura ate o lojista conferir. Se a reserva ja
                  tinha vencido e a unidade continua livre, ela volta para
                  quem pagou. Devolve { segura } para o chamador decidir o
                  alerta.
   Best-effort: falha aqui nunca derruba o pedido. */
async function mexerReserva(p, pedidoId, acao) {
  if (!p || !p.reservaChave) return { ok: true, segura: true, sem: true };
  const ref = db.collection('oferta_reservas').doc(String(p.reservaChave));
  const liveRef = db.collection('negocios').doc(String(p.lojistaUid)).collection('estado').doc('live');
  try {
    return await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const ls = await tx.get(liveRef);
      if (!s.exists) return { ok: true, segura: false };
      const d = s.data() || {};
      const agora = Date.now();
      const itens = reservasVivas(d.itens, agora);
      const of = ls.exists ? (ls.data() || {}).oferta : null;
      let segura = false;
      if (acao === 'soltar') delete itens[pedidoId];
      else if (acao === 'conferindo') {
        if (itens[pedidoId]) {
          itens[pedidoId].estado = 'conferindo'; itens[pedidoId].ate = agora + RESERVA_CONFERINDO_MS; segura = true;
        } else {
          const qtd = Math.max(1, Number((p.itens && p.itens[0] && p.itens[0].qtd) || 1));
          if (mesmaOferta(of, d.nome, d.fimEm) && Number(of.vendidos || 0) + somaReservas(itens) + qtd <= Number(of.estoque || 0)) {
            itens[pedidoId] = { qtd, ate: agora + RESERVA_CONFERINDO_MS, ip: '', cpf: '', estado: 'conferindo' }; segura = true;
          }
        }
      }
      tx.update(ref, { itens, atualizadoEm: FV.serverTimestamp() });
      if (mesmaOferta(of, d.nome, d.fimEm)) tx.update(liveRef, { 'oferta.reservas': espelhoReservas(itens) });
      return { ok: true, segura };
    });
  } catch (e) { console.error('reserva', acao, e.message); return { ok: false, segura: false }; }
}

/* Prazo do Pix deste pedido, em ms. Pedido antigo (sem validoAte) = 30 min. */
function limiteDoPedido(p) { return Number(p.validoAte) || (ms(p.criadoEm) + PEDIDO_VALIDADE_MIN * 60000); }

/* Modo Asaas: a janela da oferta passou e ninguem pagou. Cancela a cobranca
   no banco para o codigo parar de valer (o Asaas deixaria pagar ate o fim do
   dia). Antes pergunta se ja caiu: se caiu, e venda. */
async function vencerCobrancaOferta(ref, p) {
  const st = await confirmarNoAsaas(p, ref.id);
  if (st === 'pago' || st === 'pago_manual') { await marcarPago(ref, st === 'pago' ? 'gateway' : 'lojista'); return 'pago'; }
  if (st === 'erro' || st === 'divergente') return 'aguardando';
  try {
    const chave = await chaveDoPedido(p);
    if (!chave) return 'aguardando';
    await asaas('/payments/' + p.asaasId, 'DELETE', null, chave);
  } catch (e) {
    if (st !== 'expirado') return 'aguardando';   // nao cancelou e nao venceu: tenta de novo depois
  }
  await ref.set({ status: 'expirado', expiradoEm: FV.serverTimestamp(), cobrancaCancelada: true }, { merge: true });
  await devolverEstoque(ref.id, 'expirou');
  return 'expirado';
}

async function compraCriar(b, ip) {
  const lojistaUid = String(b.lojistaUid || '').slice(0, 128);
  if (!/^[A-Za-z0-9]{10,128}$/.test(lojistaUid)) return { erro: 'dados' };

  /* ---- comprador ---- */
  const nome = txt(b.nome, 60), cpf = so(b.cpf), wpp = so(b.whatsapp).replace(/^55(?=\d{10,11}$)/, '');
  if (nome.split(' ').filter(Boolean).length < 2) return { erro: 'nome' };
  if (!cpfValido(cpf)) return { erro: 'cpf' };
  if (wpp.length !== 10 && wpp.length !== 11) return { erro: 'whatsapp' };
  if ((b.entrega === 'entrega' || b.entrega === 'envio') && !(b.endereco && typeof b.endereco === 'object') && txt(b.detalhe, 140).length < 5) return { erro: 'endereco' };
  if (b.aceite !== true) return { erro: 'aceite' };   // LGPD: consentimento explicito

  /* ---- freio por IP. O do NEGOCIO vem depois das reservas, so para pedido
     que vai nascer (30/09/2026, P53): contar tentativa recusada fazia a live
     que da certo travar no 41o comprador. ---- */
  if (!(await freio(ip))) return { erro: 'freio' };

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
  let itens, total, ehOferta = false, liveId = '', ofertaInfo = null;
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
    /* CARRINHO (03/10/2026, P70): itens[] so com o recurso ligado para o lojista. */
    if (Array.isArray(b.itens) && b.itens.length) {
      const rec = await recursosDe(lojistaUid);
      if (!rec.carrinho) return { erro: 'carrinho_off' };
      const lido = lerItensLive(est, b.itens);
      if (lido.erro) return lido;
      itens = lido.itens; total = lido.total; ehOferta = lido.ehOferta; ofertaInfo = lido.ofertaInfo;
    } else {
    const qtd = Math.max(1, Math.min(MAX_QTD, parseInt(b.qtd, 10) || 1));
    const p = acharProduto(est, String(b.produto || ''));
    if (!p || !(p.preco > 0)) return { erro: 'produto' };
    if (mvProibido(p.nome)) return { erro: 'produto' };
    if (p.oferta && p.estoque > 0 && p.vendidos + qtd > p.estoque) return { erro: 'esgotado', restam: Math.max(0, p.estoque - p.vendidos) };
    itens = [{ nome: p.nome, preco: p.preco, qtd }];
    total = Math.round(p.preco * qtd * 100) / 100;
    ehOferta = !!p.oferta;
    if (ehOferta) ofertaInfo = { nome: p.ofertaNome, fimEm: p.ofertaFimEm, estoque: p.estoque };
    }
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

  /* ---- entrega e frete (26/09/2026) ----
     O minimo do modo vale sobre os ITENS: frete nao completa pedido minimo. */
  const subtotal = total;
  const ent = resolverEntrega(b, r, subtotal, b.entrega === 'envio' ? { itens, neg, rec: await recursosDe(lojistaUid) } : null);
  if (ent.erro) return ent;
  const entrega = ent.entrega;
  const frete = ent.frete;
  total = Math.round((subtotal + frete) * 100) / 100;

  const negNome = txt(neg.nome || 'Moviki', 60);
  const comprador = { nome, whatsapp: wpp, cpfFinal: cpf.slice(-2) };
  const [numero, codigo] = [await proximoNumero(lojistaUid), novoCodigo()];
  const extra = { subtotal, frete, numero, codigo };

  /* ---- prazo do Pix e reserva da oferta (30/09/2026) ----
     O id do pedido nasce aqui para a reserva apontar para ele. A unidade e
     segura ANTES de existir codigo: sem unidade, nao sai Pix. */
  const pedidoRef = db.collection('pedidos').doc();
  const validadeMin = ehOferta ? OFERTA_VALIDADE_MIN : PEDIDO_VALIDADE_MIN;
  const validoAte = Date.now() + validadeMin * 60000;
  const camposOferta = { validadeMin, validoAte };
  let reservaCtx = null;
  if (ehOferta && ofertaInfo) {
    camposOferta.ofertaNome = ofertaInfo.nome;
    camposOferta.ofertaFimEm = ofertaInfo.fimEm;
    if (ofertaInfo.estoque > 0) {
      const chave = chaveReserva(lojistaUid, liveId, ofertaInfo.nome, ofertaInfo.fimEm);
      const rv = await reservarOferta({
        chave, lojistaUid, liveId, nome: ofertaInfo.nome, fimEm: ofertaInfo.fimEm,
        qtd: itens[0].qtd, pedidoId: pedidoRef.id, ate: validoAte,
        ip: hashCurto('ip|' + ip), cpf: hashCurto('cpf|' + cpf),
      });
      if (rv.erro) return rv;
      camposOferta.reservaChave = chave;
      reservaCtx = { reservaChave: chave, lojistaUid, itens };
      /* O Pix antigo da mesma pessoa perdeu a unidade: vence agora, para o
         lojista nao ver dois pedidos abertos da mesma compra. */
      if (rv.substituido) await db.collection('pedidos').doc(rv.substituido).set({ status: 'expirado', substituidoPor: pedidoRef.id }, { merge: true }).catch(() => {});
    }
  }
  /* 30/09 (P53): a falha devolve tambem a peca do estoque do produto. */
  const soltarSeFalhar = async (res) => {
    if (res && res.erro) {
      if (reservaCtx) await mexerReserva(reservaCtx, pedidoRef.id, 'soltar');
      await devolverEstoque(pedidoRef.id, 'falha');
    }
    return res;
  };

  /* ---- ESTOQUE DO PRODUTO (30/09/2026, P53): segura as pecas antes de
     gerar o Pix. Produto sem estoque cadastrado passa direto. ---- */
  const linhasEst = linhasDoPedido(neg, itens);
  let resEst;
  try { resEst = await reservarEstoque(lojistaUid, pedidoRef.id, linhasEst, validoAte + ESTOQUE_FOLGA_MS); }
  catch (e) { console.error('estoque reservar', lojistaUid, e.message); return soltarSeFalhar({ erro: 'ocupado' }); }
  if (resEst.erro) return soltarSeFalhar(resEst);
  extra.estoque = { v: 1, linhas: resEst.linhas || [] };

  /* ---- freio do negocio: so conta pedido que vai nascer ---- */
  if (!(await freioNegocio(lojistaUid, origem === 'live' ? FREIO_NEG_LIVE : FREIO_NEG_CARDAPIO))) return soltarSeFalhar({ erro: 'freio' });

  /* ---- MODO A: Pix direto do lojista ---- */
  if (modo === 'pix') {
    if (!(r && r.pix && r.pix.chaveCifrada)) return soltarSeFalhar({ erro: 'indisponivel' });
    const feito = await criarPedidoPix({ lojistaUid, r, itens, total, comprador, entrega, origem, liveId, negNome, extra, pedidoRef, campos: camposOferta });
    if (feito.erro) return soltarSeFalhar(feito);
    feito.mostrarNome = b.mostrarNome === true;
    if (feito.mostrarNome) await db.collection('pedidos').doc(feito.pedidoId).set({ mostrarNome: true, oferta: ehOferta }, { merge: true });
    else if (ehOferta) await db.collection('pedidos').doc(feito.pedidoId).set({ oferta: true }, { merge: true });
    return feito;
  }

  /* ---- MODOS B e C: cobranca pelo Asaas ---- */
  let chaveConta;
  if (modo === 'asaas') {
    if (!(r && r.asaasChave)) return soltarSeFalhar({ erro: 'indisponivel' });
    try { chaveConta = decifrar(r.asaasChave); } catch (e) { return soltarSeFalhar({ erro: 'config' }); }
  } else {
    if (!(sub && sub.chave)) return soltarSeFalhar({ erro: 'indisponivel' });
    try { chaveConta = decifrar(sub.chave); } catch (e) { return soltarSeFalhar({ erro: 'config' }); }
  }

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
    return soltarSeFalhar({ erro: 'asaas', mensagem: e.status === 0 ? 'O banco não respondeu. Tente de novo.' : txt(e.message, 160) });
  }

  await pedidoRef.set({
    ...camposOferta,
    lojistaUid, origem, liveId, dia: hoje(), modo,
    itens, total, oferta: ehOferta,
    comprador, entrega, mostrarNome: b.mostrarNome === true,
    subtotal: extra.subtotal, frete: extra.frete, numero: extra.numero, codigo: extra.codigo,
    estoque: extra.estoque || { v: 1, linhas: [] },
    aceite: { versao: POLITICA_VERSAO, em: FV.serverTimestamp() },
    status: 'aguardando', asaasId: pay.id, asaasCliente: cli.id,
    segredoHash: crypto.createHash('sha256').update(segredo).digest('hex'),
    criadoEm: FV.serverTimestamp(), expiraEm: admin.firestore.Timestamp.fromMillis(Date.now() + PEDIDO_RETENCAO_MS),
    apagarDadosEm: prazoDados(DADOS_SEM_VENDA_MS),
  });
  await trilha(lojistaUid, 'pedido_criado', { pedido: pedidoRef.id, modo, total, origem });
  await avisarLojista('novo', { lojistaUid, total, itens, entrega }, pedidoRef.id);

  return {
    ok: true, pedidoId: pedidoRef.id, chave: segredo, total, modo,
    subtotal: extra.subtotal, frete: extra.frete, numero: extra.numero,
    entrega: entrega.tipo,
    itens: itens.map((i) => ({ nome: i.nome, qtd: i.qtd })),
    produto: itens[0] ? itens[0].nome : '', qtd: itens[0] ? itens[0].qtd : 1,
    pix: { imagem: String(qr.encodedImage || ''), copiaCola: String(qr.payload || ''), expira: qr.expirationDate || '' },
    negocio: negNome,
    validadeMin, validoAte,
  };
}

/* Marca pago UMA vez (transacao): baixa o estoque da oferta e, se o
   comprador deixou, poe "Fulano comprou" no chat — prova social que e
   verdade, porque so nasce de pagamento confirmado.

   16/09/2026 — `origem` PASSOU A SER OBRIGATORIA.
   Um pedido chega a "pago" por dois caminhos que valem coisas diferentes:

     'gateway'  o Asaas confirmou que o dinheiro CAIU na subconta. Isso e
                venda, conferida contra o extrato.
     'lojista'  o lojista clicou em "Recebi" olhando o proprio celular. Isso e
                a PALAVRA dele. No modo chave Pix propria nao existe gateway,
                entao este e o unico caminho possivel — e ele e legitimo.

   O documento do pedido nao guardava essa diferenca, so a trilha guardava, num
   log que nenhum painel le. Resultado: o card "Vendido pelo Pix" somava os
   dois no mesmo numero. Um lojista distraido que nunca clica em "Recebi"
   aparecia vendendo zero; um lojista que clica sem conferir o extrato aparecia
   vendendo tudo. **O numero media a diligencia do lojista, nao a venda** — e e
   por numero assim que se decide preco, meta e quem merece atencao.
   Nao se conserta isso escondendo o caminho manual: ele e o produto no modo
   Pix proprio. Conserta-se SEPARANDO os dois no banco, para quem le decidir
   com a diferenca a vista. */
async function marcarPago(pedidoRef, origem) {
  const porQuem = (origem === 'lojista') ? 'lojista' : 'gateway';
  let efeito = null;
  await db.runTransaction(async (tx) => {
    efeito = null;  /* 23/09 (rodada 3): a transacao pode repetir; sem zerar, a repeticao que acha o pedido ja pago mandava o e-mail e o aviso de venda de novo */
    const s = await tx.get(pedidoRef);
    if (!s.exists) return;
    const p = s.data();
    if (PAGOS.indexOf(p.status) >= 0) return;
    const liveRef = db.collection('negocios').doc(p.lojistaUid).collection('estado').doc('live');
    const ls = await tx.get(liveRef);
    /* Leitura na MESMA transacao e ANTES de qualquer escrita: o Firestore
       recusa leitura depois de escrita dentro de runTransaction. */
    const sesPagoS = await tx.get(db.collection('live_sessoes').doc(p.lojistaUid));
    /* 30/09: a reserva da oferta e lida aqui tambem, antes de qualquer escrita. */
    const resRef = p.reservaChave ? db.collection('oferta_reservas').doc(String(p.reservaChave)) : null;
    const resS = resRef ? await tx.get(resRef) : null;
    /* ESTOQUE DO PRODUTO (30/09, P53). Pedido novo (estoque.v 1) ja segurou a
       peca na criacao: pagar so fecha a reserva. Reserva ja vencida (Pix
       direto confirmado depois do prazo, recusado por engano e confirmado): a
       peca e baixada de novo AGORA; se nao havia mais, alertaEstoque. */
    const novoFluxo = !!(p.estoque && p.estoque.v === 1);
    const resERef = db.collection('estoque_reservas').doc(pedidoRef.id);
    const rsE = novoFluxo ? await tx.get(resERef) : null;
    const reservaE = (rsE && rsE.exists) ? (rsE.data() || {}) : null;
    const consumir = (reservaE && reservaE.ativa === true && Array.isArray(reservaE.linhas)) ? reservaE.linhas : null;
    const forcar = (novoFluxo && !consumir && p.estoque.baixado !== true && Array.isArray(p.estoque.linhas) && p.estoque.linhas.length) ? p.estoque.linhas : null;
    const RE = refsEstoque(p.lojistaUid);
    const esE = ((consumir && consumir.length) || forcar) ? await tx.get(RE.est) : null;
    const it = (p.itens && p.itens[0]) || {};
    const qtdIt = Number(it.qtd) || 1;
    const of = ls.exists ? (ls.data() || {}).oferta : null;
    /* Baixa de estoque so na live que gerou o pedido E na oferta que gerou o
       pedido (desde 30/09 o pedido guarda o fimEm dela: uma oferta nova do
       mesmo produto na mesma live nao leva a baixa de uma antiga). */
    const sessaoIdAtual = sesPagoS.exists ? String((sesPagoS.data() || {}).sessaoId || '') : '';
    const mesmaDoPedido = !!(of && of.nome === (p.ofertaNome || it.nome) && (!p.ofertaFimEm || ms(of.fimEm) === Number(p.ofertaFimEm)));
    const baixa = !!(p.oferta && mesmaDoPedido && sessaoIdAtual && sessaoIdAtual === p.liveId);
    let itensRes = null, alertaEstoque = '';
    if (resS && resS.exists) {
      itensRes = reservasVivas((resS.data() || {}).itens, Date.now());
      const tinha = !!itensRes[pedidoRef.id];
      delete itensRes[pedidoRef.id];
      /* Pago sem a unidade segura, e ela ja comprometida com outro comprador:
         o lojista precisa saber antes de separar. */
      if (!tinha && baixa && Number(of.estoque) > 0 && Number(of.vendidos || 0) + somaReservas(itensRes) + qtdIt > Number(of.estoque)) alertaEstoque = 'sem_reserva';
    }
    let furouEst = false, itensEst = null;
    if (esE && esE.exists) {
      itensEst = Object.assign({}, (esE.data() || {}).itens || {});
      (consumir || forcar).forEach((l) => {
        const k = acharEntrada(itensEst, l.sku, l.nome, l.k); if (!k) return;
        const n = Math.max(0, Math.floor(Number(l.n) || 0));
        const e = Object.assign({}, itensEst[k]);
        if (consumir) e.res = Math.max(0, Math.floor(Number(e.res) || 0) - n);
        else { e.qtd = Math.floor(Number(e.qtd) || 0) - n; if (e.qtd < 0) { furouEst = true; e.qtd = 0; } }
        itensEst[k] = e;
      });
    }
    if (furouEst && !alertaEstoque) alertaEstoque = 'sem_estoque';
    const updPed = Object.assign({ status: 'pago', pagoEm: FV.serverTimestamp(), alerta: FV.delete(),
      confirmadoPor: porQuem, confirmadoEm: FV.serverTimestamp(),
      expiraEm: admin.firestore.Timestamp.fromMillis(Date.now() + PEDIDO_RETENCAO_PAGO_MS),
      apagarDadosEm: prazoDados(DADOS_PAGO_MS) }, alertaEstoque ? { alertaEstoque } : {});
    if (novoFluxo) { updPed['estoque.baixado'] = true; updPed['estoque.baixadoEm'] = FV.serverTimestamp(); }
    tx.update(pedidoRef, updPed);
    if (itensEst) gravarEstoque(tx, RE, itensEst);
    if (reservaE && reservaE.ativa === true) tx.update(resERef, { ativa: false, venceEm: FV.delete(), fim: 'pago', fimEm: FV.serverTimestamp() });
    if (itensRes) tx.update(resRef, { itens: itensRes, atualizadoEm: FV.serverTimestamp() });
    const upLive = {};
    if (baixa) upLive['oferta.vendidos'] = FV.increment(qtdIt);
    if (itensRes && mesmaDoPedido) upLive['oferta.reservas'] = espelhoReservas(itensRes);
    if (Object.keys(upLive).length) tx.update(liveRef, upLive);
    efeito = alertaEstoque ? Object.assign({}, p, { alertaEstoque }) : p;
  });
  /* Modo Asaas: quem confirma e o banco, nao o lojista — ele so descobre se
     alguem avisar. Sai UMA vez por pedido, porque marcarPago so entrega
     'efeito' na transacao que de fato virou o status. */
  if (efeito) await avisarLojista('pago', efeito, pedidoRef.id);
  if (efeito && efeito.mostrarNome) {
    try {
      const primeiro = String((efeito.comprador && efeito.comprador.nome) || '').split(' ')[0].slice(0, 20);
      const it = (efeito.itens && efeito.itens[0]) || {};
      const msg = await db.collection('negocios').doc(efeito.lojistaUid).collection('livechat').add({
        nome: primeiro, texto: (String(it.nome || '') + ((efeito.itens || []).length > 1 ? ' e mais ' + ((efeito.itens || []).length - 1) : '')).slice(0, 100), tipo: 'venda',
        criadoEm: FV.serverTimestamp(), expiraEm: admin.firestore.Timestamp.fromMillis(Date.now() + 30 * 86400000),
      });
      /* 30/09 (P53): guarda o id para apagar o "comprou" se a venda for desfeita. */
      await pedidoRef.set({ chatVendaId: msg.id }, { merge: true });
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
  const validoAte = limiteDoPedido(p);
  if (p.modo === 'pix') {
    if (status === 'aguardando' && Date.now() > validoAte) {
      await devolverEstoque(id, 'expirou');
      await ref.set({ status: 'expirado' }, { merge: true });
      status = 'expirado';
    }
    return Object.assign({ ok: true, status, modo: 'pix', validoAte }, dadosDoComprador(p, status, id));
  }

  /* Plano B do webhook: se ainda esta aguardando, pergunta ao Asaas
     (no maximo a cada 8 s por pedido). Oferta com a janela vencida: cancela
     a cobranca no banco (30/09). */
  if (status === 'aguardando' && Date.now() - ms(p.conferidoEm) > 8000) {
    await ref.set({ conferidoEm: admin.firestore.Timestamp.now() }, { merge: true });
    if (p.oferta && Date.now() > validoAte) status = await vencerCobrancaOferta(ref, p);
    else {
      const st = await confirmarNoAsaas(p, id);
      if (st === 'pago' || st === 'pago_manual') { await marcarPago(ref, st === 'pago' ? 'gateway' : 'lojista'); status = 'pago'; }
      else if (st === 'expirado') { await ref.set({ status: 'expirado' }, { merge: true }); await devolverEstoque(id, 'expirou'); status = 'expirado'; }
    }
  }
  return Object.assign({ ok: true, status, validoAte }, dadosDoComprador(p, status, id));
}

/* O que a tela do comprador precisa para acompanhar o pedido depois do Pix.
   O codigo de 4 digitos so aparece depois de pago: antes disso ele nao serve
   para nada e seria so mais um numero na tela. */
function dadosDoComprador(p, status, id) {
  const pago = PAGOS.indexOf(status) >= 0;
  return {
    numero: Number(p.numero) || 0,
    entrega: (p.entrega && p.entrega.tipo) || 'retirada',
    frete: Number(p.frete) || 0,
    codigo: pago ? String(p.codigo || '') : '',
    /* 03/10 (P70 etapa 3): a tela avisa que o codigo de rastreio vem pelo
       WhatsApp da loja e, se ja houver, mostra o link de acompanhamento. */
    envio: !!(p.entrega && p.entrega.envio === true),
    acompanhar: (pago && id && /^[0-9a-f]{24}$/.test(String(p.acompanhar || ''))) ? 'https://www.moviki.com.br/pedido/' + id + '-' + p.acompanhar : '',
  };
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
    if (PAGO.indexOf(pay.status) >= 0 || pay.status === 'RECEIVED_IN_CASH') {
      if (Math.abs(Number(pay.value) - Number(p.total)) > 0.01) { console.error('checkout: valor divergente', pedidoId, pay.value, p.total); return 'divergente'; }
      /* "Recebido em dinheiro" e marcacao MANUAL no Asaas: vale como palavra
         do lojista, nao como dinheiro conferido pelo banco (30/09, C2). */
      return pay.status === 'RECEIVED_IN_CASH' ? 'pago_manual' : 'pago';
    }
    if (pay.status === 'OVERDUE' || pay.deleted) return 'expirado';
    return 'aguardando';
  } catch (e) { return 'erro'; }
}

/* COMPROVANTES COM MAIS DE 90 DIAS — 23/09/2026 (rodada 3).
   O comentario do upload prometia "some em 90 dias" e nenhum codigo apagava.
   Comprovante Pix tem nome e parte do CPF do comprador: guarda-se so o tempo
   de resolver disputa. Roda uma vez por dia, puxado pelo cron de pedidos. */
async function limparComprovantesAntigos(max) {
  const limite = Date.now() - 90 * 86400000;
  const r = { vistos: 0, apagados: 0 };
  const bucket = admin.storage().bucket(STORAGE_BUCKET);
  const [files] = await bucket.getFiles({ prefix: 'comprovantes/', maxResults: Math.max(1, Math.min(Number(max) || 300, 1000)) });
  for (const f of files) {
    r.vistos++;
    const criado = Date.parse((f.metadata && f.metadata.timeCreated) || '');
    if (!criado || criado > limite) continue;
    try {
      await f.delete();
      r.apagados++;
      const m = /^comprovantes\/([A-Za-z0-9_-]{4,60})-[0-9a-f]{32}\./.exec(f.name);
      if (m) await db.collection('pedidos').doc(m[1]).set({ comprovante: FV.delete(), comprovanteApagadoEm: FV.serverTimestamp() }, { merge: true }).catch(() => {});
    } catch (_) {}
  }
  return r;
}

/* ------------------------------------------ retencao dos dados do comprador */

/* Prazo de um pedido que nasceu ANTES de 26/09, sem o campo apagarDadosEm. */
function prazoDoPedidoAntigo(p) {
  const st = String(p.status || '');
  if (st === 'entregue') return (ms(p.entregueEm) || ms(p.etapaEm) || ms(p.pagoEm) || ms(p.criadoEm)) + DADOS_ENTREGUE_MS;
  if (PAGOS.indexOf(st) >= 0) return (ms(p.pagoEm) || ms(p.criadoEm)) + DADOS_PAGO_MS;
  return ms(p.criadoEm) + DADOS_SEM_VENDA_MS;
}

async function apagarDadosDoComprador(ref, p) {
  const upd = { apagarDadosEm: FV.delete(), dadosApagadosEm: FV.serverTimestamp() };
  if (p.comprador && typeof p.comprador === 'object') {
    upd['comprador.whatsapp'] = FV.delete();
    upd['comprador.nome'] = String(p.comprador.nome || '').trim().split(/\s+/)[0].slice(0, 30);
  }
  /* So mexe campo a campo se 'entrega' for mapa (texto solto antigo e so o
     tipo, 'retirada' ou 'entrega', e nao tem dado da pessoa). */
  if (p.entrega && typeof p.entrega === 'object') {
    ['rua', 'numero', 'complemento', 'cep', 'referencia', 'detalhe'].forEach(function (k) { upd['entrega.' + k] = FV.delete(); });
  }
  /* 03/10 (P70 etapa 3): o link de acompanhamento morre junto. */
  if (p.acompanhar) upd.acompanhar = FV.delete();
  await ref.update(upd);
}

/* Roda dentro do api/pedidos-confere.js, no maximo 1 vez por hora (a marca
   em manutencao/retencao_pedidos segura), seja qual for a frequencia do cron.
   1) apaga o que venceu (apagarDadosEm <= agora);
   2) passa UMA vez por cada pedido com mais de 1 dia, em ordem de criacao,
      e da prazo a quem nasceu sem ele (pedidos anteriores a 26/09). */
async function varrerRetencao(max) {
  /* Minimo 2: com pagina cheia o cursor volta 1 ms e relê o ultimo; com 1
     por pagina ele ficaria parado no mesmo pedido. */
  const lim = Math.max(2, Math.min(Number(max) || 100, 300));
  const marca = db.collection('manutencao').doc('retencao_pedidos');
  const m = await marca.get();
  const md = m.exists ? (m.data() || {}) : {};
  const agora = Date.now();
  if (Number(md.ultimaMs) && agora - Number(md.ultimaMs) < 3600000) return { pulou: true };
  const r = { vencidos: 0, apagados: 0, antigosVistos: 0, antigosComPrazo: 0, erros: 0 };

  const venc = await db.collection('pedidos').where('apagarDadosEm', '<=', admin.firestore.Timestamp.fromMillis(agora)).limit(lim).get();
  for (const d of venc.docs) {
    r.vencidos++;
    try { await apagarDadosDoComprador(d.ref, d.data() || {}); r.apagados++; } catch (e) { r.erros++; }
  }

  let cursor = Number(md.cursorMs) || 0;
  const ate = agora - 86400000;
  if (cursor < ate) {
    const q = await db.collection('pedidos')
      .where('criadoEm', '>', admin.firestore.Timestamp.fromMillis(cursor))
      .where('criadoEm', '<=', admin.firestore.Timestamp.fromMillis(ate))
      .orderBy('criadoEm').limit(lim).get();
    let ultimo = cursor;
    for (const d of q.docs) {
      const p = d.data() || {};
      r.antigosVistos++;
      const c = ms(p.criadoEm);
      if (c > ultimo) ultimo = c;
      if (p.apagarDadosEm || p.dadosApagadosEm) continue;
      try {
        const vence = prazoDoPedidoAntigo(p);
        if (vence <= agora) { await apagarDadosDoComprador(d.ref, p); r.apagados++; }
        else { await d.ref.set({ apagarDadosEm: admin.firestore.Timestamp.fromMillis(vence) }, { merge: true }); r.antigosComPrazo++; }
      } catch (e) { r.erros++; }
    }
    /* Pagina cheia: volta 1 ms para nao pular pedido criado no mesmo
       milissegundo do ultimo (repassar um ja tratado nao faz nada). */
    cursor = q.docs.length >= lim ? Math.max(cursor, ultimo - 1) : ate;
  }
  await marca.set({ ultimaMs: agora, cursorMs: cursor }, { merge: true });
  return r;
}

/* VARREDURA DOS PEDIDOS COM GATEWAY — 23/09/2026.
   No modo 'asaas' (conta Asaas do proprio lojista) nenhum aviso automatico do
   Asaas chega ate nos: o pedido so virava pago se o COMPRADOR estivesse com a
   pagina aberta. Quem pagava no app do banco e fechava a pagina deixava o
   pedido "aguardando" para sempre, sem e-mail de pago e sem "Marcar entregue".
   Esta varredura roda a cada 5 minutos (api/pedidos-confere.js) e pergunta ao
   Asaas por cada pedido aguardando das ultimas 48 horas. Pix direto fica de
   fora: la quem confirma e o lojista. */
async function varrerPedidosGateway(limite) {
  const max = Math.max(1, Math.min(Number(limite) || 40, 100));
  const snap = await db.collection('pedidos').where('status', '==', 'aguardando').limit(300).get();
  const r = { vistos: snap.size, conferidos: 0, pagos: 0, expirados: 0, erros: 0 };
  r.pixVencidos = 0;
  for (const d of snap.docs) {
    const p = d.data() || {};
    const criado = ms(p.criadoEm);
    /* 30/09/2026 (P53): Pix direto abandonado vence aqui tambem. Antes so
       vencia se o COMPRADOR voltasse a tela; depois de uma live cheia, Novos
       ficava entupido de Pix que ninguem ia pagar. O lojista ainda confirma
       depois, se o dinheiro cair atrasado (lojaPedidoPix aceita 'expirado'). */
    if (p.modo === 'pix') {
      if (Date.now() > limiteDoPedido(p)) {
        await d.ref.set({ status: 'expirado', expiradoEm: FV.serverTimestamp() }, { merge: true });
        await devolverEstoque(d.id, 'expirou');
        r.pixVencidos++;
      }
      continue;
    }
    if (r.conferidos >= max) continue;
    if (!p.asaasId) continue;
    if (criado && Date.now() - criado > 48 * 3600000) continue;
    r.conferidos++;
    /* 30/09: oferta com a janela vencida tem a cobranca cancelada no banco. */
    if (p.oferta && Date.now() > limiteDoPedido(p)) {
      const v = await vencerCobrancaOferta(d.ref, p);
      if (v === 'pago') r.pagos++; else if (v === 'expirado') r.expirados++;
      continue;
    }
    const st = await confirmarNoAsaas(p, d.id);
    if (st === 'pago' || st === 'pago_manual') { await marcarPago(d.ref, st === 'pago' ? 'gateway' : 'lojista'); r.pagos++; }
    else if (st === 'expirado') { await d.ref.set({ status: 'expirado' }, { merge: true }); await devolverEstoque(d.id, 'expirou'); r.expirados++; }
    else if (st === 'erro') r.erros++;
  }
  return r;
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
const TERMO_VENDA_VERSAO = '2026-09-26';   // 26/09: clausula "Os dados do cliente sao para atender o pedido" 

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
  /* 26/09/2026: a tabela de bairros vai junto — so nome e taxa, que sao
     preco publico do lojista. Nada de endereco dele alem do texto de
     retirada que ELE escreveu para o cliente ler. */
  const cfg = lerEntregaCfg(r);
  await db.collection('checkout_publico').doc(uid).set({
    ativo: ligado,
    modo,
    minimo: ligado ? minimoDoModo(modo) : 0,
    entrega: entregaSuspensa(r) ? 'retirada' : ((r && r.entrega) || 'retirada'),
    entregaSuspensa: entregaSuspensa(r),
    bairros: cfg.bairros,
    minimoEntrega: cfg.minimoEntrega,
    prazo: cfg.prazo,
    cidadeEntrega: cfg.cidade,
    retirada: cfg.retirada,
    /* 03/10 (P70 etapa 2): tabela de envio e preco publico do lojista. */
    envio: lerEnvioCfg((r && r.entregaCfg) || {}),
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
      /* 25/09/2026 (A2): so a mascara do CPF/CNPJ. O numero inteiro nao era lido
         por ninguem e ficava em claro no banco (LGPD). Documentos antigos: o
         campo 'documento' some na proxima vez que o lojista salvar a chave. */
      nome, cidade, documento: FV.delete(), docMascara: pix.mascararDoc(doc),
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

/* Configuracao de entrega do lojista (26/09/2026): como o cliente recebe,
   bairros atendidos com a taxa de cada um, pedido minimo para entrega, prazo
   e o texto de retirada. Grava em recebimento/{uid} (Admin SDK) e espelha em
   checkout_publico. Nao mexe em modo nem em ligado: configurar entrega com a
   venda desligada e o caminho normal de quem esta comecando. */
async function lojaEntrega(uid, b) {
  const modoEnt = ['retirada', 'entrega', 'ambos'].indexOf(String(b.entrega || '')) >= 0 ? String(b.entrega) : '';
  if (!modoEnt) return { erro: 'entrega' };
  const lista = Array.isArray(b.bairros) ? b.bairros : [];
  if (lista.length > MAX_BAIRROS) return { erro: 'bairros_muitos', max: MAX_BAIRROS };
  const vistos = {};
  const bairros = [];
  for (const x of lista) {
    const nome = txt(x && x.nome, 50);
    if (nome.length < 2) return { erro: 'bairro_nome' };
    const taxa = precoNum(x && x.taxa);
    if (!(taxa >= 0) || taxa > TAXA_MAX) return { erro: 'taxa', nome };
    const k = semAcento(nome);
    if (vistos[k]) return { erro: 'bairro_repetido', nome };
    vistos[k] = 1;
    bairros.push({ nome, taxa });
  }
  const minTxt = String(b.minimoEntrega == null ? '' : b.minimoEntrega).trim();
  const minimoEntrega = minTxt === '' ? 0 : precoNum(minTxt);
  if (!(minimoEntrega >= 0) || minimoEntrega > 5000) return { erro: 'minimo_entrega' };
  const cfg = { bairros, minimoEntrega, prazo: txt(b.prazo, 40), cidade: txt(b.cidade, 40), retirada: txt(b.retirada, 120) };

  const ref = db.collection('recebimento').doc(uid);
  const s = await ref.get();
  const r = s.exists ? s.data() : {};
  /* ENVIO (03/10, P70 etapa 2): so mexe se a tela mandou o bloco; senao
     mantem o que estava salvo (tela antiga nao apaga a tabela de envio). */
  if (b.envio && typeof b.envio === 'object') {
    const e = b.envio, regioes = {};
    for (const k of REGIOES) {
      const v = taxaOuNada(e.regioes && e.regioes[k]);
      if (v === undefined) return { erro: 'taxa_envio', regiao: k };
      regioes[k] = v;
    }
    const mesmo = taxaOuNada(e.mesmoEstado);
    if (mesmo === undefined) return { erro: 'taxa_envio', regiao: 'UF' };
    const uf = String(e.ufOrigem || '').toUpperCase().slice(0, 2);
    if (e.ativo === true && !UFS[uf]) return { erro: 'uf_origem' };
    const gtTxt = String(e.gratisAcima == null ? '' : e.gratisAcima).trim();
    const gratisAcima = gtTxt === '' ? 0 : precoNum(gtTxt);
    if (!(gratisAcima >= 0) || gratisAcima > 50000) return { erro: 'gratis_acima' };
    if (e.ativo === true && mesmo === null && REGIOES.every((k) => regioes[k] === null)) return { erro: 'envio_vazio' };
    cfg.envio = { ativo: e.ativo === true, ufOrigem: UFS[uf] ? uf : '', mesmoEstado: mesmo, regioes, gratisAcima, prazo: txt(e.prazo, 40) };
  } else if (r.entregaCfg && r.entregaCfg.envio) cfg.envio = r.entregaCfg.envio;
  await ref.set({ uid, entrega: modoEnt, entregaCfg: cfg, atualizadoEm: FV.serverTimestamp() }, { merge: true });
  await espelharRecebimento(uid, Object.assign({}, r, { entrega: modoEnt, entregaCfg: cfg }));
  await trilha(uid, 'entrega_config', { entrega: modoEnt, bairros: bairros.length, minimoEntrega });
  return situacaoRecebimento(uid);
}

/* Suspensao da entrega de um lojista pelo DONO do Moviki (26/09/2026).
   Nao mexe na configuracao que o lojista fez: so poe a trava por cima, e
   reativar devolve tudo como estava. Motivo obrigatorio ao suspender — e ele
   que aparece para o lojista no painel. */
async function admEntrega(adminUid, b) {
  const uid = String((b && b.uid) || '');
  if (!/^[A-Za-z0-9]{10,128}$/.test(uid)) return { erro: 'uid' };
  const suspender = b.suspender === true;
  const motivo = txt(b.motivo, 200);
  if (suspender && motivo.length < 5) return { erro: 'motivo' };
  const ref = db.collection('recebimento').doc(uid);
  const s = await ref.get();
  const r = s.exists ? s.data() : {};
  const trava = suspender ? { ativa: true, motivo, em: FV.serverTimestamp(), por: adminUid } : { ativa: false, em: FV.serverTimestamp(), por: adminUid };
  await ref.set({ uid, entregaSuspensa: trava, atualizadoEm: FV.serverTimestamp() }, { merge: true });
  await espelharRecebimento(uid, Object.assign({}, r, { entregaSuspensa: { ativa: suspender } }));
  await trilha(uid, suspender ? 'entrega_suspensa' : 'entrega_reativada', { motivo, por: adminUid });
  return { ok: true, uid, suspensa: suspender };
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
    entregaCfg: Object.assign(lerEntregaCfg(d), { envio: lerEnvioCfg(d.entregaCfg || {}) }),
    recursos: await recursosDe(uid),
    entregaSuspensa: entregaSuspensa(d) ? { ativa: true, motivo: txt(d.entregaSuspensa.motivo, 200) } : { ativa: false },
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
    estornado: { assunto: 'ATENÇÃO: Pix devolvido — ' + dados.valor, titulo: 'O Pix deste pedido foi devolvido', linha: 'O banco devolveu o dinheiro ao comprador. NÃO entregue este pedido. Se já entregou, fale com o cliente. Se você controla estoque no Moviki e o pedido não tinha saído, a peça voltou para o estoque.' },
  }[tipo];
  if (!t) return null;
  /* 30/09: pagou depois do prazo, ou sem a unidade da oferta segura. */
  const alerta = dados.alerta
    ? '<p style="font-size:13.5px;color:#ffd36b;background:#3a2a0c;border-radius:10px;padding:10px 12px;line-height:1.55;margin:0 0 16px">' + dados.alerta + '</p>'
    : '';
  const html =
    '<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;background:#060d18;color:#eaf6ff;padding:26px">' +
      '<div style="max-width:520px;margin:0 auto;background:#0e1c30;border:1px solid #1c3457;border-radius:16px;padding:22px">' +
        '<div style="font-size:19px;font-weight:700;margin-bottom:6px">' + t.titulo + '</div>' +
        '<div style="font-size:13px;color:#8fa6c4;margin-bottom:16px">' + dados.negocio + '</div>' +
        '<div style="font-size:30px;font-weight:800;color:#25e39b;letter-spacing:-.5px">' + dados.valor + '</div>' +
        '<div style="font-size:13.5px;color:#c6d8ee;margin-top:6px">' + dados.itens + ' &middot; ' + dados.entrega + '</div>' +
        '<p style="font-size:13.5px;color:#c6d8ee;line-height:1.6;margin:16px 0 20px">' + t.linha + '</p>' + alerta +
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
      entrega: (p.entrega && p.entrega.tipo === 'entrega') ? (p.entrega.envio ? 'envio para ' + (p.entrega.cidade || '') + (p.entrega.uf ? '/' + p.entrega.uf : '') : ((p.entrega.aCombinar === false) ? 'entrega' : 'entrega combinada')) : 'retirada no local',
      negocio: negNome || 'Seu negocio',
      alerta: p.alertaEstoque === 'sem_estoque'
        ? 'Atencao: este Pix foi confirmado depois do prazo, e a ultima peca ja tinha sido vendida para outra pessoa. Confira se ainda tem o produto antes de separar. Se nao tiver, use Desfazer venda no painel e devolva o Pix pelo app do seu banco.'
        : p.alertaEstoque
        ? 'Atencao: este Pix foi pago quando a unidade da oferta ja estava com outro comprador. Confira se ainda tem a peca antes de separar. Se nao tiver, devolva o Pix pelo app do seu banco.'
        : (p.pagouAtrasado ? 'Atencao: o comprador pagou depois do prazo do Pix. Confira no extrato e confirme so se o dinheiro caiu.' : ''),
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
async function freioNegocio(uid, teto) {
  const ref = db.collection('checkout_freio').doc('_neg_' + String(uid).slice(0, 100));
  const agora = Date.now();
  const max = Number(teto) > 0 ? Number(teto) : MAX_ABERTOS_NEGOCIO;
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    let d = s.exists ? s.data() : { ini: agora, n: 0 };
    if (agora - (d.ini || 0) > 3600000) d = { ini: agora, n: 0 };
    if (d.n >= max) return false;
    tx.set(ref, { ini: d.ini, n: d.n + 1, expiraEm: admin.firestore.Timestamp.fromMillis(agora + 86400000) });
    return true;
  });
}

/* ------------------------------------------------- criar pedido no Pix direto */

async function criarPedidoPix(ctx) {
  const { lojistaUid, r, itens, total, comprador, entrega, origem, liveId, negNome } = ctx;
  const extra = ctx.extra || {};
  const campos = ctx.campos || {};
  const validadeMin = Number(campos.validadeMin) || PEDIDO_VALIDADE_MIN;
  const validoAte = Number(campos.validoAte) || (Date.now() + validadeMin * 60000);

  const pedidoRef = ctx.pedidoRef || db.collection('pedidos').doc();
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
    ...campos, validadeMin, validoAte,
    lojistaUid, origem, liveId: liveId || '', dia: hoje(),
    modo: 'pix',
    itens, total: totalFinal, totalBase: total, centavos,
    subtotal: extra.subtotal != null ? extra.subtotal : total, frete: extra.frete || 0,
    numero: extra.numero || 0, codigo: extra.codigo || '',
    estoque: extra.estoque || { v: 1, linhas: [] },
    comprador, entrega,
    aceite: { versao: POLITICA_VERSAO, em: FV.serverTimestamp() },
    status: 'aguardando',
    segredoHash: crypto.createHash('sha256').update(segredo).digest('hex'),
    criadoEm: FV.serverTimestamp(),
    expiraEm: admin.firestore.Timestamp.fromMillis(Date.now() + PEDIDO_RETENCAO_MS),
    apagarDadosEm: prazoDados(DADOS_SEM_VENDA_MS),
  });

  await trilha(lojistaUid, 'pedido_criado', { pedido: pedidoRef.id, modo: 'pix', total: totalFinal, origem });
  /* Aguardado, nao solto: em funcao serverless a promessa que ninguem espera e
     cortada no momento em que a resposta sai, e o e-mail simplesmente nao
     chega. O custo e o tempo limite de 2,5 s la dentro. */
  await avisarLojista('novo', { lojistaUid, total: totalFinal, itens, entrega }, pedidoRef.id);

  return {
    ok: true, pedidoId: pedidoRef.id, chave: segredo, total: totalFinal, centavos,
    subtotal: extra.subtotal != null ? extra.subtotal : total, frete: extra.frete || 0,
    numero: extra.numero || 0, entrega: entrega.tipo,
    /* 26/09/2026: a tela da live mostra o produto na confirmacao. So o modo
       Asaas devolvia isto; no Pix direto aparecia "undefined". */
    itens: itens.map((i) => ({ nome: i.nome, qtd: i.qtd })),
    produto: itens[0] ? itens[0].nome : '', qtd: itens[0] ? itens[0].qtd : 1,
    modo: 'pix',
    pix: {
      copiaCola: br.payload,
      // A tela MOSTRA estes dois. Sao a barreira contra QR trocado por script
      // injetado: o comprador confere no aplicativo do banco antes de pagar.
      recebedor: { nome: r.pix.nome, documento: r.pix.docMascara, chave: r.pix.mascara },
    },
    negocio: negNome,
    validadeMin, validoAte,
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
  /* 30/09: 'expirado' entra. O copia-e-cola estatico nao vence no banco: quem
     pagou depois do prazo precisa conseguir avisar, senao o lojista recebe o
     dinheiro sem saber de quem e o comprador fica sem resposta. */
  if (['aguardando', 'conferindo', 'expirado'].indexOf(p.status) < 0) return { ok: true, status: p.status };

  /* 03/10/2026 (auditoria): o "Ja paguei" aceitava comprovante novo a cada
     chamada, enquanto o pedido estivesse em 'conferindo'. Com o proprio
     pedido, um script enchia o Storage (1,7 MB por chamada) e cada arquivo
     anterior ficava orfao. Agora: no maximo 3 por pedido, e o anterior e
     apagado quando o novo entra. */
  let comprovante = null;
  if (b.comprovanteBase64) {
    if ((Number(p.comprovantesN) || 0) >= 3) return { erro: 'comprovante_limite' };
    comprovante = await salvarComprovante(id, String(b.comprovanteBase64));
    if (comprovante && comprovante.erro) return comprovante;
    if (p.comprovante && p.comprovante !== comprovante.caminho) {
      try { await admin.storage().bucket(STORAGE_BUCKET).file(String(p.comprovante)).delete(); }
      catch (e) { console.error('comprovante anterior', id, e && e.message); }
    }
  }

  /* Oferta: "Ja paguei" segura a unidade ate o lojista conferir. Se ela ja
     tinha ido para outro comprador, o pedido sai com alerta. */
  const atrasado = p.status === 'expirado' || Date.now() > limiteDoPedido(p);
  const jaAvisou = p.status === 'conferindo';
  let alertaEstoque = p.alertaEstoque || '';
  if (!jaAvisou && p.reservaChave) {
    const rv = await mexerReserva(p, id, 'conferindo');
    if (!rv.segura) alertaEstoque = 'sem_reserva';
  }

  await ref.set(Object.assign({
    status: 'conferindo',
    avisadoEm: FV.serverTimestamp(),
  }, comprovante ? { comprovante: comprovante.caminho, comprovantesN: FV.increment(1) } : {},
     atrasado ? { pagouAtrasado: true } : {},
     alertaEstoque ? { alertaEstoque } : {}), { merge: true });

  /* 30/09 (P53): quem avisou que pagou segura a peca do ESTOQUE do produto
     ate o lojista conferir (24 h) — mesma regra da oferta. */
  try {
    const rr = db.collection('estoque_reservas').doc(id);
    const rs = await rr.get();
    if (rs.exists && rs.data().ativa === true) await rr.update({ venceEm: admin.firestore.Timestamp.fromMillis(Date.now() + ESTOQUE_AVISOU_MS) });
  } catch (e) { console.error('reserva estoque prazo', id, e.message); }

  await trilha(p.lojistaUid, 'comprador_avisou', { pedido: id, comComprovante: !!comprovante, atrasado, alertaEstoque });
  /* Este e o aviso que realmente importa no Pix direto: enquanto o lojista nao
     confere o extrato e confirma, o pedido nao anda. */
  if (!jaAvisou) await avisarLojista('pagou', Object.assign({}, p, { pagouAtrasado: atrasado, alertaEstoque }), id);
  return { ok: true, status: 'conferindo', atrasado, alertaEstoque };
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
    /* 30/09/2026 (P53): 'recusado' e 'cancelado' tambem — "Nao caiu" tocado
       por engano nao tinha volta, e o Pix que caia depois ficava sem pedido.
       A peca e baixada de novo em marcarPago (com alerta se ja nao havia). */
    if (['aguardando', 'conferindo', 'expirado', 'recusado', 'cancelado'].indexOf(p.status) < 0) return { erro: 'so_aguardando' };
    /* 'lojista': confirmado na palavra dele, sem gateway. Ver o comentario de
       marcarPago — este caminho e legitimo e precisa ficar separado. */
    await marcarPago(ref, 'lojista');
    await trilha(uid, 'pedido_confirmado', { pedido: ref.id, total: p.total, por: 'lojista' });
    return { ok: true, status: 'pago' };
  }
  if (novo === 'recusado') {
    if (p.status !== 'conferindo' && p.status !== 'aguardando') return { erro: 'so_aguardando' };
    await ref.set({ status: 'recusado', recusadoEm: FV.serverTimestamp(), recusaMotivo: txt(motivo, 140) }, { merge: true });
    await mexerReserva(p, ref.id, 'soltar');
    await devolverEstoque(ref.id, 'recusado');
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
    if (st === 'pago' || st === 'pago_manual') { await marcarPago(ref, st === 'pago' ? 'gateway' : 'lojista'); return { pedido: id, status: 'pago' }; }
    if (st === 'divergente') await ref.set({ alerta: 'divergente', alertaEm: FV.serverTimestamp() }, { merge: true });
    /* 200 mesmo sem confirmar: devolver erro faria o Asaas pausar a fila da
       subconta. A tela do comprador e o botao do lojista conferem de novo. */
    return { pedido: id, naoConfirmado: st };
  }
  /* 30/09/2026 (P53): chargeback (MED do Pix) conta como estorno — o
     dinheiro volta para o comprador do mesmo jeito. */
  const mapa = { PAYMENT_OVERDUE: 'expirado', PAYMENT_DELETED: 'cancelado', PAYMENT_REFUNDED: 'estornado', PAYMENT_CHARGEBACK_REQUESTED: 'estornado' };
  /* 30/09: cobranca de oferta que o proprio robo cancelou quando a janela
     passou continua 'expirado' (a tela do comprador diz "venceu"). */
  if (tipo === 'PAYMENT_DELETED' && s.data().cobrancaCancelada === true) return { pedido: id, status: s.data().status };
  if (mapa[tipo]) {
    const p = s.data();
    const atual = p.status;
    const novo = mapa[tipo];
    /* Venda paga so muda por estorno. E 'devolvido' (o lojista ja desfez)
       fica como esta: o estorno no banco e a consequencia do que ele fez. */
    const muda = !(novo !== 'estornado' && PAGOS.indexOf(atual) >= 0) && atual !== 'devolvido' && atual !== novo;
    if (muda) {
      const upd = { status: novo, [novo + 'Em']: FV.serverTimestamp() };
      if (novo === 'estornado' && PAGOS.indexOf(atual) >= 0) { upd.alerta = 'estornado'; upd.alertaEm = FV.serverTimestamp(); upd.estornoDe = atual; }
      await ref.set(upd, { merge: true });
    }
    if (PAGOS.indexOf(atual) < 0) await mexerReserva(p, id, 'soltar');
    /* Pedido ja ENTREGUE estornado: a mercadoria esta com o cliente, nao na
       prateleira. Nao volta ao estoque. */
    if (atual !== 'entregue') await devolverEstoque(id, novo);
    /* ESTORNO DE VENDA PAGA: antes o pedido sumia do quadro em silencio, o
       "comprou" continuava no chat e o lojista podia entregar o que nao
       recebeu. Agora: peca de volta, chat limpo e e-mail. */
    if (muda && novo === 'estornado' && PAGOS.indexOf(atual) >= 0) {
      await apagarVendaDoChat(p);
      await trilha(p.lojistaUid, 'pedido_estornado', { pedido: id, de: atual, total: p.total, evento: tipo });
      await avisarLojista('estornado', p, id);
    }
    return { pedido: id, status: muda ? novo : atual };
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
    /* 03/10 (P70 etapa 3): pagina publica de acompanhamento, sem login. */
    if (acao === 'compra_acompanhar') {
      const r = await pedidoVer(body);
      return res.status(r.erro ? 404 : 200).json(r.erro ? Object.assign({ ok: false }, r) : r);
    }
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
      const adm = await conferirAdmin(db, dec);
      if (!adm.ok) return erro(res, adm.status, adm.erro, { mensagem: adm.mensagem });
      const r = await admAsaas();
      return res.status(r.erro ? 400 : 200).json(r.erro ? Object.assign({ ok: false }, r) : r);
    }
    if (acao === 'adm_wh_rotacionar') {
      const adm = await conferirAdmin(db, dec);
      if (!adm.ok) return erro(res, adm.status, adm.erro, { mensagem: adm.mensagem });
      const alvo = String((body.dados && body.dados.uid) || body.uid || '');
      if (!/^[A-Za-z0-9]{10,128}$/.test(alvo)) return erro(res, 400, 'uid');
      const r = await rotacionarWebhook(alvo);
      return res.status(r.erro ? 400 : 200).json(r.erro ? Object.assign({ ok: false }, r) : r);
    }
    if (acao === 'adm_entrega') {
      const adm = await conferirAdmin(db, dec);
      if (!adm.ok) return erro(res, adm.status, adm.erro, { mensagem: adm.mensagem });
      const r = await admEntrega(dec.uid, body.dados || {});
      return res.status(r.erro ? 400 : 200).json(r.erro ? Object.assign({ ok: false }, r) : r);
    }
    if (acao === 'adm_recursos') {
      const adm = await conferirAdmin(db, dec);
      if (!adm.ok) return erro(res, adm.status, adm.erro, { mensagem: adm.mensagem });
      const r = await admRecursos(dec.uid, body.dados || {});
      return res.status(r.erro ? 400 : 200).json(r.erro ? Object.assign({ ok: false }, r) : r);
    }
    if (/^adm_/.test(acao)) return erro(res, 400, 'acao');

    /* Financeiro do lojista: Premium e Enterprise. A subconta (loja_criar) e a
       live continuam exclusivas do Enterprise, conferidas logo abaixo. */
    const ACOES_PLANO_PAGO = ['loja_recebimento', 'loja_pix', 'loja_modo', 'loja_asaas', 'loja_comprovante', 'loja_pedido', 'loja_entrega', 'loja_estoque', 'loja_rastreio'];
    if (ACOES_PLANO_PAGO.indexOf(acao) >= 0) {
      if (!(await planoDe(dec.uid))) return erro(res, 403, 'nao_pago');
      let rp;
      if (acao === 'loja_recebimento') rp = await situacaoRecebimento(dec.uid);
      else if (acao === 'loja_pix') rp = await lojaPixSalvar(dec.uid, body.dados || {});
      else if (acao === 'loja_modo') rp = await lojaModo(dec.uid, body.dados || {});
      else if (acao === 'loja_asaas') rp = await lojaAsaasConectar(dec.uid, body.dados || {});
      else if (acao === 'loja_comprovante') rp = await comprovanteLink(dec.uid, body.pedidoId);
      else if (acao === 'loja_entrega') rp = await lojaEntrega(dec.uid, body.dados || {});
      else if (acao === 'loja_estoque') rp = await lojaEstoque(dec.uid, body.dados || {});
      else if (acao === 'loja_rastreio') rp = await lojaRastreio(dec.uid, body.pedidoId, body.dados || {});
      else rp = await lojaPedido(dec.uid, body.pedidoId, body.status, body.motivo, body.voltaEstoque !== false);
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
  ehAcao, tratar, webhookPedido, uidPorTokenWebhook, rotacionarWebhook, varrerPedidosGateway, limparComprovantesAntigos, varrerRetencao, varrerReservas,
  _t: { prazoDoPedidoAntigo, apagarDadosDoComprador, cpfValido, cnpjValido, cifrar, decifrar, acharProduto, acharNoCardapio, precoNum, mvProibido, lerItensCardapio, minimoDoModo, mascararChave, emailDoLojista, freioAviso, corpoAviso, avisarLojista ,
    chaveNome, chaveSku, acharEntrada, linhasDoPedido, espelhoEstoque, reservarEstoque, devolverEstoque, lojaEstoque, marcarPago, compraCriar, lojaPedido, webhookPedido, varrerReservas, compraPaguei, compraStatus, varrerPedidosGateway, recursosDe, admRecursos, lerItensLive, lojaEntrega, freteEnvio, lerEnvioCfg, podeEnviar, resolverEntrega, lojaRastreio, pedidoVer, lerRastreio, compraStatus },
};
