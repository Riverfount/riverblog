---
title: "asyncio na prática: quando concorrência resolve e quando atrapalha"
date: 2026-03-10
draft: false
tags: ["python", "asyncio", "concorrência", "performance", "intermediário"]
moastodo_toot_id: "116206634877241099"
cover:
  image: "images/covers/cover-asyncio-pratica.png"
  alt: "asyncio na prática: quando concorrência resolve e quando atrapalha"
  relative: false
---

Se você chegou até aqui provavelmente já passou pelo profiling e encontrou um gargalo. A tentação imediata é jogar `async/await` em cima do problema e torcer para que o tempo de execução caia. Na maioria das vezes, não cai. Às vezes, piora.

Este artigo começa mostrando exatamente esse cenário — código assíncrono que não resolve nada — e explica por quê. Depois mostra um caso onde `asyncio` faz diferença real, e só então desce para o mecanismo que explica os dois resultados.

## O exemplo que não funciona

Suponha que o profiling revelou que a função abaixo consome 80% do tempo de CPU:

```python
import time

def calcular_fibonacci(n: int) -> int:
    if n <= 1:
        return n
    return calcular_fibonacci(n - 1) + calcular_fibonacci(n - 2)

def processar_lote(numeros: list[int]) -> list[int]:
    return [calcular_fibonacci(n) for n in numeros]

if __name__ == "__main__":
    inicio = time.perf_counter()
    resultado = processar_lote([36, 37, 36, 35, 37])
    fim = time.perf_counter()
    print(f"Resultado: {resultado}")
    print(f"Tempo: {fim - inicio:.2f}s")
```

Tempo típico numa máquina moderna: **~18 segundos**.

O desenvolvedor lê sobre `asyncio` e reescreve assim:

```python
import asyncio
import time

def calcular_fibonacci(n: int) -> int:
    if n <= 1:
        return n
    return calcular_fibonacci(n - 1) + calcular_fibonacci(n - 2)

async def calcular_fibonacci_async(n: int) -> int:
    # "Versão assíncrona"
    return calcular_fibonacci(n)

async def processar_lote(numeros: list[int]) -> list[int]:
    tarefas = [calcular_fibonacci_async(n) for n in numeros]
    return await asyncio.gather(*tarefas)

if __name__ == "__main__":
    inicio = time.perf_counter()
    resultado = asyncio.run(processar_lote([36, 37, 36, 35, 37]))
    fim = time.perf_counter()
    print(f"Resultado: {resultado}")
    print(f"Tempo: {fim - inicio:.2f}s")
```

Tempo: **~18 segundos**. Idêntico. O `async/await` não mudou nada.

## O exemplo que funciona

Agora um cenário diferente: buscar dados de uma API externa para uma lista de IDs.

```python
import time
import urllib.request

def buscar_usuario(user_id: int) -> dict:
    url = f"https://jsonplaceholder.typicode.com/users/{user_id}"
    with urllib.request.urlopen(url) as response:
        import json
        return json.loads(response.read())

def buscar_lote_sincrono(ids: list[int]) -> list[dict]:
    return [buscar_usuario(uid) for uid in ids]

if __name__ == "__main__":
    inicio = time.perf_counter()
    usuarios = buscar_lote_sincrono(list(range(1, 11)))
    fim = time.perf_counter()
    print(f"Buscados: {len(usuarios)} usuários")
    print(f"Tempo síncrono: {fim - inicio:.2f}s")
```

Tempo típico: **~3,5 segundos** (10 requests sequenciais, ~350ms cada).

Versão com `asyncio`:

```python
import asyncio
import time
import aiohttp

async def buscar_usuario(session: aiohttp.ClientSession, user_id: int) -> dict:
    url = f"https://jsonplaceholder.typicode.com/users/{user_id}"
    async with session.get(url) as response:
        return await response.json()

async def buscar_lote_async(ids: list[int]) -> list[dict]:
    async with aiohttp.ClientSession() as session:
        tarefas = [buscar_usuario(session, uid) for uid in ids]
        return await asyncio.gather(*tarefas)

if __name__ == "__main__":
    inicio = time.perf_counter()
    usuarios = asyncio.run(buscar_lote_async(list(range(1, 11))))
    fim = time.perf_counter()
    print(f"Buscados: {len(usuarios)} usuários")
    print(f"Tempo assíncrono: {fim - inicio:.2f}s")
```

Tempo típico: **~0,4 segundos**. Quase 9x mais rápido.

A diferença entre os dois cenários é o coração de tudo que vem a seguir.

## O que o event loop realmente faz

O CPython tem uma limitação estrutural chamada GIL (Global Interpreter Lock) que impede que múltiplas threads executem bytecode Python simultaneamente. Para processamento CPU-bound, isso significa que threads e corrotinas não ajudam — só um processo por vez avança no cálculo.

`asyncio` não contorna o GIL. Ele opera num modelo de concorrência cooperativa com um único thread. O mecanismo central é o **event loop**: um laço que despacha corrotinas, verifica quais estão aguardando operações de I/O, e retoma as que já podem continuar.

O ponto crucial: uma corrotina só libera o controle para o event loop quando encontra um `await` em uma operação que vai bloquear aguardando recursos externos — resposta de rede, leitura de disco, timer. Enquanto isso não acontece, ela monopoliza o event loop exatamente como código síncrono monopoliza o thread.

No primeiro exemplo, `calcular_fibonacci_async` nunca encontra um `await` real. O `asyncio.gather` agenda as cinco corrotinas, mas cada uma executa de ponta a ponta sem ceder controle. O resultado é idêntico ao código síncrono sequencial, com overhead extra de agendamento.

No segundo exemplo, cada `session.get()` dispara uma conexão TCP e imediatamente suspende a corrotina aguardando a resposta. O event loop retoma as demais. Dez conexões ficam abertas em paralelo — do ponto de vista da rede — e as respostas chegam aproximadamente ao mesmo tempo.

### Diagrama de execução

**Síncrono:**
```
Thread único
│
├── request 1 ──────── aguarda 350ms ──────── resposta
├── request 2 ──────────────────────────────── aguarda 350ms ── resposta
├── ...
└── request 10 ────────────────────────────────────────────────── ...
Total: ~3500ms
```

**Assíncrono com asyncio:**
```
Event loop (thread único)
│
├── inicia request 1 ──┐
├── inicia request 2 ──┤
├── inicia request 3 ──┤  todos aguardando em paralelo
├── ...                │
└── inicia request 10 ─┘
         │
         └── respostas chegam ~ao mesmo tempo
Total: ~400ms (tempo do request mais lento)
```

## Anatomia de uma corrotina

```python
import asyncio

async def exemplo() -> str:
    print("início")
    await asyncio.sleep(1)   # <-- ponto de suspensão
    print("depois de 1 segundo")
    return "pronto"

# Corrotinas não executam quando chamadas diretamente:
coro = exemplo()
print(type(coro))  # <class 'coroutine'>
# Nada foi impresso ainda

# É necessário o event loop para executar:
resultado = asyncio.run(exemplo())
```

`async def` transforma uma função em uma **função corrotina** — uma factory que retorna um objeto corrotina quando chamada. O objeto corrotina só executa quando entregue ao event loop via `asyncio.run()`, `await`, ou `asyncio.create_task()`.

`await` tem duas funções: suspende a corrotina atual enquanto aguarda o resultado de outra corrotina (ou qualquer objeto *awaitable*), e devolve o controle ao event loop para que outras corrotinas possam progredir.

## asyncio.gather vs asyncio.create_task

Há duas formas principais de executar múltiplas corrotinas concorrentemente, e elas têm semânticas distintas.

### asyncio.gather

```python
import asyncio

async def tarefa(nome: str, segundos: float) -> str:
    print(f"{nome}: iniciando")
    await asyncio.sleep(segundos)
    print(f"{nome}: concluída")
    return f"{nome} ok"

async def main():
    # gather agenda todas e aguarda todas concluírem
    resultados = await asyncio.gather(
        tarefa("A", 1.0),
        tarefa("B", 0.5),
        tarefa("C", 1.5),
    )
    print(resultados)  # ['A ok', 'B ok', 'C ok'] — mesma ordem dos inputs

asyncio.run(main())
```

`gather` retorna os resultados na mesma ordem dos argumentos, independente de qual terminou primeiro. Por padrão, se uma corrotina lança exceção, as demais são canceladas. Para comportamento diferente, use `return_exceptions=True`.

### asyncio.create_task

```python
async def main():
    # create_task agenda imediatamente e retorna um objeto Task
    tarefa_a = asyncio.create_task(tarefa("A", 1.0))
    tarefa_b = asyncio.create_task(tarefa("B", 0.5))

    # As duas tasks já estão rodando concorrentemente desde o create_task.
    # Para aguardar ambas sem perder a concorrência, use gather sobre as tasks:
    resultado_a, resultado_b = await asyncio.gather(tarefa_a, tarefa_b)

    print(f"A terminou: {resultado_a}")
    print(f"B terminou: {resultado_b}")

asyncio.run(main())
```
> Atenção: fazer `await tarefa_a` seguido de `await tarefa_b` em sequência não cancela a concorrência entre as tasks — elas continuam rodando em paralelo no event loop — mas força o código a esperar A terminar antes de processar o resultado de B. Se B terminar primeiro, o resultado fica parado esperando. 

Para processar os resultados à medida que chegam, use asyncio.as_completed:

```python
for coro in asyncio.as_completed([tarefa_a, tarefa_b]):
    resultado = await coro
    print(f"concluída: {resultado}")
```

`create_task` é mais flexível: permite cancelar tarefas individualmente, verificar se completaram, ou aguardar com timeout. Em geral, use `gather` quando você tem um conjunto fixo de corrotinas e quer todos os resultados; use `create_task` quando precisa de controle granular sobre cada tarefa.

## O problema do bloqueio acidental

O erro mais comum em código `asyncio` de produção não é usar `async/await` onde não deveria — é misturar código bloqueante dentro de corrotinas sem perceber.

```python
import asyncio
import time

async def processar_item(item: int) -> int:
    # PROBLEMA: time.sleep bloqueia o event loop inteiro
    time.sleep(0.1)
    return item * 2

async def main():
    tarefas = [processar_item(i) for i in range(10)]
    return await asyncio.gather(*tarefas)

asyncio.run(main())
# Tempo: ~1 segundo (sequencial, não concorrente)
```

`time.sleep` é uma chamada bloqueante de sistema. Quando executada numa corrotina, trava o event loop inteiro pelo tempo do sleep — nenhuma outra corrotina avança. A versão correta usa `asyncio.sleep`:

```python
async def processar_item(item: int) -> int:
    await asyncio.sleep(0.1)  # suspende apenas esta corrotina
    return item * 2
```

O mesmo problema ocorre com qualquer operação bloqueante: leitura de arquivo com `open()`, queries com drivers síncronos como `psycopg2`, requests HTTP com `requests`. Para cada uma há uma alternativa assíncrona: `aiofiles`, `asyncpg`/`databases`, `aiohttp`.

### Quando você precisa de código bloqueante

Às vezes não há alternativa assíncrona disponível, ou o custo de migrar não se justifica. Nesses casos, use `loop.run_in_executor` para executar o código bloqueante numa thread pool sem travar o event loop:

```python
import asyncio
import time
from concurrent.futures import ThreadPoolExecutor

def operacao_bloqueante(n: int) -> int:
    time.sleep(0.1)  # simula I/O bloqueante
    return n * 2

async def main():
    loop = asyncio.get_event_loop()
    
    with ThreadPoolExecutor(max_workers=10) as executor:
        tarefas = [
            loop.run_in_executor(executor, operacao_bloqueante, i)
            for i in range(10)
        ]
        resultados = await asyncio.gather(*tarefas)
    
    print(resultados)

asyncio.run(main())
# Tempo: ~0.1s (executa em paralelo nas threads)
```

`run_in_executor` retorna um objeto *awaitable* que o event loop aguarda enquanto a função executa numa thread separada. As threads podem rodar em paralelo porque operações de I/O não precisam do GIL.

## CPU-bound: a solução correta é multiprocessing

Voltando ao exemplo do Fibonacci: se o problema é CPU-bound, a resposta não é `asyncio` nem threads — é `multiprocessing`, que cria processos separados, cada um com seu próprio GIL.

```python
import time
from concurrent.futures import ProcessPoolExecutor

def calcular_fibonacci(n: int) -> int:
    if n <= 1:
        return n
    return calcular_fibonacci(n - 1) + calcular_fibonacci(n - 2)

def processar_lote_paralelo(numeros: list[int]) -> list[int]:
    with ProcessPoolExecutor() as executor:
        return list(executor.map(calcular_fibonacci, numeros))

if __name__ == "__main__":
    inicio = time.perf_counter()
    resultado = processar_lote_paralelo([36, 37, 36, 35, 37])
    fim = time.perf_counter()
    print(f"Resultado: {resultado}")
    print(f"Tempo: {fim - inicio:.2f}s")
```

Numa máquina com 4+ núcleos, o tempo cai de ~18s para ~5s. Os cinco cálculos rodam em paralelo real em processos separados.

Se precisar combinar CPU-bound com código assíncrono, `asyncio` tem integração direta com `ProcessPoolExecutor` via `run_in_executor`:

```python
import asyncio
from concurrent.futures import ProcessPoolExecutor

def calcular_fibonacci(n: int) -> int:
    if n <= 1:
        return n
    return calcular_fibonacci(n - 1) + calcular_fibonacci(n - 2)

async def main():
    loop = asyncio.get_event_loop()
    numeros = [36, 37, 36, 35, 37]
    
    with ProcessPoolExecutor() as executor:
        tarefas = [
            loop.run_in_executor(executor, calcular_fibonacci, n)
            for n in numeros
        ]
        resultados = await asyncio.gather(*tarefas)
    
    print(resultados)

if __name__ == "__main__":
    asyncio.run(main())
```

## Timeout e cancelamento

Em produção, toda operação de I/O precisa de timeout. Sem isso, uma conexão que nunca responde trava a corrotina indefinidamente.

```python
import asyncio
import aiohttp

async def buscar_com_timeout(
    session: aiohttp.ClientSession,
    url: str,
    timeout_segundos: float = 5.0,
) -> dict | None:
    try:
        async with asyncio.timeout(timeout_segundos):
            async with session.get(url) as response:
                return await response.json()
    except TimeoutError:
        print(f"Timeout ao buscar {url}")
        return None

async def main():
    urls = [
        "https://jsonplaceholder.typicode.com/posts/1",
        "https://jsonplaceholder.typicode.com/posts/2",
    ]
    
    async with aiohttp.ClientSession() as session:
        tarefas = [buscar_com_timeout(session, url) for url in urls]
        resultados = await asyncio.gather(*tarefas, return_exceptions=True)
    
    for r in resultados:
        if r is not None:
            print(r.get("title", "sem título"))

asyncio.run(main())
```

`asyncio.timeout` foi adicionado no Python 3.11 e é a forma recomendada. Em versões anteriores, use `asyncio.wait_for(coro, timeout=5.0)`.

## Padrão produtor-consumidor com filas

Para processar um volume arbitrário de itens com controle de concorrência, filas assíncronas são a solução idiomática:

```python
import asyncio
import aiohttp
from collections.abc import AsyncIterator

async def produtor(fila: asyncio.Queue, ids: list[int]) -> None:
    for id_ in ids:
        await fila.put(id_)
    # Sinaliza término para cada worker
    for _ in range(NUM_WORKERS):
        await fila.put(None)

async def worker(
    nome: str,
    fila: asyncio.Queue,
    session: aiohttp.ClientSession,
    resultados: list,
) -> None:
    while True:
        id_ = await fila.get()
        if id_ is None:
            break
        
        url = f"https://jsonplaceholder.typicode.com/users/{id_}"
        async with session.get(url) as response:
            dados = await response.json()
            resultados.append(dados)
            print(f"{nome}: processado user {id_}")
        
        fila.task_done()

NUM_WORKERS = 3

async def main():
    ids = list(range(1, 11))
    fila: asyncio.Queue = asyncio.Queue(maxsize=5)
    resultados: list = []
    
    async with aiohttp.ClientSession() as session:
        workers = [
            asyncio.create_task(worker(f"worker-{i}", fila, session, resultados))
            for i in range(NUM_WORKERS)
        ]
        
        await produtor(fila, ids)
        await asyncio.gather(*workers)
    
    print(f"Total processado: {len(resultados)}")

asyncio.run(main())
```

`maxsize=5` garante que o produtor não enfileira infinitamente se os workers não estão acompanhando. `task_done()` permite usar `fila.join()` como barreira de sincronização alternativa.

## Resumo: qual ferramenta usar

| Problema | Ferramenta |
|---|---|
| Múltiplas requisições HTTP em paralelo | `asyncio` + `aiohttp` |
| Queries em banco de dados concorrentes | `asyncio` + `asyncpg` ou `databases` |
| Cálculos pesados em CPU | `multiprocessing` / `ProcessPoolExecutor` |
| Biblioteca bloqueante sem alternativa async | `loop.run_in_executor` com `ThreadPoolExecutor` |
| Processamento de arquivos grandes | Generators (próximo artigo) |

A pergunta que precisa ser feita antes de qualquer refatoração: **o gargalo é I/O ou CPU?** Se for I/O — requisições de rede, queries, leitura de disco — `asyncio` é a ferramenta certa. Se for CPU — parsing intensivo, criptografia, computação numérica — `asyncio` não ajuda e `multiprocessing` é o caminho.

O profiling com `cProfile` e `memory_profiler` já dá essa resposta. Se as funções no topo do relatório são chamadas de sistema de rede ou banco de dados, o gargalo é I/O. Se são funções Python puras com alta contagem de chamadas recursivas ou loops numéricos, é CPU.

Esse assunto tem muitas arestas — `asyncio` com frameworks web como FastAPI e Starlette, integração com ORMs assíncronos, debugging de deadlocks em event loops. Se quiser continuar a conversa, me encontra no Fediverse em @riverfount@bolha.us.