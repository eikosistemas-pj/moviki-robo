// lib/segredo.js | versao 2026-10-03-segredo1  (repo: moviki-robo)
// COMPARACAO DE SEGREDO EM TEMPO CONSTANTE — 03/10/2026 (auditoria de seguranca).
//
// Os crons (CRON_SECRET) comparavam o cabecalho com `===`. O `===` para no
// primeiro caractere diferente, e o tempo de resposta denuncia quantos
// caracteres ja estao certos (ataque de tempo). O webhook do Asaas e a live ja
// usavam crypto.timingSafeEqual; este arquivo leva o mesmo cuidado aos crons.
//
// Falha FECHADA: segredo ausente nunca autoriza.

const crypto = require('crypto');

function segredoConfere(recebido, esperado) {
  const e = String(esperado || '');
  if (!e) return false; // vazio nunca autoriza (nao exige tamanho: nao derrubar crons ja configurados)
  const ha = crypto.createHash('sha256').update(String(recebido || '')).digest();
  const hb = crypto.createHash('sha256').update(e).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Confere o cabecalho "Authorization: Bearer <segredo>".
function bearerConfere(req, esperado) {
  const h = String((req && req.headers && req.headers.authorization) || '');
  if (h.indexOf('Bearer ') !== 0) return false;
  return segredoConfere(h.slice(7), esperado);
}

module.exports = { segredoConfere, bearerConfere };
