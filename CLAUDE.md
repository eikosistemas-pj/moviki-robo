# CLAUDE.md — Mapa Mestre do MOVIKI

Este arquivo é lido pelo Claude Code no início de toda sessão. Ele vale para TODOS os repositórios do projeto Moviki (conta GitHub `eikosistemas-pj`). A mesma cópia fica na raiz de cada repositório.

> **REGRA DE SINCRONIZAÇÃO (17/09/2026).** As seis cópias são idênticas e precisam continuar idênticas. Alteração no mapa atualiza **os seis repositórios no mesmo ciclo** — nunca um e "os outros depois". Foi exatamente isso que fez as cópias divergirem duas vezes em 17/09: uma foi atualizada e as outras ficaram para depois. "Depois" não aconteceu.
>
>
> A mesma regra vale para as duas cadeiras transversais da equipe: `.claude/skills/gabinete/` e `.claude/skills/guarda/` (seção 15). E conferir se as cópias batem deixou de depender de disciplina: virou a **primeira tarefa do Gabinete em toda sessão**.
>
> A cópia existe em todos porque a sessão do Claude Code começa em **um** repositório e lê o mapa dali sozinha. Quem trabalha no `moviki-robo` precisa da tabela de planos e das coleções; quem trabalha no `moviki` precisa das regras de LGPD da vitrine. Centralizar num repositório só obrigaria a pedir anexo em toda sessão — fricção permanente no Paulo para resolver um problema de disciplina de quem edita.

> Levantado por leitura direta dos repositórios em 17/09/2026. O que não foi possível confirmar está marcado como **a confirmar**.

---

## 1. Sobre o negócio

- **Produto:** Moviki — SaaS para **negócios itinerantes** (food truck, feira, loja móvel, prestador que se desloca).
- **O que resolve:** o lojista aparece no mapa, na hora, onde ele está; vende ao vivo pelo celular e recebe no Pix.
- **Dono:** Paulo. Toca tudo sozinho.
- **Modelo:** assinatura mensal/anual (Básico grátis, Pró, Premium, Enterprise) + programa de parceiros com comissão.

## 2. Quem dá os comandos (leia com atenção)

- Paulo **não é programador**. Trabalha pela interface web do GitHub.
- Responda **sempre em Português (Brasil)**, direto ao ponto, com bullets curtos.
- **Não mostre código na conversa.** Faça a alteração no repositório e explique o resultado em linguagem de negócio (o que muda para o lojista, para o parceiro, para o Paulo).
- Se o pedido for ambíguo ou arriscado, pergunte antes de alterar.
- Avalie criticamente o pedido: se houver falha escondida ou solução melhor, aponte antes de executar.

## 3. Mapa dos repositórios

| Repositório | Papel no sistema | Hospedagem | Endereço |
|---|---|---|---|
| `moviki` | **Site público e vitrine.** Páginas de venda, página pública de cada negócio, live pública, termos, cadastro/descadastro | Vercel | `moviki.com.br` |
| `moviki-app` | **Painel do lojista** (`index.html`), **painel do parceiro** (`parceiro.html`), **painel do dono** (`eikoadm01.html`), live do lojista, material de apoio | Vercel | `app.moviki.com.br` |
| `moviki-robo` | **Robô do dinheiro.** Sem tela. Assinaturas, webhooks do Asaas, comissões, saques, pedidos, upload | Vercel (funções + cron) | `moviki-robo.vercel.app` |
| `moviki-ai` | **Atendentes de IA.** Um no WhatsApp, um dentro do painel | Vercel (projeto próprio) | **a confirmar** |
| `moviki-assistente-social` | **Publicação nas redes.** Python 3.11, roda só por GitHub Actions | GitHub Actions | — |
| `moviki-vault` | **Privado. Cópia do cofre do Obsidian do Paulo** — anotações, decisões e contexto de negócio. Não é código e não é publicado | — | — |
| ~~`moviki-platform`~~ | **Descontinuado.** Estava vazio (nenhum arquivo, nenhum commit). O Paulo autorizou apagar em 17/09/2026 | — | — |

- **Privados desde 23/09/2026:** `moviki-robo`, `moviki-app`, `moviki-ai` (além do `moviki-vault`). Continuam públicos: `moviki-assistente-social` (o painel do dono, o do parceiro e o Vik leem o `estado/historico.json` dele direto do GitHub, e as Actions dele não gastam cota) e `moviki` (o site). Para conferir repositório privado fora do Claude Code, o Paulo baixa o ZIP pelo GitHub (Code → Download ZIP) e anexa na conversa.
- Cada sessão do Claude Code começa em um repositório. Se a tarefa exigir outro, **peça para anexar** — vários repositórios podem conviver na mesma conversa.
- `moviki-vault` é **privado**, então anexá-lo exige o Paulo aprovar o pedido na tela. Peça quando a tarefa precisar de contexto de negócio (o porquê de uma decisão), não para tarefa de código comum.
- **Nunca publicar nada que venha do `moviki-vault`.** É anotação interna: serve para entender, não para virar página, post ou texto de cliente.

## 4. Regras de ouro (nunca quebrar)

1. **Nunca fazer push direto na `main`.** O Vercel publica a `main` na hora para os clientes. Sempre criar branch, fazer commit e abrir Pull Request. O Vercel gera um **link de teste** por branch — informe esse link ao Paulo antes do merge.
2. **Aprovar um Pull Request encerra aquele pacote.** Depois disso, alteração nova é pacote novo, com link novo. Só envie o link para aprovar quando o pacote estiver fechado.
3. **Dinheiro e status são sempre server-side**, via Admin SDK no `moviki-robo`. O cliente **nunca** escreve direto em coleção financeira.
4. **Segredos:** nunca gravar chave, token ou senha em arquivo. Ficam nas **Environment Variables do Vercel** e nos **GitHub Secrets** (Actions). Cada projeto Vercel tem as suas — `moviki-ai` não herda nada do `moviki-robo`.
5. **Regras do Firestore usam `hasOnly`** (lista exata de campos em `negocioValido`). Ao adicionar campo novo, conferir a lista — senão a gravação é recusada em silêncio.
6. **Escape de XSS (`esc()`) obrigatório** em todo texto exibido em página pública.
7. **Vitrine exige `autorizaDivulgacao === true`** (booleano). Campo ausente = fora da vitrine. Isso é LGPD, não preferência.
8. **Nunca imprimir endereço exato de terceiro** em material público. Só município/UF.
9. **Preços e planos:** qualquer alteração precisa ser confirmada com o Paulo antes do commit, com o resumo "antes → depois".
10. **Nunca cobrar um valor que a tela não mostrou.** O `criar-assinatura.js` recusa com 400 período que não existe mais.
11. **O painel `index.html` tem dois escopos isolados**: script module (Firebase) e script comum (JQuery/UI). Respeitar os escopos.
12. **GitHub Actions no plano gratuito tem limite mensal de minutos.** Não aumentar a frequência das rotinas sem avisar o Paulo. Em repositório **privado** cada execução gasta cota (no mínimo 1 min): rotina de minutos em minutos vai para o **cron da Vercel**, nunca para o Actions.
13. **Subiu `index.html` ou `parceiro.html`, sobe junto o Vik — na MESMA entrega.** O Vik conhece as telas pela tabela `MARCAS_CONFERIDAS` em `moviki-ai/lib/catalogoPainel.js`. Marca nova no painel sem a tabela = Vik em **modo cauteloso para todos**, sem nenhum sintoma na tela (aconteceu em 16/09 três vezes, 22/09 e 23/09). Toda entrega que muda um desses dois painéis inclui: (a) a marca nova em `MARCAS_CONFERIDAS`; (b) o texto do catálogo com o que o cliente passa a ver (seção, botão, regra, preço); (c) `CATALOGO_VERSAO` novo. Se a entrega for de outro chat, quem conferir depois fecha essa ponta antes de qualquer outra coisa. O painel do dono acende "Precisa de você" quando as marcas divergem (desde 23/09).

## 5. Arquitetura — quem chama quem

- **Lojista** entra em `app.moviki.com.br` → painel lê e grava em `negocios/{uid}` no Firestore.
- **Lojista escolhe um plano** → painel chama `moviki-robo /api/criar-assinatura` → Asaas gera a cobrança.
- **Asaas avisa sozinho** quando o pagamento muda → `moviki-robo /api/webhook` → grava `ativo` em `assinaturas/{uid}` → recursos liberam ou caem para Básico.
- **Desde 23/09/2026 o plano liberado é o da assinatura que foi PAGA**, não o do último clique: o `criar-assinatura` registra plano e período de cada assinatura em `faturamento/{uid}.assinaturasAsaas.{id}`, marca a atual em `asaasSubscriptionId` e cancela a anterior no Asaas. Aviso de vencido/removido de assinatura que não é a atual não derruba o plano. Quem está no **teste grátis** pode assinar: a 1ª cobrança vence no último dia do teste e o plano pago conta a partir do fim do teste.
- **Desde 25/09/2026 (Pacote A):** o vencimento do plano conta a partir da **data de vencimento da cobrança paga** (`dueDate`), não do dia em que o Asaas avisou — quem paga adiantado não perde dias, e um plano pago em dia nunca encurta. O mesmo pagamento não liga o plano duas vezes (confirmado + recebido): o id fica em `faturamento/{uid}.pagosLigados`. Aviso de vencido/removido não derruba quem está no **teste grátis** ativo. Quem assina antes de confirmar o e-mail continua ganhando o teste depois (o `ativar-trial` só considera "já teve teste" quem tem registro de verdade).
- **Desde 25/09/2026 (A2):** só assina quem já **confirmou o e-mail** (o `criar-assinatura` responde 403 `email_nao_confirmado`): confirmado, o teste entra primeiro e a 1ª cobrança vence no fim dele. **Cobrança removida (`PAYMENT_DELETED`) nunca desliga o plano** — cancelar a assinatura no Asaas mantém o plano até o fim do período pago, como dizem os Termos. Vencida (`PAYMENT_OVERDUE`) da assinatura atual continua desligando. **Troca de plano de pagante é pela equipe:** nunca editar o valor da assinatura no Asaas (o robô libera o plano registrado, não o valor novo) — cancelar a atual e o lojista assina a nova.
- **Pedidos e entrega (26/09/2026):** o lojista Premium/Enterprise configura "Sua entrega" (retirada/entrega, bairros com taxa até R$ 200, mínimo, prazo) e move as etapas do pedido pela aba **Pedidos** do painel — tudo pelo robô (`/api/financeiro`, `recebimento/{uid}.entregaCfg`), espelhado em `checkout_publico/{uid}`. A taxa do bairro sai do servidor, nunca do navegador; etapa só anda em pedido pago. O dono pode suspender a entrega de um lojista no painel do dono. Endereço por CEP via ViaCEP (na CSP e na política de privacidade).
- **Estoque do produto e depois da live (30/09/2026, P53, sobre a reserva da oferta `2026-09-30-reserva`):** o lojista informa quantas peças ainda pode vender na sanfona **Estoque** da Central de Pedidos (`loja_estoque` → `estoque/{uid}`, só o robô). Vale para live e cardápio juntos (produto da live = produto do cardápio de mesmo nome). O Pix **reserva** a peça na criação do pedido (`estoque_reservas/{pedidoId}`, até o prazo do Pix + 10 min; 24 h se o comprador tocar em "Já paguei"); pago fecha a reserva, vencido/recusado/cancelado devolve; pago depois de a peça ir para outro marca `alertaEstoque: 'sem_estoque'`. A oferta relâmpago continua com a reserva própria (`oferta_reservas`, 10 min). Espelho público só com os números em `checkout_publico/{uid}.estoque` → "Esgotado"/"Restam N" na live e no cardápio. Venda paga pode ser **desfeita** pelo lojista (`status: 'devolvido'`, motivo, peça volta se ele quiser; o Pix ele devolve pelo banco). Estorno/chargeback devolve a peça (se não entregue), apaga o "comprou" do chat e avisa por e-mail. Freio por negócio conta só pedido criado: 120/h no cardápio, 600/h com live no ar (era 40/h). O quadro lê os pedidos ativos numa escuta própria (`status in [...]`) — a escuta única de 200 pedidos sem ordem escondia pedido pago.
- **Primeira live e ensaio (07/10/2026, P75 fase 1):** no estúdio, quem ainda não fez live (teste grátis com cota sobrando, Premium ou Enterprise) vê **"Fazer um ensaio"**: transmite de verdade, ninguém vê, até 10 min, 5 por dia, não gasta as 2 lives do teste. Caminho: `live.html` → `moviki /api/live` (`iniciar` com `ensaio: true`) → robô `live_reservar`/`live_ensaio_abrir` → sessão em `live_ensaios/{id}`, **nunca** em `live_sessoes` (o WHEP do ensaio não sai para ninguém). Os marcos do lojista ficam em `marcos_lojista/{uid}` (`lib/marcos.js`): primeira live real (avisa o Paulo no Telegram **uma vez**, por transação), primeiro ensaio, nº de ensaios, primeira venda paga na live. No Início do painel, quem pode fazer live e ainda não fez vê o cartão **"Sua primeira live em 3 passos"** (cardápio de exemplo → ensaio → convite no WhatsApp com o link `/live/{slug}`), no lugar dos 3 passos antigos.
- **Teste provisório (14/10/2026):** o teste grátis começa **no cadastro**, mesmo sem confirmar o e-mail. Sem confirmar, o `moviki-robo /api/ativar-trial` grava `assinaturas/{uid}` com `provisorio: true`, `inicioTeste` e 7 dias de `vence_em`: painel, ferramentas do Pró e **ensaio** liberados; **live aberta ao público** (o robô recusa no `live_reservar` com `email_nao_confirmado`, o site e o estúdio mostram "Confirme seu e-mail…") e **assinar** (403 de sempre) só com o e-mail confirmado. Confirmou, o painel chama o robô de novo e o teste vira **30 dias contados do `inicioTeste`** (no mínimo 7 a partir da confirmação), sem `provisorio`, e o e-mail entra em `trials_usados`. O hash do e-mail do provisório vai para `trials_provisorios/{hash}` (nunca apagado): criar conta com o e-mail de outra pessoa não queima os 30 dias dela, e apagar a conta e criar de novo não dá outro provisório. Domínio descartável e e-mail que já usou os 30 dias continuam sem teste. No provisório o robô não manda aviso de fim de teste nem a sequência da primeira live — só os lembretes de confirmar.
- **Cadastro direto, ramo depois (15/10/2026, P82 frente A):** "Quero vender ao vivo" e o link `?criar=1` **sem ramo** vão direto ao formulário de cadastro (1 tela em vez de 3), com a linha "O tipo do seu negócio você escolhe logo depois · escolher agora". Link com ramo (`?ramo=` ou `utm_content`) segue igual (formulário com o ramo marcado). A conta nasce sem `segmento` e sem cardápio de exemplo; ao entrar no painel, conta sem `segmento` vê por cima "Último passo: que tipo de negócio é o seu?" (as telas de ramo do quiz) e o painel grava `segmento`, `segmentoMacro` e o cardápio de exemplo **só se o cardápio estiver vazio** (`mqzPedirRamo` / `mqzSalvarRamo`, sem regra nova). `sign_up`, `cadastro_lojista` e o `Lead` da CAPI continuam no mesmo ponto. Eventos GA4 novos: `quiz_cadastro_direto`, `quiz_ramo_antes`, `ramo_pedido`, `ramo_depois`.
- **E-mail não confirmado (08/10/2026):** o aviso do topo do painel diz o que a confirmação libera (30 dias grátis, 2 lives, ensaio) e o painel percebe a confirmação sozinho quando a pessoa volta para a aba (e a cada 30 s, até 20 vezes), liberando o teste na hora. O funil do dono mostra quantos lembretes de confirmação cada cadastro recebeu.
- **Funil do lojista no painel do dono (07/10/2026):** cartão na Visão geral, alimentado por `moviki-robo /api/funil-dono` (só admin com sessão do Google, 30/h). Semana a semana: cadastro → e-mail confirmado → teste → ensaio → 1ª live (e quantos em até 48 h, meta 30%) → 1ª venda na live → pagante. Lê `avisos_cliente`, `negocios`, `marcos_lojista`, `live_cota`, `live_sessoes`, `assinaturas` e o Auth; e-mail sai mascarado. **Desde 09/10/2026 também por origem** ("De onde vem o lojista": cadastros, teste, 1ª live, live 48 h e pagantes por canal) e cada cadastro da lista mostra o canal e a campanha.
- **Origem do cadastro e aviso com WhatsApp (09/10/2026):** o painel manda ao `moviki-robo /api/novo-cliente`, junto com o clique de anúncio, as UTMs da chegada e o domínio da página anterior (`window.mvAtrib`, guardado na primeira carga da sessão); o robô lê a indicação de parceiro no próprio banco (`indicacoes/{uid}`) e grava **um canal** em `avisos_cliente/{uid}.origem` (`lib/origem.js`, com teste): parceiro > direct do Instagram (`utm_medium=dm`) > direct do TikTok (`utm_source=tiktok&utm_medium=dm`) > anúncio Google (gclid ou google/cpc) > anúncio Meta (fbc ou fonte Meta paga) > anúncio TikTok (`ttclid` ou tiktok pago) > Instagram orgânico > TikTok orgânico > Facebook > WhatsApp > busca > site > sem origem. O aviso de cadastro no Telegram diz a origem e, se o negócio já tiver WhatsApp (o quiz pede; o robô espera até ~4,5 s o `negocios/{uid}` nascer), traz o link `wa.me` com mensagem pronta do Paulo oferecendo ajuda no ensaio da primeira live. O `mvmetrica.js` leva as UTMs do site para o painel também sem clique de anúncio. Política de privacidade itens 2 e 3 (`2026-10-09-origem`).
- **Google dentro do Instagram (09/10/2026):** no navegador do Instagram/Facebook o aviso virou o botão **"Abrir no navegador e entrar com Google"** (`window.mvAbrirNoNavegador`): abre a mesma página no Chrome (Android, `intent://`) ou no Safari (iPhone, `x-safari-https://`) levando ramo, UTMs, clique do anúncio (`mvfbc`/`mvfbp`) e a página anterior (`mvref`); se o aplicativo não deixar sair, em 1,5 s aparece o caminho pelos 3 pontinhos e o "Copiar link". Com o Google o e-mail já vem confirmado e o teste libera na hora — a confirmação de e-mail é onde param 4 de cada 10 cadastros.
- **Cadastro com o ramo do anúncio (07/10/2026):** link com `?criar=1&ramo=<ramo>` (ou `utm_content` com o nome do ramo) cai direto no formulário com o ramo escolhido ("Ramo: … · trocar"); o `mvmetrica.js` do site acrescenta `&ramo=` aos botões de cadastro das páginas `/aovivo` de ramo. Quiz ganhou o grupo "Loja de bairro / Shopping" (9 ramos) e Padaria/Açougue; o apelido do link nasce do nome do negócio (ocupado → número no fim).
- **Visitante** abre `moviki.com.br/{slug}` → `moviki /api/og` monta a página do negócio.
- **Cliente manda mensagem no WhatsApp** → `moviki-ai /api/atendimento` (não sabe quem está falando, só conhece o catálogo). **Teto de 30 mensagens por telefone por dia** (`ATENDIMENTO_LIMITE_DIA` no Vercel). Ao estourar, manda uma vez o caminho humano e fica calado até a virada do dia (UTC).
- **Lojista usa a caixa de mensagens do painel** → `moviki-ai /api/chat` (sabe quem está falando, lê os dados reais da conta). Desde 25/09/2026 só responde conta com cadastro (`negocios/{uid}` ou `parceiros/{uid}`); sem e-mail confirmado, no máximo **5 respostas por dia**; e há um **teto global por dia** para todas as contas somadas (`VIK_TETO_GLOBAL_DIA` na Vercel do `moviki-ai`, padrão 1.500, contador em `vik_reserva/_global`) — ao bater, o Vik para até a virada do dia (UTC) e avisa o Paulo uma vez no Telegram.
- **Pergunta livre no direct do Instagram** (09/10/2026) → ManyChat (bloco External Request da resposta padrão) → `moviki-ai /api/manychat` (cabeçalho `x-moviki-chave` = env `MANYCHAT_CHAVE`; sem a env, stand-by 503 e nada de IA). O Vik responde com o mesmo conhecimento do atendente do WhatsApp mais as regras do direct (`lib/vikDirect.js`, com teste): até 4 frases, sem link, termina no próximo passo, nunca promete venda; não sabe → "uma pessoa responde". Tetos: 12 respostas por contato por dia (`DIRECT_LIMITE_DIA`) e 300 no total (`DIRECT_TETO_GLOBAL_DIA`, aviso único no Telegram); vaga reservada numa transação antes da IA. Guarda só a pergunta e a resposta (sem nome nem @) em `vik_direct/{id do contato}`, apagado 30 dias depois da última mensagem pela política de TTL do Firestore no campo `expiraEm`. Só dentro da janela de 24 h do Instagram.
- **Rotinas de rede social** → `moviki-assistente-social` roda por Actions, lê a vitrine (`moviki.com.br/api/vitrine`), o catálogo do material de apoio (`app.moviki.com.br/material/catalogo.json`) e as peças liberadas dos criadores (`www.moviki.com.br/api/criadores`, GET) e publica.
- **Trava do @ do parceiro (13/10/2026, P80):** `lib/arrobaParceiro.js` no robô. (1) @ **reservado** (plataformas, Moviki, Asaas, bancos e grandes marcas, inclusive com "oficial"/"brasil"/pontos) → o cartão do cadastro não mostra nada e o `novo-parceiro` **recusa na hora** (`status: 'recusado'`, `recusaMotivo: 'arroba_reservado'`, aviso no Telegram). (2) @ com nome de plataforma dentro, conta **verificada** ou com **50 mil+ seguidores** → `arrobaRevisao` e nunca entra na aprovação automática. (3) **Prova de posse:** em Meus dados do `parceiro.html` o parceiro gera um código `MVK-0000` (`POST /api/novo-parceiro?posse=1`, `acao: codigo`; guardado em `ig_posse/{uid}`, vale 48 h), cola na bio do Instagram e confere (`acao: conferir`, busca oficial da Meta sem cache com `biography`); o robô grava `igConfirmado` + `igConfirmadoArroba` (prova vale só para aquele @). **Sem prova:** o @ não vai para `parceiros_publicos` (a `/v/` fica sem @ e sem foto do Instagram), o crachá não usa a foto do Instagram e o cadastro não é aprovado sozinho (nem pela varredura nem pelas aulas). Parceiro **sem @** segue aprovando sozinho. O dono vê "@ provado / sem prova / olhe" no cartão do parceiro, confirma ao aprovar @ sem prova e é travado ao marcar criador sem prova (saída consciente para @ de TikTok/YouTube). A primeira varredura depois do deploy regrava todas as `/v/` e manda ao Telegram a lista de quem precisa de olho (`sistema/arroba_trava_v1`, roda uma vez).
- **Criador** envia peça na **Área do criador** do `parceiro.html` (`criador_pecas` + arquivo em `criadores/{uid}/`) e autoriza → **dono** aprova no menu **Criadores** do `eikoadm01.html` → a peça aparece no `GET /api/criadores` → o robô social publica. O mesmo menu lê as visitas de cada criador no GA4 pelo `POST /api/criadores` (só admin). O criador vê as **próprias** visitas pelo `POST /api/criadores` com `acao: meu_trafego` — o slug sai do registro dele no servidor, nunca do pedido.

### Fronteiras que não se cruzam

- `moviki-robo` = dinheiro. Muda o mínimo possível, de propósito.
- `moviki-ai` = conversa. **Só lê** coleção financeira, nunca escreve. Escreve apenas em `atendimentos_bot/{telefone}`, `vik_direct/{contato}` (direct do Instagram, 09/10/2026) e na mensagem do bot em `conversas/{uid}`.
- `moviki-assistente-social` = publicação. **Não responde** DM nem comentário, **não escreve** no Firestore, e **nunca** recebe chave de service account.

## 6. Endereços no ar

| O que é | Endereço |
|---|---|
| Site público | `moviki.com.br` |
| Painel do lojista | `app.moviki.com.br` |
| Painel do parceiro | `app.moviki.com.br/parceiro.html` |
| Painel do dono (Paulo) | `app.moviki.com.br/eikoadm01.html` |
| Página pública de um negócio | `moviki.com.br/{slug}` |
| Live pública | `moviki.com.br/live/{slug}` e `moviki.com.br/aovivo` |
| Robô de cobrança | `moviki-robo.vercel.app` (sem tela) |

- Rotas públicas do site: `/p/{slug}`, `/pp/{slug}`, `/c/{slug}` (criador), `/v/{slug}`, `/live/{slug}`, `/aovivo`, `/sitemap-negocios.xml`.
- Atalhos para o direct (09/10/2026, redirecionamento no `vercel.json` do site, 2 letras para não colidir com apelido de lojista): `moviki.com.br/tt` → direct do TikTok com o gatilho do link do ManyChat; `moviki.com.br/ig` → `ig.me/m/moviki.oficial?ref=qr`. QR curto para panfleto e cartaz. Trocar o link do ManyChat = trocar o destino no `vercel.json`.
- APIs do site: `/api/og`, `/api/vitrine`, `/api/live`, `/api/sitemap`, `/api/criadores` (22/09/2026), `/api/visita` (07/10/2026, ponte do aviso de visita à Meta).
- APIs novas do robô (07/10/2026): `/api/meta-visita` (visita de quem veio de anúncio da Meta) e `/api/funil-dono` (funil do lojista, só admin).
- API nova do `moviki-ai` (09/10/2026): `/api/manychat` (Vik no direct do Instagram, só o ManyChat chama).
- DNS e e-mail (Titan) na **HostGator**.

## 7. Onde ficam os dados (Firestore)

Projeto Firebase único, compartilhado por todos os repositórios: **`moviki-app`**.

As **regras do Firestore e do Storage** ficam versionadas em `moviki-app/firebase/` (`firestore.rules` e `storage.rules`). Mudança de regra passa por Pull Request ali e só depois é publicada no console do Firebase — guardar o arquivo **não** publica nada. Ver `moviki-app/firebase/LEIA-ME.md`.

| Coleção | Conteúdo | Quem escreve |
|---|---|---|
| `negocios` | Cadastro e vitrine de cada lojista | Lojista (campos limitados) + Admin SDK |
| `assinaturas` | Plano ativo, vencimento | **Só** `moviki-robo` |
| `comissoes` | Comissão de parceiro | **Só** `moviki-robo` |
| `saques` | Pedidos de saque | **Só** `moviki-robo` |
| `parceiros` | Cadastro de parceiro | **Só** `moviki-robo` |
| `pedidos` | Pedidos da live e do cardápio (desde 26/09/2026 com etapas separando/pronto/saiu/entregue, endereço estruturado, taxa de entrega por bairro, número e código de 4 dígitos) | Admin SDK |
| `pedido_seq` | Numeração dos pedidos por lojista (#0001…) | **Só** `moviki-robo` |
| `estoque`, `estoque_reservas` | Estoque por produto e reserva de cada Pix aberto (30/09/2026, P53; sem regra = nega o app) | **Só** `moviki-robo` |
| `oferta_reservas` | Reserva da unidade da oferta relâmpago na geração do Pix (30/09/2026) | **Só** `moviki-robo` |
| `conversas` | Caixa de mensagens do painel | Painel + `moviki-ai` (só a mensagem do bot) |
| `atendimentos_bot` | Conversas do WhatsApp por telefone | **Só** `moviki-ai` |
| `trials_usados`, `trials_provisorios` | Hash do e-mail (com sal) de quem já teve o teste de 30 dias / o teste provisório de 7 dias (14/10/2026). **Nunca apagar** — é o que impede abrir conta nova para ganhar outro teste. Sem regra = nega o app | **Só** `moviki-robo` |
| `avisos_cliente` | Um documento por cadastro de lojista: aviso no Telegram, origem do cadastro (`origem`, desde 09/10/2026) e lembretes de confirmar o e-mail | **Só** `moviki-robo` |
| `vik_direct` | Perguntas e respostas do Vik no direct do Instagram, por contato do ManyChat, e contador global em `_global` (09/10/2026; sem regra = nega o app; TTL de 30 dias em `expiraEm`) | **Só** `moviki-ai` |
| `pontos`, `ponto_slugs`, `slugs` | Pontos de venda e endereços curtos | Admin SDK |
| `admins`, `configuracoes`, `sistema` | Controle interno | Admin SDK |
| `checkout_contas`, `faturamento`, `recebimento` | Cobrança e recebimento | **Só** `moviki-robo` |
| `moderacao`, `liveTermos` | Moderação e aceite de termos da live | Admin SDK |
| `marcos_lojista` | Marcos do lojista: 1ª live real, 1º ensaio, nº de ensaios, 1ª venda paga na live (07/10/2026, P75; sem regra = nega o app) | **Só** `moviki-robo` |
| `live_ensaios` | Sessões de ensaio da live — ninguém assiste, não contam na cota (07/10/2026; sem regra = nega o app) | **Só** `moviki-robo` |
| `ig_posse` | Código da prova de posse do @ do parceiro (`MVK-0000`, 48 h; apagado na prova) — 13/10/2026, P80; sem regra = nega o app | **Só** `moviki-robo` |
| `criador_pecas` | Peças dos influenciadores para as redes do Moviki (regras v27, 22/09/2026) | Criador cria e autoriza/revoga; **só o dono** aprova/recusa/suspende |

- `parceiros/{uid}.igConfirmado`, `igConfirmadoArroba`, `igConfirmadoEm` (prova do @, P80) e `arrobaRevisao` (motivos para o olho do dono) são gravados **só pelo robô**; o `hasOnly` do parceiro não os aceita.
- `parceiros/{uid}.criador == true` marca quem é criador (o dono marca no menu Criadores); só com ela o menu **Área do criador** aparece no painel do parceiro. `parceiros/{uid}.criadorCustoMes` = custo fixo mensal opcional, usado só no cálculo "vale a pena".

## 8. Serviços externos

| Serviço | Para que serve |
|---|---|
| **Firebase** | Auth, Firestore, Storage |
| **Asaas** | Cobrança em produção, webhooks de assinatura |
| **Resend** | E-mails transacionais |
| **Anthropic (Claude)** | Cérebro dos atendentes de IA |
| **WhatsApp Cloud API (Meta)** | Canal do atendente do WhatsApp |
| **Instagram / Facebook (Meta)** | Publicação pelo assistente social |
| **Telegram** | Avisos internos para o Paulo |
| **ManyChat (Pro)** | Respostas automáticas no Instagram `@moviki.oficial` (desde 08/10/2026) e no direct do TikTok `@moviki.oficial` (desde 09/10/2026): comentário/direct/story → link da live de exemplo e do cadastro |
| **Vercel** | Hospedagem e funções |
| **HostGator** | DNS e e-mail |

### Configurações das contas (fora do código) — conferidas com o Paulo em 23/09/2026

- **Contas:** verificação em 2 etapas ativa no Google (`eikosistemas@gmail.com` e `paulorico2030@gmail.com`), no GitHub e na Vercel. A `eikosistemas@gmail.com` é a **chave mestra**: dona do Firebase e login do GitHub e da Vercel.
- **Vercel (equipe `moviki-robo`, Pro):** teto de gasto US$ 50 além do crédito incluído, **só aviso** (pausar projeto tiraria do ar o recebimento do Asaas). Variáveis do robô marcadas como sensíveis (ninguém lê o valor pelo painel).
- **Firebase Auth:** só E-mail/senha e Google ativos (Anônimo desligado — com ele qualquer um passaria nas regras "está logado?"); proteção contra enumeração de e-mails ligada; domínios autorizados = `app.moviki.com.br` + os dois padrão do Firebase (o login só acontece no app). Política de senha: mínimo 6, igual às telas — subir exige mudar as telas junto.
- **Google Cloud (`moviki-app`):** orçamento com aviso em R$ 50/mês (50/90/100/150%). Duas chaves: **Browser key** (Firebase, começa com `AIzaSyAjr0`) — **nunca** restringir por site: o site (`/api/og`, `/api/vitrine`, `/api/sitemap`) e o robô social usam essa chave pelo servidor; e **"Mapa - busca de endereco"** (= `GOOGLE_MAPS_KEY` do robô) travada só na **Places API (New)**, sem restrição de aplicativo (Vercel não tem IP fixo).
- **Anthropic:** workspace **Default = Moviki** (chave `moviki-ai-vercel`); workspace **Zeus** separado (projeto do Paulo fora do Moviki). O Default não aceita teto próprio: a trava é da organização — **US$ 300/mês**, avisos por e-mail em US$ 150 e US$ 250, recarga automática ligada. Motivo: em 23/09 o teste do Zeus zerou o saldo e o Vik e o WhatsApp ficaram mudos.
- **Live (Cloudflare Stream):** aberta a todos. O Stream não tem teto de gasto próprio (o alerta de orçamento da Cloudflare só avisa). A parede é o **teto de minutos do mês** no painel do dono (`configuracoes/liveTermos.tetoMinutosMes`; vazio = sem teto) e a chave-mestra "Desligar todas as lives". Preço: US$ 1 por 1.000 minutos entregues (espectadores × duração).
- **Asaas (produção):** uma chave de API só (`moviki-robo-prod`); webhook **Moviki Robo** com recebida, confirmada, vencida, removida, estornada e **chargeback** (este marcado em 23/09); webhook **Transferências** com done, failed, cancelled e blocked. Lista de IP vazia de propósito (Vercel não tem IP fixo). **Validação de saque via webhook ainda desligada** — habilitar só depois que o robô tiver o endpoint que responde (pacote pendente); habilitar antes trava todos os saques.
- **ManyChat (08/10/2026, ampliado em 09/10):** só o `@moviki.oficial` conectado (a conta do México ficou de fora de propósito). Plano Pro (decisão do Paulo; teste até ~22/10). Tudo no ar:
  - **"Funil LIVE (comentario, direct e story)"** — gatilhos: comentário em qualquer post/reel com live, quero, link, teste, preço/preco (com resposta pública); direct com live, link, teste, quero ver; resposta de story com live, link, quero; post/reel nosso compartilhado no story de alguém; comentário em live do Instagram igual a live, quero ou link. Fluxo: "Quero ver" → pergunta do ramo (11 respostas rápidas gravam o campo `ramo`: moda, calcados, semijoias, pet, acai, confeitaria, suplementos, cosmeticos, bebe, utilidades, outro; o Instagram aceita no máximo 12) → link `www.moviki.com.br/aovivo?…&ramo={ramo}` (tag `clicou_live`) → 3 min depois convite com `app.moviki.com.br/?criar=1&…&ramo={ramo}` (tag `clicou_cadastro`) → 15 min depois de tocar no cadastro, lembrete de **confirmar o e-mail** (spam/Promoções; é o que libera o teste) com botão para o painel; sem clique na live em 15 min, lembrete com os dois botões; sem cadastro em 20 h, "Ficou alguma dúvida?" (Quanto custa? / Como funciona? / Falar com uma pessoa → conversa aberta na caixa do ManyChat, tag `quer_humano`, aviso por e-mail, e botão "Chamar no WhatsApp" para o número do PABX (41) 2018-6848 com texto pronto — o lead que vai para o WhatsApp sai da regra das 24 h do Instagram). `outro` cai na live de moda (chave que o `/aovivo` não conhece).
  - **"Precos e duvidas (direct)"** — direct com preço, preco, valor, quanto custa, planos, mensalidade → texto dos planos + "Criar conta grátis" + "Ver live do meu ramo" (abre o Funil LIVE).
  - **Resposta padrão do direct** (mensagem que nenhuma palavra-chave pega): até o Vik subir, avisa (1 vez a cada 24 h) que uma pessoa responde e oferece "Quero ver" (Funil LIVE) e "Quanto custa?" (Preços). Com o `moviki-ai /api/manychat` no ar e a env `MANYCHAT_CHAVE` criada, passa a chamar o Vik toda vez (seção 5) e mostrar a resposta com "Criar conta grátis", "Ver live do meu ramo" e "Falar com uma pessoa"; se o Vik falhar ou bater o teto, volta a frase "uma pessoa responde".
  - **Link de QR** (09/10/2026): `ig.me/m/moviki.oficial?ref=qr` abre o direct e dispara o Funil LIVE — para panfleto, abordagem na rua e cartaz (QR pronto em PNG). Comentário em **anúncio** não tem gatilho próprio no ManyChat; o anúncio de mensagem abre o direct direto, com as perguntas prontas.
  - **Menção em story** (alguém marca `@moviki.oficial`): agradece e oferece "Quero ver" (Funil LIVE).
  - **TikTok (09/10/2026):** `@moviki.oficial` (conta comercial) conectado ao mesmo ManyChat. O TikTok **não libera gatilho de comentário no Brasil**: a chamada nos vídeos do TikTok é "manda LIVE no direct". Automação **"Funil LIVE TikTok (direct e link)"** com três gatilhos: direct com live, link, teste, quero ver; **link do TikTok** (`tiktok.me/moviki.oficial?ref=…`, para a bio) e **QR code do TikTok** (baixar a imagem no próprio gatilho). Também é a **resposta padrão** do TikTok, e a **boas-vindas** (aprovada pelo TikTok) pede LIVE ou PREÇO. Fluxo: "O que prefere?" → "Ver live funcionando" (texto com o link `www.moviki.com.br/aovivo?utm_source=tiktok&utm_medium=dm&utm_campaign=manda-live` e o do cadastro com as mesmas UTMs, mais o lembrete de confirmar o e-mail) ou "Quanto custa?" (planos e cadastro com `utm_campaign=manda-preco`). Regras do TikTok no ManyChat: **botão não abre site** (o link vai no texto) e **mensagem com botão tem no máximo 40 caracteres**. Sem pergunta de ramo, sem Vik e sem Conversions API no TikTok (o cadastro chega como "Direct do TikTok" no funil do dono). O link do ManyChat está na bio do TikTok e no atalho `moviki.com.br/tt`. **Kit TikTok do dia** (o Paulo posta pelo app): legenda abre com "Manda LIVE no direct…" (`CHAMADA_TIKTOK`) e o vídeo termina na cartela "MANDE LIVE NO DIRECT" com a voz da Malu (`assets/cartela/manda-live.mp3`), montada pelo workflow Metricas e guardada no Release `tiktok-kit` do `moviki-assistente-social` (até 3 novos por rodada, apagados 3 dias depois do dia; `CARTELA_TIKTOK=0` desliga); o painel do dono mostra e baixa a versão com cartela. **Preço novo no robô = mudar também o texto "Quanto custa?" do TikTok.**
  - **Perguntas prontas do direct** (conversation starters): "Quero ver uma live do meu ramo" → Funil LIVE; "Quanto custa o Moviki?" e "Como começo meu teste grátis?" → Preços; "Quero falar com uma pessoa" → resposta padrão.
  - UTMs `utm_source=instagram&utm_medium=dm&utm_campaign=` `comente-live`, `direct-preco` ou `confirmar-email`. Mensagens só dentro da janela de 24 h do Instagram. **Conversions API do ManyChat — LIGADA em 09/10/2026** (permitida pela política `2026-10-09-capi-direct`, item 4: vão só as etapas, sem texto, e-mail, telefone, cookie ou pixel): conjunto de dados **Moviki `2114417739495816`** (portfólio **Moviki App**, o mesmo que o robô usa), ligado ao Instagram @moviki.oficial e à Página Moviki.app pelo assistente "conversas de apps de mensagens" do Gerenciador de Eventos — sem essa ligação o ManyChat responde "Invalid Conversions API credentials". Conectado por "With dataset and token" (token gerado no Gerenciador de Eventos, guardado só no ManyChat). No Funil LIVE: tocar em "Ver live funcionando" manda `ViewContent`; tocar em "Criar conta grátis" manda `LeadSubmitted`. O conjunto de dados `1003679066038534` (também "Moviki", vazio) não é usado.
  - **Campanha de mensagem no Meta (09/10/2026):** "Moviki | Direct Instagram | Conversa LIVE | out-2026" (`120251677272410770`), objetivo engajamento → conversa no direct do Instagram, conjunto `120251677274430770` (Brasil, Advantage+, só Instagram, R$ 12/dia), anúncios DM moda e DM bebê com os vídeos do Material de apoio e 3 perguntas prontas no anúncio ("Quero ver a live da minha loja", "Quanto custa?", "Como começo o teste grátis?") que caem nas palavras-chave do ManyChat. **Trocar a palavra-chave no ManyChat derruba a entrada do anúncio** — conferir as perguntas do anúncio junto. **Preço novo no robô = mudar o texto de "Quanto custa?" (Funil LIVE) e da automação Preços no ManyChat no mesmo dia.** Política de privacidade itens 4 e 7 citam a ferramenta.
- **Medição de anúncios (24/09/2026):** Meta pela Conversions API do robô (sem pixel, sem cookie). **Google Ads sem tag própria:** a propriedade GA4 `G-GG5CSQZVGH` fica vinculada à conta do Google Ads, que importa os eventos principais `sign_up` (navegador, `mvSignup`) e `purchase` (robô, Measurement Protocol — envs `GA_MEASUREMENT_ID` e `GA_API_SECRET`). Sinais de anúncio continuam `denied`; o gclid chega pela URL (`url_passthrough` no `mvmetrica.js`). **Nunca** instalar a tag do Google Ads nem o pixel da Meta sem reescrever a política de privacidade (itens 4 e 10) e trocar o aviso por consentimento com "Aceitar/Recusar".
  - **Visita de quem veio de anúncio da Meta (07/10/2026, P75):** `PageView` (cada página, 1 vez por sessão) e `ViewContent` (clique para abrir o painel) saem do navegador para o **nosso servidor** e de lá para a Meta pela CAPI — continua sem pixel e sem cookie. Só com `fbc` na sessão (visita orgânica não gera nada) e respeitando "Não medir". Caminho: site → `moviki /api/visita` (mesmo domínio, CSP intacto) → `moviki-robo /api/meta-visita`; painel → robô direto. Freio de 60 por hora por `fbc`. Política de privacidade, item 4, atualizada no mesmo pacote.
- **Aviso de medição (LGPD):** barra no rodapé na 1ª visita, com "Ok" e "Não medir" (`mv_medicao` no localStorage de cada domínio; "Não medir" desliga o GA4 e, desde 25/09/2026, o `gtag.js` nem é baixado). Reabre em `moviki.com.br/?medicao=escolher` (link na política). Não aparece no painel do dono nem nas telas de live. No painel do lojista (`app.`) a barra some no primeiro toque fora dela, sem gravar escolha (cobria o botão de cadastro). Mora no `mvmetrica.js`, que é **idêntico** em `moviki` e `moviki-app`.
- **E-mail do domínio:** caixa `suporte@` no Titan (MX `mx1/mx2.titan.email`, DKIM `titan1._domainkey`, SPF na raiz com `spf.titan.email`); envio automático do robô pela Resend (domínio verificado, DKIM `resend._domainkey`, SPF/MX em `send.moviki.com.br`); e-mails do Firebase Auth (confirmar cadastro, esqueci a senha) também saem como @moviki.com.br — SPF com `_spf.firebasemail.com` e DKIM `firebase1`/`firebase2._domainkey` (CNAME). **Nunca apagar esses registros:** sem eles, com o DMARC em quarentena, o e-mail que libera o teste grátis cai no spam. Rastreio de clique da Resend **desligado** de propósito. DMARC em `_dmarc`: sai de `p=none` para `p=quarantine` com relatório para `suporte@` (23/09/2026).

### Variáveis de ambiente (nomes; os valores ficam só na Vercel)

- **NUNCA trocar nem apagar:** `CHECKOUT_CHAVE` (robô) — é dela que sai a chave que cifra a chave Pix, a chave do Asaas e as chaves de subconta dos lojistas; trocada ou apagada, todo recebimento para e não tem volta. `TRIAL_HASH_SAL` (robô) — trocada, reabre o teste grátis para todo e-mail que já usou. Guardar uma cópia das duas fora da Vercel (cofre de senhas).
- **moviki-robo:** `FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_STORAGE_BUCKET`, `ASAAS_API_KEY`, `ASAAS_BASE_URL`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_WEBHOOK_TOKEN_TRANSFER`, `CHECKOUT_CHAVE`, `CHECKOUT_MIN`, `CHECKOUT_MIN_PIX`, `MOVIKI_TAXA_PCT`, `MOVIKI_WALLET_ID`, `TRIAL_HASH_SAL`, `TRIAL_DOMINIOS_BLOQUEADOS`, `CRON_SECRET`, `RESEND_API_KEY`, `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`, `GOOGLE_MAPS_KEY`, `PLACES_TETO_DIA` (padrão 5.000 buscas de endereço por dia, todas as contas somadas), `GA_MEASUREMENT_ID`, `GA_API_SECRET`, `META_PIXEL_ID`, `META_CAPI_TOKEN`, `META_API_VERSION`, `META_TEST_CODE`, `IG_TOKEN`, `IG_USER_ID`, `IG_API_VERSION`, `LIVE_SEGREDO`.
- **moviki (site):** `FIREBASE_SA_LEITURA` (conta de serviço só leitura), `FIREBASE_API_KEY`, `CF_ACCOUNT_ID`, `CF_STREAM_TOKEN`, `LIVE_SEGREDO`, `LIVE_ORIGENS`, `ROBO_URL`, `CRIADORES_SECRET`, `VITRINE_SECRET`, `SEO_SLUGS_FORA`.
- **moviki-ai:** `FIREBASE_SERVICE_ACCOUNT`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_TIMEOUT`, `CHAT_ORIGENS`, `CHAT_LIMITE_DIA`, `VIK_TETO_GLOBAL_DIA`, `ATENDIMENTO_LIMITE_DIA`, `MANYCHAT_CHAVE` (09/10/2026; 16+ caracteres, a mesma colada no cabeçalho do bloco do ManyChat), `DIRECT_LIMITE_DIA`, `DIRECT_TETO_GLOBAL_DIA` (opcionais), `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `TELEGRAM_TOKEN`, `TELEGRAM_CHAT_ID`.
- **Tetos que moram fora do código (conferir antes de anunciar):** busca de endereço com teto do dia no robô (`PLACES_TETO_DIA`, desde 25/09/2026) além do freio de 120/h por conta e `configuracoes/liveTermos.tetoMinutosMes` preenchido no painel do dono (vazio = sem teto de Cloudflare).

## 9. Rotinas automáticas

**Vercel cron (`moviki-robo`):**

- `/api/lembrete-trial` — duas vezes por dia, às 12:00 e às 21:00 UTC (desde 07/10/2026). Além dos avisos de fim de teste e de cobrança, manda a **sequência da primeira live** (P75): no máximo 1 e-mail por rodada, dias 0, 1, 3, 7 e 10 do teste, só enquanto o lojista não fez nenhuma live (`live_cota.usadas` ou `live_sessoes/{uid}`), nunca perto do fim do teste. Descadastro das dicas em 1 clique, sem login (`?parar=uid&t=assinatura`, HMAC do `CRON_SECRET`) → `assinaturas/{uid}.dicasParar`. **Desde 08/10/2026** também: (a) **lembrete de confirmar o e-mail** para quem criou conta e não confirmou — até 2 (a partir de 3 h e de 24 h do cadastro, nunca depois de 7 dias; **desde 14/10/2026** o texto diz que o teste já começou e quando acaba, e há um 3º, só para o teste provisório, a partir do 5º dia), com link novo gerado pelo Admin SDK que volta ao painel com `?confirmado=1`; fonte `avisos_cliente/{uid}`, marca em `avisos_cliente/{uid}.confirmaLembretes`; (b) **novidade do ensaio**, 1 vez na vida, para quem já estava no teste antes de 09/10 ou é Premium/Enterprise e não fez live (`lembretes.novEnsaio`; o `ativ3` da sequência virou o e-mail do ensaio e um exclui o outro); (c) **convite de volta**, 1 vez, para teste vencido há 2 a 45 dias sem plano pago (`lembretes.volta`, live no Premium). (b) e (c) respeitam o descadastro das dicas.
- `/api/webhook-reprocessa` — a cada hora, aos 20 minutos
- `/api/pedidos-confere` — a cada 5 minutos (23/09/2026): confere no Asaas os pedidos "aguardando" dos modos com gateway (conta Asaas do lojista e subconta) das últimas 48 h. Desde 30/09 também vence o Pix direto abandonado (30 min) e devolve ao estoque as reservas vencidas (`varrerReservas`).
- `/api/novo-parceiro?processarPendentes=1` — a cada 5 minutos: aprovação automática de parceiro (só quem já passou dos 10 min de análise, só com a aprovação automática ligada no painel do dono e, desde 13/10/2026, só com o @ provado ou sem @ — P80). Até 23/09/2026 rodava pelo GitHub Actions (`aprovar-parceiros.yml`, apagado) — com o repositório privado, gastaria ~8.600 min/mês da cota de 2.000.

**Plano da Vercel: Pro**, conferido por print em 23/09/2026 (equipe `moviki-robo`, Paulo proprietário). O teto de 12 funções do Hobby não vale mais; o robô tem 22 funções em `/api` (07/10/2026).

**GitHub Actions (`moviki-assistente-social`):** `feed.yml` (seg a sex), `story.yml` (2 por dia, desde 22/09/2026), `reel.yml` (ter e sáb), `metricas.yml` (relatório das redes, triagem do material e Kit TikTok, ~08h e ~22h; desde 09/10/2026 também monta o vídeo do kit com a cartela do direct), `manutencao.yml`. Repositório público: não gasta a cota de minutos do plano gratuito.

Regras da publicação:

- Todo texto passa por `compliance.garantir()` antes de publicar. Sem exceção.
- **Chamada "Comente LIVE" (08/10/2026):** primeira linha de toda legenda de feed e reel no **Instagram** (`config.CHAMADA_COMENTE`, desliga com `CHAMADA_COMENTE=0`); quem comenta cai no fluxo do ManyChat (seção 8). Facebook fica sem (não está ligado ao ManyChat). **Nunca** pôr "comente LIVE" na arte, na narração ou na legenda do Material de apoio: o parceiro posta a mesma peça no perfil dele, onde o comentário não dispara nada.
- **Cartela "Comente LIVE" (09/10/2026, `VERSAO 2026-10-09-cartela`):** todo reel do **Instagram** ganha no fim uma cartela de 1080x1920 com a voz da Malu ("Comenta LIVE aqui embaixo…", `assets/cartela/comente-live.mp3`), montada com ffmpeg no Actions e hospedada como asset da release `cartelas` (apagado depois de publicar); falhou a montagem, sai o reel original. Depois de cada story do Instagram sai um 2º story com a cartela "Responda LIVE". Desligam com `CARTELA_REEL=0` / `CARTELA_STORY=0`. Facebook sem cartela. O Material de apoio continua sem chamada nenhuma.
- Texto reserva é obrigatório e precisa estar limpo. Falha de IA nunca fura o calendário: sai o texto reserva.
- Instagram é prioridade; Facebook é best-effort e nunca derruba o ciclo.
- Imagem não é gerada por IA na hora de publicar. **Desde 22/09/2026 feed, story e reel usam o banco do Material de apoio do parceiro**: `tipo: feed` → feed, `tipo: story` → story, `tipo: video` 9:16 de 3 a 90 s → reel. A peça vai ao ar como está, com a legenda convertida para a voz da marca (sai `#publi`, `{link}` vira link da bio). Peça com "link deste parceiro" impresso ou falado fica fora (`MATERIAL_EXCLUIR` no robô).
- **Reel e story também saem na Página do Facebook** (antes, com `SO_FACEBOOK` ligado, o reel não publicava nada desde 24/08).
- **Brecha dos criadores:** peça de influenciador entra em feed, story e reel quando ele **autoriza** no painel **e** o Moviki **aprova** — as duas chaves, sempre. Fonte desligada até existir o secret `CRIADORES_URL` = `https://www.moviki.com.br/api/criadores` (endpoint pronto em 22/09, conta só leitura). Crédito "Conteúdo de @arroba" obrigatório; até metade dos posts de cada formato. Vídeo de criador: reel 3 a 90 s, **story 3 a 60 s**; autorização vale 12 meses (termo 3.1). Contrato em `moviki-assistente-social/conteudo/CRIADORES-CONTRATO.md`.
- **Material de apoio (24/09/2026):** 92 peças, 16 categorias. No topo do menu do parceiro, três cartões: "Para qualquer negócio", "Panfletos com o seu QR" (panfletos A5) e "Chamar parceiro"; ramo novo "Lojas de shopping" (vídeos de live de moda, calçados/esportes, pet e bebê, feitos com a skill `video-shopping`). Legenda de peça que cita recurso só do Enterprise (Pix dentro da live, oferta relâmpago com contagem, estoque ao vivo, cupom, brinde, cortes) diz que é do Enterprise. Com `LIVE_NA_PAGINA` desligado o robô social só tinha 11 peças de feed, 11 de story e 1 de reel; ligado, 30, 33 e 5. **Antes de editar o `catalogo.json`, partir SEMPRE da versão atual do repositório** — em 24/09 uma edição feita sobre cópia antiga desfez duas correções de legenda (contagem regressiva e estoque ao vivo, que são do Enterprise).
- Calendário do feed: sexta = card de pauta de parceiro; o resto = peça do material. Material fora do ar → card de pauta, o calendário não fura.
- **Peça que vende live só vai para a página oficial com o secret `LIVE_NA_PAGINA` = `1`** (feed, story e reel repassam o secret desde 23/09/2026). A live está **aberta a todos** (lista de liberação vazia), então o secret fica em `1`. Se a live for fechada de novo, apagar o secret.
- **Vitrine de lojista DESLIGADA** (`VITRINE_POR_SEMANA` = 0) enquanto a base real for zero: os negócios com opt-in são contas de teste, e publicá-los é prova social falsa. No primeiro lojista real, criar o secret `VITRINE_POR_SEMANA=1` (1 post por semana).
- Vitrine e card de pauta saem na **moldura padrão Moviki** (marinho, mapa neon, botão verde). A cor do lojista não entra; o banco `assets/fundos` foi aposentado. Conta demo e slug derivado de e-mail nunca entram na vitrine.
- Vídeo não entra no git: asset de release + ponteiro em `conteudo/reels.md`.

## 10. Planos e preços

Tabela `PLANOS` em `moviki-robo/lib/asaas.js`.

| Plano | Mensal | Anual |
|---|---|---|
| Básico | grátis (não passa pelo robô) | — |
| Pró | R$ 39,90 | R$ 399,00 |
| Premium | R$ 69,90 | R$ 699,00 |
| Enterprise | R$ 129,90 (só mensal) | — |

- Ponto extra do Enterprise: R$ 19,90/mês, assinatura separada.
- **Trimestral aposentado em 16/09/2026.** Link antigo com `?periodo=trimestral` cai no mensal; se chegar ao robô, é recusado com 400.

## 11. Como trabalhar com vários repositórios

- O Moviki é **um sistema em várias partes**. Uma alteração pode pegar mais de um repositório.
- Cada repositório tem **seu próprio Pull Request**. Se a alteração pega 3, o Paulo recebe 3 aprovações.
- **Sempre diga ao Paulo a ordem de aprovação** quando um depende do outro, e o que conferir em cada link de teste.
- Ao mexer no contrato entre as partes (nome de campo, endereço de API, formato de resposta), alterar **as duas pontas no mesmo ciclo** e avisar que só funciona depois que as duas subirem.

## 12. Memória compartilhada — Claude Code, Claude do navegador e Obsidian

O Paulo trabalha o Moviki por mais de um caminho: o **Claude Code** (que altera o repositório), o **Claude do navegador** (conversa, com o mapa carregado como conhecimento) e o **Obsidian** (anotações dele). Esses três **não compartilham memória entre si**. Cada conversa nova começa do zero.

Por isso existe uma regra única:

> **O repositório é a única fonte da verdade. Este `CLAUDE.md` é a memória do projeto.**

### O que cada caminho enxerga

| Caminho | Lê este arquivo? | Como |
|---|---|---|
| **Claude Code** | Sim, sozinho | Lê a `CLAUDE.md` do repositório no início de toda sessão |
| **Claude do navegador** | Só se o Paulo conectar o GitHub ao Project, ou subir o arquivo no conhecimento | Precisa ser atualizado quando o arquivo muda |
| **Obsidian** | Sim, nos dois sentidos | O `.bat` leva o `.md` da área de trabalho para o cofre **e** sobe para o `moviki-vault` o que o Paulo escreveu no Obsidian |

### Obrigação ao terminar qualquer alteração relevante

1. **Atualizar a seção correspondente deste `CLAUDE.md`, no mesmo Pull Request da alteração.** Nunca em PR separado — se ficar para depois, não é feito.
2. **Avisar ao Paulo, em uma linha, que o mapa foi atualizado**, para ele saber que precisa refrescar a cópia do Claude do navegador.
3. Se a alteração muda **como o sistema funciona** (e não só um texto ou uma cor), registrar uma linha em **Histórico de decisões**, com a data e o motivo.

### O que conta como "alteração relevante"

- Campo novo ou removido no Firestore
- Endereço de API novo, alterado ou aposentado
- Preço, plano ou regra de cobrança
- Serviço externo entrando ou saindo
- Rotina automática criada, alterada ou desligada
- Fronteira entre repositórios mudando (quem pode escrever onde)

Correção de texto, ajuste visual e conserto de bug que não muda comportamento **não** precisam entrar no mapa.

### Regra para quem for continuar por outro caminho

Antes de confiar em qualquer resumo, **ler este arquivo no repositório, ao vivo**. Índice de Project e memória de conversa antiga ficam desatualizados; o repositório não.

### Como entregar anotação para o Obsidian do Paulo

O Paulo tem, na área de trabalho, o `.bat` **SincronizarVaultMoviki**. Ele pega os `.md` (e `.zip`) da área de trabalho, guarda cada um na pasta certa do cofre **pelo prefixo do nome**, e depois faz commit e push no `moviki-vault`. Então **a forma de alimentar a memória dele é entregar um `.md` pronto no chat** — ele arrasta para a área de trabalho e roda o `.bat`.

É **mão dupla**: o que o Paulo escreve dentro do Obsidian também sobe para o `moviki-vault` quando ele roda o `.bat`. Ou seja, anotação dele chega até aqui na conversa seguinte.

### O prefixo do nome é obrigatório

O `.bat` decide a pasta **pelo começo do nome**. Nome fora do padrão é **ignorado** e fica parado na área de trabalho. O prefixo reservado para o diário do projeto é **`MOVIKI `** (vai para `01-Projetos\Moviki - Diario`).

**Nome do arquivo:** `MOVIKI AAAA-MM-DD - <assunto curto>.md`
(exemplo: `MOVIKI 2026-09-17 - desconto por item.md`)

- Usar **hífen comum** (`-`), nunca travessão (`—`): nome de arquivo no Windows não aceita bem.
- Outros prefixos que o `.bat` conhece: `P..` (projetos), `A.` (áreas), `R` (recursos), `ARQ ` (arquivo), `T-` (templates), `_Indice`, `000 `, `LEIA-ME`, `README`, `Inbox`.
- Para entregar **vários arquivos de uma vez**, mandar um `.zip` já com as pastas dentro (ex.: `01-Projetos\Moviki - Diario\nota.md`). O `.bat` respeita a estrutura do zip e ignora o prefixo.

**Conteúdo:**

```
---
data: AAAA-MM-DD
projeto: Moviki
repos: [moviki-app, moviki-robo]
pr: <link do Pull Request>
tags: [moviki, alteracao]
---

# <Assunto>

## O que mudou
<em linguagem de negócio, o que o lojista/parceiro/Paulo passa a ver>

## Por quê
<o problema que existia, ou o pedido que originou>

## Decisões tomadas
<escolhas que fecham porta: o que passou a ser proibido, o que foi aposentado>

## O que conferir
<o que o Paulo deve testar, e em qual endereço>

## Pendências
<o que ficou para depois, e por quê>

Ver também: [[Moviki - Mapa Mestre]]
```

Regras da nota:

- **Uma nota por alteração**, não uma por dia. Assunto misturado não serve de memória.
- **Linguagem de negócio**, sem código. A nota é para o Paulo reler em três meses, não para um programador.
- **Registrar o porquê, não só o quê.** O "o quê" está no Pull Request; o "por quê" só existe se for escrito.
- Se a alteração **não** entra no mapa (texto, cor, bug sem mudança de comportamento), **não** gera nota. Diário inflado ninguém lê.
- Nunca colocar chave, senha ou token na nota.

## 13. Segurança — situação verificada em 17/09/2026

- ✅ **Nenhuma chave secreta gravada em arquivo** nos 6 repositórios lidos. A única chave presente é a `apiKey` pública do Firebase Web, que é feita para ser pública.
- ✅ Chaves de Asaas, Anthropic, WhatsApp e service account ficam corretamente fora do código.
- ✅ **Conferido em 17/09/2026: a leitura pública de `negocios` não expõe dado sensível.** Os campos legíveis são só de vitrine (nome, recado, cardápio, promoções, eventos, fotos, vídeos, horário, endereço, entrega, preço médio, capa, slug, whatsapp, lat/lng, cor, segmento). Não há CPF, e-mail, senha, dado financeiro nem id interno. O CPF do lojista vai para o Asaas pela API; em `recebimento/{uid}.pix` ficava também o número inteiro (corrigido em 25/09/2026: só a máscara; o campo antigo some quando o lojista salva a chave de novo). Do comprador guarda-se só o final.
- ✅ **App Check (reCAPTCHA v3) está ligado** em todas as páginas que leem dados, o que barra coleta em massa por script.
- ✅ **Coleções financeiras não têm regra** (`faturamento`, `checkout_contas`, `recebimento`, `checkout_tokens`, `financeiro_trilha`, `atendimentos_bot`, `trial_negado`) — sem regra, o Firestore nega por padrão, e não existe curinga global. Só o Admin SDK alcança.
- ✅ **Curinga de `negocios` removido em 17/09/2026 (v26).** Cada subcoleção passou a ter regra própria e explícita. Subcoleção nova agora nasce **negada**, não pública. Ao criar uma, é obrigatório escrever a regra dela.
- ✅ **`hasOnly` voltou a valer.** O curinga anulava o `negocioValido()` — regra do Firestore é aditiva e não tem "deny". Conferido no emulador: gravava-se campo inventado, nome vazio e cor inválida. Corrigido junto.
- ✅ **E-mail do lojista fechado.** `negocios/{uid}/estado/liveAceite` guarda o e-mail e era público pelo curinga. Agora só `estado/live` e `estado/liveSessao` são públicos.
- ✅ **Regras com teste automático** em `moviki-app/firebase/testes/`, contra o emulador oficial do Firebase.
- ✅ **Teto de uso no atendente do WhatsApp** criado em 17/09/2026 (`ATENDIMENTO_LIMITE_DIA`, padrão 30/telefone/dia), com teste automático em `moviki-ai/lib/tetoDia.test.js`.
- ✅ **Regras v28 (23/09/2026):** id de avaliação só no formato do `addDoc` (fecha invasão do painel do lojista por id com apóstrofo), carimbos do filtro do Vik (`botFiltro`, `botFiltroEm`, `botFiltros`) aceitos em `conversas/{uid}` (antes travavam a caixa de mensagens para sempre) e anexo de mensagem só com endereço do Firebase Storage.
- ✅ **Regras v29 (23/09/2026):** cadastro de parceiro só com `criadoEm` = hora do servidor, e o carimbo de treinamento (`aulasEm`) só entra 6 min ou mais depois do cadastro — antes dava para ganhar o selo público pelo F12 no mesmo segundo.
- ✅ **Apelido de parceiro excluído não volta a ficar livre** (23/09/2026): `parceiro_slugs/{slug}` vira lápide `{excluido:true}` sem uid. E indicação gravada antes de o parceiro dono do apelido existir não gera comissão (o webhook compara a hora de criação dos dois documentos no servidor).
- ✅ **Regras v30 (23/09/2026):** fim da lista pública de assinaturas e de indicações; resumo de avaliações amarrado à avaliação nova; nome de parceiro aprovado só a equipe troca.
- ✅ **Regras v31 (25/09/2026):** o lojista só **responde** avaliação (não troca nota, nome nem comentário do cliente; apagar é só da equipe); endereço curto de negócio não nasce por cima de endereço de ponto; cadastro de parceiro só com o apelido que ele mesmo reservou; lista de lojistas bloqueados na live só para o dono; peça de criador só com arquivo do Storage do Moviki, na pasta do próprio criador.
- ⚠️ **Riscos aceitos (23/09/2026):** a conta de serviço de leitura do site enxerga o banco inteiro (o Google não tem permissão por coleção); o selo de treinamento ainda pode ser carimbado pelo navegador depois de 6 min; o endereço do vídeo da live e o cupom são públicos (resolver com URL assinada antes de abrir a live para todos).
- ⚠️ `moviki-vault` é privado e não foi auditado.

## 14. Observações levantadas nesta leitura

1. **`moviki-vault` não foi auditado** (é privado). É o cofre do Obsidian do Paulo: anotações e decisões, não código.
2. **Instruções desatualizadas** nos CLAUDE.md antigos, corrigidas nesta versão:
   - "Retornar apenas código em diff/patch" e "entregar arquivo pronto pra substituir" vinham da época em que o Paulo copiava e colava à mão. **Hoje o Claude Code altera o repositório direto e abre Pull Request** — a entrega é o PR, não o código no chat.
   - "Escrita direta pelo Claude em repositório continua bloqueada (Issue #76248)" **não vale mais**.
   - "Economia drástica de tokens" e "eliminar explicações" conflitava com o fato de o Paulo não ser programador. O que ele precisa é explicação **em linguagem de negócio**, sem código.
3. **`MOVIKI_MAPA_MESTRE.md` é citado pelos repositórios mas não existe em nenhum deles** — vivia num Project do Claude. Este arquivo passa a ser o mapa mestre, dentro do repositório, onde o Claude Code lê sozinho.
4. O comando `/atualizarmapa` dos arquivos antigos foi mantido em espírito: **ao terminar uma alteração relevante, atualizar a seção correspondente deste arquivo no mesmo Pull Request.**

## 15. A equipe — quem cuida de quê

Desde 17/09/2026 o Moviki tem um time de especialistas gravado nos repositórios. Cada cadeira é dona de uma parte da empresa, já sabe as regras da área dela e trabalha sozinha dentro delas. O Paulo convoca pelo nome (`/gabinete`, `/tesouraria`, …), ou pede o que quer e o Gabinete convoca por ele.

| Cadeira | De que cuida | Onde mora |
|---|---|---|
| **Gabinete** | Coordenação, memória, mapa mestre, ordem de aprovação dos Pull Requests | Nos cinco repositórios de código |
| **Guarda** | Segurança, regras do Firestore e do Storage, LGPD, segredos | Nos cinco (com veto em todos) |
| **Tesouraria** | Dinheiro: assinatura, Asaas, webhook, comissão, saque, preço | `moviki-robo` |
| **Vitrine** | Site público, página de cada negócio, live pública, SEO, termos | `moviki` |
| **Balcão** | Painel do lojista, live do lojista, videoaulas, painel do dono | `moviki-app` |
| **Canal** | Parceiros: recrutamento, painel, material de apoio, treinamento | `moviki-app` |
| **Atendimento** | Atendentes de IA do WhatsApp e da caixa do painel | `moviki-ai` |
| **Praça** | Publicação no Instagram e no Facebook, calendário, compliance | `moviki-assistente-social` |

Como o time funciona:

- **Cada cadeira mora no repositório que governa.** Quem abre uma sessão no `moviki-robo` já recebe a Tesouraria sabendo as regras do dinheiro, sem precisar explicar nada.
- **Gabinete e Guarda moram em todos**, porque coordenação e vazamento não respeitam fronteira de repositório. Por isso entram na regra de sincronização do topo deste arquivo.
- **Toda cadeira tem escrito o que decide sozinha e o que sobe para o Paulo.** Ordem direta dele vence a regra da cadeira; quando a ordem colide com dinheiro ou segurança, a cadeira explica o risco em uma frase, pede confirmação e registra no histórico que foi decisão consciente.
- **A skill `material-de-apoio` continua existindo** como ferramenta do Canal para a aba de artes do parceiro.
- **Cadeira parada 60 dias** o Gabinete traz para revisão: ou ganha trabalho recorrente, ou é fundida com outra. Especialista que ninguém chama vira arquivo morto e polui toda sessão.
- **Criar, fundir ou aposentar cadeira é decisão do Paulo.**

## 16. Histórico de decisões

- 15/10/2026: **P82 frente A — cadastro primeiro, ramo depois.** No GA4 de 01 a 15/10, 38 pessoas entraram no quiz e só 8 criaram conta (21%): cada tela antes da conta é um ponto de desistência. Ideia do Paulo: deixar a pessoa criar a conta direto e escolher o ramo já dentro do painel. O ramo continua obrigatório para o cardápio de exemplo, mas deixou de travar a conta. Contas antigas sem ramo também veem a tela uma vez.
- 14/10/2026: **o teste grátis começa no cadastro, antes de confirmar o e-mail.** A confirmação era onde paravam 4 de cada 10 cadastros, e quem parava saía sem nunca ver o painel funcionando. Agora, sem confirmar, o lojista ganha 7 dias de teste (painel e ensaio, sem live aberta ao público e sem assinar); confirmando, fica com os 30 dias contados do cadastro. O teste provisório não queima o teste de quem é dono de verdade do e-mail e não se repete apagando a conta. Decisão do Paulo em 09/10 ("autorizo levar a confirmação para depois do início do teste"), montado em 14/10 ("monte pode montar").
- 13/10/2026: **P80 — trava do @ do parceiro.** Em 12/10 um parceiro entrou pela página dos criadores com o @ "TikTok": o @tiktok existe no Instagram como conta verificada, e o robô gravava foto, seguidores e selo no cadastro de quem só digitou o nome — e isso ia para o crachá e para a `/v/`, a credencial que o lojista usa para confiar. Entraram: @ reservado recusado na hora, conta verificada/grande/com nome de plataforma sempre com o dono, e prova de posse pelo código na bio. Decisão do Paulo: a prova é obrigatória **só para a aprovação automática e para marcar criador**; quem não prova cai na análise manual. O Paulo recusou o cadastro "TikTok" à mão em 12/10.
- 09/10/2026 (tarde, 2ª parte): **os vídeos do TikTok passam a pedir o direct.** O funil do TikTok estava no ar, mas o Kit TikTok do dia terminava em "link da bio" e a voz da cartela do Instagram ("comenta LIVE") não serve lá — comentário não dispara nada no Brasil. Entraram: chamada do direct na 1ª linha da legenda do kit, cartela "MANDE LIVE NO DIRECT" com voz própria no fim do vídeo do kit, e os atalhos `moviki.com.br/tt` e `/ig` (QR curto). Pedido do Paulo: "pode fazer o 1 e 2" (ele já pôs o link do ManyChat na bio do TikTok).
- 09/10/2026 (tarde): **TikTok entra no funil.** `@moviki.oficial` do TikTok conectado ao ManyChat (direct, link da bio e QR), com o canal "Direct do TikTok", "Anúncio TikTok" e "TikTok (orgânico)" na origem do cadastro, o botão "Abrir no navegador" também no navegador do TikTok (no iPhone ele não se identifica como TikTok e o Google recusava o login) e a política de privacidade (item 4) citando o TikTok. Pedido do Paulo: funil do TikTok, que o outro chat não conseguiu acessar.
- 09/10/2026: **cada cadastro passa a dizer de onde veio, e o Paulo recebe o WhatsApp do lojista na hora.** Com direct do Instagram, anúncio Meta, anúncio Google, QR e parceiros rodando juntos, o funil só sabia "anúncio" ou "orgânico" — a verba de R$ 33/dia era dividida no escuro. Agora o funil do dono mostra cadastro → teste → 1ª live → pagante por canal, e o aviso no Telegram traz a origem e o link do WhatsApp com mensagem pronta (com ~3 cadastros a cada 11 dias, o contato do fundador nas primeiras horas é o que mais leva à primeira live). No mesmo pacote, quem cai no navegador do Instagram ganha o botão "Abrir no navegador e entrar com Google", porque o caminho do e-mail é onde param 4 de cada 10. Pedido do Paulo: "sim" à lista de 09/10 (itens 1, 2 e 3).
- 09/10/2026: **o lead do direct não espera mais o Paulo.** Pergunta livre no direct do Instagram passa a ser respondida pelo Vik na hora (`moviki-ai /api/manychat`, tetos por contato e global, dados apagados em 30 dias, política de privacidade itens 4 e 7 no mesmo ciclo); link de QR `?ref=qr` para panfleto e rua; botão "Chamar no WhatsApp" no pedido de falar com uma pessoa. Remarketing de quem conversou no direct: público a criar no Gerenciador de Anúncios (pede login do Facebook do Paulo) e anúncio só quando o público passar de ~1.000 pessoas — abaixo disso a Meta quase não entrega e a verba sai do anúncio que traz gente nova. Depois das 24 h a Meta proíbe mensagem automática no Instagram; o que segura o lead fora da janela é o WhatsApp (decisão humana) e o anúncio de remarketing. Pedido do Paulo: "Construa tudo."
- 09/10/2026 (madrugada): **mídia paga passa a abrir conversa no direct.** Decisão do Paulo: campanha de mensagem já, sem esperar 12/10, dentro dos R$ 33/dia — Meta cadastro R$ 21 → R$ 13, ThruPlay pausado (R$ 5,30 → 0), mensagem R$ 12, Google R$ 8 sem mudança. Motivo: em 30/09 ele recusou anúncio de conversa por não ter braço para atender; com o ManyChat atendendo sozinho, o motivo caiu. Política de privacidade (item 4) passou a permitir a medição das etapas da conversa.
- 09/10/2026: **o direct do Instagram deixa de ter beco sem saída.** Além do Funil LIVE, entraram: resposta automática de preço, resposta padrão para qualquer mensagem, agradecimento a quem marca o Moviki no story, quatro perguntas prontas no direct, gatilhos de compartilhamento no story e de comentário em live, mais 3 ramos (cosméticos, bebê, casa) e o lembrete de confirmar o e-mail 15 min depois do clique no cadastro — o funil do dono mostrou que 4 em cada 10 cadastros param na confirmação. No robô social, cartela falada "Comente LIVE" no fim dos reels e story extra "Responda LIVE" (só Instagram). Pedido do Paulo: "não deixar brecha nenhuma para o lead escapar".
- 08/10/2026: **ManyChat entra como canal de conversão do Instagram.** Quem comenta, manda direct ou responde story com "LIVE" recebe em segundos o link da live de exemplo do ramo dele e o cadastro já com o ramo marcado — antes, comentário e direct dependiam do Paulo responder à mão, e o lead esfriava. Decisão do Paulo: plano Pro como custo fixo. Política de privacidade atualizada no mesmo pacote (itens 4 e 7).
- 08/10/2026: **P75 — o e-mail de confirmação deixa de ser beco sem saída.** O cartão do funil, no primeiro dia no ar, mostrou que 4 de cada 10 cadastros param antes de confirmar o e-mail — e quem não confirma não entra no teste, não tem `assinaturas/{uid}` e nunca recebia e-mail nenhum. Entraram: até 2 lembretes de confirmação com link novo, aviso do painel dizendo o que se libera e detecção automática da confirmação, e-mail único da novidade do ensaio para quem já estava dentro e convite de volta para teste vencido. Decisão do Paulo: manter a confirmação obrigatória (liberar o teste sem ela reabriria conta descartável no teste e no Vik).
- 07/10/2026: **P75, fase 1 — o lojista é levado até a primeira live.** Entraram: live de **ensaio** (ninguém vê, não gasta as 2 lives do teste — o medo da primeira live era a trava), cartão "Sua primeira live em 3 passos" no Início, marcos do lojista (`marcos_lojista`) com aviso no Telegram na primeira live real, cartão **Funil do lojista** no painel do dono (métrica-norte: 1ª live em até 48 h do cadastro, meta 30%), cadastro que já chega com o ramo do anúncio (2 telas a menos) com o grupo "Loja de bairro / Shopping" e apelido automático, e a barra de medição que não cobre mais o cadastro no app. Motivo: 141 visitas → 3 cadastros em 11 dias; o vazamento está entre o clique e a primeira live, não no anúncio.
- 07/10/2026: **P75, fase 0 — o funil passa a terminar na primeira live.** Estudo de 26 funis dos EUA mostrou que o vazamento do Moviki está depois do clique (141 visitas → 40 cliques no painel → 3 cadastros em 11 dias) e que o robô nunca levava o lojista à live, só pedia pagamento. Entraram: e-mails da primeira live com descadastro em 1 clique, e-mails de fim de teste dizendo que a live continua no **Premium** (o Pró não tem live), e o aviso de visita à Meta pelo servidor para dar sinal ao algoritmo, que via 2 páginas abertas em 41 cliques. O pedido era "pixel no navegador"; foi feito pelo servidor porque o pixel quebraria a política de privacidade publicada.

- 30/09/2026: **P53 — estoque do produto e o depois da live** (montado sobre a reserva da oferta do mesmo dia). Estoque único por produto (live + cardápio), reserva no Pix com devolução automática, desfazer venda paga, estorno com aviso, freio por negócio de 40/h para 120/h (cardápio) e 600/h (live), quadro de pedidos com escuta dos ativos, `RECEIVED_IN_CASH` como confirmação do lojista. Motivo: o problema da live não é vender, é despachar — e o sistema vendia peça que não existia, travava a live boa no 41º comprador e escondia pedido pago.

- 16/09/2026: plano trimestral aposentado.
- 17/09/2026: `moviki-ai` separado do `moviki-robo` para isolar o teto de 12 funções do plano Hobby e proteger o robô do dinheiro.
- 17/09/2026: mapa mestre trazido para dentro dos repositórios como `CLAUDE.md`, passando a ser a memória oficial do projeto.
- 17/09/2026: `moviki-platform` autorizado a ser apagado pelo Paulo — estava vazio, nunca foi usado.
- 17/09/2026: definido o formato da nota de diário entregue ao Obsidian (seção 12), com o prefixo `MOVIKI ` que o `.bat` reconhece.
- 17/09/2026: `.bat` de sincronização corrigido — passou a trazer do GitHub antes de enviar, e a subir também o que o Paulo escreve dentro do Obsidian. Antes, anotação feita direto no Obsidian nunca saía do computador.
- 17/09/2026: regras do Firestore e do Storage trazidas para dentro do repositório (`moviki-app/firebase/`). Antes viviam só no console do Firebase: sem revisão, sem histórico e sem como voltar de uma alteração feita por engano.
- 17/09/2026: curinga `match /{documento=**}` removido de `negocios/{uid}` (regras v26). Ele anulava em silêncio o `hasOnly` do cadastro, deixava público o e-mail do lojista em `estado/liveAceite`, e faria qualquer subcoleção futura nascer pública. Regras passaram a ter teste automático.
- 17/09/2026: teto de uso criado no atendente do WhatsApp. Ele falava com desconhecido sem limite nenhum, e cada mensagem é uma chamada paga à Anthropic — a assinatura da Meta barra chamada forjada, não pessoa real insistindo.
- 17/09/2026: videoaulas — a biblioteca "Aulas da live" deixou de ser repintada por cima do vídeo que está tocando (era isso que fazia a aula cortar sozinha perto do fim), e as aulas da live passaram a medir **caminho percorrido** em vez de posição da agulha, como o painel do lojista e o do parceiro já faziam desde 15/09. Arrastar o vídeo até o fim deixou de marcar a aula como assistida; o quanto falta passou a aparecer numa barra, porque trava sem medidor visível vira reclamação. O progresso de cada aula agora sobrevive a fechar e recarregar a página (fica no navegador, por conta, nunca no banco).
- 17/09/2026: mapa mantido em **cópia completa nos seis repositórios**, com regra explícita de sincronização no topo deste arquivo. Cogitou-se centralizar numa cópia só, com ponteiro nas outras; descartado porque obrigaria a pedir anexo do `moviki-app` em toda sessão iniciada em outro repositório — fricção permanente para resolver um problema que é de disciplina de quem edita, não de estrutura.
- 17/09/2026: mapa divergiu pela **terceira vez** — a linha das videoaulas existia só na cópia do `moviki-app`. Corrigido, e a conferência das seis cópias deixou de ser disciplina de quem edita: virou a primeira tarefa do Gabinete em toda sessão. Regra sem dono é regra que volta a quebrar.
- 17/09/2026: **equipe de especialistas criada** — oito cadeiras, cada uma dona de uma parte da empresa, gravadas dentro dos repositórios. Antes, toda sessão começava sem saber as regras da área que ia mexer, e o Paulo era o único ponto de memória do negócio. O time nasceu completo por decisão dele, contra a recomendação de começar com três: fica valendo a revisão aos 60 dias para a cadeira que não tiver uso.
- 22/09/2026: **feed padronizado sobre o Material de apoio.** Os posts saíam cada um de um jeito: fundo de foto sem relação com o negócio, etiqueta na cor do lojista, frase escrita por cima do rosto da pessoa. Além disso foram ao ar o e-mail de um lojista como link (slug derivado de e-mail), a conta demo como se fosse negócio real, UF errada ("Curitiba - PA") e "TÁ ABERTO AGORA" sem o robô saber se estava aberto. Agora o feed publica as peças do material, a vitrine tem moldura única e teto semanal — **desligada até o primeiro lojista real**, porque os negócios com opt-in eram todos contas de teste — e esses quatro erros estão barrados com teste. No mesmo dia: story diário, reel também na Página do Facebook (estava parado desde 24/08 por um "exclusivo do Instagram" que não era verdade) e a brecha para peças de criadores com duas chaves — autorização dele e aprovação do Moviki.
- 22/09/2026: **menu Criadores no painel do dono** — fila de aprovação (a segunda chave: o criador autoriza, o dono aprova, suspende ou recusa com motivo) e desempenho por criador: visitas pelos links /c/ e /p/ (GA4), cadastros, pagantes, receita líquida estimada (mensalidade − 6% − R$ 2), custo (comissões, bônus e custo fixo opcional), resultado e posts nas nossas redes. Coleção `criador_pecas` com regras v27 e pasta `criadores/{uid}/` no Storage. Endpoint `/api/criadores` no site: GET para o robô (só peça com as duas chaves, de criador aprovado e marcado), POST de tráfego só para admin. Motivo: decidir com número, criador por criador, se a parceria se paga.
- 23/09/2026: **auditoria pré-divulgação — 5 bloqueios corrigidos.** (1) Quem estava no teste grátis não conseguia pagar: o robô respondia "você já tem um plano ativo". (2) Cada clique em Assinar criava uma assinatura nova no Asaas sem cancelar a anterior; a abandonada vencia e derrubava quem tinha pago, e o plano liberado era o do último clique (pagar o Pró dava Premium anual). Agora o plano sai da assinatura paga e a anterior é cancelada. (3) Um visitante anônimo conseguia rodar código no painel do lojista por uma avaliação com id montado; variante no painel do dono pelos anexos. (4) A caixa de mensagens morria depois que o filtro do Vik barrava duas respostas (regras v28). (5) O teste grátis de quem confirma o e-mail só entrava até 1h depois; agora entra no clique em "Já confirmei". No mesmo pacote: consulta ao Asaas que falha na hora passou a ser reprocessada (antes o pagamento era dado como tratado e o plano nunca ligava) e o token de transferência deixou de alcançar assinatura. Motivo: tudo isso atinge exatamente quem chega pelo anúncio.
- 23/09/2026: **varredura de segurança (defensiva).** Regras v30: `assinaturas` só se LISTA como admin (ler um documento continua público); `indicacoes` deixou de ser pública (dono, admin e o parceiro dono do apelido); avaliação com data do servidor e o resumo só sobe +1 junto com a avaliação nova (`ultimaAv`); nome do parceiro travado depois de aprovado. Painel do dono carrega o Leaflet de `moviki-app/vendor/leaflet-1.9.4/` (não mais do unpkg) e tirou o unpkg da CSP. Freio por conta (`lib/freio.js`, coleção `freio/`): 120 buscas de endereço/h, 60 uploads/h, 20 trocas de foto de parceiro/h; upload confere os bytes (JPEG/PNG/WebP). Vik reserva a vaga numa transação (`vik_reserva/{uid}`) antes de chamar a Anthropic. `CRON_SECRET` só no cabeçalho; token antigo de webhook das subcontas deixou de valer; token do Facebook mascarado no log público. Troca de foto de parceiro aprovado avisa o dono no Telegram.
- 23/09/2026: **terceira rodada da auditoria.** (1) Saque na mão só fecha com o valor LIBERADO calculado pelo robô, confirmado pelo dono — o pedido é gravado pelo próprio parceiro e o card mostrava esse número (dava para forjar R$ 4.900 com R$ 30 liberados); o card agora mostra "Pedido" e "Liberado de verdade". (2) Painel do dono só conta como pagante quem tem plano ativo, em dia e fora do teste; anual entra /12; teste aparece como "Teste grátis". (3) Pro pago durante o teste segue com os limites de live DO TESTE até o fim dele (antes ganhava limites de Premium). (4) Pagamento de assinatura antiga vira a assinatura atual e a outra, sem pagamento, é cancelada — antes o vencimento da outra derrubava o plano pago. (5) Reembolso de pagamento feito no teste devolve o lojista ao teste até o fim dele. (6) Erro de rede no Pix do saque não diz mais "nenhum valor saiu". (7) Vik: teste grátis tem live, pode assinar durante o teste, cancelamento é pela equipe (não existe botão), plano vencido não aparece como ativo. (8) Regulamento 5.2 alinhado ao painel: retenção de 7 dias e Pix em até 1 dia útil após o pedido; aceite gravado passa a ser 1.2. (9) Exclusão apaga criadores/, capas/, criador_pecas e os comprovantes Pix; comprovante com mais de 90 dias é apagado todo dia (06:00 UTC, dentro do cron de pedidos). (10) Robô social não publica peça que vende live enquanto o secret `LIVE_NA_PAGINA` não for "1". Também: pautas sem "garantia/sem risco" e com "enquanto pagarem", fila de reprocessamento marca 'desistido', e-mail de pago não duplica.
- 23/09/2026: **segunda rodada da auditoria — 8 correções.** (1) Suspender ou recusar parceiro passou a derrubar o crachá público /v/ na hora (antes seguia "Parceiro autorizado"). (2) Apelido de parceiro excluído não é reaproveitado, e indicação anterior ao parceiro não gera comissão — antes quem registrasse o apelido herdava a carteira. (3) WhatsApp com +55 não quebra mais o botão da página pública. (4) Pedido do modo "Pix automático pelo Asaas" é conferido sozinho a cada 5 min (novo cron) e ganhou botão "Conferir no Asaas" — antes ficava "aguardando" para sempre se o comprador fechasse a página. (5) Parceiro que também é lojista sem plano pago vê aviso no painel; regulamento 1.2 ganhou as cláusulas 2.4 e 3.5. (6) Quem paga durante o teste grátis mantém fotos, vídeos e live do teste até o fim dele (campo `testeAte` em `assinaturas/{uid}`). (7) Selo de treinamento não se forja mais no mesmo segundo do cadastro (regras v29). (8) Trava contra dois cliques em Assinar, e a exclusão de conta cancela todas as assinaturas registradas no Asaas.
- 23/09/2026: **Vercel Pro confirmado** (print da conta). Endpoint novo no robô pode ser criado sem medo do teto do Hobby.
- 25/09/2026: **Pacote A (antes de anunciar para lojistas).** (1) Plano pago conta da data de vencimento da cobrança paga, o mesmo pagamento não liga o plano duas vezes, e vencido/removido não derruba teste grátis ativo. (2) Assinar antes de confirmar o e-mail não queima mais o teste grátis. (3) Vik só para conta com cadastro, 5 respostas/dia sem e-mail confirmado e teto global diário com aviso no Telegram — conta descartável esgotava a verba da Anthropic. (4) Regras v31 (seção 13). (5) Página `/aovivo` dizia que a live começava no Pró e que o cliente "compra ali mesmo": corrigido para Premium, com o Pix na live como Enterprise e o pacote de minutos do mês. (6) Tela Meu Plano mostra, antes de pagar, que o plano renova sozinho, o canal de cancelamento (WhatsApp e e-mail) e os 7 dias para desistir contados do primeiro pagamento, com a caixa "Li e aceito os Termos"; Termos (cláusula 5) e FAQ do site alinhados. (7) "Não medir" não baixa mais o `gtag.js`. (8) Página pública do negócio carrega o mapa de `moviki/vendor/leaflet-1.9.4/` (sem unpkg). Motivo: tudo isso atinge quem chega pelo anúncio ou é regra de anúncio da Meta/Google. Fica para o **Pacote B**, antes do primeiro saque de parceiro: comissão de cartão liberada antes do dinheiro compensar, corrida de dois saques, pontos extras não cancelados na exclusão e outros ajustes do robô do dinheiro.
- 26/09/2026: **Pedidos com entrega** (outro chat): Central de Pedidos no painel, etapas, taxa por bairro, comanda, número do pedido, e **retenção LGPD dos dados do comprador** (WhatsApp, sobrenome e endereço apagados 90 dias depois da entrega, 180 se pago sem entrega registrada, 15 se nunca pago — varredura dentro do cron `pedidos-confere`, `apagarDadosEm`); Vik atualizado. O Pacote A2 foi remontado por cima dessas versões (marca do lojista `2026-09-26-a2` sobre a `2026-09-26-dados`, catálogo do Vik `2026-09-26-9`, que também trocou o exemplo "Dipirona" da lista de separação — remédio é produto proibido na live).
- 25/09/2026: **Pacote A2 (varredura de conferência do Pacote A).** (1) O painel só pedia o teste grátis quando não havia NENHUM registro em `assinaturas/{uid}` — quem clicava em Assinar antes de confirmar o e-mail ficava no Básico para sempre; agora pede sempre que não houver teste/plano de verdade, e o robô só assina com e-mail confirmado. (2) Cancelar no Asaas cortava o plano na hora (cobrança removida desligava), contra os Termos publicados no Pacote A. (3) Home, comerciantes e aovivo ainda prometiam Pix/compra dentro da live para todos. (4) No navegador do Instagram/Facebook o Google recusa login: o botão some e aparece o caminho por e-mail. (5) Linha dos Termos/Privacidade no cadastro do lojista. (6) Premium dizia que a troca de plano era pelo painel; e-mail do fim do teste dizia que o lojista perderia o lugar no mapa. (7) Busca de endereço com teto do dia para todas as contas (`PLACES_TETO_DIA`). (8) Página pública lê no máximo 50 avaliações quando o negócio não tem resumo. (9) CPF do lojista deixou de ser gravado inteiro. Motivo: tudo atinge quem chega pelo anúncio da Meta.
- 25/09/2026: **pendência 12 — contas de teste: decisão do Paulo de MANTER.** Ficam no ar as contas Fábio Suplementos, Caldeirão Nordestino e Hamburguer Master e os 4 posts delas na Página do Facebook (11, 14, 15 e 16/09). Consequências aceitas: se forem contas de teste, os posts contam como prova social na Página, e contas com plano pago de teste entram em "Lojistas pagantes" e na receita do painel do dono (descontar de cabeça). `VITRINE_POR_SEMANA` continua 0; antes de ligar a vitrine no primeiro lojista real, pôr os apelidos de teste em `VITRINE_EXCLUIR` (GitHub) e `SEO_SLUGS_FORA` (Vercel do site, com redeploy). **Com isso as 12 pendências de configuração pré-divulgação estão fechadas.** Ficam para pacotes de código: validação de saque via webhook do Asaas, URL assinada do vídeo e do cupom da live, cancelamento pelo próprio lojista.
- 24/09/2026: **pendência 11 — Google Ads e aviso de medição.** Decisão do Paulo: Google Ads medido **sem cookie de anúncio**, importando do GA4 o cadastro e a assinatura — mantém a promessa pública de "nenhum cookie de publicidade". Entrou o aviso de medição com "Não medir" e a política de privacidade foi atualizada (itens 4 e 10). Motivo: anunciar no Google sem medir conversão queima verba no escuro; e a política dizia que o Google Analytics não servia a anúncio.
- 24/09/2026: **pendência 10 fechada (live aberta).** O mapa dizia "live em beta fechado", mas a lista de liberação estava vazia havia tempo — e o robô social barrava toda peça que vende live (os workflows nem repassavam o secret `LIVE_NA_PAGINA`). Workflows corrigidos e secret `1`. Material novo do dia conferido contra o robô social e contra o Vik: duas legendas prometiam recurso do Enterprise como se fosse de todos ("oferta com contagem regressiva", "estoque ao vivo") e foram corrigidas; o Vik ganhou o menu novo do material (catálogo `2026-09-24-1`). Teto de minutos de vídeo da live definido no painel do dono.
- 23/09/2026: **segunda leva de configurações fora do código:** login do Firebase só com e-mail/senha e Google, proteção contra enumeração de e-mail e `localhost` fora dos domínios autorizados; chave do mapa travada só na Places API (New); Anthropic com o Zeus em workspace próprio, trava de US$ 300/mês na organização e recarga automática (o teste do Zeus tinha zerado o saldo e derrubado o Vik); DMARC do domínio em quarentena. Detalhes em "Configurações das contas" (seção 8).
- 23/09/2026: **configurações fora do código fechadas com o Paulo:** regras v30 publicadas; env `ASAAS_WEBHOOK_TOKEN_PEDIDOS` apagada na Vercel; teto de gasto da Vercel em US$ 50 além do crédito incluído, só com aviso (sem pausar projeto — pausar tira do ar o recebimento do Asaas); verificação em 2 etapas conferida na Vercel, no GitHub e nas duas contas Google (a `eikosistemas@gmail.com` é a dona do Firebase e o login do GitHub e da Vercel). A aprovação automática de parceiro saiu do GitHub Actions para o cron da Vercel, e `moviki-robo`, `moviki-app` e `moviki-ai` passaram a privados — código do dinheiro e das regras fora da vista de quem procura brecha.
- 22/09/2026: **Área do criador no painel do parceiro** — o influenciador marcado envia a peça (feed, story ou reel) com a mesma checagem do robô antes de subir (proporção, resolução, duração, peso, termos proibidos na legenda), marca ou revoga a autorização para as redes do Moviki, apaga peça e arquivo, e vê os próprios resultados: visitas por dia e por canal (`?canal=`), cadastros, pagantes, comissões e posts nas nossas redes. Motivo: o criador sabe o que aconteceu com cada peça sem pedir ao dono, e a peça já chega no formato que o robô publica.
