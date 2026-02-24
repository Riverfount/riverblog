+++
date = '2025-11-03'
draft = false
title = 'O que é uma API REST? Explicação Detalhada para Desenvolvedores'
tags = ["api", "rest", "web", "boas-práticas"]
+++
## Introdução

APIs REST (Representational State Transfer) são um padrão amplamente adotado para comunicação entre sistemas distribuídos, especialmente na web. Elas definem um conjunto de princípios que permitem que aplicações se comuniquem de forma simples, eficiente e escalável usando o protocolo HTTP. Este artigo detalha os conceitos fundamentais, a arquitetura REST e traz exemplos práticos para facilitar o entendimento.

## Conceitos Fundamentais de REST

REST não é um protocolo, mas um conjunto de restrições arquiteturais para criar APIs, proposto por Roy Fielding em 2000. Para que uma API seja considerada RESTful, ela deve seguir princípios essenciais:

- **Cliente-Servidor**: Separação entre cliente (que consome a API) e servidor (que fornece dados e serviços).
- **Sem estado (Stateless)**: Cada requisição do cliente para o servidor deve conter todas as informações para ser compreendida e processada, sem depender de informações de requisições anteriores.
- **Cacheável**: As respostas podem ser armazenadas temporariamente para melhorar o desempenho.
- **Interface uniforme**: Padronização das interações, onde cada recurso é identificado por uma URL única e manipulável via métodos HTTP.
- **Sistema em camadas**: A arquitetura pode ser composta por uma cadeia de servidores intermediários para balanceamento de carga, segurança, etc., invisíveis ao cliente.
- **Código sob demanda (opcional)**: Possibilidade do servidor enviar código executável, como scripts, ao cliente para expandir funcionalidades momentaneamente.

## Componentes de uma API REST

### Recursos

Um recurso é qualquer entidade que possa ser identificada e manipulada via API — um usuário, um produto, um pedido, etc. Cada recurso é expresso por uma URI (Uniform Resource Identifier). Por exemplo:

```http
GET https://api.loja.com/produtos/123
```

Nesse exemplo, “produtos/123” é o recurso que representa o produto com id 123.

### Métodos HTTP

REST utiliza os métodos HTTP para realizar operações CRUD (Criar, Ler, Atualizar, Deletar) nos recursos:

- **GET**: Recuperar dados (ex: listar produtos)
- **POST**: Criar novo recurso (ex: cadastrar um novo produto)
- **PUT**: Atualizar recurso existente (ex: alterar informações de um produto)
- **DELETE**: Remover recurso (excluir um produto)

### Formato das Respostas

As APIs REST geralmente retornam dados formatados em JSON (JavaScript Object Notation), que é legível tanto por humanos quanto por máquinas. Exemplo de resposta JSON para um produto:

```json
{
  "id": 123,
  "nome": "Camiseta",
  "preco": 49.90,
  "estoque": 20
}
```

### Parâmetros da Requisição

- **Route Params**: Parâmetros na própria URL para identificar recursos específicos, ex: `/produtos/123`.
- **Query Params**: Parâmetros na URL para filtros, paginação, ordenação, ex: `/produtos?categoria=camisetas&page=2`.
- **Headers**: Metadados da requisição, como autenticação, tipo de conteúdo esperado etc.
- **Body**: Dados enviados em POST/PUT, usualmente em JSON.

## Exemplo Prático

Suponha uma API REST para gerenciamento de uma lista de tarefas:

- **GET /tarefas**: Retorna todas as tarefas
- **GET /tarefas/5**: Retorna detalhes da tarefa com ID 5
- **POST /tarefas**: Cria uma nova tarefa com dados enviados no corpo da requisição
- **PUT /tarefas/5**: Atualiza a tarefa 5
- **DELETE /tarefas/5**: Exclui a tarefa 5

### Exemplo real de requisição POST para criar tarefa

```http
POST /tarefas
Content-Type: application/json

{
  "titulo": "Estudar APIs REST",
  "descricao": "Ler e praticar criação de APIs RESTful"
}
```

Resposta:

```http
201 Created
{
  "id": 10,
  "titulo": "Estudar APIs REST",
  "descricao": "Ler e praticar criação de APIs RESTful",
  "status": "pendente"
}
```

## Benefícios da Arquitetura REST

- **Escalabilidade**: Devido à independência sem estado, facilmente escalável.
- **Flexibilidade**: Pode ser consumida por diversos clientes, como web, mobile, IoT.
- **Padronização**: Uso dos métodos HTTP e formatos de dados padrão facilitam integração.
- **Desempenho**: Cacheamento ajuda na redução da carga e melhora a performance.
- **Evolução gradual**: Fácil adicionar ou modificar recursos sem impactar clientes existentes.

## Considerações Avançadas

- **HATEOAS** (Hypermedia as the Engine of Application State): A API fornece links em suas respostas para que o cliente descubra dinamicamente as operações disponíveis em cada recurso, reduzindo o acoplamento.
- **Versionamento**: Para evitar quebras, APIs REST frequentemente versionam suas endpoints, ex: `/v1/tarefas`.
- **Autenticação e Segurança**: Uso de tokens (ex: JWT), OAuth e HTTPS são essenciais.

Contate-nos no Mastodon em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
