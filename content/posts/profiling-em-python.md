+++
date = '2026-03-02'
draft = false
title = 'Profiling em Python: Encontrando Gargalos com cProfile e memory_profiler'
tags = ["python", "performance", "profiling", "cProfile", "memory-profiler", "otimização"]
+++
Existe um padrão que se repete em quase todo projeto Python que cresce. O código funciona, os testes passam, a feature está pronta — aí alguém percebe que uma rota específica demora três segundos quando deveria demorar duzentos milissegundos. Ou que um processo que roda em batch está consumindo 4 GB de RAM sem nenhuma razão óbvia.

O instinto natural é abrir o código e começar a suspeitar. Aquele loop ali, essa chamada de banco, aquela list comprehension aninhada. O problema é que intuição é um método caro: você otimiza o que acha que é lento, gasta horas em algo que mal contribui para o tempo total, e o gargalo real continua intacto.

Profiling é o processo de medir o comportamento real do programa em execução — quais funções foram chamadas, quantas vezes, quanto tempo cada uma consumiu, e quanto de memória foi alocado. Em vez de suspeitos, você tem dados. E dados mudam completamente a conversa.

Este artigo cobre a abordagem que funciona na prática: começar com **cProfile** para entender onde o tempo está sendo gasto, usar **pstats** para filtrar e interpretar os resultados, e complementar com **memory_profiler** quando o problema é de memória.

---

## A Metodologia Antes das Ferramentas

Antes de instalar qualquer biblioteca, é importante entender que profiling é uma metodologia, não apenas um comando. O fluxo correto tem quatro etapas:

**1. Reproduza o problema de forma isolada.** Profiling em código que faz dez coisas ao mesmo tempo gera ruído. Isole a operação lenta em um script ou função específica.

**2. Meça primeiro, otimize depois.** Nunca refatore antes de ter os números. Você precisa de uma baseline para saber se a mudança que fez realmente ajudou.

**3. Foque no que importa.** O Princípio de Pareto se aplica aqui: em geral, 80% do tempo está concentrado em 20% das funções. Encontre esse grupo e trabalhe nele.

**4. Meça de novo depois de otimizar.** A otimização pode deslocar o gargalo para outro lugar. Repita o ciclo até chegar no número aceitável.

---

## cProfile: O Ponto de Partida

O **cProfile** faz parte da biblioteca padrão do Python e é a ferramenta certa para a primeira pergunta: onde meu programa passa o tempo? Ele instrumenta cada chamada de função e registra quantas vezes foi chamada e quanto tempo levou — com overhead mínimo, o que o torna adequado até para uso em ambientes próximos de produção.

Para entender como funciona, vamos criar um cenário realista. Imagine que você tem um script que processa uma lista de pedidos, calcula totais com desconto e filtra os que ultrapassam um limite:

```python
# pedidos.py
import time
import random


def buscar_desconto(produto_id: int) -> float:
    # Simula uma consulta lenta — banco, API externa, o que for
    time.sleep(0.001)
    return random.uniform(0.0, 0.3)


def calcular_total(pedido: dict) -> float:
    total = 0.0
    for item in pedido["itens"]:
        desconto = buscar_desconto(item["produto_id"])
        total += item["preco"] * (1 - desconto)
    return total


def filtrar_pedidos_grandes(pedidos: list, limite: float) -> list:
    return [p for p in pedidos if calcular_total(p) > limite]


def gerar_pedidos(n: int) -> list:
    return [
        {
            "id": i,
            "itens": [
                {"produto_id": j, "preco": random.uniform(10, 500)}
                for j in range(random.randint(1, 5))
            ],
        }
        for i in range(n)
    ]


if __name__ == "__main__":
    pedidos = gerar_pedidos(200)
    resultado = filtrar_pedidos_grandes(pedidos, 300.0)
    print(f"{len(resultado)} pedidos encontrados")
```

Para rodar esse script com o cProfile a partir da linha de comando:

```bash
python -m cProfile -s cumulative pedidos.py
```

A flag `-s cumulative` ordena os resultados pelo tempo cumulativo de cada função — ou seja, inclui o tempo das funções que ela chama. Isso é quase sempre o que você quer ver primeiro.

A saída vai ser extensa, mas as primeiras linhas já contam tudo:

```
   ncalls  tottime  percall  cumtime  percall filename:lineno(function)
        1    0.003    0.003   58.421   58.421 pedidos.py:1(<module>)
        1    0.021    0.021   58.410   58.410 pedidos.py:19(filtrar_pedidos_grandes)
      200    0.045    0.000   58.389    0.292 pedidos.py:14(calcular_total)
      612    0.012    0.000   58.041    0.095 pedidos.py:6(buscar_desconto)
      612    0.010    0.000   58.019    0.095 {built-in method time.sleep}
```

Lendo as colunas: **ncalls** é o número de chamadas; **tottime** é o tempo que a função passou executando o seu próprio código (excluindo chamadas internas); **cumtime** é o tempo total incluindo as funções chamadas por ela. A coluna que você deve olhar primeiro é **cumtime**.

A leitura é imediata: a função `buscar_desconto` foi chamada 612 vezes e sozinha consumiu 58 dos 58,4 segundos totais. A culpada está identificada — sem precisar ler uma linha do código.

---

## pstats: Filtrando o Que Importa

Em projetos reais, o cProfile gera dezenas ou centenas de linhas. O módulo **pstats** permite salvar o perfil em arquivo e consultá-lo com filtros precisos. Isso é especialmente útil quando você quer integrar profiling em scripts de CI ou comparar resultados entre versões.

Primeiro, gere o arquivo de perfil:

```bash
python -m cProfile -o pedidos.prof pedidos.py
```

Agora analise programaticamente com pstats:

```python
# analise.py
import pstats
import io

stream = io.StringIO()
stats = pstats.Stats("pedidos.prof", stream=stream)

# Remove prefixos longos de caminho para leitura mais limpa
stats.strip_dirs()

# Ordena por tempo cumulativo e mostra as 10 funções mais lentas
stats.sort_stats("cumulative")
stats.print_stats(10)

print(stream.getvalue())
```

Você também pode filtrar por nome de função — muito útil para ignorar a stdlib e focar no seu código:

```python
# Mostra apenas funções do seu módulo
stats.print_stats("pedidos")

# Mostra quem chamou buscar_desconto
stats.print_callers("buscar_desconto")

# Mostra o que buscar_desconto chama internamente
stats.print_callees("buscar_desconto")
```

O `print_callers` e `print_callees` são ferramentas especialmente valiosas para entender a cadeia de responsabilidade — quem está gerando o volume de chamadas que explode o tempo total.

---

## Profiling de um Trecho Específico

Às vezes você não quer perfilar o programa inteiro, apenas uma função específica. O cProfile pode ser usado diretamente no código com a API programática:

```python
import cProfile
import pstats
import io


def profile_func(func, *args, **kwargs):
    """Perfila uma função e imprime as 15 entradas mais lentas."""
    pr = cProfile.Profile()
    pr.enable()
    result = func(*args, **kwargs)
    pr.disable()

    stream = io.StringIO()
    ps = pstats.Stats(pr, stream=stream).strip_dirs().sort_stats("cumulative")
    ps.print_stats(15)
    print(stream.getvalue())
    return result


# Uso
pedidos = gerar_pedidos(200)
resultado = profile_func(filtrar_pedidos_grandes, pedidos, 300.0)
```

Essa abordagem é útil em scripts de diagnóstico sem alterar o código original. Você passa a função como argumento e coleta o perfil apenas daquele contexto — tudo acima e abaixo fica de fora.

---

## O Fix: o Que Fazer com o Que Você Encontrou

Voltando ao exemplo: `buscar_desconto` é chamada 612 vezes e cada chamada tem um `time.sleep(0.001)` que simula latência de I/O. Em código real, esse padrão aparece como:

- **N+1 queries:** uma busca no banco dentro de um loop que já iterou N itens.
- **Chamadas repetidas a APIs externas:** sem cache, para os mesmos parâmetros.
- **Computação sem memoização:** a mesma função cara chamada múltiplas vezes com os mesmos argumentos.

A correção depende do problema, mas o padrão de solução é consistente: batching ou caching. No caso do nosso exemplo, se os descontos pudessem ser buscados em batch:

```python
def buscar_descontos_batch(produto_ids: list[int]) -> dict[int, float]:
    # Uma chamada só para todos os IDs
    time.sleep(0.01)  # Latência única, independente do volume
    return {pid: random.uniform(0.0, 0.3) for pid in produto_ids}


def calcular_total_v2(pedido: dict, descontos: dict) -> float:
    total = 0.0
    for item in pedido["itens"]:
        desconto = descontos.get(item["produto_id"], 0.0)
        total += item["preco"] * (1 - desconto)
    return total


def filtrar_pedidos_grandes_v2(pedidos: list, limite: float) -> list:
    # Coleta todos os produto_ids primeiro
    todos_ids = {
        item["produto_id"]
        for pedido in pedidos
        for item in pedido["itens"]
    }
    descontos = buscar_descontos_batch(list(todos_ids))
    return [p for p in pedidos if calcular_total_v2(p, descontos) > limite]
```

Rodando o cProfile novamente na versão nova, a diferença é brutal: de ~58 segundos para menos de 1. O profiling identificou exatamente o problema e a validação confirma que a mudança funcionou.

---

## memory_profiler: Quando o Problema É RAM

Problemas de memória têm um padrão diferente dos problemas de tempo. Às vezes o processo não está lento — ele está crescendo. Um job que roda por horas e vai acumulando memória até ser morto pelo sistema. Um endpoint que, sob carga, faz o servidor entrar em swap. Uma pipeline de dados que carrega tudo em memória quando poderia processar em partes.

O **memory_profiler** mede o consumo de memória linha a linha. A instalação é simples:

```bash
pip install memory-profiler
```

Para usar, você decora a função que quer analisar com `@profile` — sem importar nada, o decorator é injetado pelo próprio memory_profiler em tempo de execução:

```python
# memoria.py


@profile
def processar_log_grande(caminho: str) -> dict:
    """
    Problema clássico: carregar um arquivo inteiro em memória
    quando processar linha a linha seria suficiente.
    """
    with open(caminho) as f:
        linhas = f.readlines()  # <- aqui está o problema

    contagem: dict[str, int] = {}
    for linha in linhas:
        chave = linha.split()[0] if linha.strip() else None
        if chave:
            contagem[chave] = contagem.get(chave, 0) + 1
    return contagem


if __name__ == "__main__":
    resultado = processar_log_grande("acesso.log")
    print(f"{len(resultado)} chaves únicas")
```

Execute com:

```bash
python -m memory_profiler memoria.py
```

A saída mostra o consumo de memória linha a linha:

```
Line #    Mem usage    Increment   Line Contents
================================================
     4   48.3 MiB    48.3 MiB   @profile
     5                           def processar_log_grande(caminho: str) -> dict:
     8   48.3 MiB     0.0 MiB       with open(caminho) as f:
     9  312.7 MiB   264.4 MiB           linhas = f.readlines()
    11  312.7 MiB     0.0 MiB       contagem: dict[str, int] = {}
    12  312.8 MiB     0.1 MiB       for linha in linhas:
    13  312.8 MiB     0.0 MiB           chave = linha.split()[0] if linha.strip() else None
    14  312.8 MiB     0.0 MiB           if chave:
    15  312.8 MiB     0.0 MiB               contagem[chave] = contagem.get(chave, 0) + 1
    16  262.1 MiB   -50.7 MiB       return contagem
```

A linha 9 é inconfundível: um incremento de **264 MB** em uma única linha — o `f.readlines()` carregando o arquivo inteiro para uma lista de strings na RAM. O processo termina usando 262 MB porque a lista `linhas` ainda existe até o fim da função.

### A Versão Corrigida

A solução é processar linha a linha com um generator — sem nunca manter o arquivo inteiro em memória:

```python
@profile
def processar_log_eficiente(caminho: str) -> dict:
    contagem: dict[str, int] = {}
    with open(caminho) as f:
        for linha in f:  # <- itera o file object diretamente
            chave = linha.split()[0] if linha.strip() else None
            if chave:
                contagem[chave] = contagem.get(chave, 0) + 1
    return contagem
```

A nova saída do memory_profiler:

```
Line #    Mem usage    Increment   Line Contents
================================================
     4   48.3 MiB    48.3 MiB   @profile
     5                           def processar_log_eficiente(caminho: str) -> dict:
     6   48.3 MiB     0.0 MiB       contagem: dict[str, int] = {}
     7   48.3 MiB     0.0 MiB       with open(caminho) as f:
     8   52.1 MiB     3.8 MiB           for linha in f:
     9   52.1 MiB     0.0 MiB               chave = linha.split()[0] if linha.strip() else None
    10   52.1 MiB     0.0 MiB               if chave:
    11   52.2 MiB     0.1 MiB                   contagem[chave] = contagem.get(chave, 0) + 1
    12   52.2 MiB     0.0 MiB       return contagem
```

De 264 MB de incremento para 3,8 MB. O arquivo pode ter qualquer tamanho — o consumo de memória permanece constante porque você nunca materializa a lista completa.

---

## Visualizando o Consumo ao Longo do Tempo

O memory_profiler tem uma ferramenta complementar para monitorar o consumo de RAM ao longo da execução de um processo inteiro, útil quando o problema é crescimento progressivo e não um pico isolado:

```bash
mprof run memoria.py
mprof plot
```

O `mprof run` coleta amostras periódicas de RAM e salva em um arquivo `.dat`. O `mprof plot` gera um gráfico de linha do consumo ao longo do tempo — você vê exatamente quando o processo cresce, quando libera memória e onde fica estável. Para salvar o gráfico em arquivo:

```bash
mprof plot --output consumo.png
```

---

## Quando Usar Cada Ferramenta

A escolha entre cProfile e memory_profiler não é questão de preferência — depende do sintoma.

**Use cProfile** quando o problema é **tempo**: a operação é mais lenta do que deveria, o endpoint não responde dentro do SLA, o batch que deveria rodar em 5 minutos leva 40.

**Use memory_profiler** quando o problema é **memória**: o processo é morto pelo OOM killer, o servidor começa a usar swap, a RAM cresce progressivamente em processos de longa duração, você está processando dados grandes e precisa garantir footprint constante.

Em casos onde o processo é simultaneamente lento e consome muita memória, comece pelo cProfile — problemas de tempo são geralmente mais fáceis de isolar e resolver. Memória pode ser consequência da solução errada para um problema de performance.

> **Nota sobre overhead:** o `@profile` do memory_profiler adiciona latência considerável à execução — pode ser 10x mais lento. Use apenas em ambiente de desenvolvimento e diagnóstico, nunca em produção.

---

## Integrando na Rotina de Desenvolvimento

Profiling não precisa ser uma atividade de emergência. Algumas práticas que funcionam bem no dia a dia:

**Scripts de benchmark reutilizáveis.** Para funções críticas, mantenha um script de benchmark versionado junto com o código. Quando alguém propõe uma mudança nessa função, roda o benchmark antes e depois do PR.

**cProfile no CI para regressões de performance.** É possível adicionar um teste que perfila uma operação específica e falha se o tempo cumulativo de uma função ultrapassar um threshold. Não é comum em todos os projetos, mas para sistemas com SLA restrito vale o investimento.

**Separe o diagnóstico da otimização.** Quando alguém reportar lentidão, o primeiro PR deve ser apenas a prova do problema — um script de profiling com os números. O segundo PR traz a correção. Essa separação garante que a otimização seja validada por dados e não por impressão.

---

## Conclusão

Profiling muda a natureza do trabalho de otimização. Sem ele, você está atirando no escuro — gastando tempo em partes do código que podem representar 2% do tempo total de execução. Com ele, você sabe exatamente onde está o problema antes de tocar no código.

O cProfile, apesar de fazer parte da biblioteca padrão e ser frequentemente subestimado por isso, é suficiente para a grande maioria dos problemas de performance em Python. O memory_profiler complementa com o que o cProfile não consegue ver: alocação linha a linha.

A metodologia é simples: reproduza o problema de forma isolada, meça com a ferramenta certa, identifique o culpado nos dados, corrija, meça de novo. Repita até o número estar dentro do aceitável.

A próxima vez que alguém trouxer um problema de lentidão para a equipe, a primeira pergunta não deve ser "o que você acha que está lento?" — deve ser "você rodou o profiler?". Com os dados em mãos, a conversa fica muito mais produtiva.

E já que você chegou até aqui: rodou o profiler no seu projeto e encontrou algo interessante? Tem um gargalo que não sabia por onde começar? Pode me chamar no Fediverso — [@riverfount@bolha.us](https://bolha.us/@riverfount). Adoro esse tipo de papo.
