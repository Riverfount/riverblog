+++
date = '2025-11-25'
draft = false
title = 'Por que abandonar números mágicos em status codes HTTP'
tags = ["api", "clean-code", "boas-práticas"]
+++
Em desenvolvimento de APIs REST, status codes HTTP são tão importantes quanto o payload da resposta. Eles comunicam, de forma padronizada, o resultado de cada requisição e são consumidos por clientes, gateways, observabilidade e ferramentas de monitoração. Apesar disso, ainda é comum encontrar código repleto de “números mágicos”, como `200`, `404` ou `500` espalhados pela base.

Uma abordagem mais robusta é substituir esses valores literais por constantes descritivas, como `HTTP_200_OK` ou `HTTP_404_NOT_FOUND`. Essa prática aproxima o código das boas práticas de engenharia de software e melhora diretamente a legibilidade, a manutenção e a confiabilidade da API.

## Constantes de status HTTP em Python

Frameworks modernos como FastAPI, Django REST Framework e outros já fornecem coleções de constantes ou enums para representar status codes HTTP. Isso cria um vocabulário padrão no código, evita ambiguidade e reduz dependência de “decorar” números.

Quando o framework ou stack utilizado não oferece esse mapeamento, é altamente recomendável criar o seu próprio módulo de constantes. Um exemplo simples é a criação do arquivo `helper/status_code.py`, que centraliza os códigos mais utilizados pela sua API. Esse arquivo funciona como um contrato semântico para a aplicação e pode ser adotado como padrão de time.

Exemplo de uso em código:

```python
from helper import status_code

if response.status_code == status_code.HTTP_200_OK:
    print("Requisição bem-sucedida!")
```

Esse padrão é facilmente reconhecível por qualquer desenvolvedor que já tenha trabalhado com APIs, independentemente do backend ou da linguagem.

## Legibilidade e intenção clara do código

Legibilidade é um dos pilares de um código de qualidade. Quando a base utiliza `HTTP_201_CREATED` em vez de `201`, a intenção da resposta fica explícita.

Em uma revisão de código (code review), não é necessário parar para lembrar o que cada número significa. A constante descreve o comportamento desejado e reduz o esforço cognitivo de quem lê. Em times grandes ou em projetos que passam por muitas mãos, essa economia de contexto se traduz em menos dúvidas, menos ruído em revisões e onboarding mais rápido de novos membros.

## Manutenção, consistência e redução de erros

Espalhar números mágicos na base aumenta o risco de inconsistência. É fácil um endpoint retornar `200` em um caso, `201` em outro cenário similar, ou ainda alguém digitar `2040` em vez de `204`.

Com um módulo de constantes, você:

* Centraliza a definição dos status codes.
* Garante consistência sem depender da memória individual.
* Facilita refinos pontuais de semântica (por exemplo, trocar um `200` por `204` quando a API deixa de retornar corpo em uma deleção).

Embora os valores dos status codes HTTP sejam padronizados e raramente mudem, o mapeamento semântico dentro da sua aplicação pode evoluir. Ter isso encapsulado em constantes torna essa evolução muito menos dolorosa.

## Documentação viva e apoio das ferramentas

Constantes descritivas funcionam como documentação viva embutida no código. Em vez de manter uma tabela à parte em uma wiki, o próprio módulo de status codes evidencia quais valores são usados e com qual propósito.

Além disso, IDEs e ferramentas de desenvolvimento conseguem:

* Sugerir autocompletar para `HTTP_4xx` ou `HTTP_5xx`.
* Ajudar na navegação (go to definition) para entender onde e como os códigos são definidos.
* Aumentar a segurança estática, evitando valores inválidos.

Tudo isso contribui para um fluxo de desenvolvimento mais seguro e produtivo.

## Alinhamento com padrões de API e design de contratos

Do ponto de vista de design de APIs, status codes são parte do contrato público da sua interface. Tratá-los como constantes nomeadas reforça essa visão de contrato.

Alguns benefícios práticos:

* Facilita a padronização de respostas entre diferentes microserviços.
* Ajuda a manter alinhamento com guias internos de API (API Guidelines).
* Simplifica a documentação em ferramentas como OpenAPI/Swagger, onde você pode mapear diretamente as constantes utilizadas no código para os status documentados.

Quando cada serviço expõe respostas coerentes – por exemplo, sempre usando `HTTP_404_NOT_FOUND` para recursos inexistentes e `HTTP_422_UNPROCESSABLE_ENTITY` para erros de validação –, consumidores conseguem tratar erros de forma genérica e previsível.

## Integração com frameworks e bibliotecas

Em frameworks como FastAPI, é comum configurar o status code diretamente nos endpoints, muitas vezes usando constantes ou enums oriundos do próprio framework ou da biblioteca padrão de HTTP. Essa prática reduz acoplamento a valores “mágicos” e torna o código mais idiomático.

Mesmo que a stack atual não ofereça esse suporte nativamente, nada impede que você:

* Crie um módulo `helper/status_code.py` com constantes alinhadas à especificação HTTP.
* Use essas constantes tanto no backend quanto em testes automatizados, evitando duplicações.
* Compartilhe o padrão com bibliotecas internas ou SDKs que consomem a API.

Assim, `helper/status_code.py` se torna um exemplo de padrão arquitetural que pode ser replicado em diferentes serviços e projetos.

## Observabilidade, logs e debugging

Em ambientes de produção, a qualidade dos logs é fundamental para análise de incidentes. Status codes aparecem em traces, métricas e dashboards. Quando constantes descritivas são usadas na aplicação, é natural que o mesmo vocabulário apareça nas mensagens de log e no contexto de exceções.

Ver algo como “Falha ao chamar serviço externo: HTTP_503_SERVICE_UNAVAILABLE” é mais autoexplicativo do que apenas registrar “503”. Isso acelera o diagnóstico, reduz ambiguidade e diminui o tempo médio de resolução de incidentes (MTTR).

## Conclusão prática para projetos Python

Para projetos Python que expõem APIs REST, adotar constantes de status code não é apenas um detalhe estético: é uma decisão de design que impacta legibilidade, manutenção, padronização e observabilidade.

* Se o framework já fornece constantes, use-as.
* Se não fornece, crie um módulo dedicado – como o `helper/status_code.py` – e estabeleça-o como padrão de equipe.
* Garanta que todas as camadas que lidam com HTTP (handlers, services, middlewares, testes) utilizem as mesmas constantes.

Esse pequeno investimento inicial gera um retorno significativo ao longo do ciclo de vida da aplicação, tornando a base mais previsível, profissional e preparada para crescer com segurança.

Conte-nos como lida com números mágicos no seu dia-a-dia, você nos encontra no Mastodon em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
