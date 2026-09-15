---
title: 'O CI trava em lint antes de chegar no teste'
date: 2026-09-14
draft: false
tags: ['python', 'ruff', 'lint', 'ci', 'produtividade']
cover:
  image: 'images/covers/cover-ruff-lint-ci.png'
  alt: 'O CI trava em lint antes de chegar no teste'
  relative: false
---

Um pipeline de CI que ajudei a diagnosticar recentemente levava quatro minutos e meio para chegar no primeiro teste. Não quatro minutos e meio de suíte de testes: quatro minutos e meio de lint. `flake8` rodando as regras de estilo, `black --check` validando formatação, `isort --check` conferindo ordem de imports, `pylint` fechando a lista com suas próprias verificações de design. Quatro processos Python inicializando, cada um lendo a árvore inteira do projeto, cada um com seu próprio cache (quando tinha cache configurado), cada um bloqueando o passo seguinte do workflow.

O problema não é que essas ferramentas sejam ruins. `black` formata bem, `isort` organiza imports de forma previsível, `pylint` pega coisas que o resto ignora. O problema é a soma: quatro binários Python, quatro tempos de inicialização do interpretador, quatro passadas pela árvore de arquivos, para resolver um conjunto de checagens que, na prática, se sobrepõe bastante.

<!--more-->

```yaml
# .github/workflows/ci.yml (antes)
jobs:
  lint:
    steps:
      - run: uv run flake8 src/
      - run: uv run black --check src/
      - run: uv run isort --check src/
      - run: uv run pylint src/
  test:
    needs: lint
    steps:
      - run: uv run pytest
```

O job de `test` fica esperando o de `lint` terminar. Em um projeto de porte médio (uns 40 mil linhas, múltiplos pacotes internos), esses quatro passos somados passavam dos quatro minutos citados acima, quase sempre para detectar problemas triviais: um import fora de ordem, uma linha passando de 88 caracteres, uma docstring faltando. Nada que devesse competir por atenção com o resultado da suíte de testes, que é o que realmente importa nesse pipeline.

## Quatro ferramentas resolvendo o mesmo problema

`flake8`, `black`, `isort` e boa parte do que `pylint` cobre atacam a mesma camada: análise estática de um arquivo Python, sem executar nada. A diferença entre eles está no conjunto de regras e no formato de saída, não na natureza do trabalho. Isso significa que dá para consolidar sem perder cobertura, desde que a ferramenta nova implemente (ou tenha equivalente para) as regras que o time já depende.

É exatamente o espaço que o `ruff` ocupa. É um linter e formatter escrito em Rust que reimplementa as regras do `pyflakes`, boa parte do `pycodestyle`, o comportamento de ordenação do `isort`, a formatação do `black` (com compatibilidade declarada de cerca de 99%) e um conjunto grande de plugins populares do ecossistema flake8 (`flake8-bugbear`, `flake8-comprehensions`, `flake8-simplify`, entre outros), tudo em um único binário.

Instalação segue o padrão do projeto:

```bash
uv add --dev ruff
```

## Migrando de fato

A configuração antiga costuma estar espalhada entre `setup.cfg`, `.flake8`, um bloco `[tool.isort]` no `pyproject.toml` e talvez um `.pylintrc`. A migração para `ruff` centraliza tudo em uma seção só:

```toml
[tool.ruff]
line-length = 88
target-version = "py312"

[tool.ruff.lint]
select = [
    "E",   # pycodestyle
    "F",   # pyflakes
    "I",   # isort
    "B",   # flake8-bugbear
    "UP",  # pyupgrade
]
ignore = ["E501"]  # comprimento de linha já é tratado pelo formatter

[tool.ruff.format]
quote-style = "double"
```

`ruff check .` substitui `flake8` e a checagem do `isort` na mesma passada. `ruff format .` substitui `black`. E como as duas operações compartilham o mesmo parser e a mesma árvore sintática internamente, não existe o risco (comum na combinação flake8 + black) de uma ferramenta reclamar de algo que a outra acabou de corrigir.

O CI consolidado fica assim:

```yaml
# .github/workflows/ci.yml (depois)
jobs:
  lint:
    steps:
      - run: uv run ruff check .
      - run: uv run ruff format --check .
  test:
    needs: lint
    steps:
      - run: uv run pytest
```

No mesmo projeto de 40 mil linhas citado no início, os dois passos combinados do `ruff` rodam em menos de um segundo. Os quatro minutos e meio viraram parte do orçamento de tempo do `pytest`, que é o que de fato merece essa atenção.

Para o loop local o ganho é parecido: `ruff check --fix .` corrige boa parte dos problemas automaticamente (imports não usados, ordenação, várias das regras do bugbear) sem precisar rodar três comandos em sequência. Em pre-commit, isso significa um hook a menos brigando com outro:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.15.21
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format
```

## O que o ruff não resolve

Consolidar lint e formatação não elimina a necessidade de outras camadas de análise estática. `ruff` não faz checagem de tipos: `mypy` (ou o `ty`, o checker de tipos que a Astral vem desenvolvendo em paralelo ao `ruff` e que ainda está em estágio inicial) continua sendo uma ferramenta separada no pipeline.

Também vale conferir a paridade de regras antes de remover o `pylint` de uma vez. Ele tem checagens de design (complexidade ciclomática, número de argumentos, acoplamento entre classes) que só parcialmente têm equivalente no conjunto de regras do `ruff`. Rodar `ruff check --select ALL` num projeto existente e comparar com a saída atual do `pylint` é o jeito mais seguro de descobrir o que ficaria sem cobertura antes de tirar a ferramenta antiga do pipeline.

Nenhuma dessas ressalvas justifica manter quatro processos fazendo o trabalho que um resolve rápido o suficiente para não aparecer no tempo total do CI. Só significa que a migração merece uma conferência de regras, não um `uv remove` às cegas nas ferramentas antigas.

---

Se alguém já passou por essa migração ou tem ressalvas sobre regras de `pylint` que ficaram para trás, comento sempre no Fediverse: **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
