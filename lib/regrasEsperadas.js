// lib/regrasEsperadas.js | versao 2026-10-23-regras37  (repo: moviki-robo)
// 23/10/2026: v37 + Storage 19/10 (video de capa, P85). Ja publicadas no Console
//   em 19/10; este arquivo nao foi atualizado nas entregas v35/v36/v37 e o
//   painel do dono acusava "diferente" com o Console certo.
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
    versao: 'v37',
    sha256: '538a58d9494f94765d8220bf337549aa2a5548001c249423e6bc9119e3c7f4c0',
  },
  storage: {
    versao: '19/10/2026',
    sha256: 'd78b758fb30be685b6bb404943108fd702a8711339e8ac9175fe253c6646cda8',
  },
};
