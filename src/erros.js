/**
 * O erro que diz onde.
 *
 * `JSON.parse` erra assim:
 *
 *     Unexpected token } in JSON at position 87
 *
 * Posição 87 de um arquivo de 4 KB não ajuda ninguém. O que ajuda é linha,
 * coluna e o trecho com um cursor embaixo — que é o que um compilador faz há
 * cinquenta anos e um analisador de JSON deveria fazer também.
 */

/** Converte um índice em linha e coluna, contando a partir de 1. */
export function posicaoDe(texto, indice) {
  const limite = Math.max(0, Math.min(indice, texto.length));
  const antes = texto.slice(0, limite);
  const quebra = antes.lastIndexOf('\n');

  return { linha: antes.split('\n').length, coluna: limite - quebra };
}

/** Recorta a linha do erro e monta o cursor embaixo da coluna. */
export function trechoDe(texto, indice, { largura = 60 } = {}) {
  const { linha, coluna } = posicaoDe(texto, indice);
  const linhas = texto.split('\n');
  const conteudo = linhas[linha - 1] ?? '';

  // Linha comprida é cortada em volta da coluna: mostrar 4 KB numa mensagem
  // de erro é o mesmo que não mostrar nada.
  const meio = Math.floor(largura / 2);
  const inicio = Math.max(0, coluna - 1 - meio);
  const fim = Math.min(conteudo.length, inicio + largura);

  const recorte = (inicio > 0 ? '…' : '') + conteudo.slice(inicio, fim) + (fim < conteudo.length ? '…' : '');
  const deslocamento = coluna - 1 - inicio + (inicio > 0 ? 1 : 0);

  return `${recorte}\n${' '.repeat(Math.max(0, deslocamento))}^`;
}

/** O texto não é JSON válido. */
export class ErroDeJson extends SyntaxError {
  /**
   * @param {string} mensagem o que houve, em português
   * @param {{texto: string, indice: number, caminho?: string}} onde
   */
  constructor(mensagem, { texto = '', indice = 0, caminho = '' } = {}) {
    const { linha, coluna } = posicaoDe(texto, indice);
    const lugar = caminho ? ` em ${caminho}` : '';

    super(`${mensagem}${lugar} (linha ${linha}, coluna ${coluna})\n\n${trechoDe(texto, indice)}`);

    this.name = 'ErroDeJson';
    this.motivo = mensagem;
    this.linha = linha;
    this.coluna = coluna;
    this.indice = indice;
    this.caminho = caminho;
  }
}

/** Um valor não pôde ser serializado. */
export class ErroDeSerializacao extends TypeError {
  constructor(mensagem, caminho = '') {
    super(caminho ? `${mensagem} em ${caminho}` : mensagem);

    this.name = 'ErroDeSerializacao';
    this.caminho = caminho;
  }
}
