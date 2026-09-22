#!/usr/bin/env node
/**
 * A linha de comando.
 *
 * Valida, formata e consulta. Toda a decisão está na biblioteca.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analisar } from './analisador.js';
import { serializar } from './serializador.js';
import { caminhos, obter } from './ponteiro.js';
import { ErroDeJson } from './erros.js';

const AJUDA = `analisador-json — JSON do zero, com erro que diz onde

  json validar <arquivo>          só diz se está válido
  json formatar <arquivo>         reescreve com recuo
  json compactar <arquivo>        reescreve sem espaço nenhum
  json ler <arquivo> <ponteiro>   segue um ponteiro RFC 6901
  json caminhos <arquivo>         lista os ponteiros de todas as folhas

  -o, --ordenar     ordena as chaves (saída estável para diff e assinatura)
  -r, --recuo <n>   espaços do recuo (padrão 2)
  -d, --duplicadas <erro|ultima|primeira>   o que fazer com chave repetida
  -g, --grandes <numero|bigint|texto>       inteiro fora da faixa segura
  -h, --ajuda`;

/** Lê os argumentos. */
export function lerArgumentos(argumentos) {
  const opcoes = {
    comando: null,
    arquivo: null,
    ponteiro: null,
    ordenar: false,
    recuo: 2,
    duplicadas: 'erro',
    grandes: 'numero',
    ajuda: false,
  };

  const soltos = [];

  for (let i = 0; i < argumentos.length; i += 1) {
    const arg = argumentos[i];

    if (arg === '-h' || arg === '--ajuda') opcoes.ajuda = true;
    else if (arg === '-o' || arg === '--ordenar') opcoes.ordenar = true;
    else if (arg === '-r' || arg === '--recuo') {
      opcoes.recuo = Number(argumentos[++i]);

      if (!Number.isInteger(opcoes.recuo) || opcoes.recuo < 0) throw new Error('O recuo precisa ser um inteiro não negativo.');
    } else if (arg === '-d' || arg === '--duplicadas') {
      opcoes.duplicadas = argumentos[++i];

      if (!['erro', 'ultima', 'primeira'].includes(opcoes.duplicadas)) {
        throw new Error('duplicadas aceita erro, ultima ou primeira.');
      }
    } else if (arg === '-g' || arg === '--grandes') {
      opcoes.grandes = argumentos[++i];

      if (!['numero', 'bigint', 'texto'].includes(opcoes.grandes)) {
        throw new Error('grandes aceita numero, bigint ou texto.');
      }
    } else if (arg.startsWith('-')) {
      throw new Error(`Opção desconhecida: ${arg}.`);
    } else {
      soltos.push(arg);
    }
  }

  [opcoes.comando = null, opcoes.arquivo = null, opcoes.ponteiro = null] = soltos;

  return opcoes;
}

/** Roda um comando e devolve o código de saída. */
export async function principal(argumentos, escrever = console.log, ler = (c) => readFile(c, 'utf8')) {
  let opcoes;

  try {
    opcoes = lerArgumentos(argumentos);
  } catch (erro) {
    escrever(erro.message);
    return 2;
  }

  if (opcoes.ajuda || opcoes.comando === null) {
    escrever(AJUDA);
    return opcoes.ajuda ? 0 : 2;
  }

  const conhecidos = ['validar', 'formatar', 'compactar', 'ler', 'caminhos'];

  if (!conhecidos.includes(opcoes.comando)) {
    escrever(`Comando desconhecido: ${opcoes.comando}.\n\n${AJUDA}`);
    return 2;
  }

  if (opcoes.arquivo === null) {
    escrever('Informe o arquivo.');
    return 2;
  }

  let texto;

  try {
    texto = await ler(opcoes.arquivo);
  } catch (erro) {
    escrever(`Não consegui ler ${opcoes.arquivo}: ${erro.message}`);
    return 2;
  }

  let documento;

  try {
    documento = analisar(texto, { duplicadas: opcoes.duplicadas, grandes: opcoes.grandes });
  } catch (erro) {
    // O erro já vem com linha, coluna e o trecho; a CLI só o repassa.
    escrever(erro instanceof ErroDeJson ? `${opcoes.arquivo}: ${erro.message}` : erro.message);
    return 1;
  }

  try {
    return despachar(opcoes, documento, escrever);
  } catch (erro) {
    escrever(erro.message);
    return 1;
  }
}

function despachar(opcoes, documento, escrever) {
  const comum = { ordenarChaves: opcoes.ordenar, bigint: 'numero' };

  if (opcoes.comando === 'validar') {
    escrever('válido');
    return 0;
  }

  if (opcoes.comando === 'formatar') {
    escrever(serializar(documento, { ...comum, recuo: opcoes.recuo }));
    return 0;
  }

  if (opcoes.comando === 'compactar') {
    escrever(serializar(documento, comum));
    return 0;
  }

  if (opcoes.comando === 'caminhos') {
    for (const caminho of caminhos(documento)) escrever(caminho || '/');

    return 0;
  }

  if (opcoes.ponteiro === null) {
    escrever('Informe o ponteiro, por exemplo /usuarios/0/nome.');
    return 2;
  }

  escrever(serializar(obter(documento, opcoes.ponteiro), { ...comum, recuo: opcoes.recuo }));

  return 0;
}

/* c8 ignore start */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal(process.argv.slice(2)).then((codigo) => {
    process.exitCode = codigo;
  });
}
/* c8 ignore stop */
