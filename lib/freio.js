// lib/freio.js | versao 2026-09-23-freio1  (repo: moviki-robo)
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
// Falha ABERTA de proposito: se o proprio freio der erro (Firestore fora),
// deixa passar. O freio protege custo; ele nao pode derrubar o produto.

async function freioUid(admin, db, acao, uid, max, janelaMs) {
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
    console.error('[freio] falhou, deixando passar:', (e && e.message) || e);
    return true;
  }
}

module.exports = { freioUid };
