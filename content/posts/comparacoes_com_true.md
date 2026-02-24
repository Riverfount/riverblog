+++
date = '2025-11-17'
draft = false
title = 'Comparações com True em Python: erros comuns e práticas recomendadas para engenheiros'
tags = ["python", "boas-práticas", "clean-code"]
+++
No desenvolvimento Python, especialmente em projetos de médio a grande porte e pipelines complexos de testes automatizados, é comum encontrar erros sutis relacionados a comparações com o valor booleano `True`. Uma prática aparentemente inofensiva, como usar `== True` para verificar condições, pode introduzir comportamentos inesperados que dificultam a manutenção, geram falsos positivos em testes e causam dúvidas em revisões de código.

Essas situações não são incomuns em equipes que lidam com múltiplas camadas de abstração — desde o código de negócio até frameworks de teste — e evidenciam a importância de entender profundamente a diferença entre identidade e igualdade em Python, bem como as melhores práticas para escrever condicionais claras e robustas.

## Entendendo o impacto de `is True` vs `== True`

O operador `is` verifica se dois objetos são exatamente os mesmos na memória — ou seja, se têm identidade. No caso de `var is True`, o teste passa somente se `var` for exatamente o objeto singleton `True` do Python.  

Já o operador `==` compara valores, permitindo que diversos objetos considerados “truthy” no contexto booleano, como `1`, Strings não vazias ou listas, sejam equivalentes a `True` quando comparados com `var == True`. Isso pode causar falhas silenciosas ou testes que passam indevidamente.

```python
if 1 == True:  # Avalia para True, embora 1 não seja o objeto True
    print("Isso pode confundir a lógica.")
```

Esse tipo de resultado pode mascarar bugs ou comportamentos inesperados, especialmente em testes unitários.

## Evitando comparações explícitas desnecessárias

O consenso na comunidade Python — refletido em PEP8 e amplamente adotado — é que a maioria das comparações explícitas com `True` e `False` são redundantes e prejudicam a legibilidade. Python permite confiar diretamente na avaliação booleana implícita, que é mais limpa e expressiva.

```python
# Menos legível
if var == True:
    ...

# Idiomático
if var:
    ...

# Para casos False
if not var:
    ...
```

Essa abordagem reduz o ruído visual e elimina ambiguidades causadas por diferentes tipos que avaliam para verdadeiro ou falso.

## Exemplos práticos de erros comuns

- **Erro em comparações com listas booleanas:**

```python
a = [True, True, False]
b = [True, True, True]

result = a and b  
print(result)  # Saída: [True, True, True]
```

Aqui, usar `and` entre listas não faz uma comparação elemento a elemento, mas retorna o último valor avaliado. Isso pode levar a resultados inesperados, especialmente se se esperava um valor booleano.

- **Confusão com tipos de retornos em bibliotecas como NumPy:**

Em NumPy, comparações booleanas não retornam `True` ou `False` do Python nativo, mas tipos como `np.True_` ou `np.False_`, que podem quebrar testes que usam `is True`:

```python
import numpy as np

result = np.array([1, 2, 3]) == 1
print(result)          # array([ True, False, False])
print(result[0] is True)  # False, pois é np.bool_, não bool nativo
```

Essa sutileza é fonte comum de bugs em projetos científicos e de análise de dados.

- **Falsos positivos em testes unitários:**

```python
def test_func():
    result = 1
    assert result == True  # Passa, mas result não é booleano

    assert result is True  # Falha, aqui a precisão salva o teste
```

O uso de `is True` impede que valores “truthy” como `1` passem em testes que esperam tipos booleanos.

## Casos excepcionais: validação rigorosa em testes unitários

Há, todavia, situações específicas — especialmente em testes unitários — onde a precisão semântica é necessária. Quando uma função ou método deve retornar explicitamente o valor booleano `True`, e não apenas um “valor truthy” qualquer, o uso de `assert ... is True` garante que o teste falhe se houver qualquer discrepância de tipo ou valor.

```python
def is_even(number):
    return number % 2 == 0

def test_is_even():
    result = is_even(4)

    # Verificação rigorosa: valida identidade
    assert result is True

    # Evitar
    assert result == True
```

Essa prática ajuda a prevenir falsos positivos em pipelines de CI/CD, assegurando que o comportamento funcional esperado esteja alinhado com tipos e valores corretos e não somente com avaliações booleanas superficiais.

## Conclusão: clareza e rigor em equilíbrio

Escrever código Python robusto é também dominar as sutilezas da linguagem. Evitar comparações explícitas desnecessárias com `True` não só melhora a clareza, como também reduz riscos de bugs ocultos.

Por outro lado, saber quando estabelecer verificações estritas, como em testes unitários com `is True`, demonstra maturidade técnica e compromisso com a qualidade.

Equilibrar legibilidade e precisão é o passo decisivo que diferencia código “funcional” de código profissional, limpo e confiável.

Contate-nos no Mastodon em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
