---
title: "Testes que Realmente Testam: pytest Além do Básico"
date: 2026-03-16
draft: false
tags: ["python", "pytest", "testes", "mocks", "fixtures", "unittest", "qualidade", "intermediário"]
cover:
  image: "images/covers/cover-pytest-alem-do-basico.png"
  alt: "Testes que Realmente Testam: pytest Além do Básico"
  relative: false
---

No artigo sobre [injeção de dependência](https://www.riverfount.dev.br/posts/injecao_dependencia/) ficou um problema em aberto. A classe `OrderService`
não dava para testar sem subir banco, sem fazer chamada HTTP real, sem criar arquivo em disco.
A solução apresentada foi injetar as dependências pelo construtor — o que deixa o código
testável. Mas testável não significa testado. Este artigo fecha esse loop.

O objetivo aqui não é ensinar `assert 1 == 1`. É mostrar as ferramentas que separam uma
suite de testes que protege o código de uma suite que só infla a cobertura: fixtures com
escopo controlado, `parametrize` para eliminar duplicação, e mocks com `pytest-mock` para
isolar dependências externas de verdade.

## O ponto de partida

O código que vai servir de base vem diretamente do [artigo de injeção de dependência](https://www.riverfount.dev.br/posts/injecao_dependencia/). Um
serviço de pedidos com duas dependências injetadas: um repositório de banco e um cliente HTTP
para notificações.

```python
# services.py
from dataclasses import dataclass
from datetime import datetime


@dataclass
class Order:
    id: int
    customer_id: int
    total: float
    created_at: datetime


class OrderRepository:
    def get(self, order_id: int) -> Order | None:
        # Na implementação real: SELECT no banco
        raise NotImplementedError

    def save(self, order: Order) -> Order:
        # Na implementação real: INSERT/UPDATE no banco
        raise NotImplementedError


class NotificationClient:
    def send(self, customer_id: int, message: str) -> bool:
        # Na implementação real: chamada HTTP para serviço externo
        raise NotImplementedError


class OrderService:
    def __init__(
        self,
        repository: OrderRepository,
        notification_client: NotificationClient,
    ) -> None:
        self._repo = repository
        self._notifications = notification_client

    def confirm_order(self, order_id: int) -> Order:
        order = self._repo.get(order_id)

        if order is None:
            raise ValueError(f"Pedido {order_id} não encontrado")

        if order.total <= 0:
            raise ValueError("Pedido com total inválido não pode ser confirmado")

        self._notifications.send(
            order.customer_id,
            f"Pedido #{order.id} confirmado. Total: R$ {order.total:.2f}",
        )

        return order
```

Sem injeção de dependência, testar `confirm_order` exigiria banco real e serviço de
notificação real. Com a estrutura acima, basta substituir as dependências por implementações
controladas. É exatamente isso que o pytest permite fazer com precisão cirúrgica.

## Instalação

```bash
pip install pytest pytest-mock
```

A separação importa: `pytest` é o framework de testes; `pytest-mock` é o plugin que integra
`unittest.mock` ao sistema de fixtures do pytest com uma API mais ergonômica.

## Fixtures: dependências controláveis e reutilizáveis

Uma fixture no pytest é uma função que prepara algum recurso para o teste. O decorator
`@pytest.fixture` registra a função, e qualquer teste que declare o nome da fixture como
parâmetro a recebe automaticamente — sem herança de classe, sem `setUp`, sem cerimônia.

O exemplo mais direto: criar implementações falsas (`fakes`) das dependências do
`OrderService`.

```python
# tests/test_order_service.py
from datetime import datetime

import pytest

from services import Order, NotificationClient, OrderRepository, OrderService


class FakeOrderRepository(OrderRepository):
    """Repositório em memória para testes."""

    def __init__(self) -> None:
        self._store: dict[int, Order] = {}

    def get(self, order_id: int) -> Order | None:
        return self._store.get(order_id)

    def save(self, order: Order) -> Order:
        self._store[order.id] = order
        return order

    def add(self, order: Order) -> None:
        """Método auxiliar para popular o fake nos testes."""
        self._store[order.id] = order


class FakeNotificationClient(NotificationClient):
    """Cliente de notificação que registra as mensagens enviadas."""

    def __init__(self) -> None:
        self.sent: list[tuple[int, str]] = []

    def send(self, customer_id: int, message: str) -> bool:
        self.sent.append((customer_id, message))
        return True


@pytest.fixture
def repository() -> FakeOrderRepository:
    return FakeOrderRepository()


@pytest.fixture
def notification_client() -> FakeNotificationClient:
    return FakeNotificationClient()


@pytest.fixture
def service(
    repository: FakeOrderRepository,
    notification_client: FakeNotificationClient,
) -> OrderService:
    return OrderService(
        repository=repository,
        notification_client=notification_client,
    )
```

Fixtures podem depender de outras fixtures — o pytest resolve a cadeia automaticamente.
A fixture `service` recebe `repository` e `notification_client`, que por sua vez são
fixtures definidas acima. Nos testes, basta pedir `service` e todo o grafo de dependências
é construído.

```python
def test_confirm_order_returns_order(
    service: OrderService,
    repository: FakeOrderRepository,
) -> None:
    order = Order(id=1, customer_id=42, total=150.00, created_at=datetime.now())
    repository.add(order)

    result = service.confirm_order(order_id=1)

    assert result.id == 1
    assert result.total == 150.00


def test_confirm_order_sends_notification(
    service: OrderService,
    repository: FakeOrderRepository,
    notification_client: FakeNotificationClient,
) -> None:
    order = Order(id=2, customer_id=99, total=75.50, created_at=datetime.now())
    repository.add(order)

    service.confirm_order(order_id=2)

    assert len(notification_client.sent) == 1
    customer_id, message = notification_client.sent[0]
    assert customer_id == 99
    assert "R$ 75.50" in message
```

Cada teste recebe instâncias frescas das fixtures — não há estado compartilhado entre testes
por padrão. O `FakeNotificationClient.sent` começa vazio em cada teste, o que elimina uma
classe inteira de bugs difíceis de diagnosticar (testes que passam ou falham dependendo da
ordem de execução).

### Escopo de fixture

O comportamento padrão — instância nova por teste — é o correto para a maioria dos casos.
Mas há situações onde inicializar um recurso a cada teste é caro demais: conexão real com
banco de testes, carregamento de arquivo grande, inicialização de servidor local.

O parâmetro `scope` controla o tempo de vida da fixture:

```python
@pytest.fixture(scope="module")
def db_connection():
    """Conexão criada uma vez por módulo de teste, não por teste."""
    conn = create_test_database_connection()
    yield conn
    conn.close()
```

Os escopos disponíveis, do mais curto ao mais longo: `"function"` (padrão), `"class"`,
`"module"`, `"package"`, `"session"`.

A palavra-chave `yield` merece atenção. Tudo antes do `yield` é setup; tudo depois é
teardown. O pytest garante que o código de teardown executa mesmo se o teste falhar —
equivalente a um `try/finally` automático. É o padrão correto para qualquer fixture que
abre um recurso.

```python
@pytest.fixture
def temp_file(tmp_path):
    """tmp_path é uma fixture built-in do pytest que cria um diretório temporário."""
    file = tmp_path / "test_data.csv"
    file.write_text("id,name\n1,Alice\n2,Bob\n")
    yield file
    # O pytest limpa tmp_path automaticamente, mas se fosse um recurso externo:
    # cleanup_code_here()
```

## `parametrize`: eliminando testes duplicados

O padrão mais comum de duplicação em suites de teste é o seguinte:

```python
# Forma ruim — três testes que testam a mesma coisa com dados diferentes
def test_confirm_order_raises_for_order_not_found(service):
    with pytest.raises(ValueError, match="não encontrado"):
        service.confirm_order(order_id=999)

def test_confirm_order_raises_for_zero_total(service, repository):
    order = Order(id=1, customer_id=1, total=0.0, created_at=datetime.now())
    repository.add(order)
    with pytest.raises(ValueError, match="total inválido"):
        service.confirm_order(order_id=1)

def test_confirm_order_raises_for_negative_total(service, repository):
    order = Order(id=2, customer_id=1, total=-10.0, created_at=datetime.now())
    repository.add(order)
    with pytest.raises(ValueError, match="total inválido"):
        service.confirm_order(order_id=2)
```

O decorator `@pytest.mark.parametrize` resolve isso sem perder granularidade de diagnóstico
— cada combinação de parâmetros gera um teste independente com ID próprio na saída:

```python
@pytest.mark.parametrize(
    "order_id, total, expected_message",
    [
        (999, None, "não encontrado"),   # pedido inexistente
        (1,   0.0,  "total inválido"),   # total zero
        (1,  -10.0, "total inválido"),   # total negativo
    ],
    ids=["order_not_found", "zero_total", "negative_total"],
)
def test_confirm_order_raises_for_invalid_input(
    service: OrderService,
    repository: FakeOrderRepository,
    order_id: int,
    total: float | None,
    expected_message: str,
) -> None:
    if total is not None:
        order = Order(id=order_id, customer_id=1, total=total, created_at=datetime.now())
        repository.add(order)

    with pytest.raises(ValueError, match=expected_message):
        service.confirm_order(order_id=order_id)
```

O parâmetro `ids` dá nomes legíveis aos casos na saída do pytest. Sem ele, o pytest gera
IDs automáticos baseados nos valores (`999-None-não encontrado`), o que funciona mas é menos
expressivo em suites grandes.

A saída do pytest com `ids` explícitos:

```
PASSED tests/test_order_service.py::test_confirm_order_raises_for_invalid_input[order_not_found]
PASSED tests/test_order_service.py::test_confirm_order_raises_for_invalid_input[zero_total]
PASSED tests/test_order_service.py::test_confirm_order_raises_for_invalid_input[negative_total]
```

Quando um caso falha, o ID aparece no relatório — é imediatamente claro qual cenário quebrou,
sem precisar inspecionar os parâmetros.

### `parametrize` com fixtures

Uma limitação do `parametrize` padrão é que os valores são estáticos — não podem chamar
fixtures. Para parametrizar com fixtures, o pytest oferece o `params` no próprio decorator
de fixture combinado com `request.param`:

```python
@pytest.fixture(params=[0.0, -1.0, -100.0], ids=["zero", "minus_one", "minus_hundred"])
def invalid_total(request) -> float:
    return request.param


def test_confirm_order_raises_for_invalid_total(
    service: OrderService,
    repository: FakeOrderRepository,
    invalid_total: float,
) -> None:
    order = Order(id=1, customer_id=1, total=invalid_total, created_at=datetime.now())
    repository.add(order)

    with pytest.raises(ValueError, match="total inválido"):
        service.confirm_order(order_id=1)
```

## Mocks com `pytest-mock`

Fakes são ótimos quando a dependência tem comportamento que vale exercitar — como o
`FakeOrderRepository` que verifica se o pedido existe de fato. Mas há casos onde o que
interessa é apenas verificar que uma chamada aconteceu com os argumentos certos, ou simular
um comportamento excepcional sem criar uma classe inteira para isso. É o território dos mocks.

O `pytest-mock` fornece a fixture `mocker`, que é um wrapper em torno de `unittest.mock`
com integração automática ao ciclo de vida dos testes — não é preciso fazer `patcher.stop()`
manualmente, o mock é revertido automaticamente ao final de cada teste.

### Verificando chamadas

```python
def test_confirm_order_calls_notification_with_correct_args(
    mocker,
    repository: FakeOrderRepository,
) -> None:
    mock_client = mocker.MagicMock()
    service = OrderService(repository=repository, notification_client=mock_client)

    order = Order(id=5, customer_id=77, total=200.00, created_at=datetime.now())
    repository.add(order)

    service.confirm_order(order_id=5)

    mock_client.send.assert_called_once_with(
        77,
        "Pedido #5 confirmado. Total: R$ 200.00",
    )
```

`MagicMock` aceita qualquer atribuição e qualquer chamada sem reclamar, registrando tudo.
`assert_called_once_with` verifica que o método foi chamado exatamente uma vez, com
exatamente esses argumentos. Se a asserção falhar, o pytest mostra a diferença entre o
esperado e o que foi chamado de fato.

### Simulando falhas

Testar o caminho feliz é a parte fácil. A parte que protege o código em produção é testar
o que acontece quando dependências externas falham.

```python
def test_confirm_order_propagates_notification_failure(
    mocker,
    repository: FakeOrderRepository,
) -> None:
    mock_client = mocker.MagicMock()
    mock_client.send.side_effect = ConnectionError("Serviço de notificação indisponível")

    service = OrderService(repository=repository, notification_client=mock_client)

    order = Order(id=6, customer_id=10, total=50.00, created_at=datetime.now())
    repository.add(order)

    with pytest.raises(ConnectionError, match="indisponível"):
        service.confirm_order(order_id=6)
```

`side_effect` pode receber uma exceção (que será levantada quando o mock for chamado),
uma lista de valores (retornados em sequência a cada chamada), ou uma função (chamada com
os mesmos argumentos do mock).

### `mocker.patch`: substituindo dependências no ponto de uso

Às vezes a dependência não é injetada pelo construtor — é uma chamada direta a uma função
do módulo, `datetime.now()`, ou qualquer coisa que não dá para substituir facilmente via
construtor. `mocker.patch` resolve isso.

Suponha que `confirm_order` registre um timestamp interno usando `datetime.now()` e isso
precise ser verificado:

```python
# services.py (versão modificada)
from datetime import datetime

class OrderService:
    def confirm_order(self, order_id: int) -> dict:
        order = self._repo.get(order_id)
        if order is None:
            raise ValueError(f"Pedido {order_id} não encontrado")

        confirmed_at = datetime.now()  # dependência difícil de controlar
        self._notifications.send(order.customer_id, f"Pedido #{order.id} confirmado.")
        return {"order": order, "confirmed_at": confirmed_at}
```

```python
def test_confirm_order_records_confirmation_timestamp(
    mocker,
    repository: FakeOrderRepository,
    notification_client: FakeNotificationClient,
) -> None:
    fixed_time = datetime(2026, 3, 17, 12, 0, 0)
    mocker.patch("services.datetime") .now.return_value = fixed_time

    service = OrderService(repository=repository, notification_client=notification_client)
    order = Order(id=7, customer_id=1, total=100.00, created_at=datetime.now())
    repository.add(order)

    result = service.confirm_order(order_id=7)

    assert result["confirmed_at"] == fixed_time
```

O argumento de `mocker.patch` é o caminho completo do objeto **no módulo onde ele é usado**,
não onde ele é definido. `"services.datetime"` funciona porque é de `services` que
`datetime` é importado e chamado. Esse é o erro mais comum com `patch`: tentar fazer patch
no módulo de origem em vez do módulo de uso.

## Organizando a suite

Com fixtures e testes crescendo, a organização importa. A estrutura recomendada:

```
project/
├── src/
│   └── services.py
└── tests/
    ├── conftest.py          ← fixtures compartilhadas entre módulos
    ├── test_order_service.py
    └── test_another_module.py
```

O arquivo `conftest.py` é carregado automaticamente pelo pytest. Fixtures definidas nele
ficam disponíveis para todos os testes no mesmo diretório e subdiretórios — sem precisar
importar nada.

```python
# tests/conftest.py
import pytest
from services import OrderRepository, NotificationClient, OrderService
from tests.fakes import FakeOrderRepository, FakeNotificationClient


@pytest.fixture
def repository() -> FakeOrderRepository:
    return FakeOrderRepository()


@pytest.fixture
def notification_client() -> FakeNotificationClient:
    return FakeNotificationClient()


@pytest.fixture
def service(
    repository: FakeOrderRepository,
    notification_client: FakeNotificationClient,
) -> OrderService:
    return OrderService(
        repository=repository,
        notification_client=notification_client,
    )
```

Fixtures de escopo mais amplo (`session`, `module`) também ficam bem no `conftest.py` — é
o lugar natural para recursos caros compartilhados entre vários arquivos de teste.

## Executando e lendo a saída

```bash
# Rodar todos os testes
pytest

# Verbose: ver o nome de cada teste
pytest -v

# Parar no primeiro erro
pytest -x

# Rodar apenas testes com um nome específico
pytest -k "notification"

# Ver a cobertura (requer pytest-cov)
pytest --cov=src --cov-report=term-missing
```

A saída do `--cov-report=term-missing` mostra quais linhas não foram cobertas por nenhum
teste. É a métrica mais útil para identificar caminhos de código ainda sem proteção.

```
Name            Stmts   Miss  Cover   Missing
---------------------------------------------
src/services.py    28      2    93%   45, 61
---------------------------------------------
TOTAL              28      2    93%
```

Linhas 45 e 61 — fácil de saber exatamente onde focar.

## O que veio antes e o que vem depois

As fixtures e mocks deste artigo só funcionam com a estrutura que o [artigo de injeção de dependência](https://www.riverfount.dev.br/posts/injecao_dependencia/) estabeleceu: dependências recebidas pelo construtor, interfaces implícitas via
duck typing. Sem isso, `mocker.patch` e `MagicMock` ficam remendando código acoplado em
vez de testando comportamento.

O próximo nível é o Hypothesis — uma biblioteca que gera casos de teste automaticamente e
encontra edge cases que qualquer teste manual perderia. Mas ele pressupõe exatamente essa
base: uma suite pytest funcionando, com fixtures organizadas e mocks no lugar certo.

Se quiser continuar a conversa, estou no Fediverse em  **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
