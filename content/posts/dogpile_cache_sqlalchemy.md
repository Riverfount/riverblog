---
title: "suas queries do SQLAlchemy podem ser cacheadas sem Redis manual"
date: 2026-06-02
draft: false
tags: ["python", "sqlalchemy", "cache", "dogpile", "performance"]
cover:
  image: "images/covers/cover-dogpile-cache-sqlalchemy.png"
  alt: "suas queries do SQLAlchemy podem ser cacheadas sem Redis manual"
  relative: false
---

O pool está configurado. As queries têm índice. O `lru_cache` eliminou as buscas repetidas nos
endpoints mais simples. Mesmo assim, um endpoint de relatório continua lento, não porque está
mal escrito, mas porque ele é genuinamente caro: agrega dados de várias tabelas, cruza informações
de três meses, e faz isso a cada requisição, mesmo que os dados subjacentes não mudem por horas.

O `lru_cache` não resolve. Ele cacheia por argumentos exatos, e os filtros de data variam o
suficiente para inviabilizar o hit rate. O Redis resolve, mas exige serializar o resultado
manualmente, gerenciar a chave, decidir em que camada a invalidação acontece, código de infraestrutura
espalhado pela camada de negócio. O que falta é uma abstração que entenda o ORM.

O `dogpile.cache` é essa abstração.

## O que é o dogpile.cache

O dogpile.cache é uma biblioteca de cache desenvolvida pelo mesmo autor do SQLAlchemy (Mike
Bayer) e mantida sob o projeto SQLAlchemy. Ele não é um plugin do ORM, funciona de forma
independente, mas foi projetado com o caso de uso de cache de queries em mente, e a integração
com o SQLAlchemy é direta.

O nome vem do "dogpile effect": o que acontece quando o cache expira e múltiplas requisições
simultâneas percebem o miss ao mesmo tempo, todas disparando a query cara para o banco. O
dogpile.cache resolve isso com um mecanismo de lock que garante que apenas uma requisição
recalcula o valor enquanto as outras aguardam ou recebem o valor expirado temporariamente.

Para instalar:

```bash
uv add dogpile.cache
```

Para usar com Redis, adicionar também o cliente:

```bash
uv add redis
```

## Configurando a região de cache

O dogpile.cache trabalha com o conceito de **regiões**: objetos de configuração que definem o
backend de armazenamento, o tempo de expiração padrão e outros parâmetros. Uma aplicação pode
ter várias regiões com políticas diferentes: uma para dados voláteis com TTL curto, outra para
relatórios que podem ter TTL de horas.

```python
from dogpile.cache import make_region

# Região em memória — boa para desenvolvimento ou dados por processo
region_memoria = make_region().configure(
    "dogpile.cache.memory",
    expiration_time=300,  # 5 minutos
)

# Região Redis — para ambientes com múltiplos workers
region_redis = make_region().configure(
    "dogpile.cache.redis",
    expiration_time=3600,
    arguments={
        "host": "localhost",
        "port": 6379,
        "db": 0,
    },
)
```

A região é o ponto central de controle: trocar de backend de memória para Redis não exige mudar
o código que usa o cache, apenas a configuração da região.

## Cacheando uma query

Com a região configurada, a forma mais simples de cachear um resultado é o decorador `cache_on_arguments`:

```python
from sqlalchemy import select
from sqlalchemy.orm import Session
from dogpile.cache import make_region

from .models import Pedido, Produto

region = make_region().configure(
    "dogpile.cache.redis",
    expiration_time=1800,
    arguments={"host": "localhost", "port": 6379},
)


@region.cache_on_arguments()
def buscar_resumo_produtos(session: Session, categoria_id: int) -> list[dict]:
    stmt = (
        select(
            Produto.id,
            Produto.nome,
            Produto.preco,
        )
        .where(Produto.categoria_id == categoria_id)
        .where(Produto.ativo == True)
        .order_by(Produto.nome)
    )
    rows = session.execute(stmt).all()
    return [{"id": r.id, "nome": r.nome, "preco": float(r.preco)} for r in rows]
```

A chave de cache é gerada automaticamente a partir do nome da função e dos argumentos. Na
primeira chamada com `categoria_id=5`, a query roda; nas chamadas seguintes dentro do TTL, o
resultado vem do Redis sem tocar no banco.

Há um detalhe importante: o objeto `Session` não pode fazer parte da chave. O dogpile.cache
serializa os argumentos para construir a chave, e sessões do SQLAlchemy não são serializáveis.
A solução é excluir argumentos que não devem participar da chave usando `function_key_generator`:

```python
from dogpile.cache.util import function_key_generator


def gerar_chave_sem_session(namespace, fn, **kwargs):
    generator = function_key_generator(namespace, fn, to_str=str)

    def gerar(*arg, **kw):
        # Remove o primeiro argumento (session) da chave
        return generator(*arg[1:], **kw)

    return gerar


region = make_region(function_key_generator=gerar_chave_sem_session).configure(
    "dogpile.cache.redis",
    expiration_time=1800,
    arguments={"host": "localhost", "port": 6379},
)
```

Com isso, a chave considera apenas `categoria_id`, e a sessão é passada normalmente à função mas
ignorada para fins de cache.

## Invalidação por região e por chave

O TTL cuida da invalidação automática. Para invalidação explícita, quando um produto é
atualizado e o cache precisa ser descartado imediatamente, há duas opções.

Invalidar uma entrada específica:

```python
buscar_resumo_produtos.invalidate(session, categoria_id=5)
```

Invalidar toda a região de uma vez:

```python
region.invalidate()
```

Invalidar a região inteira raramente é o que se quer em produção, pois descarta tudo de uma vez e
gera uma rajada de queries no banco até o cache reaquecer. O padrão mais seguro é invalidar por
chave no momento da escrita:

```python
def atualizar_produto(session: Session, produto_id: int, dados: dict) -> None:
    produto = session.get(Produto, produto_id)
    for campo, valor in dados.items():
        setattr(produto, campo, valor)
    session.commit()
    # Invalida apenas o cache da categoria desse produto
    buscar_resumo_produtos.invalidate(session, produto.categoria_id)
```

## Múltiplos backends e separação de políticas

A separação em regiões permite políticas de cache distintas para dados com características
diferentes. Um exemplo de configuração com duas regiões:

```python
# Dados de catálogo: mudam raramente, TTL longo
region_catalogo = make_region(
    function_key_generator=gerar_chave_sem_session
).configure(
    "dogpile.cache.redis",
    expiration_time=7200,  # 2 horas
    arguments={"host": "localhost", "port": 6379, "db": 1},
)

# Dados de estoque: mudam com frequência, TTL curto
region_estoque = make_region(
    function_key_generator=gerar_chave_sem_session
).configure(
    "dogpile.cache.redis",
    expiration_time=60,  # 1 minuto
    arguments={"host": "localhost", "port": 6379, "db": 2},
)


@region_catalogo.cache_on_arguments()
def buscar_categorias(session: Session) -> list[dict]:
    ...


@region_estoque.cache_on_arguments()
def buscar_estoque_disponivel(session: Session, produto_id: int) -> int:
    ...
```

Cada função declara explicitamente qual região usa. A política de expiração fica junto à
configuração da região, não espalhada pelo código de negócio.

## Integrando com injeção de dependência

Se a aplicação usa injeção de dependência, como no padrão com Dishka e FastAPI coberto
[anteriormente](https://www.riverfount.dev.br/posts/ioc_dishka/), a região de cache
pode ser registrada como dependência e injetada nos serviços:

```python
from dishka import provide, Provider, Scope
from dogpile.cache import make_region, CacheRegion


class CacheProvider(Provider):
    @provide(scope=Scope.APP)
    def cache_region(self) -> CacheRegion:
        return make_region(
            function_key_generator=gerar_chave_sem_session
        ).configure(
            "dogpile.cache.redis",
            expiration_time=1800,
            arguments={"host": "localhost", "port": 6379},
        )


class ProdutoService:
    def __init__(self, session: Session, cache: CacheRegion) -> None:
        self._session = session
        self._cache = cache

    def buscar_resumo(self, categoria_id: int) -> list[dict]:
        chave = f"produtos:categoria:{categoria_id}"
        return self._cache.get_or_create(
            chave,
            lambda: self._buscar_do_banco(categoria_id),
        )

    def _buscar_do_banco(self, categoria_id: int) -> list[dict]:
        stmt = (
            select(Produto.id, Produto.nome, Produto.preco)
            .where(Produto.categoria_id == categoria_id)
            .where(Produto.ativo == True)
        )
        rows = self._session.execute(stmt).all()
        return [{"id": r.id, "nome": r.nome, "preco": float(r.preco)} for r in rows]
```

O método `get_or_create` recebe a chave e um callable que produz o valor quando há cache miss.
O dogpile se encarrega do lock para evitar o dogpile effect.

## Quando o dogpile.cache faz sentido

Vale a pena usar quando a query já está correta e otimizada (com joins adequados, índices no
lugar, pool configurado), mas o resultado é caro demais para recalcular a cada requisição, e
o dado é estável o suficiente para tolerar alguma defasagem.

Não faz sentido quando os dados mudam a cada escrita e o cache precisaria ser invalidado
imediatamente: a essa frequência de invalidação, o overhead do cache supera o benefício. E não
substitui a correção de N+1 queries, esse problema se resolve na query, não no cache.

O ponto de encaixe na trilha de performance é exatamente este: depois do pool configurado e das
queries otimizadas, o dogpile.cache atua na camada acima, cacheando resultados estáveis para
que o banco sequer seja consultado nas requisições seguintes.

---

Se tiver um caso parecido ou uma abordagem diferente para cache de queries no ORM, a conversa
continua no Fediverse em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
