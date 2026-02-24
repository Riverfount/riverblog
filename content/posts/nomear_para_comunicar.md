+++
date = '2026-01-13'
draft = false
title = 'Nomear Para Comunicar: Como Escrever Variáveis Claras Concisas e Inteligentes em Python'
tags = ["python", "clean-code", "boas-práticas"]
+++
Saber dar bons nomes é uma das habilidades mais valiosas — e menos ensinadas — na engenharia de software. Em Python,
nomes de variáveis e funções bem escolhidos tornam o código legível, reduzem ambiguidade e ajudam a preservar o design
ao longo do tempo. Seguindo as diretrizes da **PEP 8** e os princípios da **Clean Architecture**, este artigo mostra
como criar nomes expressivos, consistentes e concisos, sem cair na armadilha dos identificadores longos ou genéricos.
Você verá exemplos reais, más práticas comuns e um mini *refactor* que demonstra como nomes claros transformam o código.

## 1. Nomes são parte do design

Um código pode estar correto e, ainda assim, ser difícil de entender. Na maioria das vezes, o problema está nos nomes.
Na **Clean Architecture**, os nomes devem refletir **conceitos de negócio**, não detalhes técnicos ou estruturais.

| Má prática      | Boa prática        | Por quê?                                      |
|-----------------|--------------------|-----------------------------------------------|
| `db_user`       | `user_account`     | Remove o detalhe técnico e foca no domínio.   |
| `json_response` | `order_summary`    | “JSON” é formato, não conceito.               |
| `user_data`     | `customer_profile` | “Data” é genérico; “profile” tem significado. |

A lógica é simples: **nomeie pelo propósito, não pela forma**.

## 2. PEP 8: legibilidade é prioridade

A [PEP 8](https://peps.python.org/pep-0008/#naming-conventions) vai muito além da estética — ela é um guia de 
comunicação entre pessoas.

Algumas regras práticas:

- Use `snake_case` para variáveis e funções.
- Evite abreviações desnecessárias (`cfg`, `cnt`, `ttl`). Prefira nomes completos (`config`, `count`, `total`).
- Use plural para coleções (`users`, `orders`) e singular para elementos únicos (`user`, `order`).
- Remova redundâncias no contexto: dentro de `UserService`, prefira `get_user()` a `get_user_data()`.

```python
# ruim
def list_all_active_user_objects():
    ...

# bom
def list_active_users():
    ...
```

No segundo exemplo, o nome é simples e direto — o leitor entende a intenção de imediato.

## 3. Contexto é autoexplicativo

Bons nomes reduzem a necessidade de comentários. O código deve ser quase uma frase legível.

```python
# ruim
data = get_data()

# bom
user_orders = order_service.fetch_recent_orders(user_id)
```

Outro exemplo comum:

```python
# ruim
flag = True
if flag:
    process()

# bom
should_notify = True
if should_notify:
    send_notification()
```

Quando as variáveis comunicam intenção, o raciocínio flui naturalmente — o código se torna autoexplicativo.

## 4. Clareza e concisão

Nomes longos demais são tão ruins quanto nomes curtos e vagos.
O segredo é deixar o contexto carregar parte do significado.

| Má prática                                          | Boa prática        | Justificativa                     |
|-----------------------------------------------------|--------------------|-----------------------------------|
| `customer_account_balance_after_transaction_update` | `new_balance`      | O contexto já comunica o momento. |
| `temporary_order_price_value`                       | `temp_price`       | Clareza mantida, sem prolixidade. |
| `is_user_valid_and_authenticated`                   | `is_authenticated` | Detalhes extras só atrapalham.    |

A clareza vem do **contexto**, não do tamanho do nome.

## 5. Nomear é projetar

Nomes são uma peça invisível da arquitetura do sistema.  Quando todas as partes falam a mesma língua — a do negócio —,
o código mantém **coesão e resiliência**.  Trocar o banco ou o framework é fácil; perder clareza semântica, porém, é
caro.

Bons nomes **preservam a intenção arquitetural** — mesmo após refatorações.
Eles são a ponte entre design técnico e linguagem de domínio.

## 6. Checklist rápido de boas práticas

1. **Use a linguagem do domínio**, não da tecnologia.
2. **Seja claro, mas evite redundâncias.**
3. **Adapte a granularidade**: nomes locais curtos, nomes globais descritivos.
4. **Descreva propósito, não formato técnico.**
5. **Evite genéricos** (`data`, `info`, `object`).
6. **Mantenha consistência terminológica.**
7. **Não exponha infraestrutura** (`db_`, `api_`, `json_`) em camadas de domínio.
8. **Reveja nomes em PRs** — eles comunicam tanto quanto o código em si.

## 7. Exemplo prático de refatoração

Um exemplo simples mostra o poder de nomes bem escolhidos.

**Antes (difícil de entender):**

```python
def p(u, d):
    r = []
    for i in d:
        if i[1] == u:
            r.append(i[0])
    return r
```

Esse código até funciona, mas o leitor não sabe o que `p`, `u`, `d` ou `r` significam.

**Depois (mesma lógica, nomes expressivos):**

```python
def get_orders_by_user(user_id: int, orders: list[tuple[int, int]]) -> list[int]:
    user_orders = []
    for order_id, owner_id in orders:
        if owner_id == user_id:
            user_orders.append(order_id)
    return user_orders
```

Sem mudar nada na lógica, o código agora se explica.  Os nomes contam a história completa — o que está sendo filtrado,
por quê e o que é retornado.

## Conclusão

Dar bons nomes é mais do que estilo: é **comunicação entre mentes técnicas**.  Variáveis bem nomeadas expressam
intenção, reforçam arquitetura e tornam o código sustentável ao longo do tempo.  O nome certo transforma a leitura em
compreensão imediata — e isso é poder puro na engenharia de software.

Se este artigo te fez repensar como você nomeia variáveis, compartilhe com sua equipe ou continue a conversa no
Mastodon:  **[@riverfount@bolha.us](https://bolha.us/@riverfount)**

Espalhe boas práticas e ajude mais pessoas a escrever código que realmente se explica por si só.
