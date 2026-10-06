// lib/regrasEsperadas.js | versao 2026-10-06-regras34  (repo: moviki-robo)
// 06/10/2026 (noite): v34 (avaliacao so pelo robo + denuncias_avaliacao).
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
    versao: 'v34',
    sha256: 'cdd4a36ecb494917bdd84922810f791d318fb51fe2718ec8a9bf5a2638c3460d',
  },
  storage: {
    versao: '03/10/2026',
    sha256: 'a0b72a83e88e7d38bc1df00730293c2d7358de63bc3bd994a33ed86f8d4ae61b',
  },
};
