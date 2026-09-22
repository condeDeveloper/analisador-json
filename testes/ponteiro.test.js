import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ErroDePonteiro,
  caminhos,
  definir,
  degraus,
  desescapar,
  escapar,
  existe,
  montar,
  obter,
  obterOu,
  remover,
} from '../src/ponteiro.js';
import { lerArgumentos, principal } from '../src/cli.js';

/** O documento do apêndice da RFC 6901, que é o teste de conformidade dela. */
const RFC = {
  foo: ['bar', 'baz'],
  '': 0,
  'a/b': 1,
  'c%d': 2,
  "e^f": 3,
  'g|h': 4,
  'i\\j': 5,
  'k"l': 6,
  ' ': 7,
  'm~n': 8,
};

/** Roda a CLI com um leitor de arquivo falso. */
async function rodar(argumentos, arquivos = {}) {
  const linhas = [];
  const codigo = await principal(argumentos, (l) => linhas.push(String(l)), async (caminho) => {
    if (!(caminho in arquivos)) throw new Error('não existe');

    return arquivos[caminho];
  });

  return { codigo, saida: linhas.join('\n') };
}

describe('os exemplos da RFC 6901', () => {
  const esperado = {
    '': RFC,
    '/foo': ['bar', 'baz'],
    '/foo/0': 'bar',
    '/': 0,
    '/a~1b': 1,
    '/c%d': 2,
    '/e^f': 3,
    '/g|h': 4,
    '/i\\j': 5,
    '/k"l': 6,
    '/ ': 7,
    '/m~0n': 8,
  };

  for (const [ponteiro, valor] of Object.entries(esperado)) {
    it(`${JSON.stringify(ponteiro)} leva ao valor certo`, () => {
      assert.deepEqual(obter(RFC, ponteiro), valor);
    });
  }
});

describe('escape dos degraus', () => {
  it('a barra vira ~1 e o til vira ~0', () => {
    assert.equal(escapar('a/b'), 'a~1b');
    assert.equal(escapar('m~n'), 'm~0n');
  });

  it('a ordem de desfazer importa', () => {
    // Fazendo ~0 primeiro, `~01` viraria `~1` e depois `/` — a chave errada.
    assert.equal(desescapar('~01'), '~1');
    assert.equal(desescapar('~1'), '/');
    assert.equal(desescapar(escapar('~1')), '~1');
  });

  it('vai e volta com qualquer chave', () => {
    for (const chave of ['a/b', '~', '~0', '~1', 'a~1b', '', 'normal']) {
      assert.equal(desescapar(escapar(chave)), chave);
    }
  });

  it('degraus e montar são inversos', () => {
    assert.deepEqual(degraus('/a~1b/c'), ['a/b', 'c']);
    assert.equal(montar(['a/b', 'c']), '/a~1b/c');
    assert.deepEqual(degraus(''), []);
    assert.equal(montar([]), '');
  });

  it('ponteiro que não começa com barra é recusado', () => {
    assert.throws(() => obter(RFC, 'foo'), ErroDePonteiro);
  });
});

describe('caminho que não existe', () => {
  it('reclama dizendo o que faltou', () => {
    assert.throws(() => obter(RFC, '/nada'), /Chave inexistente/);
    assert.throws(() => obter(RFC, '/foo/9'), /fora da lista/);
    assert.throws(() => obter(RFC, '/foo/0/mais'), /Não dá para entrar em string/);
  });

  it('índice de lista precisa ser dígito sem zero à esquerda', () => {
    assert.throws(() => obter(RFC, '/foo/01'), /Índice de lista inválido/);
    assert.throws(() => obter(RFC, '/foo/a'), /Índice de lista inválido/);
    assert.throws(() => obter(RFC, '/foo/-'), /só vale para acrescentar/);
  });

  it('existe e obterOu não levantam', () => {
    assert.equal(existe(RFC, '/foo/0'), true);
    assert.equal(existe(RFC, '/nada'), false);
    assert.equal(obterOu(RFC, '/nada', 'padrão'), 'padrão');
    assert.equal(obterOu(RFC, '/foo/1'), 'baz');
  });
});

describe('gravar e remover', () => {
  it('grava numa chave nova e numa existente', () => {
    const documento = { a: { b: 1 } };

    definir(documento, '/a/b', 2);
    definir(documento, '/a/c', 3);

    assert.deepEqual(documento, { a: { b: 2, c: 3 } });
  });

  it('o degrau "-" acrescenta no fim da lista', () => {
    const documento = { lista: [1, 2] };

    definir(documento, '/lista/-', 3);

    assert.deepEqual(documento.lista, [1, 2, 3]);
  });

  it('__proto__ continua sendo uma chave comum', () => {
    const documento = {};

    definir(documento, '/__proto__', { poluido: true });

    assert.equal({}.poluido, undefined);
    assert.deepEqual(documento.__proto__, { poluido: true });
  });

  it('remover tira da lista sem deixar buraco', () => {
    const documento = { lista: [1, 2, 3] };

    remover(documento, '/lista/1');

    assert.deepEqual(documento.lista, [1, 3]);
  });

  it('remover apaga a chave do objeto', () => {
    const documento = { a: 1, b: 2 };

    remover(documento, '/b');

    assert.deepEqual(documento, { a: 1 });
  });

  it('o documento inteiro não é alvo de gravar nem de remover', () => {
    assert.throws(() => definir({}, '', 1), ErroDePonteiro);
    assert.throws(() => remover({}, ''), ErroDePonteiro);
  });
});

describe('caminhos', () => {
  it('lista os ponteiros de todas as folhas', () => {
    assert.deepEqual(caminhos({ a: 1, b: { c: [true, null] } }), ['/a', '/b/c/0', '/b/c/1']);
  });

  it('objeto e lista vazios são folhas', () => {
    assert.deepEqual(caminhos({ a: {}, b: [] }), ['/a', '/b']);
  });

  it('o que caminhos devolve, obter consegue seguir', () => {
    const documento = { a: [1, { b: 'x' }], c: null };

    for (const ponteiro of caminhos(documento)) {
      assert.doesNotThrow(() => obter(documento, ponteiro), `não consegui seguir ${ponteiro}`);
    }
  });
});

describe('linha de comando', () => {
  it('lê os argumentos', () => {
    const opcoes = lerArgumentos(['ler', 'a.json', '/x', '-o', '-r', '4', '-d', 'ultima', '-g', 'bigint']);

    assert.equal(opcoes.comando, 'ler');
    assert.equal(opcoes.arquivo, 'a.json');
    assert.equal(opcoes.ponteiro, '/x');
    assert.equal(opcoes.ordenar, true);
    assert.equal(opcoes.recuo, 4);
    assert.equal(opcoes.duplicadas, 'ultima');
    assert.equal(opcoes.grandes, 'bigint');
  });

  it('recusa opção e valor inválidos', () => {
    assert.throws(() => lerArgumentos(['--inventada']), /desconhecida/);
    assert.throws(() => lerArgumentos(['validar', 'a', '-r', 'x']), /inteiro não negativo/);
    assert.throws(() => lerArgumentos(['validar', 'a', '-d', 'talvez']), /erro, ultima ou primeira/);
  });

  it('valida, formata e compacta', async () => {
    const arquivos = { 'a.json': '{"b":1,"a":[1,2]}' };

    assert.deepEqual(await rodar(['validar', 'a.json'], arquivos), { codigo: 0, saida: 'válido' });
    assert.equal((await rodar(['compactar', 'a.json'], arquivos)).saida, '{"b":1,"a":[1,2]}');
    assert.equal((await rodar(['compactar', 'a.json', '-o'], arquivos)).saida, '{"a":[1,2],"b":1}');
    assert.match((await rodar(['formatar', 'a.json'], arquivos)).saida, /^\{\n {2}"b": 1,/);
  });

  it('segue um ponteiro', async () => {
    const arquivos = { 'a.json': '{"usuarios":[{"nome":"Ana"}]}' };

    assert.equal((await rodar(['ler', 'a.json', '/usuarios/0/nome'], arquivos)).saida, '"Ana"');
  });

  it('lista os caminhos', async () => {
    const { saida } = await rodar(['caminhos', 'a.json'], { 'a.json': '{"a":1,"b":[2]}' });

    assert.equal(saida, '/a\n/b/0');
  });

  it('JSON inválido sai com 1 e mostra linha e coluna', async () => {
    const { codigo, saida } = await rodar(['validar', 'a.json'], { 'a.json': '{"a":1,}' });

    assert.equal(codigo, 1);
    assert.match(saida, /a\.json: Vírgula sobrando/);
    // A coluna 7 é a da própria vírgula, que é onde o cursor deve apontar.
    assert.match(saida, /linha 1, coluna 7/);
  });

  it('chave repetida é erro por padrão e passa com -d ultima', async () => {
    const arquivos = { 'a.json': '{"a":1,"a":2}' };

    assert.equal((await rodar(['validar', 'a.json'], arquivos)).codigo, 1);
    assert.equal((await rodar(['validar', 'a.json', '-d', 'ultima'], arquivos)).codigo, 0);
  });

  it('ponteiro que não leva a lugar nenhum sai com 1', async () => {
    const { codigo } = await rodar(['ler', 'a.json', '/nada'], { 'a.json': '{}' });

    assert.equal(codigo, 1);
  });

  it('sem comando, comando errado e arquivo faltando saem com 2', async () => {
    assert.equal((await rodar([])).codigo, 2);
    assert.equal((await rodar(['voar', 'a.json'])).codigo, 2);
    assert.equal((await rodar(['validar'])).codigo, 2);
    assert.equal((await rodar(['validar', 'sumiu.json'])).codigo, 2);
    assert.equal((await rodar(['ler', 'a.json'], { 'a.json': '{}' })).codigo, 2);
  });

  it('a ajuda sai com 0', async () => {
    const { codigo, saida } = await rodar(['--ajuda']);

    assert.equal(codigo, 0);
    assert.match(saida, /analisador-json/);
  });
});
