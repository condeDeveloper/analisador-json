/**
 * O analisador.
 *
 * Descida recursiva sobre o texto, seguindo a RFC 8259 à risca. Três coisas
 * o separam do `JSON.parse` embutido, e são as três razões de este projeto
 * existir:
 *
 * 1. **O erro diz onde.** Linha, coluna, o caminho do valor (`usuarios[2].nome`)
 *    e o trecho com um cursor embaixo.
 * 2. **Chave repetida é erro.** `{"a":1,"a":2}` é JSON válido pela gramática,
 *    e o `JSON.parse` fica com o último em silêncio. Quando os dois lados de
 *    uma integração geram o mesmo campo, esse silêncio vira um bug de
 *    produção que ninguém acha.
 * 3. **Inteiro grande não perde dígito.** `JSON.parse('9007199254740993')`
 *    devolve 9007199254740992. Um identificador de banco de dados que volta
 *    errado por um é pior do que um erro.
 */

import { ErroDeJson } from './erros.js';

/** O que fazer quando a mesma chave aparece duas vezes no mesmo objeto. */
export const DUPLICADAS = ['erro', 'ultima', 'primeira'];

/** Como devolver um inteiro que não cabe em `Number` sem perder dígito. */
export const GRANDES = ['numero', 'bigint', 'texto'];

const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/** Espaço em branco, pela RFC: só estes quatro. */
const BRANCOS = new Set([0x20, 0x09, 0x0a, 0x0d]);

/**
 * Analisa um texto JSON.
 *
 * @param {string} texto
 * @param {{
 *   duplicadas?: 'erro'|'ultima'|'primeira',
 *   grandes?: 'numero'|'bigint'|'texto',
 *   profundidadeMaxima?: number,
 *   semPrototipo?: boolean,
 *   reviver?: (chave: string, valor: any, caminho: string) => any,
 * }} opcoes
 */
export function analisar(texto, opcoes = {}) {
  if (typeof texto !== 'string') {
    throw new TypeError(`Esperava texto, veio ${texto === null ? 'null' : typeof texto}.`);
  }

  return new Analisador(texto, opcoes).documento();
}

/** O estado da análise. Uma instância por texto. */
export class Analisador {
  constructor(texto, opcoes = {}) {
    this.texto = texto;
    this.i = 0;
    this.profundidade = 0;

    this.duplicadas = opcoes.duplicadas ?? 'erro';
    this.grandes = opcoes.grandes ?? 'numero';
    this.profundidadeMaxima = opcoes.profundidadeMaxima ?? 512;
    this.semPrototipo = opcoes.semPrototipo ?? false;
    this.reviver = opcoes.reviver ?? null;

    if (!DUPLICADAS.includes(this.duplicadas)) {
      throw new TypeError(`duplicadas deve ser ${DUPLICADAS.join(', ')}.`);
    }

    if (!GRANDES.includes(this.grandes)) {
      throw new TypeError(`grandes deve ser ${GRANDES.join(', ')}.`);
    }
  }

  /** Levanta o erro já com posição e caminho. */
  erro(mensagem, indice = this.i, caminho = '') {
    return new ErroDeJson(mensagem, { texto: this.texto, indice, caminho });
  }

  /** O documento inteiro: um valor e mais nada depois dele. */
  documento() {
    this.pularBrancos();

    if (this.i >= this.texto.length) throw this.erro('Documento vazio');

    const valor = this.valor('');

    this.pularBrancos();

    if (this.i < this.texto.length) {
      throw this.erro(`Sobrou conteúdo depois do valor: ${JSON.stringify(this.texto[this.i])}`);
    }

    return valor;
  }

  pularBrancos() {
    while (this.i < this.texto.length && BRANCOS.has(this.texto.charCodeAt(this.i))) this.i += 1;
  }

  /** O caractere atual, ou vazio no fim. */
  atual() {
    return this.texto[this.i] ?? '';
  }

  /** Um valor qualquer. */
  valor(caminho) {
    const c = this.atual();

    if (c === '{') return this.objeto(caminho);
    if (c === '[') return this.lista(caminho);
    if (c === '"') return this.texto_(caminho);
    if (c === '-' || (c >= '0' && c <= '9')) return this.numero(caminho);

    for (const [palavra, resultado] of [['true', true], ['false', false], ['null', null]]) {
      if (this.texto.startsWith(palavra, this.i)) {
        this.i += palavra.length;
        return resultado;
      }
    }

    if (c === '') throw this.erro('Acabou o texto onde um valor era esperado', this.i, caminho);

    // As confusões mais comuns vêm de JavaScript e de YAML; dizer o nome do
    // problema poupa muito mais tempo do que "token inesperado".
    const dicas = {
      "'": 'JSON usa aspas duplas, nunca simples',
      N: 'NaN não existe em JSON',
      I: 'Infinity não existe em JSON',
      u: 'undefined não existe em JSON; use null',
      '+': 'número em JSON não pode começar com sinal de mais',
      '.': 'número em JSON precisa de um dígito antes do ponto',
    };

    const dica = dicas[c];

    throw this.erro(
      `Valor inesperado: ${JSON.stringify(c)}${dica ? ` — ${dica}` : ''}`,
      this.i,
      caminho,
    );
  }

  /** Entra num nível, conferindo o teto. */
  descer(caminho) {
    this.profundidade += 1;

    // Sem esta trava, um texto com 100 mil colchetes derruba a pilha e o
    // processo inteiro cai com um RangeError sem contexto nenhum.
    if (this.profundidade > this.profundidadeMaxima) {
      throw this.erro(`Aninhamento passou de ${this.profundidadeMaxima} níveis`, this.i, caminho);
    }
  }

  objeto(caminho) {
    this.descer(caminho);
    this.i += 1;

    const alvo = this.semPrototipo ? Object.create(null) : {};
    const vistas = new Set();

    this.pularBrancos();

    if (this.atual() === '}') {
      this.i += 1;
      this.profundidade -= 1;

      return alvo;
    }

    for (;;) {
      this.pularBrancos();

      if (this.atual() !== '"') {
        throw this.erro('Chave de objeto precisa ser um texto entre aspas', this.i, caminho);
      }

      const inicioDaChave = this.i;
      const chave = this.texto_(caminho);
      const dentro = caminho ? `${caminho}.${chave}` : chave;

      this.pularBrancos();

      if (this.atual() !== ':') throw this.erro('Esperava ":" depois da chave', this.i, dentro);

      this.i += 1;
      this.pularBrancos();

      const valor = this.valor(dentro);
      const repetida = vistas.has(chave);

      if (repetida && this.duplicadas === 'erro') {
        throw this.erro(`Chave repetida no mesmo objeto: ${JSON.stringify(chave)}`, inicioDaChave, caminho);
      }

      vistas.add(chave);

      if (!repetida || this.duplicadas === 'ultima') this.guardar(alvo, chave, valor, dentro);

      this.pularBrancos();

      const c = this.atual();

      if (c === ',') {
        this.i += 1;
        this.pularBrancos();

        // Vírgula sobrando é o erro de JSON mais comum que existe, e vale
        // ser nomeado em vez de virar "chave precisa ser texto".
        if (this.atual() === '}') throw this.erro('Vírgula sobrando antes de "}"', this.i - 1, caminho);

        continue;
      }

      if (c === '}') {
        this.i += 1;
        this.profundidade -= 1;

        return alvo;
      }

      throw this.erro(c === '' ? 'Objeto sem "}"' : `Esperava "," ou "}", veio ${JSON.stringify(c)}`, this.i, caminho);
    }
  }

  /**
   * Grava a chave sem deixar `__proto__` mudar o protótipo.
   *
   * `alvo[chave] = valor` com a chave `__proto__` **não** cria propriedade
   * nenhuma: ele chama o setter herdado e troca o protótipo do objeto. É a
   * poluição de protótipo clássica, e `defineProperty` a desarma.
   */
  guardar(alvo, chave, valor, caminho) {
    const revisto = this.reviver ? this.reviver(chave, valor, caminho) : valor;

    if (revisto === undefined && this.reviver) return;

    Object.defineProperty(alvo, chave, { value: revisto, writable: true, enumerable: true, configurable: true });
  }

  lista(caminho) {
    this.descer(caminho);
    this.i += 1;

    const alvo = [];

    this.pularBrancos();

    if (this.atual() === ']') {
      this.i += 1;
      this.profundidade -= 1;

      return alvo;
    }

    for (;;) {
      this.pularBrancos();

      const dentro = `${caminho}[${alvo.length}]`;
      const valor = this.valor(dentro);

      alvo.push(this.reviver ? this.reviver(String(alvo.length), valor, dentro) : valor);

      this.pularBrancos();

      const c = this.atual();

      if (c === ',') {
        this.i += 1;
        this.pularBrancos();

        if (this.atual() === ']') throw this.erro('Vírgula sobrando antes de "]"', this.i - 1, caminho);

        continue;
      }

      if (c === ']') {
        this.i += 1;
        this.profundidade -= 1;

        return alvo;
      }

      throw this.erro(c === '' ? 'Lista sem "]"' : `Esperava "," ou "]", veio ${JSON.stringify(c)}`, this.i, caminho);
    }
  }

  texto_(caminho) {
    const inicio = this.i;

    this.i += 1;

    let saida = '';

    for (;;) {
      const c = this.atual();

      if (c === '') throw this.erro('Texto sem aspas de fechamento', inicio, caminho);

      if (c === '"') {
        this.i += 1;
        return saida;
      }

      if (c === '\\') {
        saida += this.escape(caminho);
        continue;
      }

      const codigo = this.texto.charCodeAt(this.i);

      // Caractere de controle cru dentro de texto é proibido pela RFC. Deixar
      // passar produz um JSON que metade dos leitores do mundo recusa.
      if (codigo < 0x20) {
        throw this.erro(
          `Caractere de controle sem escape no texto (U+${codigo.toString(16).padStart(4, '0').toUpperCase()})`,
          this.i,
          caminho,
        );
      }

      saida += c;
      this.i += 1;
    }
  }

  escape(caminho) {
    const inicio = this.i;

    this.i += 1;

    const c = this.atual();

    if (c in ESCAPES) {
      this.i += 1;
      return ESCAPES[c];
    }

    if (c !== 'u') {
      throw this.erro(`Escape desconhecido: \\${c === '' ? '<fim>' : c}`, inicio, caminho);
    }

    return String.fromCharCode(this.hexadecimal(caminho));
  }

  /** Os quatro dígitos de um `\uXXXX`. */
  hexadecimal(caminho) {
    const inicio = this.i;

    this.i += 1;

    const digitos = this.texto.slice(this.i, this.i + 4);

    if (digitos.length < 4 || !/^[0-9a-fA-F]{4}$/.test(digitos)) {
      throw this.erro(`\\u precisa de quatro dígitos hexadecimais, veio ${JSON.stringify(digitos)}`, inicio, caminho);
    }

    this.i += 4;

    return Number.parseInt(digitos, 16);
  }

  numero(caminho) {
    const inicio = this.i;

    if (this.atual() === '-') this.i += 1;

    const inicioInteiro = this.i;

    if (this.atual() === '0') {
      this.i += 1;

      // `01` não é JSON. Aceitar seria abrir a porta para octal em quem lê.
      if (/[0-9]/.test(this.atual())) {
        throw this.erro('Número não pode ter zero à esquerda', inicio, caminho);
      }
    } else {
      while (/[0-9]/.test(this.atual())) this.i += 1;
    }

    if (this.i === inicioInteiro) throw this.erro('Número sem dígitos', inicio, caminho);

    let inteiro = true;

    if (this.atual() === '.') {
      inteiro = false;
      this.i += 1;

      const antes = this.i;

      while (/[0-9]/.test(this.atual())) this.i += 1;

      if (this.i === antes) throw this.erro('Número com ponto e sem casas decimais', inicio, caminho);
    }

    if (this.atual() === 'e' || this.atual() === 'E') {
      inteiro = false;
      this.i += 1;

      if (this.atual() === '+' || this.atual() === '-') this.i += 1;

      const antes = this.i;

      while (/[0-9]/.test(this.atual())) this.i += 1;

      if (this.i === antes) throw this.erro('Expoente sem dígitos', inicio, caminho);
    }

    const bruto = this.texto.slice(inicio, this.i);
    const valor = Number(bruto);

    // Aqui está o dígito que o JSON.parse perde: um inteiro fora da faixa
    // segura volta arredondado, e nada avisa.
    if (inteiro && !Number.isSafeInteger(valor)) {
      if (this.grandes === 'bigint') return BigInt(bruto);
      if (this.grandes === 'texto') return bruto;
    }

    return valor;
  }
}
