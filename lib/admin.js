// lib/admin.js | versao 2026-10-03-admingoogle  (repo: moviki-robo)
// QUEM E O DONO — 03/10/2026 (auditoria de seguranca).
//
// Antes, ser admin era so ter o documento em admins/{uid}. O dono entrava no
// painel com e-mail e senha: quem descobrisse a senha pagava saque, excluia
// conta e trocava apelido, sem passar por nenhum segundo fator.
//
// Agora a acao de dono exige as DUAS coisas:
//   1. documento em admins/{uid} (como sempre);
//   2. sessao aberta pelo Google (token com sign_in_provider 'google.com').
//      A conta Google do dono tem verificacao em 2 etapas: e ela que vira o
//      segundo fator, sem custo e sem o upgrade do Identity Platform.
//
// As regras do Firestore e do Storage (v32) cobram o mesmo. Uma ponta sem a
// outra deixaria uma porta aberta.
//
// EMERGENCIA: env ADMIN_ACEITA_SENHA = "1" no projeto Vercel do robo volta a
// aceitar a sessao por senha (so para o dono nao ficar trancado se o login do
// Google falhar). Apagar a env assim que o Google voltar.

async function conferirAdmin(db, decoded) {
  if (!decoded || !decoded.uid) return { ok: false, status: 401, erro: 'sessao' };
  const a = await db.collection('admins').doc(decoded.uid).get();
  if (!a.exists) return { ok: false, status: 403, erro: 'nao_admin' };
  const entrada = decoded.firebase && decoded.firebase.sign_in_provider;
  if (entrada !== 'google.com' && process.env.ADMIN_ACEITA_SENHA !== '1') {
    return { ok: false, status: 403, erro: 'entre_com_google',
      mensagem: 'Acao de dono so com o login do Google. Saia e entre de novo pelo botao "Entrar com o Google".' };
  }
  return { ok: true };
}

module.exports = { conferirAdmin };
