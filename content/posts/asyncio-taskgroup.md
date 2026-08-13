---
title: 'asyncio.TaskGroup: quando gather não é suficiente'
date: 2026-08-12
draft: false
tags: ['python', 'asyncio', 'taskgroup', 'concorrência', 'produção']
cover:
  image: 'images/covers/cover-asyncio-taskgroup.png'
  alt: 'asyncio.TaskGroup: quando gather não é suficiente'
  relative: false
---

Um endpoint de checkout dispara três operações concorrentes com `asyncio.gather`: cobra o cartão, reserva o estoque, envia a notificação de confirmação do pedido. O serviço de pagamento cai no meio da chamada e lança uma exceção. `gather` propaga esse erro imediatamente para quem está aguardando. O handler captura a exceção, devolve um 500 para o cliente, registra a falha no log. Para quem está de plantão, o sistema reagiu do jeito certo.

Só que a corrotina que reservava o estoque continuava rodando quando o erro subiu. Ela não foi cancelada, não recebeu nenhum sinal de que a operação como um todo tinha falhado. Alguns segundos depois, sozinha, ela termina e grava no banco uma reserva de cinco unidades para um pedido que nunca foi cobrado. Nenhuma linha de log aponta esse efeito colateral, porque tecnicamente não houve erro na reserva de estoque. Ela funcionou. Só funcionou tarde demais para importar, num event loop que seguia vivo muito depois da resposta HTTP já ter sido enviada.

## O que gather realmente faz quando uma corrotina falha

A suposição comum é que uma exceção em `gather` cancela as demais corrotinas do grupo. Não é isso que acontece. Com `return_exceptions=False` (o padrão), a primeira exceção lançada é propagada imediatamente para quem aguarda o `gather`. As outras corrotinas da lista continuam agendadas e seguem executando normalmente, sem qualquer aviso de que o conjunto falhou.

O exemplo abaixo reproduz o comportamento de forma isolada:

```python
import asyncio


async def falha_rapida() -> None:
    await asyncio.sleep(0.3)
    raise RuntimeError("gateway de pagamento indisponível")


async def trabalho_lento(nome: str) -> None:
    await asyncio.sleep(1.0)
    print(f"{nome}: terminou, efeito colateral aplicado")


async def main() -> None:
    try:
        await asyncio.gather(
            falha_rapida(),
            trabalho_lento("reserva de estoque"),
        )
    except RuntimeError as erro:
        print(f"gather propagou o erro: {erro}")

    # segura o processo vivo só para provar que a task não some sozinha
    await asyncio.sleep(1.0)


asyncio.run(main())
```

Saída:

```
gather propagou o erro: gateway de pagamento indisponível
reserva de estoque: terminou, efeito colateral aplicado
```

O erro chega em ~0,3s. `trabalho_lento` termina depois, em ~1s, sem que nada no código tenha pedido isso. Num script curto que roda via `asyncio.run`, esse comportamento passa despercebido porque o processo inteiro morre logo em seguida. Num servidor de aplicação, com o event loop rodando havia horas, a task "esquecida" tem todo o tempo do mundo para terminar e aplicar seu efeito colateral, muito depois de qualquer coisa relacionada à requisição original ainda existir.

## TaskGroup cancela e espera de verdade

`asyncio.TaskGroup`, disponível a partir do Python 3.11, resolve exatamente esse problema. É um gerenciador de contexto assíncrono: as tasks criadas com `tg.create_task()` dentro do bloco `async with` são rastreadas automaticamente, e no primeiro erro que não seja `CancelledError`, todas as demais tasks do grupo são canceladas e aguardadas antes que qualquer exceção suba.

```python
import asyncio


async def falha_rapida() -> None:
    await asyncio.sleep(0.3)
    raise RuntimeError("gateway de pagamento indisponível")


async def trabalho_lento(nome: str) -> None:
    try:
        await asyncio.sleep(1.0)
        print(f"{nome}: terminou, efeito colateral aplicado")
    except asyncio.CancelledError:
        print(f"{nome}: cancelado antes de aplicar o efeito colateral")
        raise


async def main() -> None:
    try:
        async with asyncio.TaskGroup() as tg:
            tg.create_task(falha_rapida())
            tg.create_task(trabalho_lento("reserva de estoque"))
    except* RuntimeError as grupo_erros:
        for erro in grupo_erros.exceptions:
            print(f"TaskGroup propagou: {erro}")


asyncio.run(main())
```

Saída:

```
reserva de estoque: cancelado antes de aplicar o efeito colateral
TaskGroup propagou: gateway de pagamento indisponível
```

A reserva de estoque recebe `CancelledError` assim que o pagamento falha, tem a chance de reverter qualquer coisa num bloco `try/finally` (ou, como no exemplo, num `except asyncio.CancelledError` que apenas relança) e nunca chega a aplicar o efeito colateral. O `async with` só libera o controle depois que todas as tasks do grupo, inclusive as canceladas, terminaram de fato.

## ExceptionGroup e a sintaxe except\*

Repare no `except*` no lugar do `except` comum. `TaskGroup` não garante que só uma task vai falhar: se duas ou três lançarem exceções antes que o cancelamento surta efeito, todas elas são agrupadas num `ExceptionGroup` (ou `BaseExceptionGroup`, para exceções que não herdam de `Exception`), em vez de descartar todas menos a primeira, como `gather` faz por padrão.

`except*`, introduzido pela PEP 654 junto com o próprio `TaskGroup` no Python 3.11, filtra o grupo por tipo de exceção. É possível ter múltiplos blocos para tratar cada categoria separadamente:

```python
async def main() -> None:
    try:
        async with asyncio.TaskGroup() as tg:
            tg.create_task(chamar_gateway_pagamento())
            tg.create_task(consultar_estoque())
            tg.create_task(validar_cupom())
    except* TimeoutError as timeouts:
        for erro in timeouts.exceptions:
            registrar_timeout(erro)
    except* ValueError as validacoes:
        for erro in validacoes.exceptions:
            registrar_erro_validacao(erro)
```

Cada cláusula `except*` captura apenas as exceções do grupo que correspondem ao tipo indicado; o que sobra continua se propagando. É uma mudança de mentalidade em relação ao `try/except` tradicional, que assume uma única exceção por vez, mas é o preço para ter cancelamento cooperativo com visibilidade completa sobre tudo que deu errado, não só sobre o primeiro erro.

## Coletando resultados sem o retorno agregado do gather

`gather` devolve a lista de resultados na ordem dos argumentos assim que tudo termina. `TaskGroup` não devolve nada no `__aexit__`: é preciso guardar a referência de cada task criada com `tg.create_task()` e chamar `.result()` depois que o bloco `async with` for concluído.

```python
async def buscar_pedidos_do_dia(datas: list[str]) -> list[dict]:
    async with asyncio.TaskGroup() as tg:
        tasks = [tg.create_task(buscar_pedido(data)) for data in datas]

    return [task.result() for task in tasks]
```

Se qualquer `buscar_pedido` falhar, a exceção sobe antes de chegar na linha do `return`, então esse `.result()` só executa quando todas as tasks terminaram com sucesso. É mais verboso que `await asyncio.gather(*coros)`, mas o custo é pequeno perto da garantia de que nenhuma task fica correndo solta.

## O footgun que TaskGroup elimina de graça

Existe um problema paralelo, menos óbvio, com `asyncio.create_task` usado fora de um `TaskGroup`: o event loop guarda apenas uma referência fraca para cada task. Se nada mais no código mantém essa referência viva, o coletor de lixo pode remover a task no meio da execução, e o erro que aparece é só um aviso genérico de "Task was destroyed but it is pending" no log, sem nenhuma pista de qual task era ou por que sumiu.

```python
# perigoso: nada guarda a referência da task
for pedido_id in pedidos_pendentes:
    asyncio.create_task(processar_pedido(pedido_id))
```

`TaskGroup` mantém uma referência forte para cada task criada dentro dele até que ela termine, então esse problema simplesmente não acontece com tasks criadas via `tg.create_task()`. É um benefício colateral do design, não o motivo principal para adotar `TaskGroup`, mas resolve uma classe inteira de bugs difíceis de reproduzir.

## Quando ainda faz sentido usar gather

`TaskGroup` não substitui `gather` em todo cenário. O cancelamento automático é exatamente o comportamento errado quando o objetivo é "melhor esforço": buscar dados de cinco fontes externas e seguir em frente com o que responder, sem que a falha de uma derrube as outras quatro. Para isso, `gather(*coros, return_exceptions=True)` continua sendo a ferramenta certa, porque devolve exceções como valores na lista de resultados em vez de cancelar o grupo inteiro. `TaskGroup` não tem um parâmetro equivalente: uma falha cancela o grupo, sempre.

| Cenário                                                               | Ferramenta                            |
| --------------------------------------------------------------------- | ------------------------------------- |
| Falha de uma operação invalida as demais (checkout, transação)        | `TaskGroup`                           |
| Múltiplas falhas precisam ser tratadas por tipo, não só a primeira    | `TaskGroup` com `except*`             |
| Melhor esforço: seguir com o que respondeu, mesmo com falhas parciais | `gather(..., return_exceptions=True)` |
| Python anterior à 3.11                                                | `gather` (única opção disponível)     |

A pergunta que separa os dois casos: se uma corrotina falhar, o resultado parcial das outras ainda serve para alguma coisa? Se a resposta for não, `TaskGroup` evita exatamente o tipo de efeito colateral tardio que abriu este artigo. Se for sim, `gather` com `return_exceptions=True` continua sendo mais direto.

Esse assunto ainda tem cantos que valem outro artigo: cancelamento aninhado quando um `TaskGroup` está dentro de outro, e a interação de `TaskGroup` com `asyncio.timeout` em operações que precisam de prazo além de tratamento de erro. Se quiser continuar essa conversa, me encontra no Fediverse em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
