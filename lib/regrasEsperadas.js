// lib/regrasEsperadas.js | versao 2026-10-06-regras33  (repo: moviki-robo)
// 06/10/2026: v33 (Pix do parceiro com carimbo + apelido de marca).
// O QUE DEVERIA ESTAR PUBLICADO NO CONSOLE DO FIREBASE.
//
// sha256 do texto das regras do repositorio moviki-app (firebase/), depois de
// normalizar (sem \r, sem espaco no fim da linha, sem linha vazia no fim).
// O cron api/regras.js compara com o que o Firebase diz que esta no ar.
//
// REGRA DE OURO: mudou firebase/firestore.rules ou firebase/storage.rules no
// moviki-app, este arquivo muda NA MESMA ENTREGA. Sem isso o painel do dono
// acusa "diferente" depois de publicar certo.

module.exports = {
  firestore: {
    versao: 'v33',
    sha256: '3bde7a179f3eefafce145501068a9c149b6f5246ab53fd5c558a26a047b42bd0',
  },
  storage: {
    versao: '03/10/2026',
    sha256: 'a0b72a83e88e7d38bc1df00730293c2d7358de63bc3bd994a33ed86f8d4ae61b',
  },
};
