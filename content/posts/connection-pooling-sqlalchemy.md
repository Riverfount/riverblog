---
title: "Por que a aplicação travava mesmo com queries rápidas"
date: 2026-05-05
draft: false
tags: ["python", "sqlalchemy", "banco-de-dados", "performance", "produção"]
cover:
  image: "images/covers/cover-connection-pooling-sqlalchemy.png"
  alt: "Por que a aplicação travava mesmo com queries rápidas"
  relative: false
---

O profiling não encontrou nada. As queries estão com índice, rodam em menos de 5ms,
e o cache eliminou as buscas repetidas. Mas sob carga — dez, vinte requisições
simultâneas — a aplicação trava. Requisições acumulam na fila, o tempo de resposta
explode, e o log mostra um erro que parece absurdo: `TimeoutError: QueuePool limit of
size 5 overflow 10 reached`.

O banco de dados não está sobrecarregado. As queries são rápidas. O problema está entre
a aplicação e o banco — no pool de conexões que ninguém configurou.

## O que é o pool e por que ele existe

Abrir uma conexão TCP com o banco de dados não é barato. Dependendo do servidor, do
driver e da rede, o handshake leva de alguns milissegundos a algumas dezenas de
milissegundos. Numa aplicação web em que cada requisição faz várias queries, pagar
esse custo a cada request seria proibitivo.

O pool resolve isso mantendo conexões abertas e reutilizando-as entre requisições. Ao
invés de abrir e fechar uma conexão por query, a aplicação pega uma conexão emprestada
do pool, usa, e devolve. O pool gerencia o ciclo de vida das conexões em segundo plano.

O SQLAlchemy implementa esse comportamento por padrão com o `QueuePool`. Quando você
cria um `engine`, o pool já está lá — com configurações padrão que funcionam para
desenvolvimento mas costumam ser insuficientes para produção.

```python
from sqlalchemy import create_engine

engine = create_engine("postgresql+psycopg2://user:pass@localhost/mydb")
```

Essa linha cria um pool com `pool_size=5` e `max_overflow=10`. Sem nenhum argumento
adicional, a aplicação nunca vai usar mais do que 15 conexões simultâneas — e vai
travar quando a décima sexta requisição chegar antes de qualquer das anteriores
terminar.

## Anatomia do travamento

Para entender o que acontece, é útil visualizar o ciclo de uma requisição que usa o pool:

1. A requisição chega e solicita uma conexão ao pool
2. Se há conexão disponível, o pool entrega imediatamente
3. Se não há, o pool verifica se pode criar uma nova (dentro do `max_overflow`)
4. Se nem isso é possível, a requisição fica bloqueada esperando por até `pool_timeout`
   segundos (padrão: 30)
5. Se nenhuma conexão ficar disponível dentro do timeout, `TimeoutError` é lançado

O problema clássico não é pico de carga — é conexão que não volta para o pool. Uma
transação aberta que nunca faz commit, um `session.close()` que foi esquecido num
caminho de erro, um generator que nunca foi consumido até o fim. Cada um desses casos
mantém uma conexão ocupada indefinidamente.

```python
# Isso vaza conexão se ocorrer exceção antes do close()
def get_user(user_id: int) -> User:
    session = SessionLocal()
    user = session.query(User).filter(User.id == user_id).first()
    session.close()  # não executa se a query lançar exceção
    return user
```

O context manager resolve o problema:

```python
def get_user(user_id: int) -> User:
    with SessionLocal() as session:
        return session.query(User).filter(User.id == user_id).first()
```

Mas em aplicações com FastAPI ou outro framework, o padrão correto é injetar a sessão
como dependência — como vimos no [artigo sobre IoC com Dishka e FastAPI](https://www.riverfount.dev.br/posts/ioc_dishka/).
A sessão aberta no início da requisição é fechada no `finally` do provider, garantindo
que a conexão volte ao pool independentemente de exceções.

## Diagnosticando o estado do pool

Antes de ajustar configurações, vale medir o que está acontecendo. O SQLAlchemy expõe
o estado do pool pelo objeto `engine.pool`:

```python
def log_pool_status(engine):
    pool = engine.pool
    print(f"Tamanho do pool:        {pool.size()}")
    print(f"Conexões em uso:        {pool.checkedout()}")
    print(f"Conexões disponíveis:   {pool.checkedin()}")
    print(f"Conexões overflow:      {pool.overflow()}")
```

Em produção, esses valores podem ser emitidos como métricas para Prometheus ou
expostos num endpoint de healthcheck. O número que importa é `checkedout()` sob
carga: se ele consistentemente se aproxima de `pool_size + max_overflow`, a
configuração precisa ser ajustada — ou há vazamento de conexões.

O SQLAlchemy também emite eventos do pool em que você pode instrumentar logging:

```python
from sqlalchemy import event

@event.listens_for(engine, "checkout")
def on_checkout(dbapi_conn, conn_record, conn_proxy):
    # Disparado quando uma conexão é retirada do pool
    pass

@event.listens_for(engine, "checkin")
def on_checkin(dbapi_conn, conn_record):
    # Disparado quando uma conexão é devolvida ao pool
    pass

@event.listens_for(engine, "connect")
def on_connect(dbapi_conn, conn_record):
    # Disparado quando uma nova conexão física é criada
    pass
```

Adicionar um log no `checkout` com `time.monotonic()` e comparar com o timestamp do
`checkin` correspondente revela quais partes do código estão segurando conexões por
mais tempo do que deveriam.

## Configurando o pool para produção

Os parâmetros relevantes do `QueuePool`:

```python
engine = create_engine(
    "postgresql+psycopg2://user:pass@localhost/mydb",
    pool_size=10,        # conexões permanentes mantidas abertas
    max_overflow=20,     # conexões extras criadas sob demanda (além do pool_size)
    pool_timeout=30,     # segundos para esperar por uma conexão antes de lançar TimeoutError
    pool_recycle=1800,   # segundos antes de reciclar uma conexão (evita "stale connections")
    pool_pre_ping=True,  # testa a conexão antes de entregar ao código
)
```

**`pool_size`** define quantas conexões o pool mantém abertas permanentemente. Conexões
acima desse número (até `pool_size + max_overflow`) são criadas sob demanda e fechadas
quando devolvidas ao pool. Conexões dentro do `pool_size` permanecem abertas mesmo
ociosas.

**`max_overflow`** define o quanto o pool pode crescer além do `pool_size`. Com
`pool_size=10` e `max_overflow=20`, a aplicação pode ter no máximo 30 conexões
simultâneas. Quando a carga cai, as 20 extras são fechadas e o pool volta a 10.

**`pool_recycle`** é crítico em produção. Conexões TCP podem ser encerradas pelo
servidor de banco de dados, pelo load balancer ou pela infraestrutura de rede após
um período de inatividade — sem que o pool saiba. Sem `pool_recycle`, a aplicação
tenta usar uma conexão que já foi fechada pelo servidor e recebe um erro na primeira
query. Com `pool_recycle=1800`, o pool recria conexões que estão abertas há mais de
30 minutos, evitando o problema.

**`pool_pre_ping`** resolve o mesmo problema de forma mais cirúrgica: antes de
entregar uma conexão ao código, o pool executa `SELECT 1` para verificar se ela ainda
está viva. Se não estiver, descarta e cria uma nova. O custo é uma query extra por
checkout de conexão — negligível na maioria dos casos e menor que o custo de tratar
uma `OperationalError` inesperada.

### Dimensionando o pool

Não existe fórmula universal, mas um ponto de partida razoável para aplicações web:

```ini
pool_size ≈ número de workers × 2
max_overflow ≈ pool_size × 2
```

Para uma aplicação Gunicorn com 4 workers síncronos, `pool_size=8` e `max_overflow=16`
é um ponto de partida. Para workers assíncronos (uvicorn com asyncio), cada worker
pode lidar com muitas requisições simultâneas — o pool precisa ser maior, ou a
aplicação precisa de connection pooling externo como o PgBouncer.

O limite real não está na aplicação — está no banco de dados. PostgreSQL tem
`max_connections` (padrão 100). Se você tem 3 instâncias da aplicação com
`pool_size=10` e `max_overflow=20`, o pior caso é 90 conexões simultâneas. Isso
ainda cabe em 100, mas deixa pouca margem. Monitorar `pg_stat_activity` em produção
revela o uso real:

```sql
SELECT count(*), state
FROM pg_stat_activity
WHERE datname = 'mydb'
GROUP BY state;
```

## Conexões e asyncio

Se a aplicação usa SQLAlchemy assíncrono com asyncio — como mencionado no fechamento
do [artigo sobre asyncio](https://www.riverfount.dev.br/posts/asyncio_na_pratica/) — o pool relevante é o
`AsyncAdaptedQueuePool`, configurado da mesma forma mas via `create_async_engine`:

```python
from sqlalchemy.ext.asyncio import create_async_engine

engine = create_async_engine(
    "postgresql+asyncpg://user:pass@localhost/mydb",
    pool_size=10,
    max_overflow=20,
    pool_recycle=1800,
    pool_pre_ping=True,
)
```

A diferença importante: com asyncio, um único worker pode processar centenas de
requisições concorrentes. Isso significa que o pool pode ser saturado com muito menos
workers do que no caso síncrono. Uma aplicação FastAPI com um único processo uvicorn
pode facilmente saturar um pool de 5 conexões se tiver muitas coroutines aguardando
resultado de queries ao mesmo tempo.

O padrão de uso da sessão assíncrona segue o mesmo princípio do síncrono — o context
manager garante que a conexão seja devolvida:

```python
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

async def get_orders(user_id: int) -> list[Order]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Order).where(Order.user_id == user_id)
        )
        return result.scalars().all()
```

## NullPool: quando não usar pool nenhum

Nem toda aplicação precisa de pool. Scripts de linha de comando, jobs de ETL que rodam
em batch, workers Celery em que cada task abre e fecha sua própria sessão — nesses
casos o pool pode causar mais problema do que resolve, mantendo conexões abertas mesmo
quando o script está ocioso entre execuções.

O `NullPool` desativa o pool completamente: cada `connect()` abre uma conexão nova e
cada `close()` encerra de verdade:

```python
from sqlalchemy.pool import NullPool

engine = create_engine(
    "postgresql+psycopg2://user:pass@localhost/mydb",
    poolclass=NullPool,
)
```

Para aplicações web, `NullPool` é quase sempre a escolha errada — o custo de abrir uma
conexão por request destrói a performance. Mas para processos de curta duração ou
ambientes em que o pooling é delegado a uma ferramenta externa como o PgBouncer, faz
sentido.

## PgBouncer: pooling fora da aplicação

Quando a aplicação escala horizontalmente — múltiplas instâncias, cada uma com seu
próprio pool — o número total de conexões com o banco cresce proporcionalmente.
Dez instâncias com `pool_size=10` resultam em 100 conexões permanentes, mesmo que
a carga real exija apenas 20.

O PgBouncer resolve isso centralizando o pooling num proxy externo. As instâncias da
aplicação se conectam ao PgBouncer (que parece um servidor PostgreSQL normal), e o
PgBouncer mantém um pool menor de conexões reais com o banco.

A configuração básica do PgBouncer para esse cenário:

```ini
# pgbouncer.ini
[databases]
mydb = host=localhost port=5432 dbname=mydb

[pgbouncer]
pool_mode = transaction
max_client_conn = 200
default_pool_size = 20
```

Com `pool_mode = transaction`, o PgBouncer devolve a conexão ao pool após cada
transação — não após cada sessão. Isso maximiza o reuso, mas tem uma implicação
importante: prepared statements e session-level settings não funcionam corretamente
nesse modo. Para aplicações que usam esses recursos, `pool_mode = session` é mais
seguro, mas menos eficiente.

Com PgBouncer na frente, o `pool_size` da aplicação pode ser reduzido drasticamente
— ou substituído por `NullPool`, deixando todo o gerenciamento para o proxy.

---

Configurar o pool corretamente é uma daquelas coisas que ninguém faz até o primeiro
travamento em produção. Depois que acontece uma vez, vira checklist de deploy. Se você
passou por um `QueuePool limit reached` e tem uma história para contar — ou quer
discutir como dimensionar o pool para o seu caso — me encontra no Fediverse em
**[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
