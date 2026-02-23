+++
date = '2025-11-12'
draft = true
title = 'Segregação de Interfaces em Python: projetando contratos enxutos com ABC e Protocol'
+++
O Princípio da Segregação de Interfaces (ISP — Interface Segregation Principle) é um dos pilares do SOLID e trata diretamente da qualidade dos contratos entre componentes. Em essência, ele afirma que uma classe não deve ser obrigada a depender de métodos que não utiliza. Essa regra incentiva o desenho de interfaces menores, mais coesas e representativas de um papel específico no sistema.

Na prática, o ISP força uma reflexão arquitetural: qual é a verdadeira responsabilidade dessa abstração? Se a resposta envolve comportamentos heterogêneos, a interface provavelmente está concentrando demasiadas responsabilidades — um sinal de design frágil e baixo reuso.

## O problema das interfaces genéricas

Considere um caso comum: um módulo que define uma interface genérica de “dispositivo multifuncional”. Ela impõe à hierarquia de classes um contrato extenso, mesmo que nem todas as implementações precisem de todas as operações.

```python
from abc import ABC, abstractmethod

class MultiFunctionDevice(ABC):
    @abstractmethod
    def print_document(self, document): pass

    @abstractmethod
    def scan_document(self, document): pass

    @abstractmethod
    def fax_document(self, document): pass


class BasicPrinter(MultiFunctionDevice):
    def print_document(self, document):
        print(f"Imprimindo: {document}")

    def scan_document(self, document):
        raise NotImplementedError("Este dispositivo não suporta digitalização")

    def fax_document(self, document):
        raise NotImplementedError("Este dispositivo não envia fax")
```

Aqui, `BasicPrinter` viola o ISP porque é forçada a implementar métodos irrelevantes. Qualquer alteração em `MultiFunctionDevice` pode afetar classes que não deveriam ter relação entre si.

## Refinando o design com interfaces específicas

Para evitar esse problema, segmentamos as interfaces em abstrações menores e mais focadas:

```python
from abc import ABC, abstractmethod

class Printable(ABC):
    @abstractmethod
    def print_document(self, document): pass

class Scannable(ABC):
    @abstractmethod
    def scan_document(self, document): pass

class Faxable(ABC):
    @abstractmethod
    def fax_document(self, document): pass


class BasicPrinter(Printable):
    def print_document(self, document):
        print(f"Imprimindo: {document}")


class MultiFunctionPrinter(Printable, Scannable, Faxable):
    def print_document(self, document):
        print(f"Imprimindo: {document}")

    def scan_document(self, document):
        print(f"Digitalizando: {document}")

    def fax_document(self, document):
        print(f"Enviando fax: {document}")
```

Cada interface é coesa e independente. As classes agora implementam apenas as operações relevantes às suas funcionalidades, reduzindo o acoplamento e melhorando a clareza estrutural.

## Abordagem moderna com typing.Protocol

A partir do Python 3.8, `typing.Protocol` permite expressar contratos comportamentais baseados em **tipagem estrutural** (também chamada de _duck typing verificado estaticamente_). Esse recurso é especialmente compatível com o ISP, pois elimina a necessidade de herança explícita para validar conformidade de tipo.

```python
from typing import Protocol

class Printable(Protocol):
    def print_document(self, document: str) -> None: ...

class Scannable(Protocol):
    def scan_document(self, document: str) -> None: ...


class BasicPrinter:
    def print_document(self, document: str) -> None:
        print(f"Imprimindo: {document}")


class SmartDevice:
    def print_document(self, document: str) -> None:
        print(f"Imprimindo: {document}")

    def scan_document(self, document: str) -> None:
        print(f"Digitalizando: {document}")


def print_any(printer: Printable, content: str) -> None:
    printer.print_document(content)
```

Observe que `BasicPrinter` e `SmartDevice` não herdam explicitamente de `Printable` ou `Scannable`, mas o _type checker_ reconhecerá ambas as classes como compatíveis por possuírem os métodos exigidos. Essa abordagem é vantajosa porque:

- Mantém baixo acoplamento entre tipos, reforçando a aplicação do ISP.
- Usa duck typing com suporte de tipagem estática (útil em ferramentas como `mypy`).
- Favorece design evolutivo; novos comportamentos podem ser adicionados a outras classes sem quebrar a hierarquia.

Assim, `Protocol` é a forma moderna e idiomática de aplicar o ISP em projetos Python, tornando clara a separação de responsabilidades e preservando a flexibilidade da linguagem.

## Conclusão

O ISP é mais que um princípio de design: é uma diretriz para compor sistemas orientados a abstrações coesas e independentes. No ecossistema Python, a evolução da tipagem com `abc` e `Protocol` oferece duas formas complementares de expressar esse princípio — uma baseada em herança nominal, outra em compatibilidade estrutural.

Projetar interfaces enxutas e especializadas é um ato de disciplina arquitetural: reduz o impacto de mudanças, aumenta a clareza e favorece a manutenibilidade a longo prazo. Em times maduros, a aplicação do ISP reflete um domínio avançado de separação de responsabilidades e uma compreensão profunda da dinâmica entre contrato e implementação.

Contate-nos no Mastodon em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
