+++
date = '2025-11-10'
draft = false
title = 'Como o Princípio Aberto-Fechado Pode Transformar Seu Código Python'
+++
O Princípio Aberto-Fechado (Open-Closed Principle), um dos pilares do SOLID, é essencial para quem busca escrever código Python orientado a objetos mais flexível, escalável e de fácil manutenção. Ele estabelece que entidades de software — como classes, módulos e funções — devem estar abertas para extensão, mas fechadas para modificação.  
Em outras palavras, o comportamento do sistema deve poder evoluir sem necessidade de alterar o código existente.

## Entendendo o Princípio Aberto-Fechado

- **Aberto para extensão** significa que o sistema pode adquirir novas funcionalidades.
- **Fechado para modificação** significa que essas melhorias não devem exigir alterações nas implementações originais, reduzindo a chance de regressões e preservando a integridade do código já testado.

Em Python, a aplicação desse princípio está fortemente relacionada ao uso de **abstrações**, **polimorfismo** e **injeção de dependências**. Projetar para interfaces (ou classes abstratas) é o caminho para permitir evolução sem quebrar funcionalidades existentes.

## Exemplo Clássico: Onde o OCP é Quebrado

```python
class Calc:
    def operacao(self, tipo, a, b):
        if tipo == "soma":
            return a + b
        elif tipo == "subtracao":
            return a - b
        # E assim por diante...

```

Esse design é comum, mas viola o princípio: sempre que surgir uma nova operação, o método **operacao** precisará ser alterado. Quanto mais lógica for adicionada, mais frágil e mais difícil de testar o código se tornará.

## Aplicando o OCP com Polimorfismo

Podemos refatorar usando uma hierarquia de classes, permitindo adicionar novas operações sem modificar código existente:

```python
from abc import ABC, abstractmethod

class Operacao(ABC):
    @abstractmethod
    def calcular(self, a, b):
        pass

class Soma(Operacao):
    def calcular(self, a, b):
        return a + b

class Subtracao(Operacao):
    def calcular(self, a, b):
        return a - b


def executar_operacao(operacao: Operacao, a, b):
    return operacao.calcular(a, b)


# Uso:
resultado = executar_operacao(Soma(), 2, 3)
```
Agora, para adicionar uma nova operação — por exemplo, uma multiplicação — basta criar uma nova subclasse:

```python
class Multiplicacao(Operacao):
    def calcular(self, a, b):
        return a * b
```
Nenhuma modificação no código principal é necessária. Isso torna o design mais estável, previsível e fácil de evoluir.

## Onde o OCP Brilha na Prática

- **Regras de negócio variáveis**: Cálculo de comissões, descontos ou impostos que variam conforme o tipo de cliente ou o contrato.
- **Estratégias de notificação**: Diferentes canais (email, SMS, push, WhatsApp) com uma interface comum.
- **Sistemas de plugins**: Ferramentas extensíveis em que cada plugin adiciona comportamento por meio de subclasses.

Aliás, o padrão **Strategy** é uma aplicação direta do OCP, permitindo selecionar comportamentos em tempo de execução sem alterar código central.

## Por Que Adotar o OCP

- Facilita a **evolução do sistema** sem comprometer código validado.
- Reduz o **acoplamento** e incentiva abstrações limpas.
- Melhora a **testabilidade**, pois cada comportamento é isolado em sua própria classe.
- Promove um **design mais profissional**, típico de projetos Python maduros.

Projetar com o Princípio Aberto-Fechado é dar um passo estratégico rumo a um código mais sustentável, que cresce com o produto — e não contra ele.

Contate-nos no Mastodon em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
