---
title: "Você provavelmente não precisa desse try/finally"
date: 2026-03-19
draft: false
tags: ["python", "context-managers", "contextlib", "boas-práticas", "intermediário"]
cover:
  image: "images/covers/cover-context-managers.png"
  alt: "Você provavelmente não precisa desse try/finally"
  relative: false
---

Existe um padrão que aparece em quase todo projeto Python com mais de algumas semanas de vida. Ele tem variações, mas o esqueleto é sempre o mesmo:

```python
conn = get_db_connection()
try:
    resultado = conn.execute(query)
    return resultado
finally:
    conn.close()
```

Funciona. Fecha a conexão mesmo se der exceção. Ninguém vai questionar em code review. O problema é que esse bloco vai se repetir em todo lugar que precisar de uma conexão — e quando a lógica de encerramento mudar (adicionar log, métricas, rollback), você vai caçar essa duplicação pelo projeto inteiro.

A solução não é encapsular num helper. É usar o mecanismo que o Python criou exatamente para esse problema: context managers.

Você já usa context managers todo dia com `with open()`. Este artigo mostra como criar os seus próprios, por dois caminhos diferentes, e quando cada abordagem faz sentido.

## O que acontece dentro de um `with`

Antes de criar um context manager, vale entender o que o `with` faz de fato. A instrução não é açúcar sintático para `try/finally` — ela chama um protocolo específico no objeto que recebe.

```python
with open("arquivo.txt") as f:
    conteúdo = f.read()
```

Esse código é equivalente a:

```python
gerenciador = open("arquivo.txt")
f = gerenciador.__enter__()
try:
    conteúdo = f.read()
except Exception as exc:
    if not gerenciador.__exit__(type(exc), exc, exc.__traceback__):
        raise
else:
    gerenciador.__exit__(None, None, None)
```

Dois métodos definem o protocolo: `__enter__` e `__exit__`. O `__enter__` é chamado na entrada do bloco e seu retorno vira a variável do `as`. O `__exit__` é chamado na saída — com informações da exceção se houver, ou com três `None` se tudo correu bem.

Qualquer objeto que implemente esses dois métodos pode ser usado num `with`. Isso abre espaço para um padrão muito mais limpo do que `try/finally` repetido.

## Criando um context manager com `__enter__` e `__exit__`

A abordagem mais explícita é criar uma classe com os dois métodos. Vamos refatorar o exemplo da conexão de banco:

```python
class GerenciadorConexao:
    def __init__(self, dsn: str) -> None:
        self.dsn = dsn
        self.conn = None

    def __enter__(self):
        self.conn = get_db_connection(self.dsn)
        return self.conn

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.conn:
            self.conn.close()
        return False  # não suprime exceções
```

O uso fica limpo:

```python
with GerenciadorConexao("postgresql://localhost/mydb") as conn:
    resultado = conn.execute(query)
```

O `__exit__` recebe três argumentos que descrevem a exceção, se houver: o tipo, o valor e o traceback. Retornar `True` suprime a exceção — o bloco `with` termina normalmente, como se ela não tivesse acontecido. Retornar `False` (ou `None`) deixa a exceção propagar normalmente.

Suprimir exceção seletivamente faz sentido em alguns casos. Um context manager de retry, por exemplo, poderia capturar `TimeoutError` e tentar de novo sem deixar a exceção chegar ao chamador. Na maioria dos casos, porém, o correto é retornar `False` e deixar o erro visível.

## O caminho mais curto: `contextlib.contextmanager`

A abordagem com classe funciona, mas tem cerimônia. Para a maioria dos casos, `contextlib.contextmanager` é mais direto: você escreve um generator function com exatamente um `yield`, e o decorador transforma isso em context manager.

```python
from contextlib import contextmanager

@contextmanager
def gerenciar_conexao(dsn: str):
    conn = get_db_connection(dsn)
    try:
        yield conn
    finally:
        conn.close()
```

O que está antes do `yield` executa como `__enter__`. O valor do `yield` vira o retorno de `__enter__` — a variável do `as`. O que está depois do `yield` (no `finally`) executa como `__exit__`.

O uso é idêntico:

```python
with gerenciar_conexao("postgresql://localhost/mydb") as conn:
    resultado = conn.execute(query)
```

Para tratar exceções explicitamente, você captura ao redor do `yield`:

```python
@contextmanager
def gerenciar_conexao(dsn: str):
    conn = get_db_connection(dsn)
    try:
        yield conn
    except Exception as exc:
        conn.rollback()
        raise  # re-raise: não suprime
    finally:
        conn.close()
```

O `raise` sem argumento dentro do `except` re-lança a exceção original. Se você omitir o `raise`, o context manager suprime a exceção — equivalente a retornar `True` no `__exit__`.

## Três padrões que aparecem em produção

### 1. Timer de performance

Medir tempo de execução de blocos é um caso clássico. Sem context manager, o código fica cheio de `time.perf_counter()` antes e depois de cada seção. Com um context manager:

```python
import time
from contextlib import contextmanager

@contextmanager
def cronometrar(label: str):
    inicio = time.perf_counter()
    try:
        yield
    finally:
        duracao = time.perf_counter() - inicio
        print(f"{label}: {duracao:.3f}s")
```

```python
with cronometrar("consulta ao banco"):
    resultados = conn.execute(query_pesada).fetchall()

with cronometrar("processamento"):
    dados_tratados = [processar(r) for r in resultados]
```

Note que o `yield` não tem valor — não há nada útil para passar pro bloco. Isso é perfeitamente válido; o `with` sem `as` apenas demarca o escopo.

### 2. Lock de arquivo

Processos concorrentes que escrevem no mesmo arquivo precisam de coordenação. Um context manager limpa o padrão de adquirir e liberar lock:

```python
import fcntl
from contextlib import contextmanager

@contextmanager
def lock_arquivo(caminho: str):
    with open(caminho, "w") as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX)
            yield f
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)
```

Context managers são combináveis: o `with open()` interno é ele mesmo um context manager. O `yield f` passa o arquivo aberto para o bloco externo, que pode escrever nele com garantia de exclusividade.

### 3. Configuração temporária

Mudar um estado global temporariamente — variável de ambiente, configuração de locale, nível de log — e restaurar o valor original ao sair é exatamente o que context managers fazem melhor:

```python
import os
from contextlib import contextmanager

@contextmanager
def variavel_de_ambiente(nome: str, valor: str):
    anterior = os.environ.get(nome)
    os.environ[nome] = valor
    try:
        yield
    finally:
        if anterior is None:
            del os.environ[nome]
        else:
            os.environ[nome] = anterior
```

```python
with variavel_de_ambiente("DATABASE_URL", "sqlite:///:memory:"):
    executar_suite_de_testes()
# DATABASE_URL voltou ao valor original aqui
```

Esse padrão é especialmente útil em testes: você altera o ambiente para o escopo do teste e tem garantia de que o estado vai ser restaurado mesmo se o teste falhar.

## Quando usar classe, quando usar `contextmanager`

A distinção prática é simples.

Use `@contextmanager` quando o context manager é autocontido — toda a lógica cabe num generator function e não precisa de estado entre usos. Os três exemplos acima se encaixam aqui.

Use uma classe quando o context manager precisa de configuração mais elaborada, herança, ou quando ele vai ser reutilizado como parte de um objeto maior. Um pool de conexões que é ele mesmo um context manager, por exemplo, vai ter estado (`self.pool`, `self.timeout`, `self.max_connections`) que justifica a classe.

Há uma terceira opção para casos simples onde você só precisa garantir que um método de limpeza seja chamado: `contextlib.closing`.

```python
from contextlib import closing
import urllib.request

with closing(urllib.request.urlopen("https://example.com")) as resposta:
    conteúdo = resposta.read()
```

`closing` chama `.close()` no objeto ao sair do bloco. Funciona com qualquer objeto que tenha esse método — útil para integrar com APIs que não implementam o protocolo de context manager nativamente.

## O `try/finally` que vale manter

Context managers não eliminam `try/finally` — eles encapsulam os casos onde o mesmo padrão se repete. Se você tem um `try/finally` que aparece uma única vez e não vai ser reutilizado, não há razão para criar um context manager em torno dele. O overhead de abstração não compensa.

O sinal de que é hora de criar um context manager é a repetição: quando você se pega escrevendo o mesmo bloco de setup/teardown em dois ou mais lugares, o padrão está pedindo para ser encapsulado.

Há também uma dimensão de legibilidade. Um `with transacao_atomica(conn):` comunica intenção de forma que um `try/finally` com `conn.begin()` e `conn.commit()` não comunica. O context manager nomeia o padrão.

Context managers são um dos lugares onde Python deixa mais claro que o protocolo importa mais do que a herança. Você não precisa herdar de nenhuma classe base — só implementar `__enter__` e `__exit__`, ou usar `@contextmanager` e escrever um generator. O mecanismo faz o resto.

O próximo artigo vai entrar numa comparação que muita gente empurra para baixo do tapete: `dataclass`, `NamedTuple` e `attrs` — quando cada um é a escolha certa e por quê o `dict` que você está passando entre funções provavelmente não deveria ser um `dict`.

Se tiver dúvidas ou casos de uso que não encaixaram no que foi mostrado aqui, a conversa continua no Fediverso: **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
