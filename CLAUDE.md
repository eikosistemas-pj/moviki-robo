# CLAUDE.md — Mapa Mestre do MOVIKI

Este arquivo é lido pelo Claude Code no início de toda sessão. Ele vale para TODOS os repositórios do projeto Moviki (conta GitHub `eikosistemas-pj`). A mesma cópia fica na raiz de cada repositório.

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
12. **GitHub Actions no plano gratuito tem limite mensal de minutos.** Não aumentar a frequência das rotinas sem avisar o Paulo.

## 5. Arquitetura — quem chama quem

- **Lojista** entra em `app.moviki.com.br` → painel lê e grava em `negocios/{uid}` no Firestore.
- **Lojista escolhe um plano** → painel chama `moviki-robo /api/criar-assinatura` → Asaas gera a cobrança.
- **Asaas avisa sozinho** quando o pagamento muda → `moviki-robo /api/webhook` → grava `ativo` em `assinaturas/{uid}` → recursos liberam ou caem para Básico.
- **Visitante** abre `moviki.com.br/{slug}` → `moviki /api/og` monta a página do negócio.
- **Cliente manda mensagem no WhatsApp** → `moviki-ai /api/atendimento` (não sabe quem está falando, só conhece o catálogo).
- **Lojista usa a caixa de mensagens do painel** → `moviki-ai /api/chat` (sabe quem está falando, lê os dados reais da conta).
- **Rotinas de rede social** → `moviki-assistente-social` roda por Actions, lê `negocios` e publica.

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

- Rotas públicas do site: `/p/{slug}`, `/pp/{slug}`, `/v/{slug}`, `/live/{slug}`, `/aovivo`, `/sitemap-negocios.xml`.
- DNS e e-mail (Titan) na **HostGator**.

## 7. Onde ficam os dados (Firestore)

Projeto Firebase único, compartilhado por todos os repositórios: **`moviki-app`**.

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

## 9. Rotinas automáticas

**Vercel cron (`moviki-robo`):**

- `/api/lembrete-trial` — todo dia às 12:00 UTC
- `/api/webhook-reprocessa` — a cada hora, aos 20 minutos

**GitHub Actions (`moviki-assistente-social`):** `feed.yml`, `reel.yml`, `manutencao.yml`

Regras da publicação:

- Todo texto passa por `compliance.garantir()` antes de publicar. Sem exceção.
- Texto reserva é obrigatório e precisa estar limpo. Falha de IA nunca fura o calendário: sai o texto reserva.
- Instagram é prioridade; Facebook é best-effort e nunca derruba o ciclo.
- Imagem não é gerada por IA na hora de publicar — compõe sobre fundo já aprovado.
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
| **Obsidian** | Sim, pelo `.bat` da área de trabalho | O Paulo coloca o `.md` ao lado do `.bat`, roda, e entra no cofre |

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

O Paulo tem, na área de trabalho, um arquivo `.bat` que joga qualquer `.md` colocado ao lado dele dentro do Obsidian. Então **a forma de alimentar a memória dele é entregar um `.md` pronto no chat** — ele arrasta para a área de trabalho e roda o `.bat`.

Ao terminar uma alteração relevante, além de atualizar este mapa no Pull Request, **entregar também uma nota de diário** seguindo exatamente este formato:

**Nome do arquivo:** `AAAA-MM-DD Moviki — <assunto curto>.md`
(exemplo: `2026-09-17 Moviki — desconto por item.md`)

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

Ver também: [[Moviki — Mapa Mestre]]
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
- ⚠️ A leitura de `negocios` é pública nas regras do Firestore, de propósito (o assistente social lê sem autenticação). **Conferir que nenhum dado sensível de lojista está nessa coleção.**
- ⚠️ `moviki-vault` é privado e não foi auditado.

## 14. Observações levantadas nesta leitura

1. **`moviki-vault` não foi auditado** (é privado). É o cofre do Obsidian do Paulo: anotações e decisões, não código.
2. **Instruções desatualizadas** nos CLAUDE.md antigos, corrigidas nesta versão:
   - "Retornar apenas código em diff/patch" e "entregar arquivo pronto pra substituir" vinham da época em que o Paulo copiava e colava à mão. **Hoje o Claude Code altera o repositório direto e abre Pull Request** — a entrega é o PR, não o código no chat.
   - "Escrita direta pelo Claude em repositório continua bloqueada (Issue #76248)" **não vale mais**.
   - "Economia drástica de tokens" e "eliminar explicações" conflitava com o fato de o Paulo não ser programador. O que ele precisa é explicação **em linguagem de negócio**, sem código.
3. **`MOVIKI_MAPA_MESTRE.md` é citado pelos repositórios mas não existe em nenhum deles** — vivia num Project do Claude. Este arquivo passa a ser o mapa mestre, dentro do repositório, onde o Claude Code lê sozinho.
4. O comando `/atualizarmapa` dos arquivos antigos foi mantido em espírito: **ao terminar uma alteração relevante, atualizar a seção correspondente deste arquivo no mesmo Pull Request.**

## 15. Histórico de decisões

- 16/09/2026: plano trimestral aposentado.
- 17/09/2026: `moviki-ai` separado do `moviki-robo` para isolar o teto de 12 funções do plano Hobby e proteger o robô do dinheiro.
- 17/09/2026: mapa mestre trazido para dentro dos repositórios como `CLAUDE.md`, passando a ser a memória oficial do projeto.
- 17/09/2026: `moviki-platform` autorizado a ser apagado pelo Paulo — estava vazio, nunca foi usado.
- 17/09/2026: definido o formato da nota de diário entregue ao Obsidian (seção 12), aproveitando o `.bat` que o Paulo já tem na área de trabalho.
