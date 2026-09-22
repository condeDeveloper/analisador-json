import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analisar } from '../src/analisador.js';
import { ErroDeJson, posicaoDe, trechoDe } from '../src/erros.js';

/** Captura o erro para poder olhar os campos dele. */
function pegar(fn) {
  try {
    fn();
  } catch (erro) {
    return erro;
  }

  return null;
}

describe('o que a RFC 8259 manda aceitar', () => {
  it('os valores simples', () => {
    assert.equal(analisar('true'), true);
    assert.equal(analisar('false'), false);
    assert.equal(analisar('null'), null);
    assert.equal(analisar('0'), 0);
    assert.equal(analisar('"oi"'), 'oi');
  });

  it('objeto e lista vazios', () => {
    assert.deepEqual(analisar('{}'), {});
    assert.deepEqual(analisar('[]'), []);
    assert.deepEqual(analisar('  {  }  '), {});
  });

  it('só estes quatro são espaço em branco', () => {
    // Espaço, tabulação, nova linha e retorno. Nada mais — nem o espaço
    // inquebrável, que vem colado quando alguém copia JSON de uma página.
    const brancos = String.fromCharCode(0x20, 0x09, 0x0a, 0x0d);

    assert.deepEqual(analisar(`${brancos}[1]${brancos}`), [1]);
    assert.throws(() => analisar(String.fromCharCode(0xa0) + '[1]'), ErroDeJson);
    assert.throws(() => analisar(String.fromCharCode(0x0b) + '[1]'), ErroDeJson);
  });

  it('aninhamento fundo funciona dentro do teto', () => {
    const texto = `${'['.repeat(400)}1${']'.repeat(400)}`;

    assert.equal(analisar(texto, { profundidadeMaxima: 500 }).flat(Infinity)[0], 1);
  });

  it('números em todas as formas da gramática', () => {
    assert.equal(analisar('-0.5e+3'), -500);
    assert.equal(analisar('1E-2'), 0.01);
    assert.equal(analisar('-0'), -0);
    assert.equal(analisar('1e2'), 100);
  });

  it('escapes de texto', () => {
    assert.equal(analisar('"a\\"b"'), 'a"b');
    assert.equal(analisar('"\\\\"'), '\\');
    assert.equal(analisar('"\\/"'), '/');
    assert.equal(analisar('"\\b\\f\\n\\r\\t"'), '\b\f\n\r\t');
    assert.equal(analisar('"\\u00e7\\u00e3o"'), 'ção');
  });

  it('par substituto vira um emoji só', () => {
    assert.equal(analisar('"\\ud83d\\ude42"'), '🙂');
    assert.equal(analisar('"\\ud83d\\ude42"').length, 2);
  });
});

describe('o que a RFC manda recusar', () => {
  const invalidos = {
    'vírgula sobrando no objeto': '{"a":1,}',
    'vírgula sobrando na lista': '[1,2,]',
    'aspas simples': "{'a':1}",
    'chave sem aspas': '{a:1}',
    'NaN': 'NaN',
    'Infinity': 'Infinity',
    'undefined': 'undefined',
    'zero à esquerda': '01',
    'sinal de mais': '+1',
    'ponto sem inteiro': '.5',
    'ponto sem decimais': '1.',
    'expoente vazio': '1e',
    'comentário': '{"a":1} // nota',
    'sobra depois do valor': '{} {}',
    'texto sem fechar': '"aberto',
    'objeto sem fechar': '{"a":1',
    'lista sem fechar': '[1,2',
    'escape desconhecido': '"\\x41"',
    'unicode curto': '"\\u12"',
    'documento vazio': '',
    'só espaço': '   ',
    'dois pontos faltando': '{"a" 1}',
  };

  for (const [nome, texto] of Object.entries(invalidos)) {
    it(`recusa ${nome}`, () => {
      assert.throws(() => analisar(texto), ErroDeJson, `deveria recusar ${JSON.stringify(texto)}`);
    });
  }

  it('recusa caractere de controle cru dentro do texto', () => {
    // Deixar passar produz um JSON que metade dos leitores do mundo recusa.
    assert.throws(() => analisar('"quebra\naqui"'), /Caractere de controle/);
    assert.throws(() => analisar('"tab\tqui"'), ErroDeJson);
  });

  it('o que o JSON.parse também recusa, este recusa igual', () => {
    for (const texto of Object.values(invalidos)) {
      assert.throws(() => JSON.parse(texto), undefined, `o embutido aceitou ${JSON.stringify(texto)}`);
    }
  });
});

describe('o erro diz onde', () => {
  it('traz linha, coluna e o trecho com cursor', () => {
    const texto = '{\n  "nome": "Ana",\n  "idade": 3O\n}';
    const erro = pegar(() => analisar(texto));

    assert.ok(erro instanceof ErroDeJson);
    assert.equal(erro.linha, 3);
    assert.match(erro.message, /linha 3, coluna \d+/);
    assert.match(erro.message, /\^/);
  });

  it('traz o caminho do valor com problema', () => {
    const erro = pegar(() => analisar('{"usuarios":[{"nome":"Ana"},{"nome":}]}'));

    assert.equal(erro.caminho, 'usuarios[1].nome');
  });

  it('nomeia as confusões mais comuns', () => {
    assert.match(pegar(() => analisar("['a']")).message, /aspas duplas/);
    assert.match(pegar(() => analisar('[NaN]')).message, /NaN não existe/);
    assert.match(pegar(() => analisar('[undefined]')).message, /use null/);
    assert.match(pegar(() => analisar('{"a":1,}')).message, /Vírgula sobrando/);
  });

  it('linha comprida é recortada em volta da coluna', () => {
    const texto = `{"a":"${'x'.repeat(500)}",...}`;
    const erro = pegar(() => analisar(texto));

    assert.ok(erro.message.length < 400, 'a mensagem não pode despejar a linha inteira');
    assert.match(erro.message, /…/);
  });

  it('posicaoDe conta a partir de 1', () => {
    assert.deepEqual(posicaoDe('ab\ncd', 0), { linha: 1, coluna: 1 });
    assert.deepEqual(posicaoDe('ab\ncd', 3), { linha: 2, coluna: 1 });
    assert.deepEqual(posicaoDe('ab\ncd', 4), { linha: 2, coluna: 2 });
  });

  it('o cursor cai debaixo da coluna certa', () => {
    const [, cursor] = trechoDe('  erro aqui', 6).split('\n');

    assert.equal(cursor.length - 1, 6);
  });
});

describe('chave repetida', () => {
  it('é erro por padrão', () => {
    // O embutido fica com o último em silêncio, e o silêncio vira bug de
    // produção quando os dois lados geram o mesmo campo.
    assert.equal(JSON.parse('{"a":1,"a":2}').a, 2);
    assert.throws(() => analisar('{"a":1,"a":2}'), /Chave repetida/);
  });

  it('dá para escolher a primeira ou a última', () => {
    assert.equal(analisar('{"a":1,"a":2}', { duplicadas: 'ultima' }).a, 2);
    assert.equal(analisar('{"a":1,"a":2}', { duplicadas: 'primeira' }).a, 1);
  });

  it('a mesma chave em objetos irmãos não é repetição', () => {
    assert.deepEqual(analisar('[{"a":1},{"a":2}]'), [{ a: 1 }, { a: 2 }]);
  });

  it('o erro aponta para a segunda ocorrência', () => {
    const erro = pegar(() => analisar('{"a":1,\n "a":2}'));

    assert.equal(erro.linha, 2);
  });
});

describe('inteiro grande', () => {
  const GRANDE = '9007199254740993';

  it('o embutido perde o último dígito', () => {
    // 2^53 + 1 não cabe num double. O embutido arredonda e não avisa.
    assert.equal(JSON.parse(GRANDE), 9007199254740992);
  });

  it('com bigint o dígito fica', () => {
    assert.equal(analisar(GRANDE, { grandes: 'bigint' }), 9007199254740993n);
  });

  it('com texto o valor original fica à mão', () => {
    assert.equal(analisar(`{"id":${GRANDE}}`, { grandes: 'texto' }).id, GRANDE);
  });

  it('o padrão continua igual ao embutido', () => {
    assert.equal(analisar(GRANDE), JSON.parse(GRANDE));
  });

  it('número com casas decimais não vira bigint', () => {
    assert.equal(analisar('1.5', { grandes: 'bigint' }), 1.5);
    assert.equal(typeof analisar('1e400', { grandes: 'bigint' }), 'number');
  });

  it('inteiro dentro da faixa segura continua número', () => {
    assert.equal(analisar('9007199254740991', { grandes: 'bigint' }), 9007199254740991);
  });
});

describe('segurança', () => {
  it('a chave __proto__ não polui o protótipo', () => {
    // Com `alvo[chave] = valor` isto trocaria o protótipo em vez de criar a
    // chave, e todo objeto do processo passaria a ter `poluido`.
    const objeto = analisar('{"__proto__": {"poluido": true}}');

    assert.equal({}.poluido, undefined);
    assert.equal(Object.getPrototypeOf(objeto), Object.prototype);
    assert.deepEqual(objeto.__proto__, { poluido: true });
  });

  it('constructor também fica sendo uma chave comum', () => {
    const objeto = analisar('{"constructor": 1}');

    assert.equal(objeto.constructor, 1);
    assert.equal({}.constructor, Object);
  });

  it('o teto de aninhamento evita a pilha estourar', () => {
    const fundo = `${'['.repeat(100_000)}1${']'.repeat(100_000)}`;

    assert.throws(() => analisar(fundo), /Aninhamento passou de 512/);
  });

  it('com semPrototipo o objeto nasce sem herança nenhuma', () => {
    const objeto = analisar('{"a":1}', { semPrototipo: true });

    assert.equal(Object.getPrototypeOf(objeto), null);
    assert.equal(objeto.toString, undefined);
  });
});

describe('opções inválidas', () => {
  it('reclamam em vez de escolher por conta', () => {
    assert.throws(() => analisar('1', { duplicadas: 'talvez' }), TypeError);
    assert.throws(() => analisar('1', { grandes: 'talvez' }), TypeError);
    assert.throws(() => analisar(null), /Esperava texto/);
    assert.throws(() => analisar(42), /veio number/);
  });
});
