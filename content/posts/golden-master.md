---
title: 'Golden Master: o teste que você escreve sem saber o que o código deveria fazer'
date: 2026-09-25
draft: false
tags: ['python', 'testes', 'legado', 'golden-master', 'pytest']
cover:
  image: 'images/covers/cover-golden-master.png'
  alt: 'Golden Master: o teste que você escreve sem saber o que o código deveria fazer'
  relative: false
---

Tem uma função no seu projeto que todo mundo evita mexer. Não porque o código seja complexo demais para entender, mas porque ninguém tem certeza do que ele deveria fazer, só do que ele faz. Algo assim:

<!--more-->

```python
def calcular_valor_pedido(pedido, cliente, cupom=None):
    valor = sum(item.preco * item.quantidade for item in pedido.itens)

    if cliente.tipo == "vip":
        if valor > 500:
            valor *= 0.85
        else:
            valor *= 0.92
    elif cliente.dias_cadastro > 365:
        if valor > 1000:
            valor *= 0.90
        else:
            valor *= 0.95

    if cupom:
        if cupom.tipo == "percentual":
            if cliente.tipo == "vip" and cupom.codigo.startswith("VIP"):
                valor *= (1 - cupom.valor / 100 * 1.2)
            else:
                valor *= (1 - cupom.valor / 100)
        elif cupom.tipo == "fixo":
            valor -= cupom.valor
            if valor < 0:
                valor = 0

    if pedido.regiao in ("norte", "nordeste"):
        if valor < 200:
            valor += 45
    elif pedido.peso_total > 30:
        valor += 25

    return round(valor, 2)
```

Essa função calcula quatro anos de regras de negócio acumuladas: desconto por fidelidade, cupom, frete regional, peso do pedido. O autor original saiu da empresa há dois anos. Ninguém sabe se aquele `* 1.2` no desconto VIP combinado com cupom é uma regra intencional ou um bug que virou comportamento esperado porque o financeiro já ajustou a precificação em cima dele. E agora o produto pediu uma nova faixa de desconto, o que significa mexer bem no meio dessa árvore de condicionais.

O instinto correto é "escreve teste antes de refatorar". O problema é que escrever um teste unitário tradicional exige que você declare o valor esperado, e ninguém aqui sabe dizer com segurança qual é o valor certo para cada combinação de cliente, cupom e região. Só dá para afirmar qual é o valor atual. É exatamente para esse cenário que existe a técnica de Golden Master, também chamada de characterization testing.

## A diferença entre testar corretude e testar estabilidade

Um teste unitário comum verifica se o código faz o que deveria fazer, comparando a saída com um valor que você calculou de forma independente. O Golden Master não tenta responder "isso está certo?". Ele responde a uma pergunta mais modesta e, nesse contexto, mais útil: "isso continua fazendo exatamente o que fazia antes da minha alteração?".

Na prática, você roda a função atual contra um conjunto amplo de entradas, congela as saídas em um arquivo (o master) e passa a comparar cada execução futura contra esse arquivo. Enquanto o diff for zero, você tem liberdade para reorganizar o código por dentro. No momento em que o diff aparecer, ele aponta exatamente qual caso mudou de comportamento, e cabe a você decidir se essa mudança era intencional ou um efeito colateral da refatoração.

## Capturando o master

O primeiro passo é decidir quais entradas representam de verdade o que a função recebe em produção. Aqui vale usar um objeto simples para montar as combinações de pedido, cliente e cupom:

```python
from dataclasses import dataclass


@dataclass
class Item:
    preco: float
    quantidade: int


@dataclass
class Pedido:
    itens: list[Item]
    regiao: str
    peso_total: float


@dataclass
class Cliente:
    tipo: str
    dias_cadastro: int


@dataclass
class Cupom:
    tipo: str
    valor: float
    codigo: str


def construir_entrada(spec: dict) -> tuple[Pedido, Cliente, Cupom | None]:
    pedido = Pedido(
        itens=[Item(preco=spec["pedido"]["valor_itens"], quantidade=1)],
        regiao=spec["pedido"]["regiao"],
        peso_total=spec["pedido"]["peso_total"],
    )
    cliente = Cliente(**spec["cliente"])
    cupom = Cupom(**spec["cupom"]) if spec["cupom"] else None
    return pedido, cliente, cupom
```

Escrever essas combinações à mão cobre os casos óbvios, mas é justamente nas combinações que ninguém pensaria em escrever manualmente que mora o comportamento estranho que você quer capturar antes de tocar no código. No artigo sobre Hypothesis usamos geração de dados para achar bugs em código novo, comparando a saída contra propriedades que deveriam valer sempre. Aqui a lógica se inverte: não existe propriedade conhecida para validar, então usamos o Hypothesis só para gerar uma amostra ampla e variada de entradas plausíveis. Um script separado, fora da suíte de testes, cuida disso uma única vez:

```python
# scripts/gerar_casos_golden.py
import json
from pathlib import Path

from hypothesis import strategies as st

clientes = st.fixed_dictionaries({
    "tipo": st.sampled_from(["novo", "regular", "vip"]),
    "dias_cadastro": st.integers(min_value=0, max_value=3000),
})

cupons = st.one_of(
    st.none(),
    st.fixed_dictionaries({
        "tipo": st.sampled_from(["percentual", "fixo"]),
        "valor": st.integers(min_value=1, max_value=80),
        "codigo": st.sampled_from(["PROMO10", "VIP20", "BLACKFRIDAY"]),
    }),
)

pedidos = st.fixed_dictionaries({
    "valor_itens": st.integers(min_value=10, max_value=3000),
    "regiao": st.sampled_from(["sudeste", "sul", "norte", "nordeste", "centro-oeste"]),
    "peso_total": st.floats(min_value=0.5, max_value=80, allow_nan=False),
})

entrada = st.fixed_dictionaries({"pedido": pedidos, "cliente": clientes, "cupom": cupons})

# .example() fora de um teste com @given é algo que o próprio Hypothesis
# desaconselha para código de produção, mas aqui é um script auxiliar que
# roda uma vez para descobrir combinações, não parte da suíte que roda no CI.
brutos = (entrada.example() for _ in range(300))
unicos = {json.dumps(v, sort_keys=True): v for v in brutos}
casos = {f"caso_{i:03d}": v for i, v in enumerate(unicos.values())}

destino = Path("tests/golden/casos_entrada.json")
destino.write_text(json.dumps(casos, indent=2, sort_keys=True, ensure_ascii=False))
```

O resultado é um `casos_entrada.json` fixo, versionado junto com o teste. A partir daqui, a suíte não depende mais do Hypothesis: ela lê uma lista estável de entradas e compara a saída atual contra o master gravado.

```python
# conftest.py
def pytest_addoption(parser):
    parser.addoption(
        "--update-golden",
        action="store_true",
        default=False,
        help="Regrava o arquivo golden com a saída atual da função",
    )
```

```python
# test_golden_master.py
import json
from pathlib import Path

import pytest

from pedidos.calculo import calcular_valor_pedido
from pedidos.testes.fixtures_golden import construir_entrada

DIR_GOLDEN = Path(__file__).parent / "golden"
CASOS = json.loads((DIR_GOLDEN / "casos_entrada.json").read_text())
ARQUIVO_MASTER = DIR_GOLDEN / "calculo_pedido_master.json"


def test_calculo_pedido_preserva_comportamento(request):
    resultados_atuais = {}

    for nome, spec in CASOS.items():
        pedido, cliente, cupom = construir_entrada(spec)
        resultados_atuais[nome] = calcular_valor_pedido(pedido, cliente, cupom)

    deve_gravar = request.config.getoption("--update-golden") or not ARQUIVO_MASTER.exists()
    if deve_gravar:
        ARQUIVO_MASTER.write_text(json.dumps(resultados_atuais, indent=2, sort_keys=True))
        pytest.skip("Master gravado. Rode a suíte de novo para validar contra ele.")

    esperado = json.loads(ARQUIVO_MASTER.read_text())
    assert resultados_atuais == esperado
```

Na primeira execução, com `--update-golden`, o teste grava o comportamento atual e para por aí, porque ainda não existe nada para comparar. Da segunda execução em diante, ele vira um teste de regressão de verdade: qualquer alteração na saída de qualquer um dos trezentos casos quebra a suíte. Para dicionários grandes, o diff que o pytest mostra por padrão já ajuda bastante graças à reescrita de asserts, mas em casos com muitos níveis de aninhamento vale `uv add deepdiff` e usar `DeepDiff(esperado, resultados_atuais)` no bloco de falha para ver exatamente qual chave divergiu, sem precisar rolar um diff de texto gigante.

## Refatorando com a rede de segurança armada

Com a suíte verde, a refatoração em si fica sem graça, que é o objetivo. Extrair a lógica de desconto por fidelidade para uma função separada, trocar a cadeia de `if/elif` por um dicionário de estratégias, renomear variáveis: cada mudança é seguida de uma rodada da suíte golden master. Enquanto o resultado continuar batendo com o master, o comportamento externo está preservado, mesmo que você não tenha certeza absoluta de que entendeu cada regra de negócio embutida naquele código.

Se em algum ponto o teste quebrar, o `DeepDiff` (ou o diff do próprio pytest) mostra exatamente qual caso mudou de valor. Nesse momento você para e investiga: a mudança é um efeito colateral indesejado da refatoração, ou é uma correção de um bug que valia a pena corrigir mesmo? A decisão passa a ser explícita e documentada, em vez de acontecer sem ninguém perceber.

## Os limites do Golden Master

Vale deixar claro o que essa técnica não faz. Ela não valida se o código está correto, só se ele continua consistente com o que já fazia. Se aquele `* 1.2` no desconto VIP com cupom for de fato um bug histórico, o Golden Master vai defender esse bug com a mesma força que defende as regras corretas, porque para ele os dois são indistinguíveis. Vale conversar com quem conhece a regra de negócio antes de congelar um comportamento suspeito, e não depois.

Também é preciso eliminar qualquer fonte de não determinismo antes de gravar o master. Se a função em algum momento chamar `datetime.now()`, gerar um `uuid4()` ou depender da ordem de iteração de um `set`, a suíte vai falhar de forma intermitente sem que nada de fato tenha mudado. Nesses casos, congele o tempo com `freezegun` ou injete essas dependências como parâmetros para poder controlá-las no teste.

E por fim: Golden Master é andaime, não fundação. Ele existe para te dar segurança durante a travessia de um código sem testes até um código decomposto em unidades menores e compreensíveis. Depois que `calcular_valor_pedido` virar um conjunto de funções pequenas com responsabilidade única, cada uma delas merece testes unitários tradicionais, com valores esperados que alguém efetivamente validou. A suíte golden master pode ser mantida como um teste de integração de sanidade, ou aposentada quando a cobertura unitária ficar completa. O que ela não deveria ser é o único teste que aquele código tem daqui a dois anos.

---

Se você tem um caso de código legado que resistiu até ao Golden Master, ou uma história de "o teste passou e mesmo assim quebrou em produção", manda um toot lá no fediverso: **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
