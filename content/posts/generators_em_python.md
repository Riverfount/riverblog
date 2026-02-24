+++
date = '2025-12-04'
draft = false
title = 'Generators em Python: Técnicas Essenciais para Código Eficiente e Robusto'
tags = ["python", "geradores", "performance"]
+++
Generators em Python são funções especiais que usam `yield` para gerar valores sob demanda, economizando memória em vez
de criar listas completas na RAM. Pense neles como "listas preguiçosas" que produzem um item por vez, ideais para
processar arquivos grandes ou sequências infinitas sem travar o sistema.

## Yield vs Return: A Diferença Fundamental

`return` encerra a função imediatamente após retornar um único valor, enquanto `yield` pausa a execução, retorna um
valor e preserva o estado interno para continuar de onde parou na próxima chamada. Isso permite que uma única função
gere múltiplos valores sequencialmente, como um loop "congelado" e retomado.

```python
def com_return(n):
    for i in range(n):
        return i  # Para após o primeiro valor: sempre retorna 0

def com_yield(n):
    for i in range(n):
        yield i  # Gera 0, 1, 2... até n, pausando entre cada yield

print(next(com_return(5)))  # 0 (e função termina)
for i in com_yield(5):      # 0, 1, 2, 3, 4 (estado preservado)
    print(i)
```

`return` é para resultados finais únicos; `yield` constrói iteradores reutilizáveis.

## Como Funcionam os Generators Básicos

Uma função generator parece normal, mas substitui `return` por `yield`, que pausa a execução e retorna um valor,
preservando o estado para continuar depois. Isso cria um objeto iterável consumido com `for` ou `next()`, perfeito para
loops sem alocar memória extra.

```python
def contar_ate(n):
    for i in range(n):
        yield i

for numero in contar_ate(5):
    print(numero)  # Saída: 0 1 2 3 4
```

## Vantagens em Memória e Performance

Generators brilham com dados grandes: uma lista de 1 milhão de números usa ~80MB, mas o generator equivalente consome
apenas 128 bytes, gerando itens sob demanda. São nativos para `for`, `list()`, `sum()` e economizam tempo em cenários
reais como leitura de logs ou CSV gigantes.

Expressões geradoras simplificam ainda mais: `(x**2 for x in range(1000000))` cria um generator conciso sem parênteses
extras, consumido iterativamente.

## Tratamento de Exceções Simples

Exceções funcionam naturalmente dentro do generator. Use `try/except` para capturar erros durante a geração, como
valores inválidos em um parser de JSON, mantendo o fluxo seguro.

```python
def numeros_validos(arquivo):
    with open(arquivo) as f:
        for linha in f:
            try:
                yield int(linha.strip())
            except ValueError:
                print(f"Ignorando linha inválida: {linha}")
                continue
```

Isso previne crashes em dados reais "sujos", comuns em automações e ETLs.

## Fechamento Correto de Resources

Generators com arquivos ou conexões precisam de fechamento para evitar vazamentos. Use `try/finally` internamente ou
`generator.close()` externamente, garantindo liberação automática.

```python
# Exemplo 1: try/finally interno + close() externo
def ler_arquivo(arquivo):
    f = open(arquivo)
    try:
        for linha in f:
            yield linha.strip()
    finally:
        f.close()

gen = ler_arquivo('dados.csv')
try:
    for dado in gen:
        processar(dado)
finally:
    gen.close()
```

Context managers (`with`) integram perfeitamente para automação, eliminando necessidade de `close()` manual.

```python
# Exemplo 2: Context manager with (mais limpo e automático)
def ler_arquivo_with(arquivo):
    with open(arquivo) as f:
        for linha in f:
            yield linha.strip()

# Uso simples e seguro - fecha automaticamente
for dado in ler_arquivo_with('dados.csv'):
    processar(dado)
```

## Aplicações Práticas Iniciais

* **Arquivos gigantes**: Leia linha por linha sem carregar tudo.
* **Sequências infinitas**: Fibonacci ou contadores sem fim.
* **Pipelines simples**: Filtre e transforme dados em cadeia.
* **Testes unitários**: Mock de iteradores sem dados reais.​

Esses padrões otimizam ERPs, scripts de automação e APIs desde o primeiro projeto.

## Conclusão

Generators transformam código Python em soluções eficientes e elegantes. Comece substituindo listas por generators em
seus loops e veja a diferença em performance imediatamente.

Teste os exemplos acima no seu próximo projeto Python, meça o uso de memória com `sys.getsizeof()` e compartilhe seus
resultados em **[@riverfount@bolha.us](https://bolha.us/@riverfount)** para discutirmos otimizações reais juntos!
