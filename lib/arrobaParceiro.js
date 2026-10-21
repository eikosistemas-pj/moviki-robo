// lib/arrobaParceiro.js  (repo: moviki-robo)  | versao 2026-10-13-arroba
//
// TRAVA DO @ DO PARCEIRO — 13/10/2026 (P80)
//
// O incidente: em 12/10 um parceiro entrou pela porta do criador com o @
// "TikTok". O @tiktok EXISTE no Instagram, como conta comercial e verificada,
// entao a busca oficial da Meta (business_discovery) achava a conta e o robo
// gravava a foto, os seguidores e o selo de verificado no cadastro de quem
// so DIGITOU o @. Isso aparecia no cracha e na pagina /v/ — a credencial que
// o lojista usa para confiar no parceiro. O mesmo golpe vale para qualquer
// marca ou famoso.
//
// Tres camadas, todas aqui no servidor:
//   1) @ RESERVADO (plataforma, Moviki, Asaas, grande marca): recusado na hora.
//   2) @ que contem nome de plataforma, conta verificada ou conta grande:
//      nunca aprovado sozinho — vai para a analise do dono, com alerta.
//   3) PROVA DE POSSE: codigo MVK-0000 na bio do Instagram, conferido pela
//      mesma busca da Meta. Sem prova o @ fica "nao confirmado": sai do
//      espelho publico (/v/ sem @ e sem foto do Instagram) e o parceiro nao
//      entra na aprovacao automatica.
//
// Decisao do Paulo (12/10/2026): a prova e obrigatoria so para a APROVACAO
// AUTOMATICA e para MARCAR COMO CRIADOR. Quem nao prova cai na analise manual.
//
// Este modulo e puro (sem Firestore) de proposito: e testavel sem banco
// (lib/arrobaParceiro.test.js).

const crypto = require('crypto');

/* Conta acima disso nunca e aprovada sozinha, mesmo com a prova. Nao e
   desconfianca: conta grande de verdade merece o olho do dono (oferta,
   bonus, contrato de criador). */
const TETO_SEGUIDORES = 50000;

/* Validade do codigo da bio. Passou, gera outro. */
const CODIGO_HORAS = 48;

/* Nomes que NINGUEM pode usar como o proprio @, depois de limpar pontos,
   tracos, numeros e sufixos tipo "oficial"/"brasil". Comparacao exata —
   "tiktokbrasil" vira "tiktok" e cai aqui; "joaodatiktok" nao. */
const RESERVADOS = [
  // plataformas
  'tiktok', 'instagram', 'facebook', 'meta', 'whatsapp', 'messenger', 'threads',
  'google', 'youtube', 'gmail', 'twitter', 'kwai', 'linkedin', 'pinterest',
  'snapchat', 'telegram', 'spotify', 'netflix', 'apple', 'microsoft', 'amazon',
  'openai', 'chatgpt', 'anthropic',
  // a casa
  'moviki', 'movikiapp', 'movikioficial', 'eikosistemas', 'eiko', 'asaas',
  // comercio e pagamento
  'mercadolivre', 'mercadopago', 'shopee', 'shein', 'aliexpress', 'temu',
  'magalu', 'magazineluiza', 'americanas', 'casasbahia', 'ifood', 'rappi',
  'uber', 'nubank', 'picpay', 'itau', 'bradesco', 'santander', 'caixa',
  'bancodobrasil', 'bancointer', 'c6bank',
  // marcas grandes que costumam ser usadas em golpe
  'nike', 'adidas', 'natura', 'boticario', 'oboticario', 'avon', 'renner',
  'riachuelo', 'hering', 'zara', 'cocacola', 'globo', 'sbt', 'record',
];

/* Plataformas cujo nome, aparecendo DENTRO do @, ja pede o olho do dono
   (ex.: "suportewhatsapp", "tiktokshopbr"). Nao recusa — so tira da
   aprovacao automatica. So nomes longos, para nao pegar "meta" em
   "metalurgica". */
const CONTEM_REVISAO = ['tiktok', 'instagram', 'facebook', 'whatsapp', 'youtube', 'google', 'moviki', 'asaas'];

/* Afixos que nao mudam de quem e a conta. */
const AFIXOS = ['oficial', 'official', 'brasil', 'brazil', 'real', 'the', 'app', 'suporte', 'support', 'ajuda', 'help', 'team', 'equipe', 'br', 'loja', 'store', 'shop'];

/* Normaliza o que o parceiro digitou (aceita @, URL do Instagram, TikTok ou
   YouTube). Devolve so letras, numeros, ponto, underline e traco, minusculo. */
function normalizar(bruto) {
  let s = String(bruto == null ? '' : bruto).trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^https?:\/\//, '').replace(/^(www\.|m\.)/, '');
  s = s.replace(/^(instagram\.com|tiktok\.com|youtube\.com)\//, '');
  s = s.split(/[/?#\s]/)[0].replace(/^@+/, '');
  return s.replace(/[^a-z0-9._-]/g, '').slice(0, 40);
}

/* Os nucleos possiveis: so as letras, tirando afixos das pontas em todas as
   combinacoes. Guarda cada passo — tirar "app" de "whatsapp" estragaria o
   nome se so o ultimo passo valesse. */
function nucleos(arroba) {
  const ini = normalizar(arroba).replace(/[^a-z]/g, '');
  const vistos = new Set();
  const fila = ini ? [ini] : [];
  while (fila.length && vistos.size < 200) {
    const k = fila.shift();
    if (vistos.has(k)) continue;
    vistos.add(k);
    for (const a of AFIXOS) {
      if (k.length > a.length && k.startsWith(a)) fila.push(k.slice(a.length));
      if (k.length > a.length && k.endsWith(a)) fila.push(k.slice(0, -a.length));
    }
  }
  return Array.from(vistos);
}
function nucleo(arroba) { const l = nucleos(arroba); return l.length ? l[l.length - 1] : ''; }

/* Camada 1: recusa na hora. */
function reservado(arroba) {
  if (!normalizar(arroba)) return false;
  return nucleos(arroba).some(k => RESERVADOS.indexOf(k) >= 0);
}

/* Camada 2: motivos para nunca aprovar sozinho. Recebe o cadastro do
   parceiro (com os campos ig* gravados pelo robo). Lista vazia = nada. */
function motivosRevisao(p) {
  const out = [];
  const a = normalizar(p && p.arroba);
  if (!a) return out;
  const cru = a.replace(/[^a-z]/g, '');
  if (!reservado(a) && CONTEM_REVISAO.some(t => cru.indexOf(t) >= 0)) out.push('marca');
  if (p.igVerificado === true) out.push('verificado');
  if (Number(p.igSeguidores || 0) >= TETO_SEGUIDORES) out.push('grande');
  return out;
}

/* O @ esta CONFIRMADO quando a prova foi feita para ESTE MESMO @. Se o
   dono trocar o @ do cadastro depois, a prova antiga deixa de valer. */
function arrobaConfirmada(p) {
  if (!p || p.igConfirmado !== true) return false;
  const a = normalizar(p.arroba);
  return !!a && normalizar(p.igConfirmadoArroba) === a;
}

/* Pode entrar na aprovacao automatica?
   - sem @: sim (nao tem identidade de terceiro para usurpar);
   - @ reservado: nao;
   - qualquer motivo de revisao: nao;
   - @ sem prova: nao. */
function podeAutoAprovar(p) {
  const a = normalizar(p && p.arroba);
  if (!a) return true;
  if (reservado(a)) return false;
  if (motivosRevisao(p).length) return false;
  return arrobaConfirmada(p);
}

/* Codigo da bio: MVK- + 4 digitos aleatorios. */
function gerarCodigo() {
  return 'MVK-' + String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

/* A bio contem o codigo? Tolera espaco, minuscula e traco trocado. */
function bioTemCodigo(bio, codigo) {
  const limpa = s => String(s || '').toUpperCase().replace(/[\s‐-―_-]/g, '');
  const c = limpa(codigo);
  return !!c && limpa(bio).indexOf(c) >= 0;
}

const ROTULO = {
  marca: 'o @ contém nome de plataforma',
  verificado: 'conta verificada no Instagram',
  grande: 'conta com ' + TETO_SEGUIDORES.toLocaleString('pt-BR') + '+ seguidores',
};

module.exports = {
  TETO_SEGUIDORES, CODIGO_HORAS, RESERVADOS,
  normalizar, nucleo, nucleos, reservado, motivosRevisao, arrobaConfirmada,
  podeAutoAprovar, gerarCodigo, bioTemCodigo, ROTULO,
};
