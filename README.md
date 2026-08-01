# Moviki — Robô de cobrança

Este é o "robô" que liga o Moviki ao Asaas. Ele NÃO tem tela. São 3 endereços que
trabalham nos bastidores:

- `POST /api/criar-assinatura` — o painel chama quando o lojista escolhe um plano.
- `POST /api/webhook` — o **Asaas** chama sozinho quando um pagamento muda de status.
  (Liga o plano quando paga, desliga quando vence.)

> ⚠️ **Regra de ouro:** as chaves secretas NUNCA vão no código nem no GitHub.
> Elas ficam só nas **Environment Variables** do Vercel (passo 3).

---

## Passo 1 — Subir os arquivos no GitHub

Suba **todos** os arquivos deste pacote pro repositório `moviki-robo`, mantendo as
pastas (`api/` e `lib/` têm que continuar como pastas). No GitHub: **Add file →
Upload files**, arraste as pastas, **Commit**.

## Passo 2 — Ligar o Vercel no repositório

1. Em **vercel.com** → **Add New… → Project**.
2. Escolha o repositório `moviki-robo` e clique em **Import**.
3. Não mude nada nas configurações. Clique em **Deploy**.
4. No fim, o Vercel te dá um endereço, tipo `https://moviki-robo.vercel.app`.
   **Guarde esse endereço** — é o do robô.

## Passo 3 — Configurar as 4 chaves (Environment Variables)

No Vercel: **Project → Settings → Environment Variables**. Crie estas 4:

| Nome | Valor |
|------|-------|
| `ASAAS_API_KEY` | A chave de API do **Sandbox** do Asaas (começa com `$aact_hmlg_`). Pegue em: painel do Asaas Sandbox → **Integrações → Chave de API → Gerar**. |
| `ASAAS_BASE_URL` | `https://api-sandbox.asaas.com/v3` (é o de testes; na hora de ir pro real, troca pra `https://api.asaas.com/v3`). |
| `ASAAS_WEBHOOK_TOKEN` | Uma senha forte que **você inventa** (30+ caracteres aleatórios). A mesma vai no passo 5. |
| `FIREBASE_SERVICE_ACCOUNT` | O conteúdo do arquivo JSON da conta de serviço do Firebase (passo 4). Cole o JSON inteiro. |

Depois de criar/alterar variáveis, o Vercel pede pra **Redeploy** — faça.

## Passo 4 — Pegar a chave do Firebase (FIREBASE_SERVICE_ACCOUNT)

1. No **Firebase Console** → ⚙️ (Configurações do projeto) → aba **Contas de serviço**.
2. Clique em **Gerar nova chave privada** → baixa um arquivo `.json`.
3. Abra o arquivo, **copie tudo** e cole como o valor de `FIREBASE_SERVICE_ACCOUNT` no Vercel.
   Esse arquivo é uma chave-mestra do seu banco: guarde bem e não suba em lugar nenhum.

## Passo 5 — Criar o webhook no Asaas

No painel do Asaas **Sandbox** → **Integrações → Webhooks → Adicionar**:

- **URL:** `https://SEU-ENDERECO.vercel.app/api/webhook` (o do passo 2).
- **Token de autenticação:** o **mesmo** valor de `ASAAS_WEBHOOK_TOKEN`.
- **Eventos:** marque `PAYMENT_RECEIVED`, `PAYMENT_CONFIRMED`, `PAYMENT_OVERDUE`,
  `PAYMENT_DELETED`, `PAYMENT_REFUNDED`.
- Ative e salve.

---

## Como testar (tudo no Sandbox, sem dinheiro real)

1. Depois que o app estiver ligado ao robô, o lojista escolhe um plano → cai numa
   tela de pagamento do Asaas.
2. No Sandbox dá pra "simular" o pagamento. Ao simular, o Asaas dispara o webhook,
   o robô grava `ativo: true` em `assinaturas/{uid}`, e os recursos liberam no app.
3. Simule um vencimento → o robô grava `ativo: false` → cai pra Básico sozinho.

## Ir pro ar (produção), quando validar

1. Troque `ASAAS_BASE_URL` para `https://api.asaas.com/v3`.
2. Troque `ASAAS_API_KEY` pela chave de **produção** (`$aact_prod_`).
3. Recrie o webhook no painel **real** do Asaas apontando pra mesma URL do robô.
4. Redeploy no Vercel.

## Planos e preços (já embutidos em `lib/asaas.js`)

- **Pró:** 37,90/mês · 99,90/trimestre · 379,00/ano
- **Premium:** 49,90/mês · 134,90/trimestre · 499,00/ano
- **Básico:** grátis (não passa pelo robô — é só não ter assinatura Pró/Premium).

Pra mudar um preço, é só editar a tabela `PLANOS` no arquivo `lib/asaas.js`.
