---
title: "Injeção de dependência do jeito certo: IoC com Dishka e FastAPI"
date: 2026-03-20
draft: false
tags: ["python", "fastapi", "dishka", "injeção-de-dependência", "arquitetura", "avançado"]
cover:
  image: "images/covers/cover-ioc-dishka-fastapi.png"
  alt: "Injeção de dependência do jeito certo: IoC com Dishka e FastAPI"
  relative: false
---

Você já escreveu algo assim numa aplicação FastAPI?

```python
@router.get("/orders/{order_id}")
async def get_order(order_id: int):
    db = SessionLocal()
    try:
        repo = OrderRepository(db)
        service = OrderService(repo, settings.TAX_RATE)
        return await service.get_order(order_id)
    finally:
        db.close()
```

O código funciona. Mas há um problema sério: cada endpoint é responsável por montar sua própria árvore de dependências. Quando `OrderService` precisar de um `CacheClient` e de um `EventPublisher`, quem vai sofrer é quem escreve — e depois testa — cada endpoint.

O FastAPI tem seu próprio sistema de `Depends()` que resolve parte disso, mas tem limites quando a aplicação cresce e os grafos de dependência ficam complexos. É aqui que entra o conceito de **Inversão de Controle** e, mais especificamente, uma biblioteca que acerta onde o `Depends()` tropeça: o **Dishka**.

## O que é IoC, de verdade

Inversão de Controle (IoC) é o princípio de que um módulo não deve instanciar suas próprias dependências — ele deve recebê-las de fora. A confusão comum é que IoC e injeção de dependência (DI) são a mesma coisa. Não são.

IoC é o princípio. DI é um padrão que implementa esse princípio. Um container de IoC é a infraestrutura que automatiza o processo de construção e entrega dessas dependências.

No ecossistema Python, o padrão mais comum é passar dependências via construtor:

```python
class OrderService:
    def __init__(self, repo: OrderRepository, cache: CacheClient):
        self.repo = repo
        self.cache = cache
```

O `OrderService` não sabe como criar um `OrderRepository`. Ele apenas declara que precisa de um. Quem resolve isso é o container de IoC — e é exatamente o que o Dishka faz.

## O limite do `Depends()` nativo

O sistema de DI do FastAPI resolve dependências por requisição, o que é ótimo para muitos casos:

```python
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_order_repo(db: Session = Depends(get_db)) -> OrderRepository:
    return OrderRepository(db)

@router.get("/orders/{order_id}")
async def get_order(
    order_id: int,
    repo: OrderRepository = Depends(get_order_repo),
):
    ...
```

O problema aparece quando você tem:

1. **Dependências com ciclos de vida diferentes** — uma conexão de banco vive por requisição, mas um `HTTPClient` pode viver pela duração do processo.
2. **Grafos profundos** — quando `ServiceA` depende de `ServiceB` que depende de `RepositoryA` e `RepositoryB`, e cada um tem suas próprias dependências, o arquivo de "providers" vira um espaguete de `Depends`.
3. **Reutilização fora do contexto HTTP** — se você precisar do mesmo serviço num worker Celery, num script de CLI ou num teste, não há como reutilizar a cadeia de `Depends()` sem acoplamento desnecessário ao FastAPI.
4. **Testabilidade** — substituir dependências em testes com `app.dependency_overrides` funciona, mas escala mal.

## Dishka: o container de IoC que entende escopo

O [Dishka](https://github.com/reagento/dishka) é um container de DI para Python que resolve exatamente esses problemas. Ele foi desenhado com escopo em mente desde o início.

Instale:

```bash
pip install dishka
```

Para integrar com FastAPI:

```bash
pip install "dishka[fastapi]"
```

### Conceitos centrais

**Provider:** uma classe que declara como construir dependências.

**Scope:** define o ciclo de vida de uma dependência. Os escopos principais são:
- `Scope.APP` — criado uma vez, vive durante toda a aplicação
- `Scope.REQUEST` — criado por requisição HTTP e destruído no final
- `Scope.SESSION` — útil para workers ou tarefas com vida intermediária

**Container:** o objeto central que resolve dependências com base nos providers registrados.

## Construindo do zero: uma API de pedidos

Vamos construir uma API de pedidos com PostgreSQL, Redis para cache e publicação de eventos. A estrutura de diretórios:

```
app/
├── main.py
├── providers.py
├── routers/
│   └── orders.py
└── services/
    ├── order_service.py
    ├── order_repository.py
    └── cache_client.py
```

### Definindo os serviços

```python
# app/services/order_repository.py
from sqlalchemy.ext.asyncio import AsyncSession
from app.models import Order

class OrderRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_id(self, order_id: int) -> Order | None:
        return await self.session.get(Order, order_id)

    async def save(self, order: Order) -> Order:
        self.session.add(order)
        await self.session.flush()
        return order
```

```python
# app/services/cache_client.py
import redis.asyncio as redis
import json

class CacheClient:
    def __init__(self, client: redis.Redis):
        self._client = client

    async def get(self, key: str) -> dict | None:
        value = await self._client.get(key)
        return json.loads(value) if value else None

    async def set(self, key: str, value: dict, ttl: int = 300) -> None:
        await self._client.setex(key, ttl, json.dumps(value))
```

```python
# app/services/order_service.py
from app.services.order_repository import OrderRepository
from app.services.cache_client import CacheClient
from app.models import Order

class OrderService:
    def __init__(self, repo: OrderRepository, cache: CacheClient):
        self.repo = repo
        self.cache = cache

    async def get_order(self, order_id: int) -> Order | None:
        cache_key = f"order:{order_id}"
        
        cached = await self.cache.get(cache_key)
        if cached:
            return Order(**cached)

        order = await self.repo.get_by_id(order_id)
        if order:
            await self.cache.set(cache_key, order.to_dict())
        
        return order
```

Nenhum desses serviços sabe como criar suas próprias dependências. Perfeito.

### Definindo os providers

Aqui é onde o Dishka entra de fato. Um provider declara como construir cada dependência e qual é o seu escopo:

```python
# app/providers.py
from dishka import Provider, Scope, provide
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
import redis.asyncio as redis

from app.config import Settings
from app.services.order_repository import OrderRepository
from app.services.cache_client import CacheClient
from app.services.order_service import OrderService


class DatabaseProvider(Provider):
    def __init__(self, settings: Settings):
        super().__init__()
        self.settings = settings

    @provide(scope=Scope.APP)
    async def get_engine(self):
        engine = create_async_engine(
            self.settings.DATABASE_URL,
            pool_size=10,
            max_overflow=20,
        )
        yield engine
        await engine.dispose()

    @provide(scope=Scope.APP)
    def get_sessionmaker(self, engine) -> async_sessionmaker:
        return async_sessionmaker(engine, expire_on_commit=False)

    @provide(scope=Scope.REQUEST)
    async def get_session(self, sessionmaker: async_sessionmaker) -> AsyncSession:
        async with sessionmaker() as session:
            async with session.begin():
                yield session


class CacheProvider(Provider):
    def __init__(self, settings: Settings):
        super().__init__()
        self.settings = settings

    @provide(scope=Scope.APP)
    async def get_redis(self) -> redis.Redis:
        client = redis.from_url(self.settings.REDIS_URL, decode_responses=True)
        yield client
        await client.aclose()

    @provide(scope=Scope.REQUEST)
    def get_cache_client(self, client: redis.Redis) -> CacheClient:
        return CacheClient(client)


class ServiceProvider(Provider):
    scope = Scope.REQUEST

    @provide
    def get_order_repo(self, session: AsyncSession) -> OrderRepository:
        return OrderRepository(session)

    @provide
    def get_order_service(
        self, repo: OrderRepository, cache: CacheClient
    ) -> OrderService:
        return OrderService(repo, cache)
```

Dois detalhes importantes aqui:

Primeiro, o `@provide(scope=Scope.APP)` com `yield` é um gerador que funciona exatamente como um context manager — o código após o `yield` é o cleanup. O engine é criado uma vez na inicialização e destruído no shutdown. Isso é análogo ao `lifespan` do FastAPI, mas declarado dentro do provider.

Segundo, o `ServiceProvider` define `scope = Scope.REQUEST` como padrão de classe e aplica a todos os `@provide` sem escopo explícito. Isso evita repetição.

### Montando a aplicação

```python
# app/main.py
from contextlib import asynccontextmanager
from fastapi import FastAPI
from dishka.integrations.fastapi import setup_dishka
from dishka import make_async_container

from app.config import Settings
from app.providers import DatabaseProvider, CacheProvider, ServiceProvider
from app.routers import orders

settings = Settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    container = make_async_container(
        DatabaseProvider(settings),
        CacheProvider(settings),
        ServiceProvider(),
    )
    setup_dishka(container, app)
    yield
    await container.close()


app = FastAPI(lifespan=lifespan)
app.include_router(orders.router)
```

### Usando nos endpoints

A integração com FastAPI injeta o container no request e resolve as dependências automaticamente. Nos endpoints, você usa `FromDishka` para declarar o que precisa:

```python
# app/routers/orders.py
from fastapi import APIRouter
from dishka.integrations.fastapi import FromDishka

from app.services.order_service import OrderService

router = APIRouter(prefix="/orders", tags=["orders"])


@router.get("/{order_id}")
async def get_order(
    order_id: int,
    service: FromDishka[OrderService],
):
    order = await service.get_order(order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@router.post("/")
async def create_order(
    payload: OrderCreate,
    service: FromDishka[OrderService],
):
    return await service.create_order(payload)
```

O endpoint não sabe nada sobre banco de dados, Redis, ou como montar um `OrderService`. Ele declara o que precisa e recebe. O container resolve o grafo inteiro.

## Escopo na prática: o que acontece em cada requisição

Quando uma requisição chega em `GET /orders/42`:

1. O Dishka abre um escopo de `REQUEST`
2. Resolve `OrderService` — que precisa de `OrderRepository` e `CacheClient`
3. `OrderRepository` precisa de `AsyncSession` — criada dentro do escopo de REQUEST, com transação aberta
4. `CacheClient` precisa de `redis.Redis` — reutiliza a conexão de escopo APP, cria apenas o wrapper
5. `OrderService` é construído com as dependências resolvidas
6. O endpoint executa
7. Ao final da requisição, o escopo de REQUEST é encerrado — a transação é commitada (ou revertida em caso de exceção) e a sessão é fechada

O Redis e o engine do SQLAlchemy não são recriados. Eles vivem no escopo `APP` e são compartilhados entre requisições. A sessão e o cliente de cache recebem uma nova instância por requisição.

## Testabilidade: o ganho real

Com o Dishka, substituir dependências em testes é declarativo e não polui o código de produção:

```python
# tests/test_orders.py
import pytest
from httpx import AsyncClient, ASGITransport
from dishka import make_async_container
from dishka.integrations.fastapi import setup_dishka
from unittest.mock import AsyncMock

from app.main import app
from app.services.order_service import OrderService


class MockServiceProvider(Provider):
    scope = Scope.REQUEST

    @provide
    def get_order_service(self) -> OrderService:
        mock = AsyncMock(spec=OrderService)
        mock.get_order.return_value = Order(id=42, total=99.90)
        return mock


@pytest.fixture
async def client():
    container = make_async_container(MockServiceProvider())
    setup_dishka(container, app)
    
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as ac:
        yield ac
    
    await container.close()


async def test_get_order(client):
    response = await client.get("/orders/42")
    assert response.status_code == 200
    assert response.json()["id"] == 42
```

Nenhum banco. Nenhum Redis. O container de teste substitui apenas o que interessa — o serviço — e o resto do pipeline HTTP (serialização, validação de schema, roteamento) funciona normalmente.

Compare isso com `app.dependency_overrides`: aqui você substitui providers inteiros de forma composível, sem precisar conhecer a cadeia de `Depends` que está por baixo.

## Reutilizando fora do FastAPI

Essa é uma vantagem que o `Depends()` nativo simplesmente não oferece. Precisa processar pedidos num worker?

```python
# workers/process_orders.py
import asyncio
from dishka import make_async_container

from app.config import Settings
from app.providers import DatabaseProvider, CacheProvider, ServiceProvider
from app.services.order_service import OrderService

settings = Settings()

async def process_pending_orders():
    container = make_async_container(
        DatabaseProvider(settings),
        CacheProvider(settings),
        ServiceProvider(),
    )

    async with container() as request_container:
        service = await request_container.get(OrderService)
        await service.process_pending()

    await container.close()

asyncio.run(process_pending_orders())
```

O mesmo container, os mesmos providers, os mesmos serviços — sem nenhum acoplamento ao FastAPI. A configuração de escopos funciona da mesma forma.

## Quando o `Depends()` ainda é a escolha certa

Dishka não é a resposta para tudo. O sistema nativo do FastAPI é mais simples de entender, tem zero dependências extras e funciona perfeitamente para:

- APIs pequenas onde o grafo de dependências é raso
- Dependências que são genuinamente específicas do contexto HTTP (request body, headers, path params)
- Projetos onde a equipe já está familiarizada com o `Depends()` e a complexidade não justifica a troca

O Dishka brilha quando a aplicação cresce, quando você precisa de múltiplos escopos de ciclo de vida, quando os serviços precisam ser compartilhados com workers ou scripts, e quando a testabilidade começa a sofrer com `dependency_overrides` espalhados.

---

Saindo da teoria e indo para o que importa: se você tem uma API FastAPI que está crescendo e os `Depends()` começaram a se multiplicar de forma difícil de rastrear, o Dishka resolve isso com uma abordagem que você vai reconhecer se já usou Spring, .NET DI ou qualquer container IoC mais robusto. A curva de aprendizado é pequena e o ganho em testabilidade e organização é imediato.

Se você implementou algo parecido ou tem dúvidas sobre como organizar os providers em projetos maiores, continua o papo no Fediverse: `@riverfount@bolha.us`.
