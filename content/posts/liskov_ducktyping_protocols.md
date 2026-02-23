+++
date = '2025-11-11'
draft = false
title = 'Liskov, Duck Typing e Protocolos: Como Python Transforma o Princípio de Substituição'
+++
No mundo da programação orientada a objetos, o Princípio de Substituição de Liskov (LSP) é um guia essencial para criar sistemas robustos e flexíveis. Porém, em Python, esse princípio ganha uma nuance especial graças ao **duck typing** e aos **protocolos**, que mudam completamente a forma como pensamos em substituição e hierarquia. 

Neste post, vamos explorar como esses conceitos se entrelaçam, por que o LSP faz tanto sentido na linguagem pythonica e como seu entendimento ajuda a escrever códigos mais limpos, seguros e reutilizáveis — tudo isso sem depender exclusivamente de herança formal. Prepare-se para olhar para o LSP através das lentes de Python e descobrir ferramentas poderosas para o design de software elegante e eficiente.

## LSP e Duck Typing: O Poder do Comportamento

Em linguagens estaticamente tipadas, o LSP está intimamente ligado à hierarquia de classes e à herança formal. Já em Python, graças ao duck typing, não é a herança que define a possibilidade de substituição, mas o comportamento do objeto. Se um objeto "grasna" e "anda" como um pato, ele pode ser tratado como um pato, independentemente de sua árvore de classes.

Exemplo simples:

```python
class PatoReal:
    def voar(self):
        print("Voando!")

    def grasnar(self):
        print("Quack!")

class PatoDeBorracha:
    def voar(self):
        raise NotImplementedError("Não posso voar")

    def grasnar(self):
        print("Squeak!")

def fazer_o_pato_grasnar(pato):
    pato.grasnar()

pato_real = PatoReal()
pato_borracha = PatoDeBorracha()

fazer_o_pato_grasnar(pato_real)   # Quack!
fazer_o_pato_grasnar(pato_borracha)  # Squeak!
```

Aqui, ambos os objetos possuem o método `grasnar()`, então o código funciona para ambos. No entanto, o método `voar()` do `PatoDeBorracha` quebra a expectativa do comportamento esperado, violando o LSP caso o código cliente dependa dele.

## Protocolos e o Contrato Explícito

Os protocolos (introduzidos com PEP 544) formalizam essa ideia apresentando um tipo estrutural onde uma "interface" é definida pelo conjunto de métodos que um objeto deve implementar para ser considerado um subtipo daquele protocolo. Diferente da herança tradicional, o protocolo não exige que a classe declare que o implementa explicitamente; ele verifica a compatibilidade estrutural.

Exemplo com protocolo:

```python
from typing import Protocol

class Pato(Protocol):
    def voar(self) -> None:
        ...
    def grasnar(self) -> None:
        ...

class PatoReal:
    def voar(self) -> None:
        print("Voando!")

    def grasnar(self) -> None:
        print("Quack!")

class PatoDeBorracha:
    def voar(self) -> None:
        raise NotImplementedError("Não posso voar")

    def grasnar(self) -> None:
        print("Squeak!")

def fazer_o_pato_voar(pato: Pato) -> None:
    pato.voar()

fazer_o_pato_voar(PatoReal())    # Voando!
fazer_o_pato_voar(PatoDeBorracha())  # Erro: viola LSP
```

O protocolo `Pato` define claramente o contrato esperado. Substituir um `PatoReal` por `PatoDeBorracha` falha porque `PatoDeBorracha` não mantém a garantia do método `voar`.

## Interseção do LSP com Duck Typing e Protocolos

- O LSP reforça que substitutos devem manter o contrato de comportamento original.
- Duck typing foca na existência desse comportamento ao invés da herança.
- Protocolos formalizam esse contrato, tornando explícita a interface esperada.
- Em Python, usar protocolos deixa mais claro onde o LSP pode ser inadvertidamente violado, especialmente em projetos maiores.

## Benefícios Práticos

- Evita exceções inesperadas ou falhas ao substituir objetos que não mantêm o contrato.
- Permite maior flexibilidade, pois não é necessária herança pura para garantir substituibilidade.
- Facilita a manutenção e extensibilidade com tipos mais expressivos e contratos claros.
- Compatibiliza com a filosofia pythonica de código explícito, porém flexível.

Dessa forma, o LSP em Python é mais um guia para respeitar o comportamento esperado, alinhado naturalmente com a dinâmica do duck typing e o rigor dos protocolos, garantindo que seu código seja ao mesmo tempo flexível, seguro e fácil de estender.

Contate-nos no Mastodon em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
