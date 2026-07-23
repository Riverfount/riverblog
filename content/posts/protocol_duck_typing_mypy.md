---
title: 'Protocol: duck typing com garantias em tempo de análise'
date: 2026-07-22
draft: false
tags: ['python', 'typing', 'protocol', 'mypy', 'duck-typing']
cover:
  image: 'images/covers/cover-protocol-duck-typing-mypy.png'
  alt: 'Protocol: duck typing com garantias em tempo de análise'
  relative: false
---

Você herdou um sistema de cálculo de descontos. Não tem classe base, não tem ABC, não tem interface formal nenhuma. Cada tipo de desconto (cupom, fidelidade, campanha sazonal) é só uma classe qualquer com um método `aplicar(pedido)` que devolve o valor final. O código que orquestra isso nem sabe que tipo de objeto está recebendo, só chama `desconto.aplicar(pedido)` e segue em frente. Duck typing raiz: se anda como pato e grasna como pato, aplica desconto como pato.

```python
from dataclasses import dataclass


@dataclass
class Pedido:
    valor: float
    cliente_id: int


class DescontoCupom:
    def __init__(self, percentual: float) -> None:
        self.percentual = percentual

    def aplicar(self, pedido: Pedido) -> float:
        return pedido.valor * (1 - self.percentual)


class DescontoFidelidade:
    def aplicar(self, pedido: Pedido) -> float:
        return pedido.valor * 0.95


def calcular_total(pedido: Pedido, desconto) -> float:
    return desconto.aplicar(pedido)
```

Funciona bem, até o dia em que alguém adiciona uma classe nova para a campanha de aniversário. O método se chama `aplica`, sem o "r" final, porque quem escreveu copiou a assinatura de outro projeto e não reparou na diferença. Passa no code review, porque ninguém vai comparar caractere a caractere o nome de um método em meio a um PR de vinte arquivos. Passa no CI, porque os testes cobrem os descontos antigos, não o novo. Estoura em produção três semanas depois, quando o primeiro cliente cai na campanha de aniversário:

```
AttributeError: 'DescontoAniversario' object has no attribute 'aplicar'
```

Isso é familiar. No artigo anterior, sobre [o bug que o mypy](https://www.riverfount.dev.br/posts/bug_mypy_pegaria_antes_deploy/) teria pego antes do deploy, fechamos com um contraponto: duck typing é idiomático em Python, e sufocar toda função com tipos concretos tira flexibilidade real. O contraponto ficou de pé, mas incompleto. Faltou responder à seguinte pergunta: dá para manter a flexibilidade do duck typing e ainda assim deixar o mypy pegar o `aplica` sem "r" antes do deploy? Dá. O nome disso é `typing.Protocol`.

## Contrato estrutural, não hierarquia

Um Protocol descreve o formato que um objeto precisa ter, não de qual classe ele precisa descender. Isso é tipagem estrutural [PEP 544](https://peps.python.org/pep-0544/): se o objeto tem os métodos com as assinaturas certas, ele satisfaz o Protocol, mesmo que nunca tenha ouvido falar dele.

```python
from typing import Protocol


class CalculadoraDesconto(Protocol):
    def aplicar(self, pedido: Pedido) -> float: ...
```

`DescontoCupom` e `DescontoFidelidade`, do exemplo anterior, já satisfazem esse Protocol sem precisar de nenhuma alteração. Nenhum `class DescontoCupom(CalculadoraDesconto)`, nenhum import extra nessas classes. O contrato é verificado pela forma, não pela declaração.

A diferença aparece quando `calcular_total` ganha uma anotação de tipo real em vez de aceitar qualquer coisa:

```python
def calcular_total(pedido: Pedido, desconto: CalculadoraDesconto) -> float:
    return desconto.aplicar(pedido)


class DescontoAniversario:
    def aplica(self, pedido: Pedido) -> float:
        return pedido.valor * 0.9


calcular_total(Pedido(200.0, 42), DescontoAniversario())
```

Rodando o mypy nesse arquivo, o erro aparece exatamente no ponto em que o mismatch importa, a chamada, não a definição da classe:

```
$ uv run mypy pedidos.py
pedidos.py:34: error: Argument 2 to "calcular_total" has incompatible type "DescontoAniversario"; expected "CalculadoraDesconto"  [arg-type]
```

O `aplica` sem "r" nunca chegaria a produção. Ficaria vermelho no editor, no primeiro `uv run mypy .` local, ou barrado no CI, no mesmo pipeline que já defendemos no artigo sobre mypy que citamos acima.

## Protocol não é ABC com outro nome

Python já tem uma forma de definir contratos: `abc.ABC` com `@abstractmethod`. A diferença não é cosmética.

Uma ABC exige herança explícita. `DescontoAniversario` só seria reconhecida como `CalculadoraDesconto` se declarasse `class DescontoAniversario(CalculadoraDesconto)`, e só poderia ser instanciada depois de implementar todos os métodos abstratos. Isso é ótimo quando você controla toda a hierarquia: força a intenção explícita e falha na instanciação, não só na chamada.

O problema aparece com tipos que você não controla. Um cliente HTTP de terceiro, uma sessão do SQLAlchemy, um objeto fake que você criou só para um teste. Nenhum desses vai herdar da sua ABC, porque não faz sentido pedir para uma biblioteca externa herdar de uma classe do seu domínio. É exatamente o caso do repositório injetado no artigo sobre [IoC com Dishka](https://www.riverfount.dev.br/posts/ioc_dishka/): a implementação real usa uma sessão de banco, o teste usa um fake em memória, e nenhum dos dois precisa saber que o outro existe. Um Protocol descreve o formato esperado e qualquer um dos dois passa, sem herança, sem acoplamento com o seu módulo de domínio.

Regra prática: ABC quando você é dono da hierarquia e quer forçar a implementação completa antes mesmo de instanciar. Protocol quando o tipo concreto vem de fora, ou quando você só quer verificação estática sem impor herança a ninguém.

## `runtime_checkable` tem limite

Dá para usar `isinstance()` com um Protocol, desde que ele seja decorado com `@runtime_checkable`:

```python
from typing import Protocol, runtime_checkable


@runtime_checkable
class CalculadoraDesconto(Protocol):
    def aplicar(self, pedido: Pedido) -> float: ...
```

O problema é o que esse `isinstance()` realmente verifica: só a existência do método, não a assinatura.

```python
class FalsaCalculadora:
    def aplicar(self) -> str:
        return "grátis"


isinstance(FalsaCalculadora(), CalculadoraDesconto)  # True
```

`FalsaCalculadora` não recebe `pedido`, devolve `str` em vez de `float`, e ainda assim passa no `isinstance()`. Em tempo de execução, Python só confere se o nome `aplicar` existe no objeto. Quem confere parâmetros, tipos de retorno e a assinatura inteira é o mypy, em tempo de análise, e só ele. É a diferença entre o "garantias" do título deste artigo e o `isinstance()` de sempre: um verifica forma completa, o outro verifica só o nome do método.

## Em que situações isso substitui duck typing cru

Nem toda função precisa de um Protocol. Um script de uso único, chamado de um único lugar, com uma única implementação concorrente, não ganha muito com a formalização, é ceremônia sem retorno.

O cálculo muda quando a função é chamada de vários pontos do projeto, quando existem múltiplas implementações reais (produção, teste, staging com um provedor diferente), ou quando o objeto passado atravessa uma fronteira de módulo, como acontece com a injeção de dependência do artigo sobre IoC. Nesses casos, o `mypy` no CI é exatamente o cenário em que essa garantia compensa: o custo de escrever o Protocol é pago uma vez, e cada chamada nova é verificada de graça, sem precisar de um teste específico para pegar um nome de método digitado errado.

Se você acompanha o blog há mais tempo, os artigos sobre [segregação de interfaces](https://www.riverfount.dev.br/posts/segregacao_interfaces/) e sobre [Liskov com duck typing](https://www.riverfount.dev.br/posts/liskov_ducktyping_protocols/) já passaram perto de Protocol, dentro da discussão de princípios SOLID. O ângulo ali era design: como desenhar contratos enxutos e substituíveis. O ângulo aqui é outro: o que o mypy realmente consegue verificar antes do deploy, e em que pontos o `runtime_checkable` ainda deixa passar problema. São conversas complementares, não a mesma conversa duas vezes.

Se ainda não tem o mypy configurado no projeto, `uv add --dev mypy` resolve, e o `Protocol` já vem na biblioteca padrão a partir do Python 3.8, sem dependência nova nenhuma.

Se você já usa Protocol em produção e tem uma armadilha melhor do que essa do `runtime_checkable`, manda um toot lá no Fediverso: **[@riverfount@bolha.us](https://bolha.us/@riverfount)**. Sempre bom trocar figurinha sobre isso.
