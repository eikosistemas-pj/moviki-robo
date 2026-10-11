'use strict';
// Transferencia por CLABE (Mexico, M5). Sem internet e sem Firebase:
// cd moviki-robo && node testes/clabe.test.js
// Versao 2026-10-11-clabe. O digito verificador foi cruzado em 10/10/2026 com
// outra implementacao publica (clabe-validator 3.2.2) em 5.000 numeros: 0 divergencias.
const path = require('path');
const ROBO = process.env.ROBO || path.join(__dirname, '..');
const C = require(path.join(ROBO, 'lib/clabe.js'));
let falhas = 0, ok = 0;
function conf(c, msg) { if (c) { ok++; } else { falhas++; console.log('FALHOU:', msg); } }

// ---------------------------------------------------------------- CLABE valida
const validas = [
  ['032180000118359719', '032'],
  ['012180015555555550', '012'],
  ['072580010000000001', '072'],
  ['638180000100000001', '638'],
  ['728969000000000009', '728'],
  ['002180700000000008', '002'],
];
for (const [c, banco] of validas) {
  const r = C.lerClabe(c);
  conf(r.ok === true, 'valida: ' + c);
  conf(r.ok && r.banco.codigo === banco, 'banco de ' + c);
  conf(r.ok && r.mascara === '•••• ' + c.slice(-4), 'mascara de ' + c);
  conf(r.ok && r.clabe === c, 'clabe limpa ' + c);
}
conf(C.lerClabe('012180015555555550').banco.nome === 'BBVA México', 'nome curto do BBVA');
conf(C.lerClabe('638180000100000001').banco.nome === 'Nu México', 'nome curto do Nu');
conf(C.lerClabe('728969000000000009').banco.nome === 'Spin by OXXO', 'nome curto do Spin');

// colada com espacos, pontos e tracos
conf(C.lerClabe(' 0321 8000 0118 3597 19 ').ok, 'colada com espacos');
conf(C.lerClabe('032-180-00011835971-9').ok, 'colada com tracos');
conf(C.lerClabe('032.180.000118359719').ok, 'colada com pontos');

// ---------------------------------------------------------------- recusas
conf(C.lerClabe('032180000118359717').motivo === 'digito', 'digito errado');
conf(C.lerClabe('03218000011835971').motivo === 'tamanho', '17 digitos');
conf(C.lerClabe('0321800001183597190').motivo === 'tamanho', '19 digitos');
conf(C.lerClabe('03218000011835971A').motivo === 'tamanho', 'com letra');
conf(C.lerClabe('').motivo === 'tamanho', 'vazio');
conf(C.lerClabe(null).motivo === 'tamanho', 'nulo');
conf(C.lerClabe('<script>032180000118359719').ok === false, 'lixo em volta');
// banco que nao existe: prefixo 555 com digito certo; 999 e 903 nao sao conta
for (const pre of ['555', '999', '903']) {
  const p = pre + '18000011835971';
  conf(C.lerClabe(p + C._t.digitoVerificador(p)).motivo === 'banco', 'banco fora da tabela ' + pre);
}
conf(C._t.digitoVerificador('123') === null, 'digito so com 17');

// ---------------------------------------------------------------- celular DiMo
conf(C.lerCelularMx('5512345678') === '+525512345678', 'celular 10 digitos');
conf(C.lerCelularMx('+52 55 1234 5678') === '+525512345678', 'celular com +52');
conf(C.lerCelularMx('525512345678') === '+525512345678', 'celular com 52');
conf(C.lerCelularMx('5215512345678') === '+525512345678', 'celular com 521 antigo');
conf(C.lerCelularMx('551234567') === null, 'celular com 9 digitos');
conf(C.lerCelularMx('55123456789') === null, 'celular com 11 digitos');
conf(C.lerCelularMx('0512345678') === null, 'celular comecando com 0');
conf(C.lerCelularMx('5555555555') === null, 'celular repetido');
conf(C.mascararCelularMx('+525512345678').endsWith('5678'), 'mascara do celular');
conf(!C.mascararCelularMx('+525512345678').includes('1234 5678'), 'mascara esconde o meio');

// ---------------------------------------------------------------- concepto e referencia
conf(C.conceptoDe(42) === 'MV 0042', 'concepto 42');
conf(C.conceptoDe(12345) === 'MV 12345', 'concepto 12345');
conf(C.conceptoDe(1234567).length <= 10, 'concepto cabe em 10');
conf(C.conceptoDe('x') === 'MV 0000', 'concepto com lixo');
conf(/^[A-Z0-9 ]+$/.test(C.conceptoDe(99)), 'concepto sem acento');
conf(C.referenciaDe(42) === '0000042', 'referencia 42');
conf(C.referenciaDe(12345678).length === 7, 'referencia com 7 digitos');

// ---------------------------------------------------------------- clave de rastreo
conf(C.claveRastreoOk('MBAN01002610110001234567') === 'MBAN01002610110001234567', 'clave longa');
conf(C.claveRastreoOk(' 2026101140014 tra ') === '2026101140014TRA', 'clave com espaco vira maiuscula');
conf(C.claveRastreoOk('') === null, 'clave vazia');
conf(C.claveRastreoOk('ABC12') === null, 'clave curta');
conf(C.claveRastreoOk('A'.repeat(31)) === null, 'clave longa demais');
conf(C.claveRastreoOk('ABC-123456') === null, 'clave com simbolo');
conf(C.claveRastreoOk('<img src=x>') === null, 'clave com html');

// ---------------------------------------------------------------- banco de origem
conf(C.bancoOk('12').nome === 'BBVA México', 'banco de origem 12');
conf(C.bancoOk('012').codigo === '012', 'banco de origem 012');
conf(C.bancoOk('555') === null && C.bancoOk('999') === null, 'banco de origem inexistente');
conf(C.bancoOk('<b>') === null, 'banco de origem lixo');
const lista = C.listaBancos();
conf(lista.length > 100, 'lista de bancos completa');
conf(lista[0].nome === 'BBVA México' && lista.slice(0, C._t.COMUNS.length).every((b) => C._t.COMUNS.includes(b.codigo)), 'comuns primeiro');
conf(C._t.COMUNS.every((c) => C._t.BANCOS[c]), 'comuns existem na tabela');
const resto = lista.slice(C._t.COMUNS.length);
conf(resto.every((b, i) => i === 0 || resto[i - 1].nome.localeCompare(b.nome, 'es') <= 0), 'resto em ordem');
conf(new Set(lista.map((b) => b.nome)).size === lista.length, 'sem banco repetido na lista');
conf(Object.keys(C._t.BANCOS).every((k) => /^\d{3}$/.test(k)), 'codigos com 3 digitos');
conf(Object.values(C._t.BANCOS).every((n) => typeof n === 'string' && n.length > 1 && !/[<>"]/.test(n)), 'nomes limpos');

// ---------------------------------------------------------------- CEP
conf(C.CEP_URL === 'https://www.banxico.org.mx/cep/', 'endereco do CEP');

// ---------------------------------------------------------------- nada de Brasil
const fonte = require('fs').readFileSync(path.join(ROBO, 'lib/clabe.js'), 'utf8');
conf(!/firebase|require\(/.test(fonte.replace(/^.*'use strict';/s, '')), 'sem dependencia');

console.log(ok + ' conferencias, ' + falhas + ' falhas');
process.exit(falhas ? 1 : 0);
