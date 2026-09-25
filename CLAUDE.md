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
- **Visitante** abre `moviki.com.br/{slug}` → `moviki /api/og` monta a página do negócio.
- **Cliente manda mensagem no WhatsApp** → `moviki-ai /api/atendimento` (não sabe quem está falando, só conhece o catálogo). **Teto de 30 mensagens por telefone por dia** (`ATENDIMENTO_LIMITE_DIA` no Vercel). Ao estourar, manda uma vez o caminho humano e fica calado até a virada do dia (UTC).
- **Lojista usa a caixa de mensagens do painel** → `moviki-ai /api/chat` (sabe quem está falando, lê os dados reais da conta).
- **Rotinas de rede social** → `moviki-assistente-social` roda por Actions, lê a vitrine (`moviki.com.br/api/vitrine`), o catálogo do material de apoio (`app.moviki.com.br/material/catalogo.json`) e as peças liberadas dos criadores (`www.moviki.com.br/api/criadores`, GET) e publica.
- **Criador** envia peça na **Área do criador** do `parceiro.html` (`criador_pecas` + arquivo em `criadores/{uid}/`) e autoriza → **dono** aprova no menu **Criadores** do `eikoadm01.html` → a peça aparece no `GET /api/criadores` → o robô social publica. O mesmo menu lê as visitas de cada criador no GA4 pelo `POST /api/criadores` (só admin). O criador vê as **próprias** visitas pelo `POST /api/criadores` com `acao: meu_trafego` — o slug sai do registro dele no servidor, nunca do pedido.

### Fronteiras que não se cruzam

- `moviki-robo` = dinheiro. Muda o mínimo possível, de propósito.
- `moviki-ai` = conversa. **Só lê** coleção financeira, nunca escreve. Escreve apenas em `atendimentos_bot/{telefone}` e na mensagem do bot em `conversas/{uid}`.
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
- APIs do site: `/api/og`, `/api/vitrine`, `/api/live`, `/api/sitemap`, `/api/criadores` (22/09/2026).
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
| `pedidos` | Pedidos da live | Admin SDK |
| `conversas` | Caixa de mensagens do painel | Painel + `moviki-ai` (só a mensagem do bot) |
| `atendimentos_bot` | Conversas do WhatsApp por telefone | **Só** `moviki-ai` |
| `pontos`, `ponto_slugs`, `slugs` | Pontos de venda e endereços curtos | Admin SDK |
| `admins`, `configuracoes`, `sistema` | Controle interno | Admin SDK |
| `checkout_contas`, `faturamento`, `recebimento` | Cobrança e recebimento | **Só** `moviki-robo` |
| `moderacao`, `liveTermos` | Moderação e aceite de termos da live | Admin SDK |
| `criador_pecas` | Peças dos influenciadores para as redes do Moviki (regras v27, 22/09/2026) | Criador cria e autoriza/revoga; **só o dono** aprova/recusa/suspende |

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
- **Medição de anúncios (24/09/2026):** Meta pela Conversions API do robô (sem pixel, sem cookie). **Google Ads sem tag própria:** a propriedade GA4 `G-GG5CSQZVGH` fica vinculada à conta do Google Ads, que importa os eventos principais `sign_up` (navegador, `mvSignup`) e `purchase` (robô, Measurement Protocol — envs `GA_MEASUREMENT_ID` e `GA_API_SECRET`). Sinais de anúncio continuam `denied`; o gclid chega pela URL (`url_passthrough` no `mvmetrica.js`). **Nunca** instalar a tag do Google Ads nem o pixel da Meta sem reescrever a política de privacidade (itens 4 e 10) e trocar o aviso por consentimento com "Aceitar/Recusar".
- **Aviso de medição (LGPD):** barra no rodapé na 1ª visita, com "Ok" e "Não medir" (`mv_medicao` no localStorage de cada domínio; "Não medir" desliga o GA4). Reabre em `moviki.com.br/?medicao=escolher` (link na política). Não aparece no painel do dono nem nas telas de live. Mora no `mvmetrica.js`, que é **idêntico** em `moviki` e `moviki-app`.
- **E-mail do domínio:** caixa `suporte@` no Titan (MX `mx1/mx2.titan.email`, DKIM `titan1._domainkey`, SPF na raiz com `spf.titan.email`); envio automático do robô pela Resend (domínio verificado, DKIM `resend._domainkey`, SPF/MX em `send.moviki.com.br`); e-mails do Firebase Auth (confirmar cadastro, esqueci a senha) também saem como @moviki.com.br — SPF com `_spf.firebasemail.com` e DKIM `firebase1`/`firebase2._domainkey` (CNAME). **Nunca apagar esses registros:** sem eles, com o DMARC em quarentena, o e-mail que libera o teste grátis cai no spam. Rastreio de clique da Resend **desligado** de propósito. DMARC em `_dmarc`: sai de `p=none` para `p=quarantine` com relatório para `suporte@` (23/09/2026).

## 9. Rotinas automáticas

**Vercel cron (`moviki-robo`):**

- `/api/lembrete-trial` — todo dia às 12:00 UTC
- `/api/webhook-reprocessa` — a cada hora, aos 20 minutos
- `/api/pedidos-confere` — a cada 5 minutos (23/09/2026): confere no Asaas os pedidos "aguardando" dos modos com gateway (conta Asaas do lojista e subconta) das últimas 48 h. Pix direto fica de fora — lá quem confirma é o lojista.
- `/api/novo-parceiro?processarPendentes=1` — a cada 5 minutos: aprovação automática de parceiro (só quem já passou dos 10 min de análise e só com a aprovação automática ligada no painel do dono). Até 23/09/2026 rodava pelo GitHub Actions (`aprovar-parceiros.yml`, apagado) — com o repositório privado, gastaria ~8.600 min/mês da cota de 2.000.

**Plano da Vercel: Pro**, conferido por print em 23/09/2026 (equipe `moviki-robo`, Paulo proprietário). O teto de 12 funções do Hobby não vale mais; o robô tem 17 funções em `/api`.

**GitHub Actions (`moviki-assistente-social`):** `feed.yml` (seg a sex), `story.yml` (2 por dia, desde 22/09/2026), `reel.yml` (ter e sáb), `manutencao.yml`. Repositório público: não gasta a cota de minutos do plano gratuito.

Regras da publicação:

- Todo texto passa por `compliance.garantir()` antes de publicar. Sem exceção.
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
- ✅ **Conferido em 17/09/2026: a leitura pública de `negocios` não expõe dado sensível.** Os campos legíveis são só de vitrine (nome, recado, cardápio, promoções, eventos, fotos, vídeos, horário, endereço, entrega, preço médio, capa, slug, whatsapp, lat/lng, cor, segmento). Não há CPF, e-mail, senha, dado financeiro nem id interno. O CPF do lojista vai para o Asaas pela API e não é gravado; do comprador guarda-se só o final.
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
- 24/09/2026: **pendência 11 — Google Ads e aviso de medição.** Decisão do Paulo: Google Ads medido **sem cookie de anúncio**, importando do GA4 o cadastro e a assinatura — mantém a promessa pública de "nenhum cookie de publicidade". Entrou o aviso de medição com "Não medir" e a política de privacidade foi atualizada (itens 4 e 10). Motivo: anunciar no Google sem medir conversão queima verba no escuro; e a política dizia que o Google Analytics não servia a anúncio.
- 24/09/2026: **pendência 10 fechada (live aberta).** O mapa dizia "live em beta fechado", mas a lista de liberação estava vazia havia tempo — e o robô social barrava toda peça que vende live (os workflows nem repassavam o secret `LIVE_NA_PAGINA`). Workflows corrigidos e secret `1`. Material novo do dia conferido contra o robô social e contra o Vik: duas legendas prometiam recurso do Enterprise como se fosse de todos ("oferta com contagem regressiva", "estoque ao vivo") e foram corrigidas; o Vik ganhou o menu novo do material (catálogo `2026-09-24-1`). Teto de minutos de vídeo da live definido no painel do dono.
- 23/09/2026: **segunda leva de configurações fora do código:** login do Firebase só com e-mail/senha e Google, proteção contra enumeração de e-mail e `localhost` fora dos domínios autorizados; chave do mapa travada só na Places API (New); Anthropic com o Zeus em workspace próprio, trava de US$ 300/mês na organização e recarga automática (o teste do Zeus tinha zerado o saldo e derrubado o Vik); DMARC do domínio em quarentena. Detalhes em "Configurações das contas" (seção 8).
- 23/09/2026: **configurações fora do código fechadas com o Paulo:** regras v30 publicadas; env `ASAAS_WEBHOOK_TOKEN_PEDIDOS` apagada na Vercel; teto de gasto da Vercel em US$ 50 além do crédito incluído, só com aviso (sem pausar projeto — pausar tira do ar o recebimento do Asaas); verificação em 2 etapas conferida na Vercel, no GitHub e nas duas contas Google (a `eikosistemas@gmail.com` é a dona do Firebase e o login do GitHub e da Vercel). A aprovação automática de parceiro saiu do GitHub Actions para o cron da Vercel, e `moviki-robo`, `moviki-app` e `moviki-ai` passaram a privados — código do dinheiro e das regras fora da vista de quem procura brecha.
- 22/09/2026: **Área do criador no painel do parceiro** — o influenciador marcado envia a peça (feed, story ou reel) com a mesma checagem do robô antes de subir (proporção, resolução, duração, peso, termos proibidos na legenda), marca ou revoga a autorização para as redes do Moviki, apaga peça e arquivo, e vê os próprios resultados: visitas por dia e por canal (`?canal=`), cadastros, pagantes, comissões e posts nas nossas redes. Motivo: o criador sabe o que aconteceu com cada peça sem pedir ao dono, e a peça já chega no formato que o robô publica.
