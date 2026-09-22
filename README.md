# analisador-json

Um analisador e serializador de JSON escrito do zero, seguindo a RFC 8259, com
ponteiro RFC 6901 junto. **Zero dependências.**

O `JSON.parse` já existe e é rápido. Este existe por três coisas que ele não
faz — e as três já custaram uma tarde a muita gente.

```bash
$ json validar pedido.json
pedido.json: Vírgula sobrando antes de "]" em itens (linha 3, coluna 17)

  "itens": [1, 2,],
                ^

$ json validar cobranca.json
cobranca.json: Chave repetida no mesmo objeto: "valor" (linha 1, coluna 17)

{ "valor": 100, "valor": 250 }
                ^

$ json ler pedido.json /cliente/id -g texto
"9007199254740993"
```

Esse último é um `id` de banco de dados. O `JSON.parse` devolve
`9007199254740992` — um a menos, em silêncio.

## Por que existe

### 1. O erro diz onde

`Unexpected token } in JSON at position 87` não ajuda ninguém num arquivo de
4 KB. O que ajuda é linha, coluna, o caminho do valor e o trecho com um cursor
embaixo — o que um compilador faz há cinquenta anos.

E o erro tem **nome** quando o problema é conhecido:

```
JSON usa aspas duplas, nunca simples
NaN não existe em JSON
undefined não existe em JSON; use null
número não pode ter zero à esquerda
```

Linha comprida é recortada em volta da coluna: despejar 4 KB numa mensagem de
erro é o mesmo que não mostrar nada.

### 2. Chave repetida é erro

`{"a":1,"a":2}` é válido pela gramática, e o embutido fica com o último **em
silêncio**. Quando os dois lados de uma integração geram o mesmo campo — um
com o valor antigo, outro com o novo —, esse silêncio vira um bug de produção
que ninguém acha, porque o arquivo "está válido".

Aqui é erro por padrão, e `--duplicadas ultima|primeira` volta ao
comportamento antigo quando você sabe o que está fazendo.

### 3. Inteiro grande não perde dígito

```js
JSON.parse('9007199254740993')            // 9007199254740992  ← perdeu
analisar('9007199254740993', { grandes: 'bigint' })  // 9007199254740993n
```

Acima de 2^53 um inteiro não cabe num `double`. Identificador de banco, número
de nota fiscal e valor em centavos de conta grande caem todos nessa faixa. Com
`grandes: 'texto'` o valor original fica à mão para repassar sem tocar.

### E na saída

- **Ordem estável das chaves.** Dois processos que montam o mesmo objeto em
  ordens diferentes geram textos diferentes; com `ordenarChaves` o `diff` do
  arquivo de configuração e a assinatura do corpo param de mudar à toa.
- **O ciclo diz onde está.** `pedido.cliente.ultimoPedido`, e não
  "Converting circular structure to JSON".
- **`BigInt` funciona.** O embutido lança `TypeError`.

## Segurança

```js
analisar('{"__proto__": {"admin": true}}');

({}).admin; // undefined
```

Escrito do jeito óbvio — `alvo[chave] = valor` —, a chave `__proto__` **não
cria propriedade nenhuma**: ela chama o setter herdado e troca o protótipo do
objeto, e todo objeto do processo passa a ter `admin`. É a poluição de
protótipo clássica. Aqui a gravação é por `Object.defineProperty`, que desarma
isso e ainda preserva a chave como campo comum.

E existe um teto de aninhamento (512 por padrão). Sem ele, um texto com
100 mil colchetes derruba a pilha e leva o processo junto.

## A API

```js
import { analisar, serializar, obter, definir } from 'analisador-json';

analisar(texto, {
  duplicadas: 'erro',       // 'ultima' | 'primeira'
  grandes: 'numero',        // 'bigint' | 'texto'
  profundidadeMaxima: 512,
  semPrototipo: false,
  reviver: (chave, valor, caminho) => valor,
});

serializar(valor, {
  recuo: 2,
  ordenarChaves: true,
  bigint: 'numero',         // 'texto' | 'erro'
});

obter(documento, '/usuarios/0/nome');
definir(documento, '/usuarios/-', novo);   // "-" acrescenta no fim
```

## Linha de comando

```
json validar <arquivo>          só diz se está válido
json formatar <arquivo>         reescreve com recuo
json compactar <arquivo>        reescreve sem espaço nenhum
json ler <arquivo> <ponteiro>   segue um ponteiro RFC 6901
json caminhos <arquivo>         lista os ponteiros de todas as folhas
```

`caminhos` é útil para descobrir a forma de um documento desconhecido:

```bash
$ json caminhos pedido.json
/numero
/cliente/nome
/cliente/id
/itens/0/sku
/itens/0/quantidade
/itens/1/sku
/itens/1/quantidade
```

Códigos de saída: `0` tudo certo, `1` JSON inválido ou ponteiro que não leva a
lugar nenhum, `2` erro de uso.

## Estrutura

```
src/erros.js         linha, coluna e o trecho com cursor
src/analisador.js    descida recursiva, RFC 8259
src/serializador.js  escape, ordem estável, ciclo com caminho
src/ponteiro.js      RFC 6901: obter, definir, remover, caminhos
src/cli.js           argumentos e códigos de saída
```

## Rodando

```bash
npm test
```

115 testes. Os mais valiosos são os de ida e volta: **mil valores sorteados**
com semente fixa, conferindo que o que o embutido escreve este lê igual, que o
que este escreve o embutido lê igual, e que o texto compacto e o recuado saem
**idênticos** aos dele. Foi esse teste que pegou o único bug de verdade do
projeto — eu escapava as duas metades de um par substituto, e um emoji saía
como `"🙂"` em vez de `"🙂"`.

Os ponteiros são testados contra os doze exemplos do apêndice da RFC 6901.

Node 20 ou mais novo.

## Limites conhecidos

- **Mais lento que o embutido**, que é código nativo. Para um arquivo de
  configuração ou uma resposta de API não faz diferença; para um fluxo de
  centenas de MB, use o `JSON.parse`.
- **Carrega o texto inteiro na memória.** Não há análise em fluxo nem
  JSON Lines.
- **Sem JSON Patch (RFC 6902) nem JSON Schema.** O ponteiro é a base dos dois,
  mas eles são outro projeto.
- O `reviver` tem assinatura própria (recebe o caminho) e não é o do embutido.
- `grandes: 'bigint'` só age em **inteiros**; um número com casas decimais
  fora da faixa segura continua perdendo precisão, porque `BigInt` não
  representa fração.

## Licença

MIT.
