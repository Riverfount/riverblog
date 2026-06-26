---
title: 'O bug que o mypy teria pego antes do deploy'
date: 2026-06-26
draft: false
tags: ['python', 'tipagem', 'type-hints', 'mypy', 'intermediário']
cover:
  image: 'images/covers/cover-bug-mypy-pegaria-antes-deploy.png'
  alt: 'O bug que o mypy teria pego antes do deploy'
  relative: false
---

A função recebe um pedido vindo de uma integração externa, soma o valor de cada item e aplica um desconto. Em homologação, com os pedidos de teste, funciona perfeitamente. Em produção, na terceira semana, um cliente específico começa a receber o erro `TypeError: unsupported operand type(s) for +: 'float' and 'str'` em pleno checkout.

```python
def calcular_total(itens: list) -> float:
    total = 0
    for item in itens:
        total += item["preco"] * item["quantidade"]
    return total - item.get("desconto", 0)
```

Note que a assinatura já tem uma anotação de tipo: `itens: list`. Ela não é falsa, mas é rasa o suficiente para não dizer nada de útil. `list` não revela que cada elemento é um dicionário com chaves específicas, nem que `desconto` deveria ser numérico. Essa anotação solta passa pelo code review sem levantar suspeita, porque parece tipagem, mas não carrega informação nenhuma sobre o formato real dos dados. É esse tipo de anotação incompleta, não a ausência total de anotação, que vai aparecer recorrentemente neste artigo como o verdadeiro adversário.

A causa do bug, depois de uma hora de investigação no log: para esse cliente específico, o sistema de origem manda o campo `desconto` como string `"0"` em vez de número `0`, porque um formulário legado no parceiro de integração trata todo campo como texto. O Python não reclamou disso na hora de receber o dado. Não reclamou na hora de guardar. Só reclamou no exato momento em que tentou subtrair uma string de um float, três camadas de código depois do ponto em que o problema realmente nasceu.

Esse atraso entre a causa e o sintoma é o ponto central deste artigo. Não é um defeito do Python. É uma consequência direta de como o sistema de tipos da linguagem funciona, e entender essa mecânica é o que separa quem trata isso como "Python é assim mesmo" de quem sabe exatamente em que ponto colocar uma rede de proteção.

## "Fracamente tipado" é a etiqueta errada

É comum ouvir que Python é fracamente tipado, geralmente como explicação para esse tipo de bug. A etiqueta está errada, e a confusão tem um custo prático: leva a procurar a solução no lugar errado.

Tipagem **forte ou fraca** descreve o quanto a linguagem aceita misturar tipos incompatíveis sem avisar, convertendo um no outro por conta própria. Tipagem **estática ou dinâmica** descreve **quando** a linguagem decide qual é o tipo de uma variável: em tempo de compilação, antes do programa rodar, ou em tempo de execução, conforme o código vai sendo interpretado.

Python é dinamicamente tipado e fortemente tipado. As duas coisas, ao mesmo tempo, e isso explica o comportamento do bug acima.

Para ver a diferença entre forte e fraco, compare com JavaScript, que é dinamicamente tipado como Python, mas fracamente tipado:

```javascript
// JavaScript
'2' + 2; // "22": concatenação silenciosa, sem erro
'2' - 1; // 1: converteu a string para número sem avisar
```

```python
# Python
"2" + 2        # TypeError: can only concatenate str (not "int") to str
"2" - 1        # TypeError: unsupported operand type(s) for -: 'str' and 'int'
```

O JavaScript decide, nos dois casos, fazer uma coerção implícita entre tipos incompatíveis e seguir adiante. O Python se recusa. Essa recusa é o que significa ser fortemente tipado: a linguagem não inventa uma conversão que ninguém pediu. O preço dessa garantia é que ela só é cobrada em tempo de execução, porque é nesse momento que o Python finalmente sabe os tipos reais envolvidos na operação.

No exemplo do checkout, isso significa que o Python protegeu corretamente contra a operação inválida. O problema não foi a ausência de proteção. Foi o **momento** em que essa proteção foi acionada: depois do deploy, depois dos testes que passaram, no meio de uma transação de um cliente real.

## O que faltava não era tipagem forte. Era checagem antecipada

Linguagens estaticamente tipadas como Java, Go ou Rust resolvem esse atraso de um jeito específico: o compilador percorre o código antes dele rodar, sabe o tipo declarado de cada variável e rejeita a compilação se encontrar uma operação incompatível. O erro do exemplo acima nunca chegaria a um ambiente de produção em uma dessas linguagens, porque o build simplesmente falharia antes.

Python não tem essa etapa porque não compila para um binário tipado. Mas a partir da PEP 484, ele ganhou uma forma de simular parte desse benefício sem abandonar a flexibilidade da tipagem dinâmica: anotações de tipo, popularmente chamadas de type hints.

```python
def calcular_total(itens: list[dict[str, float]]) -> float:
    total = 0.0
    for item in itens:
        total += item["preco"] * item["quantidade"]
    return total - item.get("desconto", 0.0)
```

A primeira coisa a entender sobre esse código é o que ele **não** faz: rodar essa função com um `desconto` igual a `"0"` continua funcionando exatamente como antes, produzindo o mesmo `TypeError` no mesmo momento. O Python, em tempo de execução, ignora completamente as anotações de tipo. Elas não validam nada, não convertem nada, não impedem nada. `list[dict[str, float]]` é, para o interpretador, só uma anotação decorativa guardada no atributo `__annotations__` da função.

O valor das anotações aparece em outro momento, com outra ferramenta. É aqui que entra o mypy.

```bash
uv add --dev mypy
```

```bash
$ mypy checkout.py
checkout.py:15: error: Argument 1 to "calcular_total" has incompatible type "list[dict[str, object]]"; expected "list[dict[str, float]]"  [arg-type]
Found 1 error in 1 file (checked 1 source file)
```

O mypy é um type checker estático: ele lê as anotações, percorre o código sem executá-lo e verifica se os tipos declarados são consistentes entre si. Se o payload que chega da integração externa for tipado corretamente no ponto em que entra no sistema (por exemplo, via um modelo Pydantic ou um `TypedDict`), e esse tipo divergir do que `calcular_total` espera, o mypy aponta o problema no momento do `git push`, antes de qualquer deploy. O erro de produção do início deste artigo, com o `desconto` chegando como string, é exatamente o tipo de inconsistência que esse tipo de checagem estática captura quando a fonte de dados está propriamente tipada desde a borda do sistema.

## A sintaxe moderna de type hints

A forma como anotações são escritas em Python mudou bastante desde a PEP 484, e parte do motivo de tipagem ainda parecer algo "novo" ou "chato" no ecossistema é que muito código de referência por aí ainda usa a sintaxe antiga.

Antes do Python 3.9, listas e dicionários genéricos exigiam importar de `typing`:

```python
from typing import List, Dict, Optional, Union

def buscar_cliente(id: int) -> Optional[Dict[str, Union[str, int]]]:
    ...
```

A partir do Python 3.9 (PEP 585), os próprios tipos embutidos passaram a aceitar parametrização genérica, eliminando a necessidade de `List` e `Dict`:

```python
def buscar_cliente(id: int) -> dict[str, str | int] | None:
    ...
```

E a partir do Python 3.10 (PEP 604), `Union` ganhou o operador `|` como alternativa, e `Optional[X]` passou a poder ser escrito como `X | None`, que é o que aparece no exemplo acima. O resultado é uma assinatura mais curta e mais parecida com a forma como type hints aparecem em linguagens como TypeScript ou Kotlin.

Vale notar que essa sintaxe nova depende da versão mínima de Python que o projeto suporta. Bibliotecas que ainda precisam rodar em 3.8 não podem usar `dict[str, int]` diretamente em tempo de execução (embora seja possível contornar isso com `from __future__ import annotations`, que transforma todas as anotações em strings avaliadas só sob demanda).

## Onde a tipagem dinâmica continua sendo um ativo, não uma dívida

Depois de ver um bug que a tipagem estática teria evitado, é tentador concluir que o Python "deveria" ser estaticamente tipado. Essa conclusão ignora os casos em que a flexibilidade da tipagem dinâmica é exatamente o que torna certos padrões de código possíveis.

Duck typing é o exemplo mais direto: uma função pode aceitar qualquer objeto que implemente um método `.read()`, sem se importar se é um arquivo aberto, um `BytesIO` em memória ou um socket, porque o Python só verifica a existência do método no momento em que ele é chamado, não antes.

```python
def processar_conteudo(fonte) -> str:
    return fonte.read().decode("utf-8")
```

Tipar essa função de forma totalmente estática exigiria definir uma interface formal (e é exatamente isso que `typing.Protocol` permite fazer, tema para um próximo artigo desta trilha). Sem isso, a versão sem anotação nenhuma já funciona com qualquer objeto compatível, e essa ausência de compromisso prévio com um tipo concreto é o que torna prototipagem rápida e scripts exploratórios genuinamente mais ágeis em Python do que em linguagens estaticamente tipadas.

A conclusão prática não é escolher um lado. É reconhecer que tipagem dinâmica e checagem estática opcional, via type hints e mypy, não são contraditórias. Você escreve o mesmo Python dinâmico de sempre, e adiciona anotações exatamente nas fronteiras em que os dados entram no sistema (parsing de payloads externos, retornos de banco de dados, parâmetros de funções públicas de uma biblioteca interna), que são justamente os pontos em que um tipo errado, como o `desconto` que chegou como string, tem mais chance de se infiltrar sem ser notado.

## Colocando isso no CI

Anotar o código sem rodar o mypy automaticamente é meio caminho andado: alguém vai esquecer de rodar localmente, e o erro volta a só aparecer em produção. O ajuste de uma linha é adicionar mypy como etapa do pipeline:

```yaml
# .github/workflows/ci.yml
- name: Type check
  run: uv run mypy src/
```

A partir daí, qualquer PR que introduza uma incompatibilidade de tipos como a do exemplo do checkout falha no CI, antes de chegar a code review, antes de qualquer chance de merge. O custo de adicionar anotações de tipo é pago uma vez, no momento em que a função é escrita. O custo de não ter essa proteção é pago de forma recorrente, cada vez que um caso de borda como aquele cliente específico aparece.

---

Se você já foi pego de surpresa por um `TypeError` em produção que um `mypy --strict` rodando no CI teria evitado, ou se prefere viver no limite e confia inteiramente nos testes, comenta lá no Fediverse: **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
