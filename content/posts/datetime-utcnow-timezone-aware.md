---
title: 'Seu datetime.utcnow() pode estar mentindo sobre o fuso horário'
date: 2026-09-16
draft: false
tags: ['python', 'datetime', 'timezone', 'sqlalchemy', 'boas-práticas']
cover:
  image: 'images/covers/cover-datetime-utcnow-timezone-aware.png'
  alt: 'Seu datetime.utcnow() pode estar mentindo sobre o fuso horário'
  relative: false
---

Cenário fictício, mas plausível em qualquer time que já mexeu em coluna de timestamp num banco em produção: pedidos criados às 21h aparecem no painel administrativo com horário de 18h do mesmo dia. Não é só uma questão de exibição no frontend, o valor gravado no banco já chega errado, e a diferença é sempre a mesma, três horas, exatamente o offset entre UTC e o horário de Brasília.

A investigação leva até uma migração recente que trocou o tipo da coluna `criado_em` de `TIMESTAMP` para `TIMESTAMP WITH TIME ZONE`, parte de um trabalho maior para dar suporte a clientes em fusos diferentes. Ninguém precisou mexer no modelo em si para isso funcionar.

<!--more-->

```python
from datetime import datetime
from sqlalchemy import DateTime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Pedido(Base):
    __tablename__ = "pedidos"

    id: Mapped[int] = mapped_column(primary_key=True)
    criado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )
```

O default continua sendo `datetime.utcnow`, do jeito que sempre foi. O problema é que `datetime.utcnow()` devolve um objeto naive, sem `tzinfo`, que só é UTC porque o nome da função promete isso, não porque o objeto carrega essa informação. Quando esse valor naive chega ao driver do Postgres para ser gravado numa coluna `timestamptz`, o banco não tem como saber que aquele horário já está em UTC. Ele segue a regra padrão de entrada sem fuso: assume que o valor está na timezone configurada na sessão, que no servidor de produção era `America/Sao_Paulo`. Meia-noite UTC vira, para o Postgres, meia-noite em Brasília, e o valor gravado fica adiantado em três horas.

Não há exceção, não há traceback. O bug corrompe dado silenciosamente por semanas, até alguém notar a inconsistência nos relatórios.

## Por que utcnow() sempre foi um problema disfarçado

Todo `datetime` em Python é naive ou aware. Aware significa que ele carrega um `tzinfo` e sabe se posicionar de forma absoluta no tempo. Naive significa que ele é só um conjunto de números (ano, mês, dia, hora) sem contexto nenhum sobre a qual fuso horário aquilo se refere.

```python
>>> from datetime import datetime
>>> agora_utc = datetime.utcnow()
>>> agora_utc.tzinfo is None
True
```

`utcnow()` sempre devolveu um datetime naive. A convenção era informal: "esse valor representa UTC, confie em mim". Funciona até o momento em que esse datetime encontra outro código que não conhece essa convenção, seja um driver de banco que aplica a timezone da sessão, seja outra parte da aplicação que assume, também informalmente, que datetime naive significa horário local.

O Python 3.12 formalizou o que boa parte da comunidade já sabia: `utcnow()` e sua irmã `utcfromtimestamp()` estão depreciadas.

```
>>> datetime.utcnow()
<stdin>:1: DeprecationWarning: datetime.datetime.utcnow() is deprecated and scheduled for removal in a future version. Use timezone-aware objects to represent datetimes in UTC: datetime.datetime.now(datetime.UTC).
datetime.datetime(2026, 9, 16, 17, 4, 12, 331902)
```

## A forma aware

A substituição direta é `datetime.now()` passando o fuso horário explicitamente. Desde o Python 3.11 existe o alias `UTC` direto no módulo `datetime`, o que deixa o código mais enxuto do que escrever `timezone.utc` toda vez:

```python
from datetime import UTC, datetime

agora = datetime.now(UTC)
agora.tzinfo  # datetime.timezone.utc
```

Para bases que ainda precisam suportar Python 3.10 ou anterior, `UTC` não existe, e a alternativa é `datetime.timezone.utc`, disponível desde o Python 3.2 e equivalente em resultado:

```python
from datetime import datetime, timezone

agora = datetime.now(timezone.utc)
```

O mesmo raciocínio vale para `utcfromtimestamp()`, também depreciado, substituído por `fromtimestamp()` com o fuso explícito:

```python
# antes
momento = datetime.utcfromtimestamp(1700000000)

# depois
momento = datetime.fromtimestamp(1700000000, tz=UTC)
```

Voltando ao modelo do `Pedido`, o conserto direto no default resolve a origem do bug:

```python
from datetime import UTC, datetime
from sqlalchemy import DateTime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Pedido(Base):
    __tablename__ = "pedidos"

    id: Mapped[int] = mapped_column(primary_key=True)
    criado_em: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(UTC)
    )
```

Repare que o default virou uma lambda. `datetime.now(UTC)` já é uma chamada, não uma referência de função, e o SQLAlchemy precisa de um callable para executar a cada insert, não de um valor calculado uma única vez na definição da classe.

## O que a migração custa além de trocar o nome da função

Trocar `utcnow()` por `now(UTC)` é a parte mecânica. O que exige atenção de verdade são os pontos do código em que um datetime aware passa a se misturar com datetimes naive que ainda não foram migrados.

Comparar ou subtrair um datetime aware e um naive não devolve um resultado errado, o que seria pior. Isso lança `TypeError`:

```python
>>> from datetime import UTC, datetime
>>> agora_aware = datetime.now(UTC)
>>> agora_naive = datetime.utcnow()
>>> agora_aware - agora_naive
Traceback (most recent call last):
  ...
TypeError: can't subtract offset-naive and offset-aware datetimes
```

Isso pelo menos torna o problema visível em vez de silencioso, mas significa que um fluxo inteiro (validação de expiração de token, cálculo de intervalo entre execuções de um job, comparação de deadlines) precisa migrar de uma vez, não aos poucos.

A serialização também muda de formato. `datetime.now(UTC).isoformat()` inclui o offset no final da string (`2026-09-16T17:04:12.331902+00:00`), enquanto a versão naive não incluía nada. Se algum teste ou algum cliente da API faz comparação exata contra o valor serializado, a migração quebra esse contrato até alguém notar. Vale grepar por `isoformat` e por asserts de data em formato de string antes de trocar tudo de uma vez.

Colunas de banco que ainda são `TIMESTAMP WITHOUT TIME ZONE` não aceitam um datetime aware sem reclamar, dependendo do driver o `tzinfo` é descartado silenciosamente ou o insert falha. O conserto correto ali não é forçar o datetime de volta para naive com `.replace(tzinfo=None)`, isso só reintroduz a ambiguidade que essa mudança toda existe para eliminar. O conserto é migrar a coluna para `timestamptz` (`DateTime(timezone=True)` no SQLAlchemy), do jeito que já tinha sido feito com `criado_em`.

Vale lembrar do artigo sobre os [erros mais comuns de JWT](https://www.riverfount.dev.br/posts/jwt_tres_erros/): comparar `exp` contra `datetime.utcnow()` sem cuidado é uma variação exata desse mesmo problema, e costuma falhar de um jeito ainda mais silencioso, porque um token expirando alguns segundos antes ou depois do esperado raramente vira um traceback. Vira só um usuário reclamando de sessão caindo sem motivo aparente.

Para achar o que falta migrar num projeto existente, uma busca no editor por `utcnow()` e `utcfromtimestamp()` cobrindo o projeto inteiro (Ctrl+Shift+F tanto no VS Code quanto no PyCharm) já resolve a maior parte. Para pegar o que está escondido em dependências de terceiros que ainda não migraram (bibliotecas mais antigas emitem o mesmo warning), rodar a suíte de testes uma vez com `uv run pytest -W error::DeprecationWarning` transforma todo warning em falha, e a pilha de chamadas no erro aponta exatamente a origem.

---

Isso e mais fica pro próximo. Quem quiser trocar ideia sobre outros pontos do código em que datetime naive vira dor de cabeça (agendadores, cache com TTL, logs correlacionando eventos entre serviços em fusos diferentes) pode aparecer lá: **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
