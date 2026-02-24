+++
date = '2025-12-29'
draft = false
title = 'PLR2004 na prática: por que evitar números mágicos em expressões booleanas em Python'
tags = ["python", "clean-code", "ferramentas"]
+++
Evitar números mágicos em expressões booleanas é uma recomendação explícita de linters Python modernos (como Pylint e Ruff, via regra PLR2004), pois esses valores dificultam a leitura e a manutenção do código.  Entender essa regra e o contexto em que ela surgiu ajuda a justificar a prática ao time e a padronizar o estilo da base de código.

## PLR2004: de onde vem essa regra?

A sigla **PLR2004** é o identificador da regra *magic-value-comparison* em ferramentas de lint para Python, como o linter Ruff, que reutiliza a numeração herdada do Pylint.  A regra é derivada diretamente da mensagem de refatoração **R2004 – magic-value-comparison** do Pylint, mantido pelo projeto PyCQA, que incentiva o uso de constantes nomeadas em vez de valores mágicos em comparações.

Na documentação do Ruff, a PLR2004 é descrita como uma verificação que detecta o uso de constantes numéricas “mágicas” em comparações, sugerindo substituí-las por variáveis constantes, justamente para melhorar legibilidade e manutenibilidade.  A própria descrição enfatiza que o uso de valores mágicos é desencorajado pelas diretrizes de estilo PEP 8.

## O que a PLR2004 considera um “magic value”

A regra PLR2004 inspeciona comparações como `==`, `!=`, `<`, `>`, `<=` e `>=` em busca de literais numéricos sem nome, tratando-os como *magic values* quando representam algo além de números triviais.  A documentação do Ruff destaca que esses valores tornam o código mais difícil de ler, pois o significado precisa ser inferido apenas pelo contexto, e recomenda o uso de constantes nomeadas.

Por conveniência, a regra costuma ignorar alguns valores muito comuns, como `0`, `1` e `""`, que aparecem em operações idiomáticas, mas ainda assim permite configurar uma *allowlist* de valores aceitáveis para cenários específicos.  Essa flexibilidade existe porque, em certos domínios, números como `90`, `180` ou `360` deixam de ser “mágicos” e passam a ser parte da linguagem natural do problema (por exemplo, ângulos em graus).

## Por que números mágicos atrapalham em expressões booleanas

Em expressões booleanas, o problema dos números mágicos fica mais evidente, porque a condição deveria comunicar a regra de negócio de forma clara.  Ao escrever algo como `if status == 2:`, o leitor não sabe, de imediato, o que `2` representa: ativo, suspenso, cancelado?

A documentação do Pylint para **magic-value-comparison / R2004** afirma que usar constantes nomeadas em vez de valores mágicos melhora a legibilidade e a manutenibilidade do código.  Quando o valor de negócio muda (por exemplo, o status “ativo” deixa de ser 2 e passa a ser 3), o uso de literais espalhados exige uma busca manual sujeita a erro, enquanto uma constante única permite a mudança em um único ponto.

## Exemplos em Python aplicando a PLR2004

### Exemplo ruim: números mágicos em comparações

```python
def can_access_admin_area(user_role: int) -> bool:
    # 1 = admin, 2 = editor, 3 = viewer
    return user_role == 1
```

Nesse caso, a PLR2004 sinalizaria o `1` como um *magic value* na comparação, sugerindo a extração para uma constante com nome significativo.

### Exemplo melhor: constante nomeada

```python
ADMIN_ROLE_ID = 1

def can_access_admin_area(user_role: int) -> bool:
    return user_role == ADMIN_ROLE_ID
```

Aqui, a expressão booleana se explica sozinha e a ferramenta de lint não acusa a regra PLR2004, pois o valor numérico está encapsulado em uma constante nomeada.[2][1]

### Exemplo ruim: múltiplos valores mágicos

```python
def is_valid_retry(status_code: int, retries: int) -> bool:
    # 200: OK; 500: erro interno; 3: máximo de tentativas
    return status_code != 200 and status_code != 500 and retries < 3
```

Esse padrão é exatamente o tipo de uso que a regra **magic-value-comparison (PLR2004)** se propõe a detectar.

### Exemplo melhor: constantes de domínio

```python
HTTP_OK = 200
HTTP_INTERNAL_ERROR = 500
MAX_RETRIES = 3

def is_valid_retry(status_code: int, retries: int) -> bool:
    return status_code not in (HTTP_OK, HTTP_INTERNAL_ERROR) and retries < MAX_RETRIES
```

Agora cada número tem um nome de domínio, a intenção da condição é clara e a manutenção futura fica concentrada nas constantes.

### Exemplo com Enum para estados

```python
from enum import Enum, auto

class UserStatus(Enum):
    INACTIVE = auto()
    ACTIVE = auto()
    SUSPENDED = auto()

def is_active(status: UserStatus) -> bool:
    return status is UserStatus.ACTIVE
```

Ao usar `Enum`, o código evita completamente comparações numéricas, eliminando o gatilho da PLR2004 e expressando a lógica booleana em termos de estados de negócio.

## Conclusão: aproveite PLR2004 a seu favor

A regra **PLR2004 (magic-value-comparison)**, definida originalmente no Pylint e incorporada pelo linter Ruff, existe justamente para forçar a substituição de números mágicos por constantes e construções semânticas em comparações.  Em vez de encarar o aviso como ruído, é possível usá-lo como guia de refatoração para deixar suas expressões booleanas mais claras, consistentes e fáceis de evoluir.

Compartilhe comigo em **[@riverfount@bolha.us](https://bolha.us/@riverfount)** como você lida com números mágicos.
