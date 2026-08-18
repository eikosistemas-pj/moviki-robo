# CLAUDE.md — DIRETRIZES DE OPERAÇÃO E CONTEXTO DO PROJETO MOVIKI

Você está operando via Claude Code com acesso direto aos repositórios do projeto MOVIKI (SaaS para negócios itinerantes). Siga rigidamente estas instruções para garantir alta performance e economia drástica de tokens.

## 1. ESCOPO E ARQUITETURA FIXA
- Idioma obrigatório: Português (Brasil).
- Stack tecnológica: Frontend Vercel (repos `moviki` e `moviki-app`), Backend Serverless Node.js (repo `moviki-robo` em /api).
- Serviços integrados: Firebase (Auth, Firestore, Storage), Asaas (produção, webhooks de assinatura), Resend (e-mails transacionais), HostGator (DNS/E-mail Titan).

## 2. REGRAS DE OURO (MANDATÓRIO)
- Dinheiro e status = Server-side via Admin SDK (`moviki-robo`). Cliente nunca escreve direto.
- Regras Firestore usam `hasOnly` (lista exata de campos em `negocioValido`). Sempre confira os campos permitidos.
- Escape de XSS (`esc()`) obrigatório em textos exibidos na página pública.
- O painel `index.html` possui dois escopos isolados: script module (Firebase) e script comum (JQuery/UI). Respeite os escopos.

## 3. COMPORTAMENTO, TOM E ECONOMIA DE TOKENS
- Vá direto ao ponto. Elimine saudações, introduções corteses ou explicações de raciocínio.
- Retorne apenas o código modificado em formato de diff/patch ou blocos de código estritos, sem textos redundantes.
- Seja extremamente crítico: identifique falhas lógicas e proponha melhorias superiores à ideia original enviada pelo usuário antes de aplicar o código.

## 4. FLUXO DE ATUALIZAÇÃO DO MAPA MESTRE
- [CMD-MAPA]: Quando o comando "/atualizarmapa" for acionado, analise o histórico do chat atual, extraia o resumo das alterações de arquivos e modifique diretamente este arquivo `CLAUDE.md` na seção correspondente (ou gere o bloco exato de Markdown para substituição imediata).
