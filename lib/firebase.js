// Liga o robo ao seu banco Firebase com poderes de administrador.
// A chave da conta de servico NUNCA fica aqui no codigo: ela vem de uma
// variavel de ambiente privada do Vercel (FIREBASE_SERVICE_ACCOUNT).

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  // Quando a chave e colada numa variavel de ambiente, as quebras de linha
  // vem escapadas como \n literais; aqui a gente desfaz isso.
  if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

const db = admin.firestore();

module.exports = { admin, db };
