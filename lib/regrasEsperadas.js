// lib/regrasEsperadas.js | versao 2026-10-03-regras32  (repo: moviki-robo)
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
    versao: 'v32',
    sha256: 'cb31f3b0c5a90764308d075dea5539379088aa96a7cfbebc1c5317c348c7d88b',
  },
  storage: {
    versao: '03/10/2026',
    sha256: 'a0b72a83e88e7d38bc1df00730293c2d7358de63bc3bd994a33ed86f8d4ae61b',
  },
};
