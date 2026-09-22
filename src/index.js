/**
 * analisador-json — JSON do zero, com erro que diz onde.
 */

export { analisar, Analisador, DUPLICADAS, GRANDES } from './analisador.js';
export { serializar, comoTexto } from './serializador.js';
export { ErroDeJson, ErroDeSerializacao, posicaoDe, trechoDe } from './erros.js';

export {
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
} from './ponteiro.js';
