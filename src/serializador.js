/**
 * O serializador.
 *
 * Três diferenças em relação ao `JSON.stringify`, e as três aparecem no dia a
 * dia:
 *
 * 1. **Ordem estável das chaves.** Dois processos que montam o mesmo objeto em
 *    ordens diferentes geram textos diferentes. Com as chaves ordenadas, o
 *    `diff` do arquivo de configuração e a assinatura do corpo param de mudar
 *    à toa.
 * 2. **O ciclo diz onde está.** `Converting circular structure to JSON` num
 *    objeto de 200 campos não ajuda; `raiz.pedido.cliente.ultimoPedido` ajuda.
 * 3. **`BigInt` funciona.** O embutido lança `TypeError`, o que obriga quem
 *    usa identificador grande a converter na mão em todo lugar.
 */

import { ErroDeSerializacao } from './erros.js';

/** Escapes obrigatórios pela RFC 8259. */
const ESCAPADOS = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};

/**
 * Controles, aspas, barra e **metade solta** de par substituto.
 *
 * A última parte é a sutil: um emoji é um par de dois caracteres, e escapar
 * as duas metades dele estaria certo pela sintaxe, mas produziria
 * `"\ud83d\ude42"` onde o resto do mundo escreve `"🙂"`. Só é escapada a
 * metade alta sem uma baixa depois, e a metade baixa sem uma alta antes.
 */
const PRECISA_ESCAPE =
  /[\u0000-\u001f"\\]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/**
 * Escreve um texto JSON entre aspas.
 *
 * Metade solta de par substituto vira `\uXXXX`. Sem isso o resultado não é
 * UTF-8 válido, e um arquivo assim quebra na leitura de qualquer outra
 * linguagem — mesmo tendo saído de um serializador.
 */
export function comoTexto(valor) {
  return `"${valor.replace(PRECISA_ESCAPE, (c) => ESCAPADOS[c] ?? `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}"`;
}

/** Números que JSON não tem. */
function comoNumero(valor, caminho) {
  if (Number.isFinite(valor)) return Object.is(valor, -0) ? '0' : String(valor);

  throw new ErroDeSerializacao(
    `JSON não representa ${Number.isNaN(valor) ? 'NaN' : String(valor)}`,
    caminho,
  );
}

/**
 * Serializa um valor.
 *
 * @param {*} valor
 * @param {{
 *   recuo?: number|string,
 *   ordenarChaves?: boolean,
 *   bigint?: 'numero'|'texto'|'erro',
 *   pularIndefinidos?: boolean,
 * }} opcoes
 */
export function serializar(valor, opcoes = {}) {
  const recuo = typeof opcoes.recuo === 'number' ? ' '.repeat(opcoes.recuo) : (opcoes.recuo ?? '');
  const ordenar = opcoes.ordenarChaves ?? false;
  const bigint = opcoes.bigint ?? 'numero';
  const pularIndefinidos = opcoes.pularIndefinidos ?? true;

  // A pilha guarda os objetos do caminho atual, não todos os já vistos: o
  // mesmo objeto aparecendo duas vezes lado a lado não é ciclo.
  const pilha = [];

  const escrever = (atual, caminho, nivel) => {
    if (atual !== null && typeof atual === 'object' && typeof atual.toJSON === 'function') {
      atual = atual.toJSON(caminho);
    }

    if (atual === null) return 'null';

    const tipo = typeof atual;

    if (tipo === 'boolean') return atual ? 'true' : 'false';
    if (tipo === 'string') return comoTexto(atual);
    if (tipo === 'number') return comoNumero(atual, caminho);

    if (tipo === 'bigint') {
      if (bigint === 'texto') return comoTexto(atual.toString());
      if (bigint === 'numero') return atual.toString();

      throw new ErroDeSerializacao('BigInt não tem representação em JSON', caminho);
    }

    if (tipo === 'undefined' || tipo === 'function' || tipo === 'symbol') return undefined;

    if (pilha.includes(atual)) {
      throw new ErroDeSerializacao(`Referência circular: ${caminho || 'raiz'} volta para um objeto já aberto`, caminho);
    }

    pilha.push(atual);

    try {
      const dentro = recuo ? `\n${recuo.repeat(nivel + 1)}` : '';
      const fora = recuo ? `\n${recuo.repeat(nivel)}` : '';
      const separador = recuo ? ',' : ',';

      if (Array.isArray(atual)) {
        if (atual.length === 0) return '[]';

        // Buraco de lista e valor sem representação viram `null`, como no
        // embutido: uma lista não pode perder posição.
        const itens = atual.map((item, i) => escrever(item, `${caminho}[${i}]`, nivel + 1) ?? 'null');

        return `[${dentro}${itens.join(separador + dentro)}${fora}]`;
      }

      const chaves = Object.keys(atual);

      if (ordenar) chaves.sort();

      const pares = [];

      for (const chave of chaves) {
        const escrito = escrever(atual[chave], caminho ? `${caminho}.${chave}` : chave, nivel + 1);

        if (escrito === undefined) {
          if (pularIndefinidos) continue;

          throw new ErroDeSerializacao(`Valor sem representação em JSON`, caminho ? `${caminho}.${chave}` : chave);
        }

        pares.push(`${comoTexto(chave)}:${recuo ? ' ' : ''}${escrito}`);
      }

      if (pares.length === 0) return '{}';

      return `{${dentro}${pares.join(separador + dentro)}${fora}}`;
    } finally {
      pilha.pop();
    }
  };

  const texto = escrever(valor, '', 0);

  if (texto === undefined) {
    throw new ErroDeSerializacao(`${typeof valor} não tem representação em JSON`, '');
  }

  return texto;
}
