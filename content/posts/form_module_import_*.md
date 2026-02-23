+++
date = '2025-11-18'
draft = false
title = '`from módulo import *` em Python: por que você nunca deveria usar essa prática'
+++
Entenda os riscos do uso de `from módulo import *` em Python, saiba por que ele compromete a legibilidade e a manutenção do código e descubra as alternativas recomendadas por desenvolvedores experientes.

## A armadilha da conveniência em Python  

Há algo em Python que seduz até os desenvolvedores mais experientes: a promessa de simplicidade. Poucas linguagens conseguem equilibrar legibilidade e poder expressivo como ele faz. Mas é justamente essa aparente simplicidade que, às vezes, nos leva a atalhos perigosos. Entre eles, um velho conhecido: `from módulo import *`.  

Essa linha, tão curta quanto tentadora, parece inofensiva em pequenos scripts… até que o projeto cresce, outros módulos entram em cena e o caos começa a se insinuar. O que parecia elegante se transforma em um labirinto de dependências invisíveis, nomes sobrescritos e bugs indecifráveis.  

## A falsa sensação de simplicidade  

Importar tudo de um módulo é como abrir as portas da sua casa e deixar qualquer um entrar. De início, parece acolhedor. Mas quando algo dá errado, você não sabe quem fez a bagunça. Essa é a essência do problema: o código perde fronteiras claras.  

Quando um projeto cresce, inevitavelmente surgem conflitos de nome. Uma função sua pode ter o mesmo nome de algo importado, e lá se vai a previsibilidade do comportamento do código. E o pior: o erro nem sempre se manifesta de forma imediata — ele se infiltra sutilmente, como um bug fantasma que só aparece na pior hora possível.

## Legibilidade acima da brevidade  

Um código é tão bom quanto sua capacidade de ser compreendido por outras pessoas (inclusive você no futuro). Ao usar `import *`, você apaga pistas valiosas sobre de onde vêm as funções que usa. Quando um leitor se depara com sqrt(16), ele precisa adivinhar: é uma função da biblioteca padrão, algo definido localmente ou algo importado de um módulo obscuro?  

Essa incerteza sabota um princípio essencial de engenharia: previsibilidade. Códigos que exigem adivinhações são códigos menos confiáveis.

## Custo oculto e impacto no código

O uso de `from módulo import *` não implica em maior custo de desempenho ou tempo de carregamento. Ao importar um módulo, o interpretador Python o carrega e inicializa apenas uma vez, armazenando-o em `sys.modules`. As importações subsequentes, com ou sem `*`, apenas criam novas referências aos objetos já existentes.

O verdadeiro impacto está na legibilidade e manutenção. A importação global adiciona múltiplos nomes ao namespace atual, podendo sobrescrever identificadores e dificultar a rastreabilidade das dependências. Isso reduz a previsibilidade do código e aumenta o risco de colisões de nomes e efeitos colaterais sutis, principalmente em bases de código extensas.

Em projetos de médio e grande porte, recomenda-se sempre preferir importações explícitas (`import módulo` ou `from módulo import símbolo`) para preservar a clareza e facilitar ferramentas de análise estática, refatoração e autocompletar em IDEs.

## Alternativas seguras e idiomáticas em Python  

A boa notícia é que a linguagem oferece opções mais claras — e alinhadas com a filosofia "Explicit is better than implicit":

```python
from math import sqrt, pi
```
Importe apenas o que você precisa e comunique intenção.  

Ou, se preferir manter a origem explícita:
```python
import math
resultado = math.sqrt(16)
```
A notação com ponto reforça a origem de cada função.  

E em casos de bibliotecas extensas, os alias ajudam:
```python
import pandas as pd
df = pd.read_csv("data.csv")
```
Essa convenção é legível, padronizada e amplamente aceita pela comunidade.

## Um sinal de maturidade profissional  

Código limpo não é o mais curto, e sim o mais claro. Evitar `import *` é um passo em direção à maturidade profissional. É escolher clareza e previsibilidade no lugar da pressa.  

Em tempos em que a maioria dos bugs surge nas fronteiras entre módulos, saber exatamente de onde cada símbolo vem não é luxo — é controle.

## Um convite à reflexão  

Na próxima vez que você digitar `from módulo import *`, pause. Pergunte-se se a conveniência justifica o custo. O Python recompensa quem escolhe caminhos explícitos. E talvez o maior sinal de evolução como engenheiro Python seja perceber que clareza é o verdadeiro atalho.

> ## 🧭 Boas práticas resumidas  
>  
> - Prefira importações explícitas (from math import sqrt, pi).  
> - Use alias padronizados em bibliotecas populares (import pandas as pd, import numpy as np).  
> - Evite nomes genéricos que possam colidir com funções de módulos.  
> - Documente qualquer alias ou importação incomum no projeto.  
> - Faça revisões periódicas no código para eliminar usos antigos de `import *`.  
> - Valorize a clareza: código previsível é sinônimo de código profissional.  

Contate-nos no Mastodon em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
