// lib/robosCatalogo.js | versao 2026-10-13-ordens (gatilhos dos robos novos e o Maestro) | antes 2026-10-13-custos (robo de vencimentos vira o financeiro) | antes 2026-10-13-robos  (repo: moviki-robo)
// CATALOGO DOS ROBOS — 13/10/2026 (painel do dono, aba "Robos").
//
// Os robos sao tarefas agendadas do Claude (sessoes na nuvem). Cada rodada
// manda o relatorio para api/robos.js (pelo app.moviki.com.br/api/robos) e o
// painel do dono mostra todos juntos.
//
// Este catalogo serve para o painel saber QUEM DEVERIA ter rodado e QUANDO:
// robo do catalogo que nao manda relatorio no prazo aparece como "atrasado".
// Robo novo que ainda nao esta aqui tambem pode mandar relatorio (o nome vem
// no proprio relatorio) — aparece em "Outros robos" ate entrar no catalogo.
//
// freq: 'diario' | '2xdia' | 'semanal' | 'mensal' | 'demanda'
// area: nome exato da area do vault (13/10/2026)
// gatilho: id da tarefa agendada (so referencia; o robo nao chama nada aqui)
// novo: true = robo proposto em 13/10/2026, ainda nao ligado

const CATALOGO = [
  // ---- aquisicao e midia paga
  { id: 'pulso', nome: 'Pulso diário e motor de crescimento', freq: 'diario', quando: 'todo dia 07:00', area: 'A7 - Aquisicao e Midia Paga', gatilho: 'trig_01PKDLdqzgGJnWCxU3zCgemG', faz: 'Confere Google Ads, Meta Ads e GA4 de ontem e executa as regras de corte e escala.' },
  { id: 'analise-semanal', nome: 'Análise semanal e rodízio de ramos', freq: 'semanal', quando: 'segunda 08:30', area: 'A7 - Aquisicao e Midia Paga', gatilho: 'trig_019p8GrnRJqZC1BJ5sjMnGBV', faz: 'Leitura profunda da semana e troca dos ramos nos anúncios.' },
  { id: 'fechamento-midia', nome: 'Fechamento mensal de mídia', freq: 'mensal', quando: 'dia 1, 12:00', area: 'A7 - Aquisicao e Midia Paga', gatilho: 'trig_016yVwSn62mS2HJ8b3GVg5nq', faz: 'Fecha o mês da mídia paga: gasto, custo por cadastro e veredito.' },
  { id: 'saldo-anuncios', nome: 'Alerta de saldo das contas de anúncio', freq: 'diario', quando: 'todo dia 07:46', area: 'A7 - Aquisicao e Midia Paga', gatilho: 'trig_017eeuCmbsDXGE1ZZENY1eSp', faz: 'Saldo do Google Ads e cobrança recusada no Meta.' },
  { id: 'paginas-ramo', nome: 'Vigia de páginas por ramo', freq: 'diario', quando: 'todo dia 06:56', area: 'A7 - Aquisicao e Midia Paga', gatilho: 'trig_01JiKUkjZ3ddvhSpaW5o1NDD', faz: 'Todo ramo do anúncio tem página na /aovivo e entrada no catálogo de ramos.' },
  // ---- conteudo, redes e atendimento
  { id: 'redes', nome: 'Vigilância diária das redes sociais', freq: 'diario', quando: 'todo dia 08:38', area: 'A8 - Conteudo e Social', gatilho: 'trig_01Ex1pnvN589LSqy4T1YuiKj', faz: 'Posts, seguidores e falhas do robô social no Instagram e no Facebook.' },
  { id: 'manychat', nome: 'Vigia do ManyChat (Instagram e TikTok)', freq: 'diario', quando: 'todo dia 08:52', area: 'A12 - Atendimento e vozes do Moviki', gatilho: 'trig_015VbnKQHWZjZfqZxfT3iR1i', faz: 'Automações no ar, canais conectados, pessoas esperando e cobrança do ManyChat.' },
  { id: 'material-visual', nome: 'Robô Material Visual', freq: 'semanal', quando: 'segunda 06:46', area: 'A8 - Conteudo e Social', gatilho: 'trig_01VUChTDbLDLKFAtv8FcDSAV', faz: 'Acha tela sem videoaula ou com aula desatualizada e monta a pauta.' },
  { id: 'produtor', nome: 'Robô Produtor de Material', freq: 'semanal', quando: 'segunda 09:56 (ou chamado pelo Material Visual)', area: 'A8 - Conteudo e Social', gatilho: 'trig_01JcEF9ZTCahvSDxQBwsy41X', faz: 'Prepara roteiro, voz e videoaula e deixa esperando a sua confirmação.' },
  { id: 'vik', nome: 'Robô do Vik e do WhatsApp', freq: 'diario', quando: 'todo dia 05:52', area: 'A9 - IA e Atendimento Vik', gatilho: 'trig_01H5eD7HNG5ipREUcVUaDsr4', faz: 'Mantém o Vik e o PDF do WhatsApp iguais ao produto no ar.' },
  { id: 'tradutor', nome: 'Robô Tradutor', freq: 'demanda', quando: 'só quando chamado', area: 'A1 - Produto e Paineis', gatilho: 'trig_01BTbknMvRBT54Yk1JULFVPW', faz: 'Mede e traduz os textos do sistema para outros idiomas.' },
  // ---- dinheiro e custos
  { id: 'movimento', nome: 'Movimento diário (clientes, parceiros e lojas)', freq: 'diario', quando: 'todo dia 07:41', area: 'A4 - Financeiro', gatilho: 'trig_01JRoo8YnEess3gUt8VNqDpu', faz: 'Pagantes novos, renovações, cadastros e o que deu errado no dinheiro.' },
  { id: 'saldo-anthropic', nome: 'Alerta de saldo da Anthropic', freq: '2xdia', quando: 'todo dia 07:52 e 18:52', area: 'A4 - Financeiro', gatilho: 'trig_01MLf7zrTmna1y67ytEfCSaP', faz: 'Saldo estimado dos créditos da API e quando acaba.' },
  // ---- o maestro: de hora em hora entrega as ordens do dono aos robos (13/10/2026)
  { id: 'maestro', nome: 'Maestro (entrega as suas ordens)', freq: 'demanda', quando: 'de hora em hora, só quando há ordem', area: 'A2 - Infraestrutura e Deploy', faz: 'Pega a ordem que você deu no painel e acorda o robô certo em até 1 hora.' },
  // ---- novos (propostos em 13/10/2026)
  { id: 'sentinela', nome: 'Sentinela de segurança', freq: 'diario', quando: 'todo dia 06:12', area: 'A2 - Infraestrutura e Deploy', gatilho: 'trig_01Nx15haDcgZJrZ3XgwJgicP', faz: 'Regras do Firebase, cabeçalhos, segredos no código e alertas de segurança por e-mail.' },
  { id: 'infra', nome: 'Infraestrutura, backup e custo de nuvem', freq: 'diario', quando: 'todo dia 06:28', area: 'A2 - Infraestrutura e Deploy', novo: true, faz: 'Backup semanal feito, crons do robô vivos e faturas de nuvem fora do normal.' },
  { id: 'vencimentos', nome: 'Financeiro: custos, vencimentos e créditos', freq: 'diario', quando: 'todo dia 07:08', area: 'A4 - Financeiro', gatilho: 'trig_019J3u3AXPsW3eN8CEFZgGRR', faz: 'Lê os recibos do e-mail, mantém o registro de custos, sugere linha nova no Custos e margem e avisa antes de vencer.' },
  { id: 'caixa-parceiros', nome: 'Caixa dos parceiros', freq: 'diario', quando: 'todo dia 07:18', area: 'A5 - Programa de Parceiros', novo: true, faz: 'Comissões, saques parados ou com falha e CNPJ pendente.' },
  { id: 'pedidos', nome: 'Pedidos e checkout dos lojistas', freq: 'diario', quando: 'todo dia 07:24', area: 'A4 - Financeiro', novo: true, faz: 'Pedido pago parado, Pix sem confirmação e recusas no checkout.' },
  { id: 'moderacao', nome: 'Moderação da live e avaliações', freq: 'diario', quando: 'todo dia 08:14', area: 'A13 - Modo Live', novo: true, faz: 'Denúncias, avaliações para moderar e lives com problema.' },
  { id: 'ativacao', nome: 'Ativação e retenção do lojista', freq: 'diario', quando: 'todo dia 09:12', area: 'A6 - Medicao e Analytics', novo: true, faz: 'Funil P75: quem cadastrou e não fez a 1ª live em 48 h, e quem está para sair.' },
  { id: 'vault', nome: 'Saúde do vault', freq: 'semanal', quando: 'segunda 07:34', area: 'A3 - Dados e Regras', gatilho: 'trig_01KzNbU9njFpSucPnHPHCTdu', faz: 'Notas sem área válida, links quebrados, P repetido e notas esperando subir.' },
  { id: 'seo', nome: 'SEO e Search Console', freq: 'semanal', quando: 'segunda 10:04', area: 'A7 - Aquisicao e Midia Paga', novo: true, faz: 'Páginas indexadas, erros de rastreamento e buscas que trazem gente.' },
  { id: 'lgpd', nome: 'LGPD e exclusões', freq: 'mensal', quando: 'dia 2, 09:22', area: 'A10 - Conformidade e LGPD', novo: true, faz: 'Pedidos de exclusão no prazo e dado pessoal onde não devia.' },
];

const HORA = 3600000;
const PERIODO = { diario: 24 * HORA, '2xdia': 12 * HORA, semanal: 7 * 24 * HORA, mensal: 31 * 24 * HORA };

// Prazo para virar "atrasado": o periodo + 25% + 2 h de folga (a tarefa
// agendada pode sair alguns minutos depois e a rodada leva ate 15 min).
function prazoMs(freq) {
  const p = PERIODO[freq];
  return p ? Math.round(p * 1.25) + 2 * HORA : 0;
}

const POR_ID = {};
CATALOGO.forEach((r) => { POR_ID[r.id] = r; });

module.exports = { CATALOGO, POR_ID, prazoMs, PERIODO };
