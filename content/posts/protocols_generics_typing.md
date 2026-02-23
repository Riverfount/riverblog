+++
date = '2025-11-21'
draft = true
title = 'Protocols, Generics e Typing Avançado em Python: Técnicas para Construir Aplicações Robústas e Manuteníveis'
+++
Este artigo aborda como usar funcionalidades avançadas de tipagem em Python, como _Protocols_, _Generics_ e técnicas avançadas de _typing_, para criar aplicações escaláveis, flexíveis e de fácil manutenção.

## Protocols: Contratos Flexíveis e Estruturais

Protocols permitem definir contratos de métodos e propriedades sem herança explícita, facilitando a interoperabilidade entre microserviços. Qualquer classe que implemente os métodos definidos no protocolo pode ser usada onde esse protocolo é esperado.

Exemplo prático:

```python
from typing import Protocol

class Serializer(Protocol):
    def serialize(self) -> bytes:
        pass

class JsonSerializer:
    def serialize(self) -> bytes:
        return b'{"user": "alice"}'

class XmlSerializer:
    def serialize(self) -> bytes:
        return b'<user>alice</user>'

def send_data(serializer: Serializer) -> None:
    data = serializer.serialize()
    print(f"Enviando dados: {data}")

send_data(JsonSerializer())
send_data(XmlSerializer())
```

Neste exemplo, `send_data` aceita qualquer objeto que implemente o método `serialize`, garantindo baixo acoplamento e flexibilidade.

## Generics: Componentes Reutilizáveis e Tipados

Generics permitem criar classes e funções genéricas que mantêm a segurança de tipos, facilitando a modularidade.

Exemplo de repositório genérico:

```python
from typing import TypeVar, Generic, List

T = TypeVar('T')

class Repository(Generic[T]):
    def __init__(self) -> None:
        self._items: List[T] = []

    def add(self, item: T) -> None:
        self._items.append(item)

    def get_all(self) -> List[T]:
        return self._items

class User:
    def __init__(self, username: str) -> None:
        self.username = username

user_repo = Repository[User]()
user_repo.add(User("alice"))
for user in user_repo.get_all():
    print(user.username)
```

Este padrão permite criar repositórios ou caches que funcionam com qualquer tipo de objeto, aumentando a reutilização e segurança de tipos.

## Tipagem Avançada: Operador | e Literal

Prefira o operador `|` para tipos alternativos ao invés de `Union` e use `Literal` para valores fixos, reforçando contratos claros.

Exemplo:

```python
from typing import Literal

def login(role: Literal['admin', 'user', 'guest']) -> str:
    if role == 'admin':
        return "Acesso total"
    elif role == 'user':
        return "Acesso limitado"
    return "Acesso restrito"

print(login('admin'))  # Acesso total
```

Isso aumenta a legibilidade e reduz riscos de erro nas chamadas de função.

## Conclusão

Combinando _Protocols_, _Generics_ e tipagem avançada, é possível construir aplicações com contratos claros, flexíveis e robustos, facilitando o trabalho em times desacoplados e a manutenção do código.

Essas práticas elevam a qualidade do código e tornam os sistemas mais escaláveis e confiáveis, sendo indispensáveis para desenvolvedores focados em arquiteturas modernas, principalmente as de microserviços.

Contate-nos no Mastodon em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
