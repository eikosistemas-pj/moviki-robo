// lib/espelhoParceiro.js  (repo: moviki-robo)
//
// Mantem `parceiros_publicos/{slug}` — o ESPELHO PUBLICO do parceiro, que e o
// que a pagina de verificacao (moviki.com.br/v/apelido) le.
//
// POR QUE UM ESPELHO, E NAO LER O CADASTRO DIRETO: `parceiros/{uid}` guarda a
// CHAVE PIX. Abrir aquele documento para leitura publica entregaria a chave Pix
// de todo mundo para qualquer visitante. Nao existe meio-termo: regra do
// Firestore libera o documento inteiro ou nada. Entao o robo copia, para uma
// colecao separada, so o punhado de campos que pode ser visto por estranhos.
// Dinheiro, e-mail e status interno NAO atravessam.
//
// Regras do Firestore (v19): parceiros_publicos e `read: true, write: false` —
// so o Admin SDK escreve aqui, e ninguem escreve pelo app.
//
// Quem chama:
//   api/novo-parceiro.js      -> na aprovacao automatica (varredura do cron)
//                             -> no branch ?espelho=1 (o proprio parceiro pede)
//   api/parceiro-aprovado.js  -> quando o dono aprova na mao
//
// Vive em lib/ e nao em api/: o teto do plano Hobby e 12 funcoes em /api e o
// repo esta no teto. Isto e um modulo, nao um endpoint.

const CAMPOS_MAX = { nome: 80, arroba: 40, slug: 40 };

/* O parceiro deixa de aparecer publicamente se nao estiver aprovado. Nao
   apagamos o documento: viramos `ativo:false` e a pagina de verificacao diz,
   com todas as letras, que aquele apelido nao esta autorizado. Um apelido que
   simplesmente some daria "pagina nao encontrada" — e "nao encontrado" o
   comerciante interpreta como erro de digitacao, nao como alerta. */
function montar(p) {
  const nome = String(p.nome || '').trim().slice(0, CAMPOS_MAX.nome);
  const slug = String(p.slug || '').trim().slice(0, CAMPOS_MAX.slug);
  const arroba = String(p.arroba || '').trim().replace(/^@+/, '').slice(0, CAMPOS_MAX.arroba);

  const criadoMs = p.criadoEm && typeof p.criadoEm.toMillis === 'function' ? p.criadoEm.toMillis() : 0;

  return {
    slug,
    nome,
    arroba: arroba ? '@' + arroba : '',
    // Mes e ano bastam. Dia exato de cadastro nao ajuda o comerciante em nada
    // e e informacao a mais sobre o parceiro exposta sem necessidade.
    desde: criadoMs ? new Date(criadoMs).toISOString().slice(0, 7) : '',
    ativo: p.status === 'aprovado',
    // `treinado` e o que o Paulo chamou de selo: prova de que ele assistiu as
    // aulas. Vem de aulasEm, que so existe depois das 8 completas.
    treinado: !!p.aulasEm,
    // Numero de seguidores NAO entra. E dado do parceiro, nao credencial dele,
    // e mostrar publicamente transformaria a pagina de verificacao numa vitrine
    // de tamanho — exatamente o clima de ranking que a gente decidiu evitar.
  };
}

/* Escreve (ou atualiza) o espelho de UM parceiro.
   Recebe o documento ja lido para nao gastar leitura duas vezes.
   NUNCA lanca: espelho quebrado nao pode derrubar aprovacao nem e-mail. */
async function gravarEspelho(admin, db, p) {
  try {
    const dados = montar(p || {});
    if (!dados.slug) return { ok: false, motivo: 'sem_slug' };

    await db.collection('parceiros_publicos').doc(dados.slug).set(
      Object.assign({}, dados, { espelhoEm: admin.firestore.FieldValue.serverTimestamp() })
    );
    return { ok: true, slug: dados.slug };
  } catch (e) {
    console.error('[espelho] falha ao gravar:', e && e.message);
    return { ok: false, motivo: 'falha' };
  }
}

/* Le o parceiro pelo uid e grava o espelho. Usado quando quem chama ainda
   nao tem o documento em maos. */
async function espelharPorUid(admin, db, uid) {
  try {
    const snap = await db.collection('parceiros').doc(String(uid || '')).get();
    if (!snap.exists) return { ok: false, motivo: 'sem_cadastro' };
    return await gravarEspelho(admin, db, snap.data() || {});
  } catch (e) {
    console.error('[espelho] falha ao ler o parceiro:', e && e.message);
    return { ok: false, motivo: 'falha' };
  }
}

module.exports = { gravarEspelho, espelharPorUid, montar };
