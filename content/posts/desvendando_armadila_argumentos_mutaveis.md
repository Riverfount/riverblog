+++
date = '2025-11-19'
draft = false
title = 'Desvendando a Armadilha dos Argumentos Mutáveis como Default em Python'
+++
Você já enfrentou resultados inesperados ao usar listas ou dicionários como valores padrão em funções Python? Esse é um problema comum que pode causar bugs sutis e difíceis de encontrar. Neste artigo técnico, vamos desmistificar o motivo desse comportamento, mostrando exemplos práticos e como evitá-lo com boas práticas de programação. Se você é um desenvolvedor Python buscando produzir código mais robusto e previsível, este conteúdo é essencial para o seu dia a dia.


## Evitando Surpresas

Ao definir funções em Python, usar valores padrão em argumentos é comum para facilitar chamadas. Contudo, quando o valor padrão é um tipo mutável, como listas ou dicionários, isso pode causar efeitos inesperados. Vamos analisar exemplos para entender esse comportamento.

### Exemplo Problemático: Lista Mutável como Valor Padrão

```python
def add_item(item, lista=[]):
    lista.append(item)
    return lista

print(add_item('maçã'))    # Saída esperada: ['maçã']
print(add_item('banana'))  # Saída inesperada: ['maçã', 'banana']
```

Aqui, o segundo `print` adiciona o item 'banana' à mesma lista usada na primeira chamada, porque o objeto `lista` padrão foi criado uma vez e reutilizado. Isso acontece porque argumentos padrão são avaliados apenas na definição da função.

### Corrigindo com `None` como Valor Padrão

A forma recomendada é usar `None` e criar a lista dentro da função quando necessário:

```python
def add_item(item, lista=None):
    if lista is None:
        lista = []
    lista.append(item)
    return lista

print(add_item('maçã'))    # Saída: ['maçã']
print(add_item('banana'))  # Saída: ['banana']
```

Assim, cada chamada sem lista passa a criar uma nova lista vazia, evitando efeitos colaterais.

### Mais um Exemplo com Dicionário Mutável

```python
def increment_count(key, counts={}):
    counts[key] = counts.get(key, 0) + 1
    return counts

print(increment_count('python'))  # {'python': 1}
print(increment_count('java'))    # {'python': 1, 'java': 1} – resultado inesperado
```

No caso acima, o dicionário padrão é compartilhado e mantido entre as chamadas. A forma correta:

```python
def increment_count(key, counts=None):
    if counts is None:
        counts = {}
    counts[key] = counts.get(key, 0) + 1
    return counts

print(increment_count('python'))  # {'python': 1}
print(increment_count('java'))    # {'java': 1}
```

### Exemplo com Classe e Argumento Mutável

```python
class Collector:
    def __init__(self, items=[]):
        self.items = items

    def add(self, item):
        self.items.append(item)

    def get_items(self):
        return self.items

c1 = Collector()
c1.add('foo')

c2 = Collector()
print(c2.get_items())  # Saída inesperada: ['foo']
```

A mesma lista é compartilhada por todas as instâncias quando passada como valor padrão mutável. Correção:

```python
class Collector:
    def __init__(self, items=None):
        self.items = items or []

    def add(self, item):
        self.items.append(item)

    def get_items(self):
        return self.items

c1 = Collector()
c1.add('foo')

c2 = Collector()
print(c2.get_items())  # Saída correta: []
```

## Boas Práticas para Evitar Problemas com Argumentos Mutáveis

* **Nunca use tipos mutáveis como valores padrão de argumentos.** Prefira usar `None` e inicialize a variável dentro da função.

* **Evite efeitos colaterais em funções.** Funções devem ser previsíveis e sempre retornar resultados baseados em seus argumentos.

* **Prefira tipos imutáveis para valores padrão.** Imutáveis como `int`, `str` e `tuple` não causam esse tipo de problema.

* **Ao lidar com objetos mutáveis, clone-os quando necessário.** Use métodos como `copy()` ou slicing para evitar alterações inesperadas.

* **Teste cuidadosamente funções que recebem parâmetros opcionais.** Garanta que o estado de chamadas anteriores não afete as subsequentes.

* **Documente o comportamento esperado de seus métodos, especialmente em bibliotecas e APIs.** Indique claramente se objetos mutáveis são compartilhados ou não.

Dominar essas técnicas ajuda a produzir código Python mais resiliente e menos propenso a bugs difíceis de detectar, essencial para engenheiros de software que buscam qualidade profissional em seus projetos.

Contate-nos no Mastodon em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
