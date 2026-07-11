---
title: 'O backend não ficou pronto e o frontend não pode esperar'
date: 2026-07-11
draft: false
author: 'Riverfount'
tags: ['Mock', 'API', 'REST', 'json-server', 'Node', 'Frontend', 'Iniciante']
keywords: ['json-server', 'mock api', 'rest', 'todo list', 'frontend', 'node', 'iniciante']
cover:
  image: 'images/covers/cover-json-server-mock-api.png'
  alt: 'Uma API REST de mentira servida por json-server'
  relative: false
ShowToc: true
TocOpen: false
---

Você está construindo a tela de uma lista de tarefas. Os componentes estão prontos, o layout se comporta em qualquer largura de tela, e falta uma única coisa: buscar as tarefas de algum lugar. Só que a API que deveria devolver essas tarefas ainda não existe. Está na fila de outra equipe, ou é você mesmo que vai escrevê-la depois. Talvez em FastAPI, talvez em Django, quando o frontend já estiver de pé. De qualquer forma, hoje ela não responde, e o `fetch` que você acabou de escrever aponta para o nada.

A saída preguiçosa é cravar um array fixo dentro do componente e seguir em frente. Funciona por cinco minutos, até você perceber que não está testando nada que se pareça com a realidade: não tem requisição de rede, não tem estado de carregamento, não tem erro pra tratar, não tem o `id` chegando do servidor. Você não está construindo um frontend que fala com uma API. Está construindo um frontend que finge que já ter os dados.

Existe uma saída melhor, e ela cabe em dois comandos: subir uma API REST **de mentira que se comporta como uma de verdade**. É disso que trata este artigo, e a Todo List vai ser o nosso mapa do que dá pra fazer com ela.

## O que o json-server realmente faz

O [json-server](https://github.com/typicode/json-server) resolve exatamente esse problema. A ideia por trás dele é quase absurda de tão simples: você entrega um arquivo `.json`, e ele te devolve uma API REST completa em cima daquele arquivo. Cada chave de primeiro nível vira uma coleção, e cada coleção ganha as rotas que você esperaria de um backend real: listar, buscar por id, criar, atualizar, apagar.

O ponto que costuma passar despercebido de quem está começando é que ele não é um "gerador de JSON estático". Ele é um servidor de verdade, que interpreta o método HTTP e a URL da sua requisição e **grava as alterações de volta no arquivo**. Um `POST` cria um registro novo no `.json`. Um `DELETE` remove. Quando você reinicia o servidor, as mudanças continuam lá. É esse comportamento que faz o seu frontend não perceber diferença nenhuma entre o mock e o backend que vai substituí-lo depois.

Um detalhe prático antes de continuar: o json-server é uma ferramenta Node. Isso preocupa um pouco quem vive no mundo Python, mas a boa notícia é que **você não vai escrever uma linha de JavaScript**. Você só precisa ter o Node instalado para conseguir rodar o comando. O resto do trabalho é editar um arquivo JSON, que é território conhecido de qualquer pessoa que já mexeu com API.

## Subindo o servidor

Confira primeiro se o Node está disponível. A versão 1 do json-server pede Node 18.3 ou mais novo:

```bash
node -v
```

Crie uma pasta pro seu mock e instale o json-server **local ao projeto**. Muitos tutoriais antigos mandam instalar de forma global (`npm install -g`); prefira o local, porque assim a versão fica registrada no `package.json` e o projeto continua reproduzível daqui a seis meses:

```bash
mkdir todo-mock && cd todo-mock
npm init -y
npm install json-server
```

Agora o coração de tudo: o arquivo `db.json`. Ele é o seu banco de dados de mentira. Vamos criar uma coleção `todos`, que é a única coisa de que a nossa tela precisa:

```json
{
  "todos": [
    { "id": "1", "description": "Lavar a roupa", "done": true },
    { "id": "2", "description": "Passear com o cachorro", "done": false },
    { "id": "3", "description": "Estudar Rust", "done": false }
  ]
}
```

Repare que cada tarefa tem um `id`, um `description` e um `done`. Esses três campos são a nossa "entidade" — e é a partir da chave `todos` que o servidor vai montar todas as rotas. Uma observação que vai evitar confusão mais tarde: na versão 1 do json-server o `id` é sempre uma **string**, e se você omitir esse campo ao criar um registro, o próprio servidor gera um pra você.

Com o arquivo salvo, suba o servidor:

```bash
npx json-server db.json
```

Você deve ver algo assim:

```
JSON Server started on PORT :3000
http://localhost:3000
```

Pronto. Você tem uma API REST rodando em `http://localhost:3000`, e ela já está observando o `db.json` — se você editar o arquivo, as mudanças aparecem sem precisar reiniciar nada.

## A Todo List respondendo como uma API de verdade

Aqui a coisa fica interessante, porque a partir de uma coleção chamada `todos` você ganha o CRUD inteiro de graça. Vale abrir cada rota devagar, porque é exatamente esse conjunto de operações que o seu frontend vai consumir.

Para **listar** todas as tarefas, ou buscar **uma** pelo id:

```
GET http://localhost:3000/todos
GET http://localhost:3000/todos/1
```

Para **criar** uma tarefa nova, você faz um `POST`. Note que não precisa mandar o `id` — o servidor gera. O único cuidado obrigatório é o cabeçalho `Content-Type: application/json`: sem ele, o json-server responde com sucesso mas **não grava nada**, e essa é uma das pegadinhas que mais fazem o iniciante perder tempo achando que o servidor está quebrado.

```bash
curl -X POST http://localhost:3000/todos \
  -H "Content-Type: application/json" \
  -d '{"description": "Comprar café", "done": false}'
```

Para **atualizar**, você tem duas opções que confundem bastante no começo. O `PUT` substitui o registro inteiro; o `PATCH` altera só os campos que você mandar. Marcar uma tarefa como concluída é o caso clássico de `PATCH`, porque você quer mexer só no `done`:

```bash
curl -X PATCH http://localhost:3000/todos/2 \
  -H "Content-Type: application/json" \
  -d '{"done": true}'
```

E para **apagar**:

```bash
curl -X DELETE http://localhost:3000/todos/2
```

Se você abrir o `db.json` depois de rodar esses comandos, verá as alterações gravadas ali. Não é ilusão de ótica no navegador, o estado mudou de verdade. É esse detalhe que transforma o json-server de um "servidor de arquivo estático" em algo que o seu código de frontend trata como um backend legítimo.

## O que dá pra fazer além do CRUD básico

Se o json-server parasse no CRUD já valeria a pena, mas ele vai além, e conhecer esses recursos muda a forma como você testa a tela. Quando a sua Todo List crescer para dezenas de itens, você vai querer filtrar, ordenar e paginar — e tudo isso vem embutido, sem escrever nenhuma lógica.

Para **filtrar** por um campo, basta passá-lo na query string. Só as tarefas concluídas:

```
GET /todos?done=true
```

A versão 1 também trouxe **operadores de comparação**, no formato `campo:operador=valor`. Dá pra buscar por texto que contém um trecho, por exemplo:

```
GET /todos?description:contains=roupa
GET /todos?id:in=1,2
```

Para **ordenar**, use `_sort`. O prefixo `-` inverte a ordem (decrescente):

```
GET /todos?_sort=-description
```

E para **paginar**, combine `_page` com `_per_page`:

```
GET /todos?_page=1&_per_page=10
```

A paginação devolve um envelope com metadados: quantas páginas existem, qual é a próxima, quantos itens no total. Isso tudo dentro de um campo `data`. É praticamente o mesmo formato que um backend paginado de verdade te entregaria, o que significa que o código de frontend que você escrever aqui não vai precisar ser reescrito quando a API real chegar.

## O tutorial que você achou no Google provavelmente está desatualizado

Vale um aviso que economiza horas de frustração. O json-server teve uma mudança grande de versão, da série 0.x para a 1.x, e **a maioria dos tutoriais e respostas de fórum ainda ensina a sintaxe antiga**. Se você seguir um passo a passo de 2021 ao pé da letra, vai bater em erro atrás de erro sem entender por quê.

Os pontos que mais mudaram:

- o comando não usa mais `--watch` (ele observa o arquivo por padrão);
- o `id` virou string em vez de número;
- a paginação passou de `_limit` para `_per_page`;
- a ordenação decrescente deixou de usar `_order=desc` e passou a usar o prefixo `-` no `_sort`;
- e os relacionamentos entre coleções, que usavam `_expand`, agora usam `_embed`.

O conceito continua idêntico ao dos tutoriais antigos, o que muda é o vocabulário. Saber que essa fronteira existe é o que te separa de "não sei por que não funciona" e "ah, esse texto é da versão antiga".

## Onde isso ajuda e onde não serve

O json-server brilha quando você precisa destravar o frontend antes do backend existir, quando quer praticar consumo de uma API REST real sem construir um servidor inteiro, ou quando precisa de dados de exemplo para uma demo. Nesses cenários, o ganho de tempo é enorme e o custo é praticamente zero.

O que ele **não** é: um backend de produção. Não há autenticação de verdade, não há regra de negócio, não há validação além do formato JSON, e todo o "banco de dados" é um arquivo de texto rodando num `localhost`. No momento em que o backend real ficar pronto, você troca a URL base que o seu frontend consome e joga o mock fora. Ele cumpriu o papel dele: deixou-te construir e validar a interface enquanto a peça de verdade ainda estava sendo feita, em vez de você ficar parado esperando.

E é esse o ponto que fica. A Todo List aqui foi só o pretexto, o que você aprendeu vale pra qualquer entidade. Troque `todos` por `produtos`, `clientes` ou `pedidos` no `db.json`, e você tem uma nova API REST completa no mesmo par de comandos. O mock deixa de ser uma gambiarra e vira uma ferramenta de fluxo de trabalho. Um jeito de gerar valor e receber feedback antes de a implementação real existir.

---

Você já subiu um mock pra destravar um frontend enquanto o backend não vinha, ou prefere construir a API de verdade primeiro e só depois tocar na tela? Comenta lá no Fediverse: **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
