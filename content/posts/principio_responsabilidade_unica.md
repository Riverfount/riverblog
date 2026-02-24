+++
date = '2025-11-09'
draft = false
title = 'O Princípio da Responsabilidade Única em Python: menos é mais'
tags = ["solid", "clean-code", "design-patterns"]
+++
Em Python, é comum — especialmente pela flexibilidade da linguagem e pelo foco em produtividade — cairmos na armadilha de escrever grandes blocos de código em uma única função, método ou rota. Às vezes, é tentador resolver “tudo em um só lugar”: validar os dados, consultar o banco, tratar erros e ainda montar a resposta final.

Mas essa abordagem tem um preço. O código cresce, as responsabilidades se misturam e, de repente, você tem uma função que faz de tudo — e nada bem feito.

## O que diz o Princípio da Responsabilidade Única (SRP)

Diretamente inspirado no primeiro princípio do SOLID, o SRP (“Single Responsibility Principle”) afirma que cada função, classe ou módulo deve **ter apenas um motivo para mudar**. Em outras palavras, cada unidade de código deve ter uma responsabilidade bem definida.

Isso melhora a legibilidade, reduz o acoplamento e torna o sistema muito mais fácil de evoluir.

Vamos ver um exemplo prático.

## Exemplo: o anti-padrão

```python
@app.route("/users", methods=["POST"])
def create_user():
    # 1. Validação
    data = request.json
    if "email" not in data:
        return {"error": "Email is required"}, 400

    # 2. Inserção no banco
    conn = sqlite3.connect("db.sqlite")
    cursor = conn.cursor()
    cursor.execute("INSERT INTO users (email) VALUES (?)", (data["email"],))
    conn.commit()
    conn.close()

    # 3. Notificação (simulada)
    send_welcome_email(data["email"])

    return {"message": "User created successfully"}, 201
```

Essa rota funciona, mas concentra três responsabilidades distintas: validação de dados, acesso ao banco e envio de e-mail. Isso viola o SRP.

## Aplicando o princípio

Vamos refatorar o código, dividindo as responsabilidades:

```python
def validate_user_data(data):
    if "email" not in data:
        raise ValueError("Email is required")

def save_user_to_db(email):
    conn = sqlite3.connect("db.sqlite")
    with conn:
        conn.execute("INSERT INTO users (email) VALUES (?)", (email,))
    return True

def send_notification(email):
    send_welcome_email(email)

@app.route("/users", methods=["POST"])
def create_user():
    try:
        data = request.json
        validate_user_data(data)
        save_user_to_db(data["email"])
        send_notification(data["email"])
        return {"message": "User created successfully"}, 201
    except ValueError as e:
        return {"error": str(e)}, 400
```

Agora a rota faz apenas o que deve: coordena o fluxo entre funções auxiliares. Cada função tem uma única responsabilidade clara e testável.

## Por que isso é importante

- **Manutenibilidade:** funções pequenas e claras são mais fáceis de entender e de modificar.
- **Testabilidade:** testar cada parte isoladamente torna-se trivial, facilitando os testes unitários.
- **Reutilização:** funções com responsabilidades únicas podem ser reaproveitadas em outros contextos.
- **Escalabilidade:** um código modular cresce de forma mais previsível e segura.
- **Menor acoplamento:** reduz a dependência entre componentes e torna o sistema mais flexível.
- **Mocks e stubs:** com responsabilidades bem separadas, é mais fácil simular dependências em testes.
- **Depuração:** localizar bugs é muito mais simples quando cada função faz apenas uma coisa.

## Conclusão

Ao olhar para uma função, faça a si mesmo esta pergunta: “Quantas coisas ela faz?”.  Se a resposta for mais de uma, é hora de quebrar o código em partes menores. O princípio da responsabilidade única não é apenas teórico — é uma forma prática de escrever código mais limpo, testável e confiável em Python.

Contate-nos no Mastodon em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
