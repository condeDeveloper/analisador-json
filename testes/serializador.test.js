import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analisar } from '../src/analisador.js';
import { serializar } from '../src/serializador.js';
import { ErroDeSerializacao } from '../src/erros.js';

/**
 * Gerador de valores pseudoaleatório com semente fixa.
 *
 * Semente fixa porque um teste que falha uma vez a cada cem execuções é pior
 * do que teste nenhum: ninguém consegue reproduzir. Se este quebrar, quebra
 * sempre no mesmo caso.
 */
function sorteio(semente = 20260922) {
  let estado = semente;

  return () => {
    estado = (estado * 1103515245 + 12345) & 0x7fffffff;

    return estado / 0x7fffffff;
  };
}

/** Monta um valor JSON qualquer, com profundidade controlada. */
function valorAleatorio(proximo, profundidade = 0) {
  const tipo = Math.floor(proximo() * (profundidade > 3 ? 5 : 7));

  switch (tipo) {
    case 0:
      return null;
    case 1:
      return proximo() > 0.5;
    case 2:
      return Math.floor((proximo() - 0.5) * 2_000_000);
    case 3:
      return (proximo() - 0.5) * 1000;
    case 4: {
      const alfabeto = 'abcçé "\\\n\t/🙂日本';
      const tamanho = Math.floor(proximo() * 12);

      return Array.from({ length: tamanho }, () => alfabeto[Math.floor(proximo() * alfabeto.length)]).join('');
    }
    case 5:
      return Array.from({ length: Math.floor(proximo() * 5) }, () => valorAleatorio(proximo, profundidade + 1));
    default: {
      const alvo = {};

      for (let i = 0; i < Math.floor(proximo() * 5); i += 1) {
        alvo[`c${Math.floor(proximo() * 1000)}`] = valorAleatorio(proximo, profundidade + 1);
      }

      return alvo;
    }
  }
}

describe('ida e volta contra o embutido', () => {
  it('mil valores sorteados: o que o embutido escreve, este lê igual', () => {
    const proximo = sorteio();

    for (let i = 0; i < 1000; i += 1) {
      const valor = valorAleatorio(proximo);
      const texto = JSON.stringify(valor);

      assert.deepEqual(analisar(texto), JSON.parse(texto), `divergiu no caso ${i}: ${texto}`);
    }
  });

  it('mil valores sorteados: o que este escreve, o embutido lê igual', () => {
    const proximo = sorteio(7);

    for (let i = 0; i < 1000; i += 1) {
      const valor = valorAleatorio(proximo);

      assert.deepEqual(JSON.parse(serializar(valor)), JSON.parse(JSON.stringify(valor)), `divergiu no caso ${i}`);
    }
  });

  it('o texto compacto sai idêntico ao do embutido', () => {
    const proximo = sorteio(99);

    for (let i = 0; i < 500; i += 1) {
      const valor = valorAleatorio(proximo);

      assert.equal(serializar(valor), JSON.stringify(valor), `divergiu no caso ${i}`);
    }
  });

  it('o recuo sai idêntico ao do embutido', () => {
    const proximo = sorteio(123);

    for (let i = 0; i < 200; i += 1) {
      const valor = valorAleatorio(proximo);

      assert.equal(serializar(valor, { recuo: 2 }), JSON.stringify(valor, null, 2), `divergiu no caso ${i}`);
    }
  });
});

describe('escapes na saída', () => {
  it('escapa o que a RFC exige e nada mais', () => {
    assert.equal(serializar('a"b'), '"a\\"b"');
    assert.equal(serializar('a\\b'), '"a\\\\b"');
    assert.equal(serializar('\b\f\n\r\t'), '"\\b\\f\\n\\r\\t"');
    assert.equal(serializar('/'), '"/"');
    assert.equal(serializar('ção'), '"ção"');
  });

  it('caractere de controle vira \\u', () => {
    assert.equal(serializar(String.fromCharCode(1)), '"\\u0001"');
  });

  it('metade solta de par substituto é escapada', () => {
    // Sem isso a saída não é UTF-8 válido e quebra na leitura de qualquer
    // outra linguagem, mesmo tendo saído de um serializador.
    const solta = String.fromCharCode(0xd800);

    assert.equal(serializar(solta), '"\\ud800"');
    assert.equal(serializar(solta), JSON.stringify(solta));
  });

  it('par substituto completo passa inteiro', () => {
    assert.equal(serializar('🙂'), '"🙂"');
  });
});

describe('ordem estável das chaves', () => {
  it('dois objetos com as mesmas chaves em ordens diferentes saem iguais', () => {
    // É o que faz o diff do arquivo de configuração e a assinatura do corpo
    // pararem de mudar à toa.
    const um = { b: 1, a: 2, c: 3 };
    const dois = { c: 3, a: 2, b: 1 };

    assert.notEqual(JSON.stringify(um), JSON.stringify(dois));
    assert.equal(serializar(um, { ordenarChaves: true }), serializar(dois, { ordenarChaves: true }));
    assert.equal(serializar(um, { ordenarChaves: true }), '{"a":2,"b":1,"c":3}');
  });

  it('ordena em todos os níveis', () => {
    assert.equal(
      serializar({ b: { z: 1, a: 2 }, a: 1 }, { ordenarChaves: true }),
      '{"a":1,"b":{"a":2,"z":1}}',
    );
  });

  it('a ordem da lista nunca muda', () => {
    assert.equal(serializar([3, 1, 2], { ordenarChaves: true }), '[3,1,2]');
  });
});

describe('o ciclo diz onde está', () => {
  it('mostra o caminho em vez de só dizer que existe', () => {
    const cliente = { nome: 'Ana' };
    const pedido = { numero: 7, cliente };

    cliente.ultimoPedido = pedido;

    const erro = (() => {
      try {
        serializar({ pedido });
      } catch (e) {
        return e;
      }
    })();

    assert.ok(erro instanceof ErroDeSerializacao);
    assert.equal(erro.caminho, 'pedido.cliente.ultimoPedido');
  });

  it('o mesmo objeto duas vezes lado a lado não é ciclo', () => {
    const comum = { a: 1 };

    assert.equal(serializar([comum, comum]), '[{"a":1},{"a":1}]');
  });

  it('lista que contém a si mesma é pega', () => {
    const lista = [1];

    lista.push(lista);

    assert.throws(() => serializar(lista), /circular/);
  });
});

describe('BigInt', () => {
  it('o embutido lança e este escreve', () => {
    assert.throws(() => JSON.stringify({ id: 1n }), TypeError);
    assert.equal(serializar({ id: 9007199254740993n }), '{"id":9007199254740993}');
  });

  it('dá para pedir como texto', () => {
    assert.equal(serializar({ id: 10n }, { bigint: 'texto' }), '{"id":"10"}');
  });

  it('dá para pedir o erro de volta', () => {
    assert.throws(() => serializar({ id: 10n }, { bigint: 'erro' }), ErroDeSerializacao);
  });

  it('o que este escreve com bigint, este lê de volta com bigint', () => {
    const texto = serializar({ id: 9007199254740993n });

    assert.equal(analisar(texto, { grandes: 'bigint' }).id, 9007199254740993n);
  });
});

describe('valores sem representação', () => {
  it('NaN e Infinity são erro, com o caminho junto', () => {
    assert.throws(() => serializar({ a: { b: NaN } }), /NaN/);
    assert.throws(() => serializar(Infinity), /Infinity/);

    const erro = (() => {
      try {
        serializar({ a: { b: NaN } });
      } catch (e) {
        return e;
      }
    })();

    assert.equal(erro.caminho, 'a.b');
  });

  it('undefined e função somem do objeto, como no embutido', () => {
    assert.equal(serializar({ a: 1, b: undefined, c: () => {} }), '{"a":1}');
    assert.equal(serializar({ a: 1, b: undefined }), JSON.stringify({ a: 1, b: undefined }));
  });

  it('na lista eles viram null, para não perder posição', () => {
    assert.equal(serializar([1, undefined, 2]), '[1,null,2]');
    assert.equal(serializar([1, undefined, 2]), JSON.stringify([1, undefined, 2]));
  });

  it('serializar undefined direto é erro', () => {
    assert.throws(() => serializar(undefined), ErroDeSerializacao);
  });

  it('menos zero vira zero, como no embutido', () => {
    assert.equal(serializar(-0), '0');
    assert.equal(serializar(-0), JSON.stringify(-0));
  });

  it('toJSON é respeitado', () => {
    const data = new Date('2026-09-22T03:00:00.000Z');

    assert.equal(serializar({ quando: data }), JSON.stringify({ quando: data }));
    assert.equal(serializar({ x: { toJSON: () => 42 } }), '{"x":42}');
  });
});
