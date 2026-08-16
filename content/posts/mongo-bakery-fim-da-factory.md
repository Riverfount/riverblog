---
title: 'mongo_bakery: o fim da factory que você escrevia pra cada Document do MongoEngine'
date: 2026-08-16
draft: false
tags: ['python', 'mongoengine', 'testes', 'pytest', 'mongodb']
cover:
  image: 'images/covers/cover-mongo-bakery-fim-da-factory.png'
  alt: 'mongo_bakery: o fim da factory que você escrevia pra cada Document do MongoEngine'
  relative: false
---

O teste queria garantir uma coisa só: cancelar um pedido pendente devolve 200. Pra chegar até essa asserção, ele teve que passar por isso primeiro:

<!--more-->

```python
def test_cancel_order_returns_200_for_pending_order(client):
    customer = Customer(
        name="Ana Souza",
        email="ana@example.com",
        company="Acme Ltda",
        address=Address(street="Rua das Flores, 12", city="Curitiba", zip_code="80000-000"),
    ).save()
    order = Order(
        customer=customer,
        items=[OrderItem(sku="SKU-1", quantity=2, unit_price=Decimal("49.90"))],
        status="pending",
        total=Decimal("99.80"),
        created_at=datetime.utcnow(),
    ).save()

    response = client.post(f"/orders/{order.id}/cancel")

    assert response.status_code == 200
```

Nenhuma dessas linhas importa pro que o teste verifica. `company`, `address`, `sku`, `unit_price` existem só porque o MongoEngine exige `required=True` nesses campos e não deixa instanciar o `Document` sem eles. Multiplique esse bloco por trinta ou quarenta testes parecidos e sobram duas saídas: repetir o setup em cada teste que precisa de um pedido, ou empilhar fixtures em `conftest.py` até ninguém mais lembrar exatamente o que cada uma popula.

Nenhuma das duas é boa. A primeira é ruído puro: quem lê o teste precisa escanear quinze linhas de setup pra achar a única que interessa, `status="pending"`. A segunda esconde a informação no lugar errado: quando um teste falha porque um campo obrigatório mudou de nome, a pilha de erro aponta pra dentro de uma fixture que mora em outro arquivo, distante da linha em que a asserção está.

`mongo_bakery` (ferramenta que ajudo a manter, ao lado do Roger Camargo - _In Memoriam_) nasceu tentando fechar exatamente essa lacuna pra quem usa MongoEngine. A inspiração declarada é o `model_bakery` do mundo Django: preencher automaticamente tudo que for obrigatório e deixar o teste explícito só sobre o que aquele caso específico realmente testa.

## Instalação

```bash
uv add mongo-bakery --group dev
```

O nome do pacote no PyPI usa hífen (`mongo-bakery`), mas o import segue o nome do módulo Python, com underscore:

```python
from mongo_bakery import baker
```

## O básico: baker.make preenche só o obrigatório

Os modelos usados no resto do artigo:

```python
from decimal import Decimal
from mongoengine import (
    Document, EmbeddedDocument, EmbeddedDocumentField, EmbeddedDocumentListField,
    ReferenceField, StringField, EmailField, DecimalField, IntField, DateTimeField,
)

class Address(EmbeddedDocument):
    street = StringField(required=True)
    city = StringField(required=True)
    zip_code = StringField(required=True)

class Customer(Document):
    name = StringField(required=True)
    email = EmailField(required=True)
    company = StringField(required=True)
    address = EmbeddedDocumentField(Address, required=True)

class OrderItem(EmbeddedDocument):
    sku = StringField(required=True)
    quantity = IntField(required=True)
    unit_price = DecimalField(required=True, precision=2)

class Order(Document):
    customer = ReferenceField(Customer, required=True)
    items = EmbeddedDocumentListField(OrderItem, required=True)
    status = StringField(required=True, choices=["pending", "paid", "shipped", "cancelled"])
    total = DecimalField(required=True, precision=2)
    created_at = DateTimeField(required=True)
```

`baker.make` instancia e salva o `Document`, gerando um valor pra cada campo `required` que você não passou explicitamente:

```python
customer = baker.make(Customer)
```

Campos com `required=False` ficam no default do MongoEngine (geralmente `None`), a menos que você passe algo. E qualquer kwarg que você passar sempre vence o que seria gerado automaticamente, o que permite usar `baker.make` tanto pra gerar tudo quanto pra fixar só o campo que o teste de fato exercita:

```python
order = baker.make(Order, customer=customer, status="pending")
```

O teste do início do artigo, refeito:

```python
def test_cancel_order_returns_200_for_pending_order(client):
    customer = baker.make(Customer)
    order = baker.make(Order, customer=customer, status="pending")

    response = client.post(f"/orders/{order.id}/cancel")

    assert response.status_code == 200
```

Duas linhas de setup, e a única informação que salta aos olhos é justamente `status="pending"`: é o que o teste quer provar.

## Dado que parece real, não uma palavra aleatória

Pra campos `StringField`, `mongo_bakery` verifica se o nome do campo bate com um provider do Faker antes de cair no fallback de palavra aleatória. `company`, `email` (via `EmailField`) e qualquer outro nome reconhecido pelo Faker saem parecendo dado de produção:

```python
customer = baker.make(Customer)
customer.email    # algo como "ana.souza83@example.com"
customer.company  # algo como "Ferreira e Filhos Comércio"
```

Isso importa em teste de integração que serializa o documento numa resposta JSON e alguém vai revisar esse payload depois. `"asdf1234"` no campo empresa não inspira confiança num exemplo de resposta; `"Ferreira e Filhos Comércio"` sim.

## choices, sequências e reprodutibilidade

Quando o campo declara `choices`, `baker.make` sempre sorteia um valor dentro da lista permitida, então a instância gerada nunca falha a validação do MongoEngine:

```python
order = baker.make(Order)
order.status in ["pending", "paid", "shipped", "cancelled"]  # sempre True
```

Pra gerar uma sequência (um histórico de pedidos ordenado por data, por exemplo), `baker.seq` entrega um valor incremental a cada instância em vez do mesmo valor repetido:

```python
orders = baker.make(
    Order,
    customer=customer,
    created_at=baker.seq(datetime(2026, 1, 1), increment_by=timedelta(days=1)),
    _quantity=5,
)
[order.created_at.day for order in orders]  # [1, 2, 3, 4, 5]
```

E quando um teste falha de forma intermitente porque o dado aleatório bateu numa combinação específica, `baker.seed(valor)` fixa a semente do Faker pra reproduzir exatamente o mesmo dado a cada execução: o suficiente pra debugar o caso sem precisar caçar qual seed o CI usou naquela hora.

## Referências resolvidas sozinhas (com um limite claro)

`customer`, o `ReferenceField` obrigatório em `Order`, não precisa ser passado à mão. `mongo_bakery` resolve `EmbeddedDocumentField`, `ReferenceField` e `LazyReferenceField` recursivamente:

```python
order = baker.make(Order)
order.customer  # um Customer de verdade, gerado e salvo automaticamente
```

Isso funciona bem até o momento em que um `Document` referencia a si mesmo. Uma `Category` hierárquica, em que cada nível aponta pro pai, é o exemplo clássico:

```python
class Category(Document):
    name = StringField(required=True)
    parent = ReferenceField("self", required=True)
```

Gerar uma `Category` automaticamente exigiria gerar outra `Category` pai, que exige outra, indefinidamente. Em vez de estourar `RecursionError` depois de alguns milhares de frames, `mongo_bakery` detecta o ciclo (direto ou indireto, entre dois ou mais tipos) e levanta um `ValueError` explicando qual cadeia de tipos formou o ciclo. A saída é sempre a mesma: passar o valor explícito via kwarg pra quebrar a recursão.

```python
raiz = baker.make(Category, parent=None)
categoria = baker.make(Category, parent=raiz)
```

## Isolando efeito colateral com mock_dependencies

`Document`s do MongoEngine costumam carregar lógica de negócio dentro de `save()`. Um `Order` que, ao ser marcado como pago, dispara uma notificação pro gateway de pagamento:

```python
# orders/models.py
from myapp.integrations.gateway import PaymentGatewayClient

class Order(Document):
    # ...

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if self.status == "paid":
            PaymentGatewayClient().notify_payment_confirmed(self)
```

Gerar um `Order` de teste com `status="paid"` chamaria esse gateway de verdade, a menos que alguém lembre de mockar isso em todo teste que passa por esse caminho. `baker.mock_dependencies` isola o nome informado, mas só nos módulos em que ele de fato aparece:

```python
baker.mock_dependencies(["PaymentGatewayClient"])
order = baker.make(Order, status="paid")  # PaymentGatewayClient vira MagicMock durante a criação
```

Por trás disso, `mongo_bakery` faz um scan do código-fonte do módulo em que `Order` está definido (`orders/models.py`) e só chama `unittest.mock.patch` pros nomes que realmente constam ali. Chamar `baker.make(Customer)` no mesmo teste não tenta patchear `PaymentGatewayClient` em cima do módulo de `Customer`, que nem importa essa classe, e por isso a chamada não quebra.

## A fixture do pytest e o cleanup que ninguém precisa lembrar

Instalado o pacote, o plugin do pytest já registra a fixture `baker` automaticamente, via entry point `pytest11` (o mesmo mecanismo que faz o `pytest-django` funcionar sem configuração extra). Trocar o import direto pela fixture garante limpeza depois de cada teste:

```python
def test_cancel_order_returns_200_for_pending_order(baker, client):
    customer = baker.make(Customer)
    order = baker.make(Order, customer=customer, status="pending")

    response = client.post(f"/orders/{order.id}/cancel")

    assert response.status_code == 200
# baker.cleanup() roda sozinho no teardown, sem chamada explícita
```

Comparado com o bloco de abertura deste artigo, sobraram duas linhas de setup e a asserção. O resto virou trabalho da lib.

## Quando não é a escolha certa

`factory_boy` é a referência do ecossistema Python pra esse problema, mas o suporte a MongoEngine nunca foi de primeira classe: o pacote foi pensado pro Django ORM e pro SQLAlchemy, com MongoEngine coberto por adaptações da comunidade. `mixer` resolve de forma mais genérica, sem entender particularidades como `choices` ou `required` do MongoEngine tão de perto.

Vale registrar com a franqueza de quem mantém o projeto: `mongo_bakery` ainda está classificado como Alpha no PyPI, a cobertura de tipos de campo cresce conforme issues chegam (`GenericReferenceField`, por exemplo, ainda não tem geração automática porque não existe um jeito confiável de adivinhar qual `Document` instanciar sem contexto adicional), e a licença é GPLv3, o que pede atenção em projeto que for redistribuído. Pra suite de testes interna, isso raramente pesa. Pra biblioteca que vira dependência de um produto fechado, vale checar antes de adotar.

Se você mantém um projeto MongoEngine e esbarrar num tipo de campo que a lib ainda não cobre, abre uma issue no repositório ou manda um PR direto (foi assim que a lista de tipos suportados cresceu até aqui). Comentário, dúvida ou bug encontrado, você me acha no Fediverse em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
