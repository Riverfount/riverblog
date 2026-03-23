---
title: "A GIL finalmente saiu do caminho: o que muda com o Python 3.14 free-threaded"
date: 2026-03-23
draft: false
tags: ["python", "concorrência", "gil", "free-threading", "performance"]
cover:
  image: "images/covers/cover-python314-free-threaded.png"
  alt: "A GIL finalmente saiu do caminho: o que muda com o Python 3.14 free-threaded"
  relative: false
---

Você tem quatro núcleos disponíveis. Seu script Python usa um. Isso nunca foi um bug — era
uma decisão de design que durava desde 1992. O Python 3.14 não remove essa limitação de vez,
mas dá o passo mais concreto até agora para deixá-la para trás.

## O que é a GIL e por que ela importa

A Global Interpreter Lock é um mutex que garante que apenas uma thread execute bytecode Python
por vez dentro de um processo CPython. Ela existe por uma razão pragmática: simplifica
imensamente o gerenciamento de memória e a integração com extensões C, que historicamente
assumem que esse lock existe.

O problema é direto. Se você tem uma tarefa CPU-bound — hashing, compressão, inferência de
modelo, qualquer coisa que não espera I/O — e tenta paralelizá-la com `threading`, o que
acontece na prática é isso:

```python
import threading
import hashlib
import time

def cpu_task(n=2_000_000):
    data = b"benchmark"
    for _ in range(n):
        hashlib.sha256(data).hexdigest()

# Sequencial
start = time.perf_counter()
cpu_task()
cpu_task()
print(f"Sequencial: {time.perf_counter() - start:.2f}s")

# "Paralelo" com threads — mesma coisa com overhead
start = time.perf_counter()
t1 = threading.Thread(target=cpu_task)
t2 = threading.Thread(target=cpu_task)
t1.start(); t2.start()
t1.join(); t2.join()
print(f"Threads (GIL ativo): {time.perf_counter() - start:.2f}s")
```

Em CPython normal, os dois tempos ficam próximos — às vezes o threaded é até mais lento por
causa do overhead de troca de contexto. As threads existem, mas brigam pela mesma GIL no mesmo
core. Para workloads CPU-bound, `multiprocessing` sempre foi o caminho, com todo o custo que
vem junto: serialização via pickle, overhead de fork, comunicação por filas.

## O que mudou no 3.13 e o que o 3.14 consolida

O PEP 703 propôs tornar a GIL opcional em CPython. A implementação chegou no 3.13 como
experimental — uma build separada do interpretador, compilada com `--disable-gil`, disponível
nos instaladores oficiais para Windows e macOS. O sufixo da versão `t` (de *free-threaded*)
virou o marcador dessa build: `python3.13t`.

O Python 3.14 fecha o ciclo da fase experimental. O PEP 779 foi aceito pelo Steering Council,
declarando que a build free-threaded é agora **suportada oficialmente** — não mais
experimental. Isso não significa que ela virou o padrão: a build com GIL continua sendo o que
você instala quando baixa o Python normalmente. O que mudou é o compromisso institucional com
estabilidade e suporte.

Concretamente no 3.14:

- A implementação do PEP 703 foi concluída, incluindo as mudanças na C API. As soluções
  temporárias que existiam no interpretador foram substituídas por soluções definitivas.
- O interpretador adaptativo especializante (PEP 659 — o que faz o Python ficar mais rápido ao
  detectar tipos em hot paths) foi habilitado na build free-threaded. No 3.13 ele estava
  desativado nessa build por questões de segurança de threads.
- A penalidade de performance em código single-threaded caiu para aproximadamente 5–10%
  dependendo da plataforma e do compilador C. No 3.13, essa penalidade era maior.

## Como instalar e identificar a build

A situação de instalação varia bastante por plataforma, então vale detalhar cada caminho.

**Windows e macOS** têm suporte direto no instalador oficial do python.org: durante a
instalação customizada, há um checkbox para incluir os binários free-threaded. No Windows, no
entanto, o instalador do python.org tem uma limitação importante: se você instalar a build
padrão e a free-threaded do mesmo instalador, as duas compartilham o mesmo `site-packages`,
o que quebra os ambientes facilmente. A recomendação é usar o pacote `python-freethreaded`
via `nuget`, que mantém instalações separadas.

**Linux** não tem um instalador gráfico, mas a cobertura por gerenciador de pacotes é boa e
cresce por lançamento:

Em **Fedora**, o pacote já está nos repositórios oficiais:

```bash
sudo dnf install python3.14-freethreading
# interpretador disponível em /usr/bin/python3.14t
```

Em **Ubuntu e Debian**, o caminho é via deadsnakes PPA — o mesmo repositório que a maioria
usa para instalar versões mais novas do Python nessas distribuições:

```bash
sudo add-apt-repository ppa:deadsnakes
sudo apt-get update
sudo apt-get install python3.14-nogil
```

Em **NixOS e Nixpkgs**, o atributo `python314FreeThreading` está disponível a partir do canal
NixOS 24.05:

```bash
# com flakes
nix shell nixpkgs#python314FreeThreading

# sem flakes
sudo nix-channel --update
nix-shell -p python314FreeThreading
```

Em **Arch Linux**, a build free-threaded não está nos repositórios oficiais — o pacote
`python` do `core` é a build padrão com GIL. A opção documentada na ArchWiki é o pacote AUR
`python314-freethreaded`:

```bash
# com yay
yay -S python314-freethreaded

# com paru
paru -S python314-freethreaded
```

Como qualquer pacote AUR, isso compila o CPython localmente com `--disable-gil`. A compilação
demora alguns minutos. Quem usa Arch provavelmente já sabe lidar com isso, mas vale o aviso
se for rodar em CI ou em uma máquina com pouca RAM.

Para quem prefere compilar por fonte diretamente — útil quando você quer a versão mais recente
do branch `main` ou precisa reproduzir um bug no CPython — o processo é o mesmo de sempre,
com uma flag adicional:

```bash
./configure --disable-gil
make -j$(nproc)
```

**Em qualquer plataforma**, `uv` é o caminho mais rápido se você já o usa como gerenciador
de projetos:

```bash
uv python install 3.14t
uv run --python 3.14t python -VV
```

Para ambientes isolados com conda-forge:

```bash
mamba create -n nogil -c conda-forge python-freethreading
```

O output confirma qual build você está usando:

```bash
Python 3.14.0 free-threading build (main, Oct 7 2025, 15:35:12) [Clang 20.1.4] on linux
```

Para verificar programaticamente se a GIL está desativada em tempo de execução:

```python
import sys

if hasattr(sys, '_is_gil_enabled'):
    print(f"GIL ativa: {sys._is_gil_enabled()}")
else:
    print("Build padrão — GIL sempre ativa")
```

Na build free-threaded, `sys._is_gil_enabled()` retorna `False` por padrão. É possível
reativar a GIL via variável de ambiente ou flag na linha de comando:

```bash
PYTHON_GIL=1 python3.14t script.py
# ou
python3.14t -X gil=1 script.py
```

Isso é relevante para um cenário específico: se uma extensão C for importada e não estiver
marcada como compatível com free-threading, o CPython reativa a GIL automaticamente e imprime
um aviso. O comportamento evita crashes silenciosos em código legado.

## O benchmark que mostra a diferença

Com a build free-threaded, o mesmo script de hashing que não escalava agora escala:

```python
import threading
import hashlib
import time

def cpu_task(n=2_000_000):
    data = b"benchmark"
    for _ in range(n):
        hashlib.sha256(data).hexdigest()

def run_with_threads(num_threads):
    threads = [threading.Thread(target=cpu_task) for _ in range(num_threads)]
    start = time.perf_counter()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return time.perf_counter() - start

print(f"1 thread:  {run_with_threads(1):.2f}s")
print(f"2 threads: {run_with_threads(2):.2f}s")
print(f"4 threads: {run_with_threads(4):.2f}s")
```

Em Python padrão, os três resultados ficam praticamente iguais. Na build free-threaded, o tempo
cai de forma próxima à linear conforme os cores disponíveis absorvem o trabalho.

Workloads I/O-bound não ganham muito com isso — elas já escalavam via `asyncio` ou threads
normais, já que a GIL era liberada durante I/O de qualquer forma. O ganho real é para código
CPU-bound que hoje só escala com `multiprocessing`.

## Thread safety: o que você não pode mais assumir

Remover a GIL não torna o código automaticamente thread-safe. A GIL tinha um efeito colateral
conveniente: ela sincronizava acesso aos objetos built-in. `dict`, `list` e `set` pareciam
thread-safe porque, na prática, eram — a GIL garantia atomicidade implícita em operações
individuais.

Na build free-threaded, esses tipos usam locks internos para proteger contra modificações
concorrentes, mas o comportamento não é garantido como especificação — é implementação atual
que pode mudar. O conselho da documentação é direto: use `threading.Lock` e primitivas de
sincronização explicitamente, não confie nos locks internos dos built-ins.

Há limitações conhecidas nessa build que vale entender antes de migrar:

**Iteradores não são thread-safe.** Acessar o mesmo objeto iterador de múltiplas threads
simultaneamente pode resultar em elementos duplicados ou pulados. Se você está compartilhando
um iterador entre threads (incomum, mas possível), precisa de um lock.

**`frame.f_locals` em threads concorrentes pode crashar o interpretador.** Não acesse objetos
frame de uma thread enquanto outra thread está executando esse frame.

**Imortalização de objetos.** A build free-threaded imortaliza alguns objetos — literais
numéricos, strings literais, tuplas constantes, e strings internadas com `sys.intern()` — para
evitar contenção em contagem de referências. Esses objetos nunca são desalocados. O impacto
prático é pequeno para a maioria dos casos, mas pode ser relevante se você depende de
comportamentos de ciclo de vida de objetos específicos.

## O que muda no comportamento padrão

Dois comportamentos da build free-threaded diferem da build com GIL e podem surpreender:

**Context variables são herdadas por threads.** A flag `thread_inherit_context` é `True` por
padrão na build free-threaded. Isso significa que threads criadas com `threading.Thread`
começam com uma cópia do `Context()` da thread que chamou `start()`. Na build padrão, threads
começam com um `Context()` vazio. Isso afeta qualquer código que usa `contextvars` — incluindo
o context manager `decimal.localcontext()`.

**Warning filters são thread-aware.** A flag `context_aware_warnings` também é `True` por
padrão. O `warnings.catch_warnings()` usa uma variável de contexto em vez de modificar a lista
global de filtros. Na build padrão, ele modifica o estado global, o que não é thread-safe de
qualquer forma.

## O roadmap e o que vem a seguir

O Steering Council definiu as fases claramente. A fase 1 foi o 3.13 experimental. A fase 2 é
o 3.14 com suporte oficial mas opcional. A fase 3 — onde a build free-threaded se torna o
padrão — está prevista para um ponto entre 2026 e 2027, quando a GIL passará a ser controlada
por variável de ambiente ou flag de linha de comando e desativada por padrão em alguma versão
posterior (estimativa atual: 2028–2030).

O obstáculo principal para a adoção agora é o ecossistema de extensões C. Muitos pacotes
populares ainda não marcaram seus módulos como compatíveis com free-threading, o que faz o
interpretador reativar a GIL na importação. Os sites `py-free-threading.github.io/tracking/` e
`hugovk.github.io/free-threaded-wheels/` rastreiam o status por pacote. NumPy, por exemplo,
tem suporte ativo em desenvolvimento.

A lição prática: testar a build free-threaded com seu workload específico faz sentido agora,
especialmente se você tem código CPU-bound que hoje usa `multiprocessing` apenas por causa da
GIL. Mas migrar produção exige verificar cada dependência e não assumir thread-safety onde
antes havia um alívio acidental.

---

A discussão sobre esse assunto no Fediverse costuma ser bem animada — especialmente os casos
em que extensões C silenciosamente reativam a GIL sem avisar. Se você testar a build free-threaded
em algum projeto real, conta como foi em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
