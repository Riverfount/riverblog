---
title: "Hypothesis encontra os bugs que seus testes ignoram"
date: 2026-04-14
draft: false
tags: ["python", "testes", "hypothesis", "property-based-testing", "qualidade"]
cover:
  image: "images/covers/cover-hypothesis-property-based-testing.png"
  alt: "Hypothesis encontra os bugs que seus testes ignoram"
  relative: false
---

A suite de testes está verde. Fixtures bem organizadas, parametrize cobrindo os casos
óbvios, mocks isolando as dependências externas. Cobertura em 94%. O PR passa no CI e
vai para produção.

Três dias depois, um usuário reporta um comportamento estranho. Você reproduz o bug
localmente com um input que nunca ocorreu a ninguém testar: uma string vazia em que se
esperava pelo menos um caractere, um número negativo em que a função assumia valores
positivos, uma lista com um único elemento no qual a lógica de comparação silenciosamente
quebra. O teste que teria pego isso seria trivial de escrever — se alguém tivesse pensado
em escrever.

Esse é o problema que o [Hypothesis](https://hypothesis.readthedocs.io/) resolve. Não
substituindo o pytest, mas mudando quem é responsável por inventar os inputs.

## Testar o que você sabe vs. testar o que você não sabe

No artigo sobre [pytest além do básico](https://www.riverfount.dev.br/posts/pytest_alem_do_basico/), o foco foi em
ferramentas que tornam os testes mais expressivos e menos frágeis: fixtures com escopo
controlado, `parametrize` para eliminar duplicação, `pytest-mock` para isolar
dependências. Essas ferramentas partem do mesmo pressuposto: você sabe quais casos
precisam ser testados, e a questão é como organizá-los bem.

O Hypothesis parte de um pressuposto diferente. Você descreve as *propriedades* que
uma função deve satisfazer — invariantes que valem para qualquer input válido — e a
biblioteca gera os inputs automaticamente, tentando encontrar um contra-exemplo. Isso
é chamado de *property-based testing*.

A diferença prática é significativa. Com `parametrize`, você testa:

```python
@pytest.mark.parametrize("valor", [1, 10, 100, 1000])
def test_desconto(valor):
    assert calcular_desconto(valor) < valor
```

Com Hypothesis, você testa:

```python
from hypothesis import given
from hypothesis import strategies as st

@given(st.integers(min_value=1))
def test_desconto(valor):
    assert calcular_desconto(valor) < valor
```

No segundo caso, o Hypothesis vai gerar dezenas de inteiros positivos — incluindo casos
de borda como `1`, `2`, o maior inteiro possível — e rodar o teste para cada um. Se
encontrar um contra-exemplo, vai reportar o menor valor em que a função quebra. Esse
processo de minimização automática do contra-exemplo é chamado de *shrinking*.

## Instalação e setup

```bash
uv add hypothesis
```

Nenhuma configuração adicional é necessária para começar. O Hypothesis funciona como
plugin do pytest: qualquer teste decorado com `@given` é reconhecido e executado
automaticamente.

## Um bug real que o pytest não pegaria

Considere uma função que calcula o índice de um elemento numa lista ordenada usando
busca binária:

```python
def busca_binaria(lista: list[int], alvo: int) -> int:
    """Retorna o índice do alvo na lista, ou -1 se não encontrado."""
    esquerda, direita = 0, len(lista) - 1

    while esquerda <= direita:
        meio = (esquerda + direita) // 2
        if lista[meio] == alvo:
            return meio
        elif lista[meio] < alvo:
            esquerda = meio + 1
        else:
            direita = meio - 1

    return -1
```

Uma suite pytest razoável testaria alguns casos:

```python
def test_encontra_elemento():
    assert busca_binaria([1, 3, 5, 7, 9], 5) == 2

def test_elemento_ausente():
    assert busca_binaria([1, 3, 5, 7, 9], 4) == -1

def test_lista_vazia():
    assert busca_binaria([], 5) == -1

def test_primeiro_elemento():
    assert busca_binaria([1, 3, 5], 1) == 0

def test_ultimo_elemento():
    assert busca_binaria([1, 3, 5], 5) == 2
```

Todos passam. Agora com Hypothesis:

```python
from hypothesis import given
from hypothesis import strategies as st

@given(
    st.lists(st.integers(), min_size=1).map(sorted),
    st.integers()
)
def test_busca_binaria_propriedade(lista, alvo):
    idx = busca_binaria(lista, alvo)

    if alvo in lista:
        # Se o alvo está na lista, o índice retornado deve apontar para ele
        assert lista[idx] == alvo
    else:
        # Se o alvo não está, deve retornar -1
        assert idx == -1
```

Esse teste vai passar também — a implementação acima está correta. Mas agora suponha
uma variante com um bug sutil, comum em implementações antigas de busca binária em
linguagens sem inteiros de precisão arbitrária:

```python
def busca_binaria_bugada(lista: list[int], alvo: int) -> int:
    esquerda, direita = 0, len(lista) - 1

    while esquerda <= direita:
        meio = (esquerda + direita) // 2  # overflow em C/Java para listas enormes
        # Em Python isso não ocorre, mas o bug a seguir sim:
        if lista[meio] == alvo:
            return meio
        elif lista[meio] < alvo:
            esquerda = meio  # bug: deveria ser meio + 1
        else:
            direita = meio - 1

    return -1
```

O Hypothesis encontra o contra-exemplo em poucos segundos:

```
Falsifying example: test_busca_binaria_propriedade(
    lista=[0, 1], alvo=1
)
```

E então minimiza: o menor input em que a função entra em loop infinito é uma lista de
dois elementos em que o alvo é o segundo. Nenhum dos testes manuais acima teria coberto
esse caso específico.

## Estratégias: descrevendo o espaço de inputs

A interface central do Hypothesis é o módulo `strategies` (importado convencionalmente
como `st`). Uma estratégia descreve um conjunto de valores possíveis — o Hypothesis
amostra desse conjunto durante a execução do teste.

As estratégias mais usadas no dia a dia:

```python
st.integers()                    # qualquer inteiro
st.integers(min_value=0)         # inteiros não-negativos
st.floats(allow_nan=False)       # floats excluindo NaN
st.text()                        # strings unicode arbitrárias
st.text(alphabet=st.characters(
    whitelist_categories=('Lu', 'Ll', 'Nd')
))                               # apenas letras e dígitos
st.lists(st.integers())          # listas de inteiros
st.lists(st.integers(), min_size=1, max_size=100)
st.dictionaries(st.text(), st.integers())
st.one_of(st.integers(), st.text())  # qualquer um dos dois tipos
st.sampled_from(["admin", "user", "guest"])  # valor fixo de uma sequência
```

Estratégias podem ser compostas e transformadas:

```python
# Lista ordenada de inteiros positivos únicos
st.lists(st.integers(min_value=1), min_size=1, unique=True).map(sorted)

# Par em que o segundo é maior que o primeiro
st.integers().flatmap(
    lambda x: st.tuples(st.just(x), st.integers(min_value=x + 1))
)
```

## Um exemplo com domínio real

Testes de propriedade brilham especialmente em funções de transformação de dados em que
a propriedade natural é a reversibilidade. Uma função que serializa e desserializa dados
deve satisfazer:

```python
from hypothesis import given
from hypothesis import strategies as st
import json
from decimal import Decimal


def serializar_pedido(pedido: dict) -> str:
    """Serializa um pedido para JSON, convertendo Decimal para string."""
    def converter(obj):
        if isinstance(obj, Decimal):
            return str(obj)
        raise TypeError(f"Tipo não serializável: {type(obj)}")
    return json.dumps(pedido, default=converter)


def deserializar_pedido(dados: str) -> dict:
    """Desserializa JSON de pedido, convertendo strings numéricas de volta para Decimal."""
    pedido = json.loads(dados)
    if "valor" in pedido:
        pedido["valor"] = Decimal(pedido["valor"])
    return pedido


# Estratégia para gerar pedidos válidos
pedidos = st.fixed_dictionaries({
    "id": st.integers(min_value=1),
    "cliente": st.text(min_size=1, max_size=50),
    "valor": st.decimals(
        min_value=Decimal("0.01"),
        max_value=Decimal("99999.99"),
        places=2,
        allow_nan=False,
        allow_infinity=False,
    ),
    "status": st.sampled_from(["pendente", "aprovado", "cancelado"]),
})


@given(pedidos)
def test_roundtrip_serializacao(pedido):
    """Serializar e desserializar deve produzir o pedido original."""
    assert deserializar_pedido(serializar_pedido(pedido)) == pedido
```

Esse único teste cobre qualquer combinação de id, nome de cliente e valor decimal —
incluindo clientes com nomes unicode, valores com zeros à direita, ids no limite do
inteiro. Nenhum `parametrize` cobre esse espaço de forma equivalente.

## Banco de exemplos e reprodução determinística

O Hypothesis mantém um banco de exemplos local (por padrão em `.hypothesis/`) que
persiste entre execuções. Quando um contra-exemplo é encontrado, ele é salvo e
reexecutado automaticamente nas próximas rodadas — garantindo que um bug descoberto
não passe despercebido se a correção for incompleta.

Para reproduzir um caso específico sem depender do banco, o decorador `@example` força
um input fixo:

```python
from hypothesis import given, example
from hypothesis import strategies as st

@given(st.integers())
@example(0)    # sempre executa com 0, além dos casos gerados
@example(-1)   # sempre executa com -1
def test_fatorial(n):
    if n < 0:
        with pytest.raises(ValueError):
            fatorial(n)
    else:
        assert fatorial(n) >= 1
```

O `.hypothesis/` deve ir para o `.gitignore` em projetos pessoais ou entrar no
controle de versão em projetos de equipe — a escolha depende de querer ou não
compartilhar o banco de contra-exemplos encontrados.

## Configurando o comportamento

O Hypothesis tem configurações sensatas por padrão, mas dois parâmetros valem conhecer
cedo:

```python
from hypothesis import given, settings
from hypothesis import strategies as st

@settings(max_examples=500)   # padrão é 100
@given(st.integers())
def test_com_mais_casos(n):
    ...

@settings(deadline=None)      # desativa o timeout por exemplo (útil em CI lento)
@given(st.text())
def test_sem_deadline(s):
    ...
```

O `max_examples` controla quantos inputs são gerados por execução. Aumentar para 500
ou 1000 em funções críticas custa tempo de CI mas aumenta a cobertura do espaço de
inputs de forma significativa.

## O que property-based testing não substitui

Testes de propriedade não substituem testes de unidade tradicionais — eles cobrem
espaços diferentes.

Um teste com `@example` explícito ou `parametrize` documenta intenção: "esse caso
específico deve se comportar dessa forma". É útil para casos de borda conhecidos,
comportamentos contratados por uma API pública, ou regressões de bugs encontrados
em produção. Um teste com `@given` explora o espaço desconhecido: "essa propriedade
vale para qualquer input válido". É útil para invariantes matemáticas, propriedades
de reversibilidade, e funções com contratos amplos.

Na prática, os dois coexistem no mesmo arquivo de teste, frequentemente no mesmo
teste:

```python
@given(st.lists(st.integers(), min_size=1))
@example([3, 1, 2])          # caso documentado explicitamente
@example([1])                # lista de um elemento
def test_ordenacao(lista):
    resultado = minha_ordenacao(lista)
    assert sorted(lista) == resultado
    assert len(resultado) == len(lista)
```

---

O Hypothesis está na lista de dependências de projetos como o Django, o attrs e o
cryptography — projetos em que um bug de borda custa caro. Para código Python de
produção em que as entradas vêm do mundo externo e o espaço de inputs é grande, ele
passa a ser menos uma opção e mais uma camada necessária da suite de testes.

Se tiver dúvidas ou quiser compartilhar um contra-exemplo interessante que o Hypothesis
encontrou no seu código, encontra-me no Fediverse: **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
