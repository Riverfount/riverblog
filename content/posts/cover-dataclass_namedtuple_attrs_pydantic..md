---
title: "dataclass, NamedTuple, attrs ou pydantic: qual usar de verdade?"
date: 2026-04-10
draft: false
tags: ["python", "dataclasses", "typing", "attrs", "pydantic", "boas-práticas"]
cover:
  image: "images/covers/cover-dataclass-namedtuple-attrs-pydantic.png"
  alt: "dataclass, NamedTuple, attrs ou pydantic: qual usar de verdade?"
  relative: false
---

Existe um ponto no crescimento de qualquer projeto Python em que os dicionários começam a doer. Não de vez — vai acontecendo aos poucos. Você passa um `dict` para uma função, a função passa para outra, e em algum momento ninguém mais sabe ao certo quais chaves estão garantidas, qual é o tipo de cada valor, ou o que acontece se uma chave estiver faltando.

```python
def calcular_desconto(pedido: dict) -> float:
    # pedido tem "valor"? "valor_bruto"? "subtotal"?
    # "cliente" é um dict também? tem "nivel"?
    return pedido["valor"] * _fator(pedido["cliente"]["nivel"])
```

Funciona. Ninguém vai questionar em code review. O problema aparece três meses depois, quando alguém passa um pedido sem a chave `"nivel"` — ou quando você tenta debugar e o `repr` do dicionário tem quarenta chaves misturadas.

A solução natural é criar uma estrutura de dados. E aí começa a confusão: Python tem pelo menos quatro formas sérias de fazer isso — `dataclass`, `NamedTuple`, `attrs` e `pydantic` — cada uma com trade-offs reais que raramente aparecem na documentação oficial.

## O ponto de partida: `NamedTuple`

Se o que você precisa é de um objeto imutável que carrega dados e nada mais, `NamedTuple` resolve com zero dependências externas:

```python
from typing import NamedTuple

class Pedido(NamedTuple):
    id: int
    valor: float
    cliente_id: int
    status: str = "pendente"
```

O `repr` já funciona. Comparação de igualdade também. Desempacotamento funciona como numa tupla normal:

```python
pedido = Pedido(id=42, valor=199.90, cliente_id=7)
pedido_id, valor, *_ = pedido  # funciona
print(pedido)  # Pedido(id=42, valor=199.9, cliente_id=7, status='pendente')
```

O lado B: porque `NamedTuple` herda de `tuple`, a instância é indexável. Ninguém vai escrever `pedido[1]` de propósito, mas se isso acontecer num bug sutil, não vai dar erro — vai silenciosamente retornar `199.9`. E como é imutável, qualquer lógica que precise alterar um campo precisa criar uma nova instância na mão, sem nenhum método de suporte.

O `NamedTuple` cobre bem o caso de dados de saída que não mudam: coordenadas, resultados de parsing, rows de consulta SQL que você quer nomear. Quando o objeto precisa de comportamento ou mutabilidade, o `NamedTuple` começa a trabalhar contra você.

## `dataclass`: o padrão razoável para a maioria dos casos

O `@dataclass` foi adicionado no Python 3.7 exatamente para o caso que o `NamedTuple` não cobre bem: objetos mutáveis com dados estruturados que podem ter algum comportamento.

```python
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class Pedido:
    id: int
    valor: float
    cliente_id: int
    status: str = "pendente"
    itens: list[str] = field(default_factory=list)
```

O `field(default_factory=list)` é o detalhe que pega quem vem direto de classe comum: nunca use um objeto mutável como valor padrão direto. O seguinte parece OK mas cria um único objeto `list` compartilhado entre todas as instâncias:

```python
# Errado — a mesma lista para todas as instâncias
@dataclass
class Pedido:
    itens: list[str] = []  # TypeError no runtime, felizmente
```

O `@dataclass` detecta isso e levanta `ValueError` na definição da classe. É um dos poucos casos em que o framework te protege do erro antes de ele acontecer.

Com `frozen=True`, você tem imutabilidade equivalente ao `NamedTuple`, mas sem o problema de herdar de `tuple`:

```python
@dataclass(frozen=True)
class Coordenada:
    lat: float
    lon: float
```

Tentativas de atribuição levantam `FrozenInstanceError`. O hash é gerado automaticamente, então a instância pode ser usada como chave de dicionário ou em sets.

O `@dataclass` tem um problema que só aparece com herança. Subclasses que adicionam campos com valores padrão quebram se a classe pai tem campos sem padrão:

```python
@dataclass
class Base:
    id: int  # sem padrão

@dataclass
class Derivada(Base):
    nome: str = "anon"  # com padrão — funciona

@dataclass
class Problema(Base):
    obrigatorio: str  # sem padrão depois de classe com padrão — TypeError
```

É uma limitação estrutural da forma como `@dataclass` gera `__init__`. O `attrs` resolve isso de forma diferente, mas veremos em seguida.

### Validação: o que o `@dataclass` não faz

O `@dataclass` não valida os campos. Se você declarar `valor: float` e passar `"duzentos reais"`, não vai dar erro na criação:

```python
pedido = Pedido(id=1, valor="duzentos reais", cliente_id=5)  # sem erro
pedido.valor * 2  # TypeError lá na frente, longe da origem do problema
```

Para validação, a saída do `@dataclass` é `__post_init__`:

```python
from dataclasses import dataclass
from decimal import Decimal

@dataclass
class Pedido:
    id: int
    valor: float
    cliente_id: int

    def __post_init__(self):
        if self.valor < 0:
            raise ValueError(f"valor não pode ser negativo: {self.valor}")
        if not isinstance(self.id, int):
            raise TypeError(f"id deve ser int, recebeu {type(self.id)}")
```

Funciona, mas escala mal. Com cinco campos validados, o `__post_init__` fica maior que o resto da classe. É aqui que o `attrs` começa a fazer sentido.

## `attrs`: quando o `@dataclass` não basta

O `attrs` existe desde 2015 — o `@dataclass` foi inspirado nele. A diferença fundamental é que o `attrs` foi projetado especificamente para geração de classes de dados, com validação e conversão como cidadãos de primeira classe.

```bash
uv add attrs
```

```python
import attrs

@attrs.define
class Pedido:
    id: int = attrs.field(validator=attrs.validators.instance_of(int))
    valor: float = attrs.field(validator=attrs.validators.gt(0))
    cliente_id: int = attrs.field()
    status: str = attrs.field(default="pendente")
    itens: list[str] = attrs.field(factory=list)
```

A validação acontece na construção e levanta `TypeError` ou `ValueError` com mensagem clara:

```python
Pedido(id=1, valor=-50.0, cliente_id=5)
# ValueError: ("'valor' must be > 0: -50.0 not > 0", ...)
```

Conversão automática também é possível — útil quando os dados vêm de JSON ou de um formulário e os tipos chegam como string:

```python
@attrs.define
class Pedido:
    id: int = attrs.field(converter=int)
    valor: float = attrs.field(converter=float)
```

```python
Pedido(id="42", valor="199.90")  # funciona, converte automaticamente
```

O problema de herança que o `@dataclass` tem não existe no `attrs`: a ordem dos campos na subclasse é controlada explicitamente pelo decorador, sem depender da ordem de definição.

O custo é verbosidade. Para um objeto simples sem validação, `@attrs.define` é mais código do que `@dataclass`. A maioria das bases de código não precisa de `attrs` em todos os lugares — só nos casos em que a validação na criação vale o overhead de legibilidade.

## `pydantic`: validação na borda, coerção como feature

O `pydantic` é onipresente em projetos Python modernos — se o projeto usa FastAPI, ele já está instalado. A diferença fundamental em relação ao `attrs` é filosófica: onde o `attrs` valida e rejeita, o `pydantic` valida e converte.

```bash
uv add pydantic
```

```python
from pydantic import BaseModel, field_validator

class PedidoRequest(BaseModel):
    id: int
    valor: float
    cliente_id: int
    status: str = "pendente"
```

Se você passar `id="42"` e `valor="199.90"`, o `pydantic` converte para `int` e `float` silenciosamente. Isso é coerção por padrão — e é exatamente o comportamento certo na borda da aplicação, em que os dados chegam de fora (corpo de request HTTP, arquivo `.env`, JSON de uma API externa) sempre como strings.

A mesma coerção que é uma feature na borda é um risco no domínio. Se `Pedido` é uma entidade interna e alguém passa uma string num campo numérico, você quer saber — não quer que o framework corrija em silêncio e continue.

```python
from pydantic import BaseModel, field_validator, model_validator

class PedidoRequest(BaseModel):
    id: int
    valor: float
    cliente_id: int

    @field_validator("valor")
    @classmethod
    def valor_positivo(cls, v: float) -> float:
        if v <= 0:
            raise ValueError(f"valor deve ser positivo, recebeu {v}")
        return v
```

A validação customizada com `@field_validator` é ergonômica — mais que o `__post_init__` do `@dataclass` e comparável ao `attrs`. O `pydantic` também gera JSON Schema automaticamente a partir do modelo, o que é útil para documentação de API.

O custo: `pydantic` é a opção mais pesada das quatro. O import é mais lento, a criação de instâncias tem overhead maior que `@dataclass`, e a coerção automática pode esconder bugs no domínio interno. Para objetos criados em loops críticos de performance, isso aparece no profiler.

O padrão que funciona bem é usar `pydantic` na deserialização e converter para `@dataclass` antes de passar para o domínio:

```python
from dataclasses import dataclass
from pydantic import BaseModel

class PedidoRequest(BaseModel):  # recebe dados externos, valida e coerce
    id: int
    valor: float
    cliente_id: int

@dataclass
class Pedido:  # entidade de domínio, sem coerção silenciosa
    id: int
    valor: float
    cliente_id: int

def criar_pedido(request: PedidoRequest) -> Pedido:
    return Pedido(
        id=request.id,
        valor=request.valor,
        cliente_id=request.cliente_id,
    )
```

Misturar os dois não é gambiarra — é separação de responsabilidades.

## Guia de decisão

A escolha depende de quatro perguntas:

**O objeto é imutável e você não precisa de validação?** Use `NamedTuple`. É simples, zero dependências, e o desempacotamento como tupla às vezes é exatamente o que você quer.

**O objeto é mutável, pode ter algum comportamento, e validação não é crítica?** Use `@dataclass`. É a escolha padrão para modelos de domínio, DTOs internos, e qualquer objeto em que a validação, se necessária, pode viver num método separado.

**Validação na construção é importante, os dados podem vir de fontes não confiáveis, ou a herança está no caminho?** Use `attrs`. É mais verboso, mas essa verbosidade é explícita — cada campo deixa claro o que é válido.

**Os dados vêm de fora da aplicação (HTTP, JSON, env)?** Use `pydantic` na deserialização. A coerção automática é uma feature aqui, não um risco. Converta para `@dataclass` ou `attrs` antes de passar para o domínio se performance ou rigor de tipos importar.

A tabela resume:

| Característica | `NamedTuple` | `@dataclass` | `attrs` | `pydantic` |
|---|---|---|---|---|
| Mutável por padrão | não | sim | sim | sim |
| Validação integrada | não | via `__post_init__` | sim, declarativa | sim, declarativa |
| Conversão de tipos | não | não | sim, via `converter` | sim, automática |
| Herança problemática | não | sim | não | não |
| Dependência externa | não | não | sim | sim |
| Indexável como tupla | sim | não | não | não |
| JSON Schema | não | não | não | sim |
| Performance | alta | alta | alta | menor |

O erro mais comum é usar `@dataclass` em todo lugar por inércia — incluindo nos casos em que `NamedTuple` bastaria, naqueles em que `attrs` seria mais honesto sobre o que o objeto precisa, e nos casos em que `pydantic` já está no projeto e resolve o problema com menos código.

---

Se você estiver montando uma arquitetura que usa os quatro em camadas diferentes, ou se tiver um caso concreto em que nenhum dos quatro parece caber bem, o assunto continua em [@riverfount@bolha.us](https://bolha.us/@riverfount).
