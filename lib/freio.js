// lib/freio.js | versao 2026-10-03-freio2 (falha FECHADA por padrao)  (repo: moviki-robo)
// FREIO POR USUARIO — 23/09/2026 (varredura de seguranca).
//
// Conta quantas vezes um uid usou uma acao numa janela de tempo e recusa
// acima do teto. Existe para o que custa dinheiro a cada chamada (busca de
// endereco no Google, que cai na fatura do Google Cloud) ou ocupa espaco
// (upload de imagem no Storage). Sem freio, uma conta gratis recem-criada
// fazia milhares de chamadas.
//
// Guarda em freio/{acao}_{uid} = { ini, n, expiraEm }. So o Admin SDK escreve
// (sem regra no Firestore = navegador nao alcanca). expiraEm serve para uma
// politica de TTL no console, se um dia quiser limpar sozinho.
//
// 03/10/2026 (auditoria): falha FECHADA por padrao. Antes, qualquer erro do
// proprio freio (Firestore instavel, transacao abortada) deixava passar — e
// justamente na hora de instabilidade a busca paga do Google e o upload no
// Storage ficavam sem limite nenhum. Se o Firestore esta fora, o painel ja
// nao funciona; recusar a chamada paga nao derruba nada que estivesse de pe.
// Excecao: contador GLOBAL (um documento so para todas as contas) disputa a
// mesma linha e pode abortar por concorrencia — quem chama passa
// { falhaAberta: true } nesses casos, porque o freio por conta (fechado)
// continua valendo ao lado dele.

async function freioUid(admin, db, acao, uid, max, janelaMs, opcoes) {
  const falhaAberta = !!(opcoes && opcoes.falhaAberta === true);
  const id = String(acao).replace(/[^a-z0-9_]/gi, '') + '_' + String(uid || 'x').replace(/[^A-Za-z0-9]/g, '').slice(0, 128);
  const ref = db.collection('freio').doc(id);
  try {
    return await db.runTransaction(async (tx) => {
      const s = await tx.get(ref);
      const agora = Date.now();
      let d = s.exists ? (s.data() || {}) : { ini: agora, n: 0 };
      if (!d.ini || agora - d.ini > janelaMs) d = { ini: agora, n: 0 };
      if (d.n >= max) return false;
      tx.set(ref, {
        ini: d.ini,
        n: d.n + 1,
        expiraEm: admin.firestore.Timestamp.fromMillis(d.ini + janelaMs + 86400000),
      });
      return true;
    });
  } catch (e) {
    console.error('[freio] falhou (' + (falhaAberta ? 'deixando passar' : 'recusando') + '):', acao, (e && e.message) || e);
    return falhaAberta;
  }
}

module.exports = { freioUid };
