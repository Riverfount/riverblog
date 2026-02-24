+++
date = '2025-11-07'
draft = false
title = 'DRY: o princípio que separa código amador de código profissional'
tags = ["solid", "clean-code", "boas-práticas"]
+++
Na prática de desenvolvimento, é comum ver blocos de código duplicados, copiados e colados em diferentes partes de um sistema. Parece inofensivo; afinal, “funciona”. Mas com o tempo, essa abordagem se torna um problema sério. É aqui que entra o princípio DRY — Don't Repeat Yourself — um dos fundamentos mais importantes da engenharia de software moderna.

## O que é o princípio DRY

O princípio DRY afirma que cada informação, comportamento ou lógica de negócio deve ter uma única representação dentro de um sistema. Repetir código é repetir responsabilidade, e cada duplicação se transforma em um ponto a mais para corrigir quando algo muda.

Aplicar DRY significa centralizar responsabilidades, promovendo clareza, consistência e reutilização.

## Por que o DRY é essencial

- **Manutenção simplificada:** Se uma regra existe em apenas um ponto, basta atualizá-la uma vez para refletir sua mudança em todo o sistema.
- **Legibilidade e clareza:** O código torna-se mais previsível, direto e fácil de entender.
- **Consistência entre módulos:** As mesmas entradas sempre produzem as mesmas saídas.  
- **Reutilização e escalabilidade:** Abstrações bem definidas permitem evolução sem retrabalho.

## Aplicando DRY na prática

### 1. Evitando repetição com funções

Sem DRY:

```python
# Cálculo duplicado de imposto
def calcular_total_produto(preco, imposto):
    return preco + (preco * imposto) 


def calcular_total_servico(preco, imposto):
    return preco + (preco * imposto)
```

Com DRY:

```python
def calcular_total(preco, imposto):
    return preco + (preco * imposto)
```

Agora, produtos e serviços usam a mesma função, reduzindo manutenção e riscos de inconsistência.

### 2. Aplicando DRY com classes e herança

Sem DRY:

```python
class Funcionario:
     def __init__(self, nome, salario):
         self.nome = nome
         self.salario = salario

    def calcular_bonus(self):
        return self.salario * 0.10
        
        
class Gerente:
    def __init__(self, nome, salario):
        self.nome = nome
        self.salario = salario 
    
    def calcular_bonus(self):
        return self.salario * 0.20
```

Com DRY e Orientação a Objetos:

```python
class Funcionario:
    def __init__(self, nome, salario):
        self.nome = nome
        self.salario = salario
        
    def calcular_bonus(self):
        return self.salario * 0.10


class Gerente(Funcionario):
    def calcular_bonus(self):
        return self.salario * 0.20
```

A herança elimina código repetido e mantém a lógica consistente entre tipos de funcionários.

### 3. Centralizando configurações

Sem DRY:

```python
API_URL = "https://api.meusistema.com"
print("Enviando dados para https://api.meusistema.com")
```

Com DRY:

```python
CONFIG = {
    "API_URL": "https://api.meusistema.com"
}

print(f"Enviando dados para {CONFIG['API_URL']}")
```

Quando for necessário mudar o endpoint, basta atualizar apenas um local.

### 4. Evitando duplicação de dados

Sem DRY:

```python
usuarios = [
    {"id": 1, "nome": "Alice", "email": "alice@example.com"},
    {"id": 2, "nome": "Bob", "email": "bob@example.com"}
]

emails = ["alice@example.com", "bob@example.com"]
```

Com DRY:

```python
usuarios = [
    {"id": 1, "nome": "Alice", "email": "alice@example.com"},
    {"id": 2, "nome": "Bob", "email": "bob@example.com"}
]

emails = [u["email"] for u in usuarios]
```

Assim, o código sempre obtém dados derivados diretamente da fonte original.

## Quando não aplicar DRY cegamente

DRY é poderoso, mas abstrações em excesso podem transformar um código simples em algo complexo demais. Se duas partes do sistema compartilham apenas semelhanças superficiais, manter a duplicação temporariamente pode ser a melhor escolha. O equilíbrio é o segredo: Deduplique apenas quando houver real benefício em termos de clareza, manutenção e consistência.

## Conclusão

O princípio DRY é mais que uma boa prática: ele reflete uma mentalidade de engenharia. Pensar em sistemas DRY é pensar em código sustentável, modular e de longo prazo.  
Evitar repetição não é apenas sobre reduzir linhas, é sobre projetar bases sólidas para a evolução natural do software.

Contate-nos no Mastodon em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
