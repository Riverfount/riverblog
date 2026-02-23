+++
date = '2025-11-24'
draft = false
title = 'Usando Abstract Base Classes (ABC) em Projetos Reais de Python: Um Exemplo Prático com Microserviços'
+++
Este artigo mostra como aplicar Abstract Base Classes (ABC) em um projeto real robusto, focado no desenvolvimento de microserviços. O objetivo é garantir clareza, contratos explícitos e extensibilidade, aliando os conceitos a práticas modernas.

## Contexto do Projeto

Imagine um sistema de microserviços para gerenciamento de pedidos, em que diferentes serviços precisam manipular objetos que representam entidades diversas, como `Pedido` e `Cliente`. Queremos garantir que todas as entidades sigam um contrato explícito para operações comuns (ex.: obter ID, validação). Além disso, há um repositório genérico para armazenar dados dessas entidades com verificação de tipo.

## Definição da ABC para Entidades

Criamos uma Abstract Base Class chamada `Entity` com métodos abstratos para garantir que toda entidade implemente os comportamentos necessários:

```python
from abc import ABC, abstractmethod

class Entity(ABC):
    @abstractmethod
    def id(self) -> int:
        """Retorna o identificador único da entidade."""
        pass

    @abstractmethod
    def validate(self) -> bool:
        """Valida as regras de negócio da entidade."""
        pass
```

## Implementação Concreta das Entidades

Exemplo de uma entidade `Order` (Pedido) que implementa a ABC e regras específicas:

```python
class Order(Entity):
    def __init__(self, order_id: int, total: float) -> None:
        self._order_id = order_id
        self.total = total

    def id(self) -> int:
        return self._order_id

    def validate(self) -> bool:
        # Validação simples: total não pode ser negativo
        return self.total >= 0
```

Outro exemplo com `Customer` (Cliente):

```python
class Customer(Entity):
    def __init__(self, customer_id: int, email: str) -> None:
        self._customer_id = customer_id
        self.email = email

    def id(self) -> int:
        return self._customer_id

    def validate(self) -> bool:
        # Validação simples: e-mail deve conter '@'
        return '@' in self.email
```

## Repositório Genérico para Armazenar Entidades Validando Antes

A seguir, um repositório que aceita apenas entidades válidas, usando o tipo genérico limitado para `Entity`:

```python
from typing import TypeVar, Generic, List

T = TypeVar('T', bound=Entity)

class Repository(Generic[T]):
    def __init__(self) -> None:
        self._items: List[T] = []

    def add(self, item: T) -> None:
        if not item.validate():
            raise ValueError(f"Invalid entity: {item}")
        self._items.append(item)

    def get_by_id(self, entity_id: int) -> T | None:
        for item in self._items:
            if item.id() == entity_id:
                return item
        return None

    def get_all(self) -> List[T]:
        return self._items
```

## Uso Prático no Microserviço

```python
def main():
    order_repo = Repository[Order]()
    customer_repo = Repository[Customer]()

    order = Order(1, 150.0)
    invalid_order = Order(2, -10.0)  # Total inválido

    customer = Customer(1, "user@example.com")
    invalid_customer = Customer(2, "invalid_email")  # E-mail inválido

    order_repo.add(order)
    try:
        order_repo.add(invalid_order)
    except ValueError as e:
        print(e)

    customer_repo.add(customer)
    try:
        customer_repo.add(invalid_customer)
    except ValueError as e:
        print(e)

    print("Pedidos:")
    for o in order_repo.get_all():
        print(f"ID: {o.id()}, Total: {o.total}")

    print("Clientes:")
    for c in customer_repo.get_all():
        print(f"ID: {c.id()}, Email: {c.email}")

if __name__ == "__main__":
    main()
```

## Benefícios desse padrão no projeto real

* **Contratos explícitos:** A ABC obriga à implementação dos métodos `id` e `validate`.

* **Segurança em tempo de execução:** Objetos inválidos não serão adicionados ao repositório.

* **Reuso e manutenibilidade:** O repositório é genérico e reutilizável com qualquer entidade.

* **Facilidade para testes:** É simples isolar e testar entidades e repositórios separadamente.

* **Escalabilidade:** Novas entidades podem ser criadas seguindo o contrato, sem mudanças na infraestrutura do repositório.

## Conclusão

Esta abordagem demonstra o poder das ABCs combinadas com generics e tipagem avançada, garantindo sistemas Python mais estruturados, robustos e suscetíveis a erros minimizados, essenciais para microserviços confiáveis e manteníveis. Se desejar, posso aprofundar a integração com outros padrões ou frameworks.

Comparilhe sua experiência com ABC's em Python, você nos encontra no Mastodon em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
