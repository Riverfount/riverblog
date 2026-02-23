+++
date = '2025-12-22'
draft = false
title = 'Pattern Matching em Python: Revolucione seu Código Além do Switch Case Tradicional'
+++
Descubra como o **pattern matching** no Python 3.10+ transforma árvores de if/elif em código declarativo e poderoso, superando limitações do switch case clássico. Neste guia técnico para desenvolvedores Python, explore exemplos práticos de destructuring de listas, dicionários e classes, guards e padrões compostos – otimizado para buscas como "pattern matching Python tutorial", "match case vs switch Python" e "structural pattern matching exemplos".

## O que Torna o Pattern Matching Único

Introduzido pelos PEPs 634, 635 e 636 no Python 3.10, o `match`/`case` vai além da comparação de valores: descreve a **estrutura** de dados, desconstruindo tuplas, listas, dicionários e objetos em variáveis prontas para uso. Diferente do switch case de C/Java, que compara apenas escalares sem fallthrough automático, aqui o primeiro case que casa encerra o bloco, eliminando bugs comuns. Ideal para APIs REST, eventos JSON e parsers em projetos full-stack Python.

## Sintaxe Básica vs Switch Case

Exemplo clássico de dias da semana, similar a um switch mas com OR nativo (`|`) e wildcard (`_`):

```python
def weekday_name(day: int) -> str:
    match day:
        case 1:
            return "Segunda-feira"
        case 2 | 3 | 4 | 5:
            return "Dia útil"
        case 6 | 7:
            return "Fim de semana"
        case _:
            raise ValueError(f"Dia inválido: {day}")
```

Sem `break` necessário – o case para automaticamente. Switch tradicional exigiria enum ou strings com fallthrough manual.

## Destructuring: Poder Estrutural

O diferencial: padrões que capturam partes de estruturas compostas.

### Tuplas e Listas
```python
def process_point(point):
    match point:
        case (0, 0):
            return "Origem"
        case (0, y):
            return f"Eixo Y: {y}"
        case (x, 0):
            return f"Eixo X: {x}"
        case (x, y):
            return f"Ponto: ({x}, {y})"
        case [x, y, *rest]:
            return f"Lista longa: inicia {x},{y} + {len(rest)}"
        case _:
            raise TypeError("Formato inválido")
```
Captura variáveis diretamente, sem indexação manual – impossível em switch puro.

### Dicionários e Eventos
```python
def handle_event(event: dict):
    match event:
        case {"type": "click", "x": x, "y": y}:
            return f"Clique em ({x}, {y})"
        case {"type": "user", "id": uid}:
            return f"Usuário {uid}"
        case _:
            return "Ignorado"
```
Perfeito para payloads HTTP/JSON em Flask ou FastAPI.

### Classes e Dataclasses
```python
from dataclasses import dataclass

@dataclass
class CreateUser:
    email: str

@dataclass
class DeleteUser:
    id: int

def dispatch(cmd):
    match cmd:
        case CreateUser(email=email):
            return f"Criar: {email}"
        case DeleteUser(id=uid):
            return f"Excluir: {uid}"
```
Desconstrói atributos por nome – switch não acessa objetos assim.

## Guards e Padrões Compostos

Combine matching com condições (`if`) e OR:
```python
def classify(num: int):
    match num:
        case 0:
            return "Zero"
        case x if x > 0:
            return "Positivo"
        case x if x % 2 == 0:
            return "Par negativo"
        case _:
            return "Ímpar negativo."
```
Guards executam pós-captura, mantendo lógica coesa – superior a ifs externos em switches.

## Vantagens sobre Switch Case

| Aspecto              | Switch Case (C/Java)          | Pattern Matching Python      |
|----------------------|-------------------------------|------------------------------|
| Comparação           | Valores escalares            | Estrutura + valores [4] |
| Destructuring        | Não                          | Sim (listas/objetos) [1]|
| Guards/Condições     | Externo                      | Integrado no case [2]   |
| Fallthrough          | Manual (break)               | Automático [8]          |
| Casos Múltiplos      | Labels separados             | `|` inline [3]          |

Reduz if/elif verbosos em 50-70% para roteamento de dados.

Adote pattern matching em seus projetos Python para código mais legível e robusto. Teste os exemplos acima no seu ambiente e compartilhe comigo em **[@riverfount@bolha.us](https://bolha.us/@riverfount)** qual use case você vai aplicar primeiro. Para mais tutoriais avançados em Python, Spring Boot ou microservices, inscreva-se ou pergunte aqui!