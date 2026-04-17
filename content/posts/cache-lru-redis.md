---
title: "Sua aplicação está buscando os mesmos dados várias vezes"
date: 2026-04-17
draft: false
tags: ["python", "cache", "redis", "performance", "lru-cache"]
cover:
  image: "images/covers/cover-cache-lru-redis.png"
  alt: "Sua aplicação está buscando os mesmos dados várias vezes"
  relative: false
---

O profiling apontou um endpoint lento. Você abre o relatório do cProfile, ordena por `cumtime`, e o topo está dominado por chamadas ao banco de dados. Antes de qualquer coisa: se o problema for N+1 queries, cache não é a solução — é um emplastro. N+1 se resolve na query, com joins, `selectinload` ou subqueries conforme o ORM. Depois disso, índices. Cache entra só se, após a query estar correta e os índices no lugar, a performance ainda não for suficiente.

O caso em que cache resolve de verdade é diferente: não é uma query mal escrita rodando muitas vezes numa requisição, mas uma query correta rodando desnecessariamente entre requisições. A mesma configuração de sistema consultada a cada request. O mesmo registro de produto buscado a cada renderização de página. O mesmo resultado de uma API externa com TTL de uma hora sendo requisitado a cada chamada. O problema não é a estrutura da query — é que o resultado não muda e ninguém está guardando.

Cache não é otimização prematura quando o profiling já identificou esse padrão. É a solução mais direta para um problema que você já mediu.

```python
import time
from functools import lru_cache


def get_plan_config(plan_id: str) -> dict:
    # Simula uma query ao banco
    time.sleep(0.05)
    return {
        "plan_id": plan_id,
        "max_users": 10 if plan_id == "basic" else 100,
        "features": ["export", "api"] if plan_id == "pro" else [],
    }
```

Sem cache, cada chamada paga 50ms. Numa aplicação que renderiza essa configuração em múltiplos pontos por requisição, isso acumula. Com `lru_cache`, o resultado é armazenado na memória do processo após a primeira chamada:

```python
@lru_cache(maxsize=128)
def get_plan_config(plan_id: str) -> dict:
    time.sleep(0.05)
    return {
        "plan_id": plan_id,
        "max_users": 10 if plan_id == "basic" else 100,
        "features": ["export", "api"] if plan_id == "pro" else [],
    }
```

A diferença é imediata:

```
# Sem cache: 10 chamadas = ~500ms
# Com lru_cache: 10 chamadas com o mesmo plan_id = ~50ms (só a primeira paga)
```

O `maxsize=128` define quantas entradas únicas ficam em memória. Quando o limite é atingido, as entradas menos usadas recentemente são descartadas — daí o "LRU" (Least Recently Used). Passar `maxsize=None` desativa o descarte, mas a memória cresce sem limite.

Para verificar a taxa de acerto do cache:

```python
print(get_plan_config.cache_info())
# CacheInfo(hits=9, misses=1, maxsize=128, currsize=1)
```

### O problema do `lru_cache` em aplicações web

`lru_cache` é um cache de processo. Em servidores WSGI/ASGI com múltiplos workers, cada worker tem seu próprio cache — não há compartilhamento. Funciona bem para dados verdadeiramente estáticos (tabelas de configuração, constantes de negócio), mas apresenta dois problemas em contextos mais dinâmicos:

**Invalidação é difícil.** Não há TTL nativo. Se o dado no banco muda, o cache fica obsoleto até o processo reiniciar — ou até você chamar `get_plan_config.cache_clear()` explicitamente, o que requer que o código saiba quando invalidar.

**Não compartilha estado entre workers.** Se você tem 4 workers Gunicorn, cada um vai fazer o miss na primeira chamada e manter sua própria cópia. Para dados que mudam com frequência ou que precisam ser consistentes entre workers, `lru_cache` não resolve.

## `cachetools` para TTL e controle fino

Quando você precisa de expiração automática sem sair do processo, `cachetools` é a escolha natural:

```python
from cachetools import TTLCache, cached
from cachetools.keys import hashkey

# Cache com no máximo 256 entradas, expiração de 5 minutos
plan_cache = TTLCache(maxsize=256, ttl=300)


@cached(cache=plan_cache, key=lambda plan_id: hashkey(plan_id))
def get_plan_config(plan_id: str) -> dict:
    # query ao banco
    ...
```

```bash
uv add cachetools
```

O `TTLCache` descarta entradas tanto por LRU (quando `maxsize` é atingido) quanto por tempo (quando o TTL expira). Isso resolve o problema de dados obsoletos sem depender de invalidação explícita.

Para o caso de função de método em classe, o `cached` do `cachetools` exige atenção ao `self` na chave — o padrão seria cachear por `(self, plan_id)`, que não faz sentido. A solução é ignorar o `self` na função de chave:

```python
class PlanService:
    _cache = TTLCache(maxsize=256, ttl=300)

    @cached(cache=_cache, key=lambda self, plan_id: hashkey(plan_id))
    def get_plan_config(self, plan_id: str) -> dict:
        ...
```

## Redis: quando o cache precisa ser compartilhado

`lru_cache` e `cachetools` vivem no processo. Para aplicações com múltiplos workers, múltiplas instâncias, ou que precisam de cache persistente entre deploys, o cache precisa de uma camada externa. Redis é o padrão para isso.

O padrão de uso mais direto usa `redis-py`:

```bash
uv add redis
```

```python
import json
import redis

r = redis.Redis(host="localhost", port=6379, decode_responses=True)


def get_plan_config(plan_id: str) -> dict:
    cache_key = f"plan:config:{plan_id}"

    cached = r.get(cache_key)
    if cached:
        return json.loads(cached)

    # Miss: busca no banco
    config = fetch_from_db(plan_id)

    # Armazena com TTL de 5 minutos
    r.setex(cache_key, 300, json.dumps(config))

    return config
```

O padrão é o mesmo em qualquer implementação: chave → verifica cache → se hit, retorna; se miss, busca a fonte e armazena. A diferença em relação ao `lru_cache` é que todos os workers do processo, e todas as instâncias da aplicação, compartilham o mesmo Redis.

### Nomeando chaves com consistência

Chaves arbitrárias se tornam um problema de manutenção rapidamente. O padrão `namespace:entidade:identificador` ajuda a manter organização e facilita operações em lote:

```python
# Ruim: colisões entre contextos diferentes
r.set("config_basic", ...)
r.set("basic", ...)

# Bom: namespace explícito
r.set("plan:config:basic", ...)
r.set("user:profile:42", ...)
r.set("product:price:SKU-001", ...)
```

Com um namespace consistente, você pode listar todas as chaves de um tipo com `r.keys("plan:config:*")` ou expirar um grupo inteiro. Em produção, prefira `r.scan_iter("plan:config:*")` ao `r.keys()` — o `keys()` bloqueia o Redis enquanto escaneia.

### Invalidação explícita

TTL cuida da expiração automática, mas há casos em que você precisa invalidar imediatamente — um preço que mudou, uma permissão que foi revogada. Com Redis, a invalidação é direta:

```python
def update_plan_config(plan_id: str, new_config: dict) -> None:
    save_to_db(plan_id, new_config)
    r.delete(f"plan:config:{plan_id}")  # Invalida o cache
```

Na próxima requisição, o miss vai buscar o dado atualizado do banco e rearmazenar.

## Cache como dependência injetável

Se sua aplicação usa injeção de dependência — como no padrão coberto no [artigo sobre IoC com Dishka e FastAPI](https://www.riverfount.dev.br/posts/ioc_dishka/) —, o cliente Redis não deveria ser instanciado dentro das funções que o usam. Ele é uma dependência de infraestrutura que pertence ao container.

O mesmo projeto em que o `OrderService` recebia `SessionLocal` pelo construtor serve de base aqui. A adição é um `CacheClient` que o container passa junto com a sessão do banco:

```python
# infra/providers.py
from dishka import Provider, Scope, provide
from sqlalchemy.orm import Session
import redis

from app.database import SessionLocal
from app.settings import settings


class InfraProvider(Provider):
    @provide(scope=Scope.APP)
    def redis_client(self) -> redis.Redis:
        return redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            decode_responses=True,
        )

    @provide(scope=Scope.REQUEST)
    def db_session(self) -> Session:
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()
```

```python
# services/order_service.py
import json
from sqlalchemy.orm import Session
import redis

from app.models import Order
from app.schemas import OrderOut


class OrderService:
    def __init__(self, db: Session, cache: redis.Redis) -> None:
        self._db = db
        self._cache = cache

    def get_order(self, order_id: int) -> OrderOut:
        key = f"order:{order_id}"

        if cached := self._cache.get(key):
            return OrderOut(**json.loads(cached))

        order = self._db.query(Order).filter(Order.id == order_id).first()
        if order is None:
            raise ValueError(f"Order {order_id} not found")

        result = OrderOut.model_validate(order)
        self._cache.setex(key, 300, result.model_dump_json())
        return result

    def update_order_status(self, order_id: int, status: str) -> OrderOut:
        order = self._db.query(Order).filter(Order.id == order_id).first()
        order.status = status
        self._db.commit()
        self._db.refresh(order)

        # Invalida o cache do pedido atualizado
        self._cache.delete(f"order:{order_id}")

        return OrderOut.model_validate(order)
```

```python
# routers/orders.py
from dishka.integrations.fastapi import inject, FromDishka
from fastapi import APIRouter

from app.services.order_service import OrderService

router = APIRouter()


@router.get("/orders/{order_id}")
@inject
async def get_order(order_id: int, service: FromDishka[OrderService]) -> OrderOut:
    return service.get_order(order_id)
```

O Dishka resolve `OrderService` sabendo que ele precisa de `Session` e `redis.Redis` — ambos registrados no `InfraProvider`. O endpoint não sabe da existência do Redis, e o `OrderService` não sabe de onde veio o cliente. Testabilidade imediata: em testes unitários, você injeta um `fakeredis.FakeRedis()` no lugar do cliente real sem tocar no código do serviço.

## Quando não usar cache

Cache introduz complexidade. Antes de adicionar uma camada, vale verificar se o problema é realmente de frequência e não de eficiência.

Se a query é lenta porque falta índice, cache vai esconder o sintoma sem resolver a causa. O dado vai estar obsoleto no cache enquanto o banco continua sem índice. `EXPLAIN ANALYZE` primeiro.

Se o dado muda com frequência alta e o TTL precisa ser muito curto para ser útil, o overhead de gerenciar o cache pode superar o ganho. Para dados que mudam a cada segundo, cache com TTL de 2 segundos provavelmente não compensa.

Se a aplicação roda com um único worker e o dado é buscado poucas vezes por requisição, `lru_cache` com `maxsize` adequado resolve sem a necessidade de Redis. Infraestrutura adicional tem custo operacional.

## O critério de escolha

Três perguntas definem a escolha:

**O dado muda?** Se nunca ou raramente, `lru_cache` com `maxsize=None` é suficiente. Tabelas de países, unidades de medida, configurações que só mudam com deploy.

**Precisa de expiração automática sem Redis?** `TTLCache` do `cachetools`. Dados que mudam mas com janela de consistência aceitável — configurações de plano, permissões por papel.

**Múltiplos workers ou instâncias precisam do mesmo cache?** Redis. Sessions, dados de sessão, rate limiting, qualquer coisa em que a inconsistência entre workers cause problemas.

---

O ciclo de performance fecha aqui: profiling identificou o gargalo, asyncio resolveu I/O concorrente, cache elimina o I/O desnecessário. O próximo nível — quando o problema não é a query em si, mas o esgotamento de conexões sob carga — é o connection pooling com SQLAlchemy.

Se você implementou algum desses padrões numa situação não óbvia ou tem uma história de cache que deu errado de maneira interessante, me conta no Fediverse em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
