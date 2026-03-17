---
title: "Por que seu script Python consome mais memória do que deveria"
date: 2026-03-17
draft: false
tags: ["python", "generators", "itertools", "memória", "performance"]
cover:
  image: "images/covers/cover-generators-itertools.png"
  alt: "Por que seu script Python consome mais memória do que deveria"
  relative: false
---

Se você já usou o `memory_profiler` para inspecionar um script que processa arquivos grandes, provavelmente se deparou com um gráfico de consumo de RAM que sobe em escada — e não desce. O arquivo tem 500 MB, o script consome 600, 700, às vezes mais de 1 GB, e o culpado raramente é o que parece.

Este artigo começa exatamente aí: num script real com consumo excessivo de memória, explica por que ele se comporta assim, e mostra como generators e `itertools` resolvem o problema sem mudar a lógica de negócio.

## O problema em código

Imagine um script que processa um arquivo de log para extrair linhas de erro e contar ocorrências por tipo:

```python
# processar_logs.py
def carregar_linhas(caminho):
    with open(caminho) as f:
        return f.readlines()

def filtrar_erros(linhas):
    return [linha for linha in linhas if "ERROR" in linha]

def extrair_tipos(linhas_erro):
    return [linha.split("|")[2].strip() for linha in linhas_erro]

def contar_ocorrencias(tipos):
    contagem = {}
    for tipo in tipos:
        contagem[tipo] = contagem.get(tipo, 0) + 1
    return contagem

if __name__ == "__main__":
    linhas = carregar_linhas("app.log")
    erros = filtrar_erros(linhas)
    tipos = extrair_tipos(erros)
    resultado = contar_ocorrencias(tipos)
    print(resultado)
```

O código é limpo, legível e funciona perfeitamente para arquivos pequenos. Agora, com um arquivo de 2 GB, veja o que o `memory_profiler` revela:

```
Line #    Mem usage    Increment   Line Contents
================================================
     4   45.2 MiB     45.2 MiB    def carregar_linhas(caminho):
     5   45.2 MiB      0.0 MiB        with open(caminho) as f:
     6 2187.4 MiB   2142.2 MiB            return f.readlines()

    10   45.3 MiB      0.0 MiB    def filtrar_erros(linhas):
    11  2934.1 MiB    746.7 MiB        return [linha for linha in linhas if "ERROR" in linha]

    13   45.1 MiB      0.0 MiB    def extrair_tipos(linhas_erro):
    14  3187.2 MiB    253.1 MiB        return [linha.split("|")[2].strip() for linha in linhas_erro]
```

Três listas em memória ao mesmo tempo: o arquivo inteiro, as linhas filtradas, e os tipos extraídos. O pico ultrapassa 3 GB para processar um arquivo de 2 GB. O problema não é o algoritmo — é a estratégia de materializar cada etapa como uma lista completa antes de passar para a próxima.

## O que está acontecendo

`readlines()` lê o arquivo inteiro e retorna uma lista com todas as linhas. A list comprehension em `filtrar_erros` cria outra lista completa. `extrair_tipos` cria uma terceira. Em nenhum momento o Python pode liberar a memória de uma etapa enquanto a próxima está sendo construída.

O problema tem um nome: **eager evaluation**. Cada função processa tudo de uma vez e entrega o resultado completo para a próxima. É o padrão natural de quem pensa em funções que transformam coleções.

A alternativa é **lazy evaluation**: processar um elemento por vez, só quando necessário. É exatamente o que generators fazem.

## Generators: processamento sob demanda

Um generator é uma função que usa `yield` em vez de `return`. Em vez de calcular todos os valores de uma vez e guardar em memória, ela calcula um valor, entrega, pausa, e só retorna quando o próximo valor for solicitado.

```python
def gerar_numeros():
    for i in range(1_000_000):
        yield i
```

Isso não cria uma lista de um milhão de números. Cria um objeto que sabe como gerar o próximo número quando necessário. A diferença de memória é radical:

```python
# Lista: aloca ~8 MB imediatamente
numeros_lista = list(range(1_000_000))

# Generator: aloca bytes, independente do tamanho
numeros_gen = (i for i in range(1_000_000))
```

A sintaxe `(expressão for item in iterável)` é uma **generator expression** — o equivalente lazy da list comprehension `[...]`.

### Reescrevendo o script com generators

```python
def carregar_linhas(caminho):
    with open(caminho) as f:
        yield from f  # itera linha a linha, sem readlines()

def filtrar_erros(linhas):
    return (linha for linha in linhas if "ERROR" in linha)

def extrair_tipos(linhas_erro):
    return (linha.split("|")[2].strip() for linha in linhas_erro)

def contar_ocorrencias(tipos):
    contagem = {}
    for tipo in tipos:
        contagem[tipo] = contagem.get(tipo, 0) + 1
    return contagem

if __name__ == "__main__":
    linhas = carregar_linhas("app.log")
    erros = filtrar_erros(linhas)
    tipos = extrair_tipos(erros)
    resultado = contar_ocorrencias(tipos)
    print(resultado)
```

O resultado no `memory_profiler`:

```
Line #    Mem usage    Increment   Line Contents
================================================
     4   45.2 MiB     45.2 MiB    def carregar_linhas(caminho):
     5   45.2 MiB      0.0 MiB        with open(caminho) as f:
     6   45.3 MiB      0.1 MiB            yield from f

    10   45.3 MiB      0.0 MiB    def filtrar_erros(linhas):
    11   45.3 MiB      0.0 MiB        return (linha for linha in linhas if "ERROR" in linha)

    13   45.3 MiB      0.0 MiB    def extrair_tipos(linhas_erro):
    14   45.3 MiB      0.0 MiB        return (linha.split("|")[2].strip() for linha in linhas_erro)
```

O pico vai de 3 GB para ~50 MB. O arquivo tem 2 GB, mas o script processa uma linha por vez — só uma linha existe em memória a qualquer momento.

A lógica do código é idêntica. A única mudança foi trocar `return lista` por `yield from` e `[...]` por `(...)`.

## `yield from`: delegando para outro iterável

O `yield from` merece atenção especial porque simplifica um padrão muito comum. Em vez de:

```python
def carregar_linhas(caminho):
    with open(caminho) as f:
        for linha in f:
            yield linha
```

Você escreve:

```python
def carregar_linhas(caminho):
    with open(caminho) as f:
        yield from f
```

`yield from` delega a iteração para qualquer iterável — outro generator, uma lista, um arquivo aberto. É mais conciso e também mais eficiente: elimina o overhead de um `for` explícito na função geradora.

Também é útil para compor generators:

```python
def todas_as_linhas(*caminhos):
    for caminho in caminhos:
        with open(caminho) as f:
            yield from f
```

Isso itera sobre múltiplos arquivos em sequência sem carregar nenhum deles por completo.

## `itertools`: o que você vai precisar mais cedo do que imagina

Generators resolvem bem transformações lineares: filtrar, mapear, extrair. Mas operações mais sofisticadas — agrupar, combinar, limitar, encadear — têm padrões que aparecem repetidamente. O módulo `itertools` da biblioteca padrão implementa esses padrões de forma eficiente e lazy.

### `islice`: pegar os N primeiros elementos

```python
from itertools import islice

linhas = carregar_linhas("app.log")  # generator
primeiras_100 = list(islice(linhas, 100))
```

Sem `islice`, você precisaria de um contador manual ou converter para lista primeiro. `islice` funciona com qualquer iterável e não materializa nada além dos elementos solicitados.

Também aceita `start`, `stop` e `step`:

```python
# Linhas de 1000 a 2000, pulando de 2 em 2
trecho = list(islice(linhas, 1000, 2000, 2))
```

### `chain`: encadear iteráveis

```python
from itertools import chain

logs_hoje = carregar_linhas("app-2026-03-17.log")
logs_ontem = carregar_linhas("app-2026-03-16.log")

todos_os_logs = chain(logs_hoje, logs_ontem)
```

`chain` recebe qualquer número de iteráveis e os percorre em sequência, sem criar uma lista intermediária. Equivale ao `yield from` no exemplo anterior, mas sem precisar escrever a função.

Para casos onde os iteráveis estão numa lista:

```python
arquivos = [carregar_linhas(f) for f in glob.glob("*.log")]
todos = chain.from_iterable(arquivos)
```

### `groupby`: agrupar por chave

```python
from itertools import groupby

# ATENÇÃO: groupby exige que os dados estejam ordenados pela chave
erros_ordenados = sorted(extrair_tipos(filtrar_erros(carregar_linhas("app.log"))))

for tipo, ocorrencias in groupby(erros_ordenados):
    print(f"{tipo}: {sum(1 for _ in ocorrencias)}")
```

**Armadilha importante:** `groupby` agrupa apenas elementos consecutivos com a mesma chave. Se os dados não estiverem ordenados, elementos iguais em posições diferentes serão tratados como grupos distintos. Para datasets grandes em que ordenar antecipadamente é caro, um `defaultdict` manual é mais adequado.

### `takewhile` e `dropwhile`: processar até uma condição

```python
from itertools import takewhile, dropwhile

# Processar apenas enquanto a linha não contiver "FATAL"
linhas_ate_fatal = takewhile(
    lambda linha: "FATAL" not in linha,
    carregar_linhas("app.log")
)

# Ignorar o cabeçalho até encontrar "START"
sem_cabecalho = dropwhile(
    lambda linha: not linha.startswith("START"),
    carregar_linhas("app.log")
)
```

Ambos retornam generators. `takewhile` para no primeiro elemento que não satisfaz a condição. `dropwhile` descarta enquanto a condição for verdadeira e depois entrega tudo.

### `batched`: processar em lotes (Python 3.12+)

```python
from itertools import batched

linhas = carregar_linhas("app.log")

for lote in batched(linhas, 1000):
    processar_lote(lote)  # recebe uma tupla de até 1000 linhas
```

Para versões anteriores ao 3.12, o padrão equivalente:

```python
from itertools import islice

def em_lotes(iteravel, tamanho):
    iteravel = iter(iteravel)
    while lote := tuple(islice(iteravel, tamanho)):
        yield lote
```

Processar em lotes é útil quando a operação unitária tem overhead alto — inserções em banco, chamadas de API, compressão — e você quer amortizar esse custo sem carregar tudo em memória.

## Quando não usar generators

Generators têm limitações reais que precisam ser entendidas antes de aplicar em tudo.

**Você só pode iterar uma vez.** Um generator é consumido. Depois de percorrido, está vazio:

```python
tipos = extrair_tipos(filtrar_erros(carregar_linhas("app.log")))

total = sum(1 for _ in tipos)   # consome o generator
lista = list(tipos)              # vazio — retorna []
```

Se você precisa percorrer o mesmo conjunto de dados mais de uma vez, ou manter uma referência para acesso aleatório, uma lista é a escolha certa.

**Debugging é mais difícil.** Generators são lazy — erros aparecem quando o dado é consumido, não quando o generator é criado. Se uma exceção ocorrer no meio do processamento, o stack trace pode ser menos direto do que em código que opera sobre listas.

**Tamanho desconhecido.** `len()` não funciona em generators. Se você precisar saber quantos elementos existem antes de processar, vai precisar materializar ou contar separadamente.

A regra prática: use generators quando processar elemento a elemento é suficiente e o tamanho dos dados torna uma lista impraticável.

## Juntando tudo: pipeline de processamento real

O padrão de encadear generators cria um pipeline onde cada etapa transforma e passa adiante sem acumular:

```python
import csv
from itertools import chain, batched
from pathlib import Path

def ler_csvs(diretorio):
    """Itera sobre todas as linhas de todos os CSVs num diretório."""
    arquivos = Path(diretorio).glob("*.csv")
    readers = (csv.DictReader(open(f)) for f in arquivos)
    yield from chain.from_iterable(readers)

def filtrar_ativos(registros):
    return (r for r in registros if r["status"] == "ativo")

def normalizar(registros):
    return (
        {**r, "email": r["email"].lower().strip()}
        for r in registros
    )

def salvar_em_lotes(registros, conexao, tamanho_lote=500):
    for lote in batched(registros, tamanho_lote):
        conexao.executemany(
            "INSERT INTO usuarios (email, status) VALUES (:email, :status)",
            lote
        )
        conexao.commit()

# O pipeline inteiro: nenhuma lista intermediária
pipeline = normalizar(filtrar_ativos(ler_csvs("/dados/importacao")))
salvar_em_lotes(pipeline, conexao)
```

Esse código processa um diretório inteiro de CSVs com consumo de memória proporcional ao tamanho do lote — 500 registros — independente de quantos arquivos existam ou quantas linhas no total.

## Conclusão

O consumo excessivo de memória em scripts Python quase sempre tem a mesma causa: materializar dados intermediários como listas quando não é necessário. Generators resolvem isso com uma mudança pequena na forma de escrever as funções — trocar `return lista` por `yield from` e `[...]` por `(...)`.

O `itertools` completa o quadro com implementações eficientes dos padrões mais comuns: encadear iteráveis com `chain`, fatiar com `islice`, agrupar com `groupby`, processar em lotes com `batched`. Tudo lazy, tudo componível.

A próxima vez que o `memory_profiler` mostrar aquela escada subindo, o diagnóstico provavelmente é: alguma função está devolvendo uma lista que poderia devolver um generator.

Se você quiser discutir casos de uso específicos ou tiver um pipeline que ainda está consumindo mais memória do que deveria, encontro-me no Fediverse em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
