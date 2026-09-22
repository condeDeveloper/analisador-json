/**
 * Ponteiro JSON (RFC 6901).
 *
 * `/usuarios/2/nome` aponta para um lugar dentro do documento. É o que as
 * mensagens de erro de validação de esquema usam, e o que torna possível
 * dizer "o problema está aqui" em vez de "o problema está em algum lugar".
 *
 * A parte que costuma passar batido é o escape: como `/` separa os degraus,
 * uma chave que contém `/` precisa virar `~1` — e, como `~` virou caractere
 * especial, ele próprio vira `~0`. A ordem de desfazer importa: `~0` primeiro
 * transformaria `~01` em `~1` e depois em `/`, que é a chave errada.
 */

/** O ponteiro não pôde ser lido ou seguido. */
export class ErroDePonteiro extends Error {
  constructor(mensagem, ponteiro) {
    super(`${mensagem} (ponteiro ${JSON.stringify(ponteiro)})`);
    this.name = 'ErroDePonteiro';
    this.ponteiro = ponteiro;
  }
}

/** Escapa um degrau para caber num ponteiro. */
export function escapar(degrau) {
  return String(degrau).replaceAll('~', '~0').replaceAll('/', '~1');
}

/** Desfaz o escape. `~1` primeiro, senão `~01` viraria `/`. */
export function desescapar(degrau) {
  return degrau.replaceAll('~1', '/').replaceAll('~0', '~');
}

/** Quebra um ponteiro nos seus degraus. */
export function degraus(ponteiro) {
  if (ponteiro === '') return [];

  if (!ponteiro.startsWith('/')) {
    throw new ErroDePonteiro('Um ponteiro não vazio precisa começar com "/"', ponteiro);
  }

  return ponteiro.slice(1).split('/').map(desescapar);
}

/** Monta um ponteiro a partir dos degraus. */
export function montar(partes) {
  return partes.map((p) => `/${escapar(p)}`).join('');
}

/** Índice de lista válido pela RFC: dígitos sem zero à esquerda. */
function comoIndice(degrau, alvo, ponteiro) {
  if (degrau === '-') throw new ErroDePonteiro('O degrau "-" só vale para acrescentar', ponteiro);

  if (!/^(0|[1-9][0-9]*)$/.test(degrau)) {
    throw new ErroDePonteiro(`Índice de lista inválido: ${JSON.stringify(degrau)}`, ponteiro);
  }

  const i = Number(degrau);

  if (i >= alvo.length) throw new ErroDePonteiro(`Índice ${i} fora da lista de ${alvo.length}`, ponteiro);

  return i;
}

/** Busca o valor apontado. */
export function obter(documento, ponteiro) {
  let atual = documento;

  for (const degrau of degraus(ponteiro)) {
    if (Array.isArray(atual)) {
      atual = atual[comoIndice(degrau, atual, ponteiro)];
      continue;
    }

    if (atual === null || typeof atual !== 'object') {
      throw new ErroDePonteiro(`Não dá para entrar em ${atual === null ? 'null' : typeof atual}`, ponteiro);
    }

    if (!Object.hasOwn(atual, degrau)) {
      throw new ErroDePonteiro(`Chave inexistente: ${JSON.stringify(degrau)}`, ponteiro);
    }

    atual = atual[degrau];
  }

  return atual;
}

/** Indica se o ponteiro leva a algum lugar. */
export function existe(documento, ponteiro) {
  try {
    obter(documento, ponteiro);
    return true;
  } catch {
    return false;
  }
}

/** Busca o valor, ou devolve o padrão quando o caminho não existe. */
export function obterOu(documento, ponteiro, padrao = undefined) {
  try {
    return obter(documento, ponteiro);
  } catch {
    return padrao;
  }
}

/** Grava um valor no lugar apontado. `-` acrescenta no fim da lista. */
export function definir(documento, ponteiro, valor) {
  const partes = degraus(ponteiro);

  if (partes.length === 0) throw new ErroDePonteiro('O ponteiro vazio aponta para o documento inteiro', ponteiro);

  const ultimo = partes.pop();
  const pai = obter(documento, montar(partes));

  if (Array.isArray(pai)) {
    if (ultimo === '-') pai.push(valor);
    else pai[comoIndice(ultimo, pai, ponteiro)] = valor;

    return documento;
  }

  if (pai === null || typeof pai !== 'object') {
    throw new ErroDePonteiro(`Não dá para gravar dentro de ${pai === null ? 'null' : typeof pai}`, ponteiro);
  }

  // `defineProperty` pela mesma razão do analisador: `pai.__proto__ = x`
  // trocaria o protótipo em vez de criar a chave.
  Object.defineProperty(pai, ultimo, { value: valor, writable: true, enumerable: true, configurable: true });

  return documento;
}

/** Apaga o valor apontado. */
export function remover(documento, ponteiro) {
  const partes = degraus(ponteiro);

  if (partes.length === 0) throw new ErroDePonteiro('Não dá para remover o documento inteiro', ponteiro);

  const ultimo = partes.pop();
  const pai = obter(documento, montar(partes));

  if (Array.isArray(pai)) {
    pai.splice(comoIndice(ultimo, pai, ponteiro), 1);
    return documento;
  }

  if (!Object.hasOwn(pai ?? {}, ultimo)) {
    throw new ErroDePonteiro(`Chave inexistente: ${JSON.stringify(ultimo)}`, ponteiro);
  }

  delete pai[ultimo];

  return documento;
}

/** Todos os ponteiros de folha do documento, em ordem de leitura. */
export function caminhos(documento, prefixo = '') {
  if (documento === null || typeof documento !== 'object') return [prefixo];

  const entradas = Array.isArray(documento)
    ? documento.map((v, i) => [String(i), v])
    : Object.entries(documento);

  if (entradas.length === 0) return [prefixo];

  return entradas.flatMap(([chave, valor]) => caminhos(valor, `${prefixo}/${escapar(chave)}`));
}
