+++
date = '2026-02-19T11:29:23-03:00'
draft = false
title = 'Decorators Internamente: Como Funcionam e Como Criar os Seus'
tags = ["python", "decoradores", "design-patterns"]
+++
Se você escreve Python há algum tempo, já usou decorators sem perceber. O `@app.route` do Flask, o
`@pytest.mark.parametrize`, o `@dataclass` da stdlib, o `@property` nativo da linguagem — todos são decorators. Eles
aparecem em todo framework relevante do ecossistema, mas a maioria dos recursos disponíveis explica *como usar* sem
explicar *por que funciona*.

Este artigo corrige isso.

A ideia aqui não é ensinar a sintaxe do `@`. É mostrar o mecanismo embaixo: o que Python faz quando encontra esse
símbolo, como construir um decorator do zero com segurança e como evitar as armadilhas que só aparecem em produção.

---

## 1. Pré-requisito: Funções São Objetos de Primeira Classe

Antes de entender decorators, é preciso internalizar um conceito que Python respeita de forma consistente: **funções são
objetos como qualquer outro**.

Isso significa que uma função pode ser atribuída a uma variável, passada como argumento para outra função, e retornada
como resultado de uma chamada. Se isso parece óbvio, bem. Mas as consequências disso são o alicerce inteiro do decorator
pattern.

**Funções podem ser atribuídas a variáveis:**

```python
def saudacao() -> str:
    return "Olá!"

outra_referencia = saudacao   # sem parênteses — não estamos chamando, estamos referenciando
print(outra_referencia())     # "Olá!"
```

**Funções podem ser passadas como argumento:**

```python
def executar(func) -> None:
    print("Antes")
    func()
    print("Depois")

executar(saudacao)
# Antes
# Olá!
# Depois
```

**Funções podem ser retornadas por outras funções:**

```python
def criar_saudacao(nome: str):
    def mensagem() -> str:
        return f"Olá, {nome}!"   # captura 'nome' do escopo externo
    return mensagem  # retorna a função, não o resultado

ola_vicente = criar_saudacao("Vicente")
print(ola_vicente())   # "Olá, Vicente!" — mesmo após criar_saudacao() ter retornado
```

Esse último exemplo tem um nome técnico: **closure**. A função interna `mensagem` "fecha sobre" a variável `nome` do
escopo externo e a mantém viva mesmo depois que `criar_saudacao` terminou de executar. O Python preserva esse contexto
enquanto houver uma referência à função interna.

Closures são o mecanismo que permite decorators funcionarem. Quando você entende closures, a mecânica do `@` deixa de
ser mágica e passa a ser consequência natural.

---

## 2. A Mecânica do Decorator — Desvendando o @

Com closures claras, o decorator se torna trivial de entender: **`@decorator` é açúcar sintático para uma atribuição**.

```python
@meu_decorator
def funcao() -> None:
    ...
```

O Python transforma isso exatamente em:

```python
def funcao() -> None:
    ...
funcao = meu_decorator(funcao)
```

É tudo. Não existe nenhuma magia adicional. O símbolo `@` instrui o interpretador a passar a função definida logo abaixo
como argumento para `meu_decorator` e a reatribuir o resultado de volta ao mesmo nome.

Para deixar isso concreto, veja o primeiro decorator possível — sem usar `@`, para tornar o mecanismo explícito:

```python
def logar(func):
    def wrapper():
        print(f"Chamando {func.__name__}...")
        func()
        print(f"{func.__name__} concluída.")
    return wrapper

def processar() -> None:
    print("Processando pedido.")

# Sem @: reatribuição explícita
processar = logar(processar)
processar()
# Chamando processar...
# Processando pedido.
# processar concluída.
```

Agora a mesma coisa com a sintaxe `@` — o resultado é idêntico:

```python
@logar
def processar() -> None:
    print("Processando pedido.")

processar()
# Chamando processar...
# Processando pedido.
# processar concluída.
```

O `@` é apenas uma forma mais limpa de escrever `processar = logar(processar)`. Reconhecer isso é o que permite
raciocinar sobre qualquer decorator, não importa o quão complexo ele pareça.

---

## 3. Anatomia de um Decorator Bem Formado

O exemplo acima funciona, mas tem um problema: só aceita funções sem argumentos. Em produção, os decorators precisam ser
transparentes — funcionar com qualquer assinatura de função, independentemente de quantos parâmetros ela receba.

Este é o template canônico:

```python
import functools

def meu_decorator(func):
    @functools.wraps(func)  # (a) preserva a identidade da função original
    def wrapper(*args, **kwargs):  # (b) aceita qualquer assinatura
        # (c) lógica executada antes da função original
        resultado = func(*args, **kwargs)   # (d) chama a função original com seus argumentos
        # (e) lógica executada depois
        return resultado  # (f) retorna o valor original sem modificá-lo
    return wrapper  # (g) retorna o wrapper — não chama, retorna
```

Cada ponto merece atenção:

**(a)** `@functools.wraps(func)` preserva os metadados da função original no wrapper. O motivo completo merece uma seção
própria — e vai ter uma logo adiante.

**(b)** `*args, **kwargs` garante que o wrapper aceita qualquer combinação de argumentos posicionais e nomeados,
repassando-os intactos para a função original. Sem isso, o decorator só funciona com funções de assinatura idêntica à do
wrapper.

**(c) e (e)** São os pontos onde a lógica do decorator vive: logging, validação, timing, cache — tudo entra aqui.

**(d)** `func(*args, **kwargs)` chama a função original com os mesmos argumentos recebidos. Note que a variável `func`
vem do escopo externo — isso é a closure em ação.

**(f)** `return resultado` é crítico. Um decorator que não retorna o valor da função original "engole" o retorno
silenciosamente. Se `processar_pedido` retorna uma lista de itens e o decorator não faz `return resultado`, o chamador
recebe `None`.

**(g)** `return wrapper` está fora do corpo do `wrapper`. O decorator retorna a função wrapper — não a chama. É essa
distinção que faz o mecanismo funcionar: ao escrever `@meu_decorator`, Python substitui o nome da função pelo wrapper
retornado aqui.

**Exemplo completo com timer:**

```python
import time
import functools

def timer(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        inicio = time.perf_counter()
        resultado = func(*args, **kwargs)
        fim = time.perf_counter()
        print(f"{func.__name__!r} executou em {fim - inicio:.6f}s")
        return resultado
    return wrapper

@timer
def processar_pedidos(n: int) -> list[int]:
    """Simula o processamento de uma lista de pedidos."""
    return list(range(n))

itens = processar_pedidos(100_000)
# 'processar_pedidos' executou em 0.004312s
```

`time.perf_counter()` é preferível a `time.time()` para medições de performance: tem resolução mais alta e não sofre
ajustes de relógio do sistema.

---

## 4. O Problema da Identidade — Por que `functools.wraps` É Obrigatório

Há um detalhe sutil que cobra um preço alto quando ignorado. Observe:

```python
def log(func):
    def wrapper(*args, **kwargs):  # sem @functools.wraps
        return func(*args, **kwargs)
    return wrapper

@log
def calcular_total(pedido: dict) -> float:
    """Calcula o valor total de um pedido com impostos."""
    ...

print(calcular_total.__name__)   # 'wrapper'  ← errado
print(calcular_total.__doc__)    # None        ← errado
```

Após a decoração, `calcular_total` aponta para o objeto `wrapper`. Sem nenhum cuidado adicional, `__name__`, `__doc__`,
`__annotations__` e outros atributos são os do wrapper — não os da função original. O nome que aparece em stack traces,
em ferramentas de documentação automática como Sphinx, em pytest markers e no `help()` interativo é `wrapper`.

Em um projeto com dezenas de funções decoradas, todo stack trace em produção vai apontar para `wrapper` em vez de
indicar a função real com problema. O custo de debugging aumenta desnecessariamente.

`functools.wraps` resolve isso. Ele é um decorator aplicado ao wrapper que copia os atributos relevantes da função
original:

```python
def log(func):
    @functools.wraps(func)    # copia os metadados de func para wrapper
    def wrapper(*args, **kwargs):
        return func(*args, **kwargs)
    return wrapper

@log
def calcular_total(pedido: dict) -> float:
    """Calcula o valor total de um pedido com impostos."""
    ...

print(calcular_total.__name__)   # 'calcular_total'  ← correto
print(calcular_total.__doc__)    # 'Calcula o valor...'  ← correto
```

Internamente, `functools.wraps` é um atalho para `functools.update_wrapper(wrapper, func)`. Os atributos transferidos
são:

| Atributo          | O que representa                                                    |
|-------------------|---------------------------------------------------------------------|
| `__name__`        | Nome da função — aparece em stack traces e `repr`                   |
| `__qualname__`    | Nome qualificado — inclui classe e módulo, para contexto exato      |
| `__doc__`         | Docstring — essencial para `help()`, Sphinx e IDEs                  |
| `__module__`      | Módulo de origem — identifica onde a função foi definida            |
| `__annotations__` | Type hints — necessário para mypy e ferramentas de análise estática |
| `__dict__`        | Atributos customizados — preserva metadados adicionados à função    |
| `__wrapped__`     | **Referência direta à função original** — adicionado pelo `wraps`   |

O atributo `__wrapped__` merece destaque: ele permite "desembrulhar" a cadeia de decorators e acessar a função original
diretamente, o que é útil em testes e introspecção.

```python
print(calcular_total.__wrapped__)   # <function calcular_total at 0x...>
```

A regra é simples: **todo decorator deve usar `@functools.wraps(func)` no wrapper interno**, sem exceção. O custo é
zero, o benefício é real.

---

## 5. Decorators com Argumentos — A Fábrica de Decorators

Até aqui, os decorators recebem apenas a função como argumento. Mas muitos dos decorators mais úteis precisam de
configuração: `@retry(max_tentativas=3)`, `@cache(ttl=60)`, `@permissao_requerida("admin")`.

Ao adicionar parênteses ao decorator, o comportamento muda completamente — e é aqui que a maioria dos tutoriais perde o
leitor.

A confusão vem do seguinte: `@repetir(vezes=3)` não está chamando um decorator. Está chamando uma
**fábrica de decorator** — uma função que, ao ser chamada com os argumentos de configuração, *retorna* o decorator de
verdade.

A estrutura tem três camadas:

```python
import functools

def repetir(vezes: int):  # ← camada 1: fábrica — recebe os argumentos
    def decorator(func):   # ← camada 2: decorator — recebe a função
        @functools.wraps(func)
        def wrapper(*args, **kwargs):  # ← camada 3: wrapper — executa em runtime
            for _ in range(vezes):
                resultado = func(*args, **kwargs)
            return resultado
        return wrapper
    return decorator  # fábrica retorna o decorator

@repetir(vezes=3)
def notificar(mensagem: str) -> None:
    print(f"[NOTIF] {mensagem}")

notificar("pedido aprovado")
# [NOTIF] pedido aprovado
# [NOTIF] pedido aprovado
# [NOTIF] pedido aprovado
```

Para entender o que acontece passo a passo, expanda a sintaxe `@`:

```python
# @repetir(vezes=3) se desdobra em:

_decorator = repetir(vezes=3)  # step 1: chama a fábrica, obtém o decorator
notificar = _decorator(notificar)  # step 2: aplica o decorator à função
```

A variável `vezes` fica capturada pela closure do `wrapper`, que a usa em cada chamada de `notificar`.

A regra para identificar quantas camadas um decorator precisa é direta: **decorator sem parênteses = uma função que
recebe `func`; decorator com parênteses = uma função que recebe os argumentos e retorna uma função que recebe `func`**.

---

## 6. Stacking — Empilhando Decorators e a Ordem de Execução

Python permite empilhar múltiplos decorators sobre uma mesma função. A ordem em que eles aparecem determina o
comportamento — e errar essa ordem pode introduzir bugs silenciosos que só aparecem em produção.

```python
@decorator_a  # aplicado por último, envolve o resultado de decorator_b
@decorator_b  # aplicado primeiro, envolve a função original
def minha_funcao():
    ...

# Equivalente exato:
minha_funcao = decorator_a(decorator_b(minha_funcao))
```

A **regra de ouro**: a aplicação é de baixo para cima (o decorator mais próximo da função é aplicado primeiro), mas a
execução em runtime é de cima para baixo (o decorator mais externo executa primeiro).

Para tornar isso concreto, considere dois decorators em um endpoint de API:

```python
import functools

def logar(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        print(f"[LOG] Chamando {func.__name__!r}")
        resultado = func(*args, **kwargs)
        print(f"[LOG] {func.__name__!r} concluída")
        return resultado
    return wrapper

def autenticar(func):
    @functools.wraps(func)
    def wrapper(usuario: str, *args, **kwargs):
        if usuario != "admin":
            raise PermissionError(f"Acesso negado para '{usuario}'")
        return func(usuario, *args, **kwargs)
    return wrapper
```

**Cenário A — `@logar` acima de `@autenticar`:**

```python
@logar
@autenticar
def obter_relatorio(usuario: str) -> dict:
    return {"relatorio": "dados sensíveis"}

obter_relatorio("convidado")
# [LOG] Chamando 'obter_relatorio'   ← loga antes de verificar permissão
# PermissionError: Acesso negado para 'convidado'
```

O log registra a tentativa de acesso mesmo quando o usuário não tem permissão. Em alguns sistemas, isso é o
comportamento correto — registrar toda tentativa, incluindo as negadas.

**Cenário B — `@autenticar` acima de `@logar`:**

```python
@autenticar
@logar
def obter_relatorio(usuario: str) -> dict:
    return {"relatorio": "dados sensíveis"}

obter_relatorio("convidado")
# PermissionError: Acesso negado para 'convidado'
# (sem log — a exceção ocorre antes do log ser atingido)
```

Aqui, a autenticação bloqueia antes do log registrar qualquer coisa. Apenas chamadas autenticadas chegam ao log.

Ambos os comportamentos podem ser desejados, dependendo do requisito. O ponto é que a ordem define o comportamento, e
não há nada no código que sinalize a diferença visualmente além da posição do `@`. É uma decisão arquitetural que
precisa ser documentada.

---

## 7. Decorators Baseados em Classe — Quando o Estado Importa

Até agora, todos os decorators foram funções. Mas Python permite usar classes como decorators também — e elas se tornam
a escolha certa quando o decorator precisa **manter estado entre chamadas**.

Um contador de invocações é o exemplo mais direto:

```python
import functools

class Contador:
    def __init__(self, func) -> None:
        functools.update_wrapper(self, func)
        self.func = func
        self.chamadas: int = 0

    def __call__(self, *args, **kwargs):
        self.chamadas += 1
        return self.func(*args, **kwargs)

@Contador
def buscar_usuario(user_id: int) -> dict:
    """Busca dados de um usuário pelo ID."""
    return {"id": user_id}

buscar_usuario(1)
buscar_usuario(2)
buscar_usuario(3)
print(f"Total de chamadas: {buscar_usuario.chamadas}")   # Total de chamadas: 3
```

O `@Contador` sobre `buscar_usuario` é equivalente a `buscar_usuario = Contador(buscar_usuario)`. O construtor
`__init__` recebe a função, `__call__` é executado cada vez que a função decorada é chamada, e o estado 
(`self.chamadas`) persiste no objeto.

### O que `update_wrapper` realmente faz numa instância de classe

Aqui vale parar e ser preciso, porque há uma nuance importante que a maioria dos tutoriais ignora.

`functools.update_wrapper(self, func)` copia atributos como `__name__`, `__qualname__`, `__doc__` e `__annotations__`
da função original para o *objeto instância* — não para a classe `Contador`. Isso significa que a introspecção
programática funciona corretamente:

```python
print(buscar_usuario.__name__)      # 'buscar_usuario'  ← correto
print(buscar_usuario.__doc__)       # 'Busca dados de um usuário pelo ID.'  ← correto
print(buscar_usuario.__wrapped__)   # <function buscar_usuario at 0x...>  ← correto
```

Porém, o `__repr__` padrão de um objeto em Python é gerado pela *classe*, não pela instância. E a classe `Contador`
não sabe nada sobre `__name__` — ela simplesmente herda o `__repr__` de `object`, que produz:

```python
repr(buscar_usuario)
# <__main__.Contador object at 0x7f3a4c2b1d90>
```

Não `<function buscar_usuario at 0x...>`, como seria com um decorator de função. O `update_wrapper` não tem como alterar
isso: atributos de instância não têm efeito sobre o `__repr__` padrão da classe.

Para fins práticos do dia a dia — pytest, mypy, Sphinx, logging, stack traces — isso raramente é problema: todas essas
ferramentas usam `__name__` e `__qualname__` diretamente, e esses atributos estão corretos. O `__repr__` entra em cena
principalmente no REPL interativo e em sessões de debug — exatamente onde um repr que "mente" pode confundir mais do que
ajudar.

### A solução correta: `__repr__` que comunica a realidade

O caminho certo não é imitar o repr de uma função — é comunicar a natureza real do objeto, incluindo o estado que só um
decorator de classe pode ter:

```python
import functools

class Contador:
    def __init__(self, func) -> None:
        functools.update_wrapper(self, func)
        self.func = func
        self.chamadas: int = 0

    def __call__(self, *args, **kwargs):
        self.chamadas += 1
        return self.func(*args, **kwargs)

    def __repr__(self) -> str:
        return (
            f"<Contador decorator de {self.func.__qualname__!r} "
            f"— {self.chamadas} chamada(s)>"
        )

@Contador
def buscar_usuario(user_id: int) -> dict:
    """Busca dados de um usuário pelo ID."""
    return {"id": user_id}

buscar_usuario(1)
buscar_usuario(2)

repr(buscar_usuario)
# <Contador decorator de 'buscar_usuario' — 2 chamada(s)>
```

Isso honra os dois requisitos ao mesmo tempo: `__name__` e `__qualname__` continuam disponíveis para introspecção
programática via `update_wrapper`, e o `repr` comunica o que o objeto realmente é — um decorator com estado — em vez de
fingir ser uma função simples.

A distinção importa especialmente quando o decorator carrega estado observável. Um repr que oculta `chamadas`, `cache`,
ou qualquer outro estado interno priva o desenvolvedor de informação útil no momento em que ele mais precisa dela:
durante o debug.

**Quando usar cada abordagem:**

| Situação                                                   | Escolha                                      |
|------------------------------------------------------------|----------------------------------------------|
| Comportamento puro sem estado (log, timer, validação)      | Decorator de função                          |
| Estado entre chamadas (contador, cache, rate limiter)      | Decorator de classe com `__repr__` explícito |
| Lógica configurável via argumentos                         | Fábrica de decorators                        |

---

## 8. Padrões de Produção — Exemplos Prontos para Usar

Com a mecânica compreendida, esta seção apresenta três decorators que resolvem problemas reais e podem ser adaptados
diretamente em projetos.

### 8.1 Retry Automático com Backoff

Chamadas a serviços externos falham. Redes instáveis, timeouts, rate limiting — são situações normais em produção. Um
decorator de retry encapsula a lógica de re-tentativa sem poluir o código de negócio:

```python
import time
import functools

def retry(max_tentativas: int = 3, delay: float = 1.0, excecoes: tuple = (Exception,)):
    """
    Tenta executar a função até max_tentativas vezes.
    Aguarda delay segundos entre cada tentativa.
    Levanta a exceção original após esgotar as tentativas.
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            for tentativa in range(1, max_tentativas + 1):
                try:
                    return func(*args, **kwargs)
                except excecoes as e:
                    if tentativa == max_tentativas:
                        raise
                    print(
                        f"[RETRY] {func.__name__!r} — tentativa {tentativa}/{max_tentativas} "
                        f"falhou: {e}. Aguardando {delay}s..."
                    )
                    time.sleep(delay)
        return wrapper
    return decorator

@retry(max_tentativas=3, delay=0.5, excecoes=(ConnectionError, TimeoutError))
def chamar_api_pagamentos(payload: dict) -> dict:
    """Envia um pagamento para o processador externo."""
    ...
```

O parâmetro `excecoes` permite especificar quais exceções devem acionar o retry. Erros de programação como `ValueError`
ou `TypeError` não devem ser re-tentados — por isso o padrão não é `Exception` para tudo.

### 8.2 Cache por Memoização

Funções que recebem os mesmos argumentos e produzem sempre o mesmo resultado são candidatas à memoização. O decorator
abaixo ilustra a lógica antes de introduzir a solução da stdlib:

```python
import functools

def memoizar(func):
    """
    Armazena resultados anteriores indexados pelos argumentos.
    Evita recomputação para entradas já vistas.
    """
    cache: dict = {}

    @functools.wraps(func)
    def wrapper(*args):
        if args not in cache:
            cache[args] = func(*args)
        return cache[args]
    return wrapper

@memoizar
def fibonacci(n: int) -> int:
    """Calcula o n-ésimo número de Fibonacci."""
    if n <= 1:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

print(fibonacci(40))   # instantâneo — sem memoização seria exponencial
```

Em projetos reais, use `@functools.lru_cache(maxsize=128)` ou `@functools.cache` (Python 3.9+) — são implementações da
stdlib com controle de tamanho, thread safety e suporte a kwargs. O decorator manual acima serve para compreender o
mecanismo antes de usar a versão pronta.

### 8.3 Validação de Argumentos

Validações de entrada que se repetem em múltiplas funções são candidatas a serem extraídas para um decorator. Isso reduz
duplicação e, como consequência direta, reduz a complexidade ciclomática de cada função — o que já discutimos no 
[artigo sobre Radon](https://bolha.blog/riverfount/complexidade-ciclomatica-em-python-guia-essencial-para-engenheiros-de-software).

```python
import functools

def validar_positivo(func):
    """
    Garante que o primeiro argumento posicional é um número positivo.
    Levanta ValueError com mensagem descritiva caso contrário.
    """
    @functools.wraps(func)
    def wrapper(valor: float, *args, **kwargs):
        if valor <= 0:
            raise ValueError(
                f"{func.__name__!r} exige um valor positivo. "
                f"Recebido: {valor!r}"
            )
        return func(valor, *args, **kwargs)
    return wrapper

@validar_positivo
def calcular_desconto(preco: float, percentual: float) -> float:
    """Calcula o valor após aplicar o desconto."""
    return preco * (1 - percentual / 100)

@validar_positivo
def calcular_frete(peso_kg: float) -> float:
    """Calcula o custo de frete baseado no peso."""
    return peso_kg * 3.5

calcular_desconto(-10.0, 5)
# ValueError: 'calcular_desconto' exige um valor positivo. Recebido: -10.0
```

Cada função de negócio ficou com uma única responsabilidade — o decorator cuidou da guarda de entrada.

---

## 9. Armadilhas Comuns — O que Costuma Dar Errado

**Engolir o retorno da função original**

```python
# Errado — não retorna o resultado
def log(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        func(*args, **kwargs)   # ← sem return
    return wrapper

@log
def somar(a: int, b: int) -> int:
    return a + b

resultado = somar(2, 3)
print(resultado)   # None — o valor foi perdido silenciosamente
```

O Python não avisa sobre isso. A função executa normalmente, mas o valor retornado some. Sempre use 
`return func(*args, **kwargs)` ou armazene em variável antes de retornar.

**Esquecer `functools.wraps`**

Já detalhado na seção 4. O custo de depurar stack traces cheios de `wrapper` em produção é muito maior do que adicionar
uma linha ao decorator.

**Decorar métodos de instância sem considerar `self`**

Decorators que inspecionam o primeiro argumento precisam de atenção ao ser aplicados a métodos:

```python
def validar_id(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        # args[0] aqui é 'self', não o primeiro argumento real do método
        user_id = args[1] if len(args) > 1 else kwargs.get("user_id")
        if not isinstance(user_id, int) or user_id <= 0:
            raise ValueError(f"user_id inválido: {user_id!r}")
        return func(*args, **kwargs)
    return wrapper

class UserService:
    @validar_id
    def buscar(self, user_id: int) -> dict:
        ...
```

O `self` entra como `args[0]`, empurrando os argumentos reais para `args[1]` em diante. Decorators de função que assumem
`args[0]` como primeiro argumento do usuário quebram silenciosamente ao serem aplicados a métodos.

**Stacking na ordem errada**: Como demonstrado na seção 6, inverter a posição de `@autenticar` e `@logar` produz
comportamentos diferentes. Sem um comentário que documente a intenção, a ordem parece arbitrária para quem lê o código
depois.

---

## 10. Checklist de Boas Práticas

| # | Prática | Por quê |
|---|---|---|
| 1 | Sempre use `@functools.wraps(func)` no wrapper interno | Preserva identidade da função em stack traces, docs e ferramentas |
| 2 | Use `*args, **kwargs` no wrapper | Garante compatibilidade com qualquer assinatura de função |
| 3 | Sempre retorne `resultado = func(...)` / `return resultado` | Evita engolir retornos silenciosamente |
| 4 | Prefira decorator de função para comportamento puro | Mais simples, sem overhead de classe |
| 5 | Use decorator de classe quando precisar de estado entre chamadas | `self` é o lugar natural para manter estado |
| 6 | Documente o decorator com docstring | Descreva o que ele adiciona, não o que a função faz |
| 7 | Em stacking, coloque o decorator mais específico mais próximo da função | Torna a cadeia de transformações previsível |
| 8 | Especifique as exceções no retry, não use `Exception` para tudo | Evita re-tentativas em erros de programação |
| 9 | Em decorators de classe, use `functools.update_wrapper(self, func)` | Equivalente ao `@wraps` para instâncias |
| 10 | Documente a ordem em stacking quando ela for semanticamente relevante | Quem lê o código não deve ter que raciocinar sobre a ordem |

---

## 11. Conclusão

Decorators não são mágica. São closures com açúcar sintático — e a sintaxe `@` é apenas uma forma elegante de escrever `funcao = decorator(funcao)`.

Entender isso abre um caminho direto para duas habilidades práticas: saber ler qualquer decorator existente em frameworks e bibliotecas, e saber construir os seus com a estrutura correta desde o início.

Há uma conexão direta com outros princípios já explorados aqui no blog. O `functools.wraps` é a materialização do princípio de [nomear pelo propósito](https://bolha.blog/riverfount/nomear-para-comunicar-como-escrever-variaveis-claras-concisas-e-inteligentes) — sem ele, `__name__` mente para toda ferramenta que depende do nome da função. E decorators que extraem lógica transversal — retry, log, validação, cache — reduzem a complexidade ciclomática das funções de negócio, exatamente o que o `radon` mediria como melhoria no [artigo sobre CC](https://bolha.blog/riverfount/complexidade-ciclomatica-em-python-guia-essencial-para-engenheiros-de-software).

Um decorator bem escrito é invisível: a função de negócio comunica sua intenção, e o comportamento adicional está encapsulado, testável e reutilizável. É código que se explica por si só — e isso é poder puro na engenharia de software.

Se este artigo te fez repensar como você aplica comportamento transversal no seu código, compartilhe o decorator mais criativo que já escreveu: **[@riverfount@bolha.us](https://bolha.us/@riverfount)**
