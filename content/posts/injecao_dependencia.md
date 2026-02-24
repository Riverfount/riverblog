+++
date = '2026-02-24T08:05:23-03:00'
draft = false
title = 'Injeção de Dependência em Python sem Frameworks'
+++
Existe uma sequência bastante comum em projetos Python: você escreve uma classe, ela funciona bem, aí chega a hora de testar — e percebe que não dá para testar sem subir um banco de dados, sem fazer uma chamada HTTP real, sem criar um arquivo em disco. O código *funciona*, mas ele não é *testável*. E não testável, na prática, significa frágil.

O problema quase sempre tem a mesma raiz: a classe criou as próprias dependências em vez de recebê-las.

Este artigo trata de Injeção de Dependência — o que é, por que resolve esse problema, e como implementar manualmente em Python antes de cogitar qualquer biblioteca. Entender o mecanismo primeiro é o que distingue usar DI de simplesmente seguir um tutorial.

---

## 1. O Problema: Dependências Acopladas

Veja este código. Ele é direto, funciona, e provavelmente se parece com código que você já escreveu ou leu:

```python
import smtplib
from email.mime.text import MIMEText


class NotificadorDePedido:
    def __init__(self) -> None:
        # a dependência é criada aqui, dentro da classe
        self.smtp = smtplib.SMTP("smtp.empresa.com", 587)

    def notificar(self, destinatario: str, pedido_id: int) -> None:
        mensagem = MIMEText(f"Seu pedido #{pedido_id} foi confirmado.")
        mensagem["Subject"] = "Confirmação de pedido"
        mensagem["From"] = "noreply@empresa.com"
        mensagem["To"] = destinatario
        self.smtp.send_message(mensagem)
```

O problema não é o que o código faz. É o que ele *impossibilita*:

- Não dá para testar `notificar` sem um servidor SMTP acessível
- Não dá para trocar o canal de notificação (push, Slack, SMS) sem alterar a classe
- Não dá para usar um cliente SMTP diferente em produção e em staging sem condicional no código
- Toda instância de `NotificadorDePedido` traz um `smtplib.SMTP` embutido — sem negociação

`NotificadorDePedido` sabe *demais*. Ela sabe que a notificação é por e-mail, que o servidor é `smtp.empresa.com`, e que a porta é 587. Conhecimento que não é responsabilidade dela.

---

## 2. O que é Injeção de Dependência

Injeção de Dependência (DI) é um nome sofisticado para uma ideia simples: **em vez de uma classe criar suas dependências, ela as recebe**.

Quem decide *qual* dependência usar é quem instancia a classe — não a classe em si. Isso inverte o controle: a classe para de controlar a criação e passa a declarar o que precisa.

Vale situar o termo numa hierarquia que aparece bastante em discussões sobre o tema:

- **IoC (Inversão de Controle)** é o princípio mais amplo: quem controla o fluxo e a criação de objetos não é mais o próprio objeto, mas algo externo a ele.
- **DI (Injeção de Dependência)** é um padrão específico de IoC: a dependência é fornecida externamente — por construtor, método ou propriedade.
- **Container de DI** é uma ferramenta: automatiza a composição quando o grafo de dependências cresce a ponto de gerenciar manualmente se tornar custoso.

Esta é a definição que usamos aqui, a mesma estabelecida por Martin Fowler no artigo [*Inversion of Control Containers and the Dependency Injection pattern*](https://martinfowler.com/articles/injection.html) (2004) — que cunhou o termo e classifica constructor injection, setter injection e interface injection como formas legítimas de DI, sem exigir container. O container é opcional; o padrão, não.

Antes de qualquer abstração ou framework, isso se resume a passar a dependência pelo construtor:

```python
class NotificadorDePedido:
    def __init__(self, smtp_client) -> None:
        self.smtp = smtp_client   # recebe, não cria

    def notificar(self, destinatario: str, pedido_id: int) -> None:
        mensagem = MIMEText(f"Seu pedido #{pedido_id} foi confirmado.")
        mensagem["Subject"] = "Confirmação de pedido"
        mensagem["From"] = "noreply@empresa.com"
        mensagem["To"] = destinatario
        self.smtp.send_message(mensagem)
```

É só isso. Não tem mágica. A classe continua fazendo exatamente o mesmo trabalho — mas agora quem chama decide o que passa. Em produção, passa um `smtplib.SMTP` real. Em teste, passa um objeto falso que nem abre conexão.

---

## 3. As Três Formas de Injetar

Dependências podem ser injetadas de três formas diferentes. Cada uma tem seu lugar.

### 3.1 Injeção por Construtor

A mais comum e, na maioria dos casos, a mais correta. A dependência é declarada no `__init__` e fica disponível para toda a vida do objeto:

```python
class ProcessadorDePagamento:
    def __init__(self, gateway) -> None:
        self.gateway = gateway

    def processar(self, valor: float, cartao: str) -> dict:
        return self.gateway.cobrar(valor=valor, cartao=cartao)
```

Use quando a dependência é essencial para o funcionamento do objeto — sem ela, o objeto não faz sentido existir.

### 3.2 Injeção por Método

A dependência é passada diretamente na chamada do método. Útil quando a dependência muda a cada chamada ou quando nem sempre é necessária:

```python
class GeradorDeRelatorio:
    def gerar(self, dados: list[dict], formatador) -> str:
        return formatador.formatar(dados)
```

Use quando a dependência é contextual — a mesma instância da classe pode usar formatadores diferentes em chamadas diferentes.

### 3.3 Injeção por Propriedade

A dependência é atribuída depois da criação do objeto. Menos comum, útil para dependências opcionais:

```python
class Servico:
    def __init__(self) -> None:
        self.logger = None   # opcional

    def executar(self, comando: str) -> None:
        if self.logger:
            self.logger.info(f"Executando: {comando}")
        # lógica principal...

servico = Servico()
servico.logger = MeuLogger()   # injetado depois, se necessário
```

Use com moderação. Dependências opcionais tornam o comportamento do objeto menos previsível — quem lê o código precisa saber o que muda com e sem o logger.

---

## 4. Abstraindo com Protocols

O exemplo anterior já é uma melhoria real, mas ainda tem uma fragilidade: `NotificadorDePedido` aceita qualquer coisa como `smtp_client`. Se alguém passar um objeto que não tem `send_message`, o erro só aparece em runtime, na hora da chamada.

Em Python moderno, o lugar certo para declarar o contrato da dependência é um `Protocol`:

```python
from typing import Protocol
from email.mime.text import MIMEText


class ClienteEmail(Protocol):
    def send_message(self, mensagem: MIMEText) -> None:
        ...


class NotificadorDePedido:
    def __init__(self, smtp_client: ClienteEmail) -> None:
        self.smtp = smtp_client

    def notificar(self, destinatario: str, pedido_id: int) -> None:
        mensagem = MIMEText(f"Seu pedido #{pedido_id} foi confirmado.")
        mensagem["Subject"] = "Confirmação de pedido"
        mensagem["From"] = "noreply@empresa.com"
        mensagem["To"] = destinatario
        self.smtp.send_message(mensagem)
```

`Protocol` define o contrato sem forçar herança. Qualquer objeto que implemente `send_message(mensagem: MIMEText) -> None` satisfaz `ClienteEmail` — o `smtplib.SMTP` real, um mock de teste, um cliente de terceiros. Nenhum deles precisa herdar de `ClienteEmail` explicitamente. O mypy verifica isso em tempo de análise estática, não em runtime.

Essa é a diferença em relação a `ABC` (Abstract Base Class): com `ABC`, as classes precisam herdar e declarar conformidade. Com `Protocol`, a conformidade é estrutural — se tem os métodos certos, satisfaz o contrato. Em Python, isso costuma ser a escolha mais flexível para definir dependências.

---

## 5. Testabilidade na Prática

Aqui é onde a diferença fica concreta. Com a dependência injetável, escrever um teste unitário deixa de exigir infraestrutura real:

```python
# sem DI: impossível testar sem servidor SMTP
# com DI: basta criar um substituto

class ClienteEmailFalso:
    """Implementa o contrato de ClienteEmail sem enviar nada de verdade."""

    def __init__(self) -> None:
        self.mensagens_enviadas: list[MIMEText] = []

    def send_message(self, mensagem: MIMEText) -> None:
        self.mensagens_enviadas.append(mensagem)   # só armazena, não envia


def test_notificar_registra_mensagem() -> None:
    cliente_falso = ClienteEmailFalso()
    notificador = NotificadorDePedido(smtp_client=cliente_falso)

    notificador.notificar(destinatario="joao@email.com", pedido_id=42)

    assert len(cliente_falso.mensagens_enviadas) == 1
    mensagem = cliente_falso.mensagens_enviadas[0]
    assert "42" in mensagem.get_payload()


def test_notificar_nao_envia_sem_destinatario() -> None:
    cliente_falso = ClienteEmailFalso()
    notificador = NotificadorDePedido(smtp_client=cliente_falso)

    # testa o comportamento esperado com entrada inválida
    notificador.notificar(destinatario="", pedido_id=1)

    assert len(cliente_falso.mensagens_enviadas) == 0
```

O teste não abre conexão, não precisa de variável de ambiente, não falha por indisponibilidade de rede. Ele testa exatamente o que deveria testar: o comportamento de `NotificadorDePedido`.

`ClienteEmailFalso` satisfaz o `Protocol` sem herdar nada — basta implementar `send_message` com a assinatura correta. O mypy confirma isso em análise estática.

---

## 6. Um Exemplo Mais Completo — Camadas Reais

DI começa a mostrar seu valor de verdade quando há múltiplas camadas. Veja um caso típico: um serviço de pedidos que depende de repositório e notificador.

**Definindo os contratos:**

```python
from typing import Protocol
from dataclasses import dataclass


@dataclass
class Pedido:
    id: int
    cliente_email: str
    valor: float
    status: str


class RepositorioDePedidos(Protocol):
    def salvar(self, pedido: Pedido) -> None:
        ...

    def buscar(self, pedido_id: int) -> Pedido | None:
        ...


class Notificador(Protocol):
    def notificar(self, destinatario: str, pedido_id: int) -> None:
        ...
```

**A camada de serviço — sem saber nada de banco ou e-mail:**

```python
class ServicoDePedidos:
    def __init__(
        self,
        repositorio: RepositorioDePedidos,
        notificador: Notificador,
    ) -> None:
        self.repositorio = repositorio
        self.notificador = notificador

    def confirmar_pedido(self, pedido_id: int) -> Pedido:
        pedido = self.repositorio.buscar(pedido_id)

        if pedido is None:
            raise ValueError(f"Pedido {pedido_id} não encontrado.")

        if pedido.status == "confirmado":
            raise ValueError(f"Pedido {pedido_id} já foi confirmado.")

        pedido.status = "confirmado"
        self.repositorio.salvar(pedido)
        self.notificador.notificar(pedido.cliente_email, pedido.id)

        return pedido
```

`ServicoDePedidos` não importa SQLAlchemy, não importa smtplib. Ela conhece apenas os contratos — `RepositorioDePedidos` e `Notificador`. Trocar PostgreSQL por SQLite, ou e-mail por Slack, não toca nesta classe.

**As implementações reais ficam em outro lugar:**

```python
import sqlite3


class RepositorioSQLite:
    def __init__(self, conexao: sqlite3.Connection) -> None:
        self.conexao = conexao

    def salvar(self, pedido: Pedido) -> None:
        self.conexao.execute(
            "INSERT OR REPLACE INTO pedidos (id, cliente_email, valor, status) "
            "VALUES (?, ?, ?, ?)",
            (pedido.id, pedido.cliente_email, pedido.valor, pedido.status),
        )
        self.conexao.commit()

    def buscar(self, pedido_id: int) -> Pedido | None:
        cursor = self.conexao.execute(
            "SELECT id, cliente_email, valor, status FROM pedidos WHERE id = ?",
            (pedido_id,),
        )
        row = cursor.fetchone()
        if row is None:
            return None
        return Pedido(id=row[0], cliente_email=row[1], valor=row[2], status=row[3])
```

**E os testes ficam limpos, sem infraestrutura:**

```python
def test_confirmar_pedido_muda_status() -> None:
    pedido_existente = Pedido(
        id=1,
        cliente_email="ana@email.com",
        valor=150.0,
        status="pendente",
    )

    class RepositorioFalso:
        def __init__(self) -> None:
            self.pedidos: dict[int, Pedido] = {1: pedido_existente}
            self.pedidos_salvos: list[Pedido] = []

        def buscar(self, pedido_id: int) -> Pedido | None:
            return self.pedidos.get(pedido_id)

        def salvar(self, pedido: Pedido) -> None:
            self.pedidos_salvos.append(pedido)

    class NotificadorFalso:
        def __init__(self) -> None:
            self.notificacoes: list[tuple[str, int]] = []

        def notificar(self, destinatario: str, pedido_id: int) -> None:
            self.notificacoes.append((destinatario, pedido_id))

    repo = RepositorioFalso()
    notificador = NotificadorFalso()
    servico = ServicoDePedidos(repositorio=repo, notificador=notificador)

    pedido = servico.confirmar_pedido(pedido_id=1)

    assert pedido.status == "confirmado"
    assert len(repo.pedidos_salvos) == 1
    assert len(notificador.notificacoes) == 1
    assert notificador.notificacoes[0] == ("ana@email.com", 1)


def test_confirmar_pedido_inexistente_levanta_erro() -> None:
    class RepositorioVazio:
        def buscar(self, pedido_id: int) -> Pedido | None:
            return None

        def salvar(self, pedido: Pedido) -> None:
            pass

    class NotificadorFalso:
        def notificar(self, destinatario: str, pedido_id: int) -> None:
            pass

    servico = ServicoDePedidos(
        repositorio=RepositorioVazio(),
        notificador=NotificadorFalso(),
    )

    try:
        servico.confirmar_pedido(pedido_id=99)
        assert False, "Deveria ter levantado ValueError"
    except ValueError as e:
        assert "99" in str(e)
```

Toda a lógica de negócio de `confirmar_pedido` está coberta sem tocar em banco de dados ou rede. Cada teste é determinístico, rápido e isolado.

---

## 7. Composição na Borda da Aplicação

Com DI manual, alguém precisa montar as dependências. Esse ponto de montagem tem um nome: **composition root** — a borda da aplicação, onde tudo se conecta.

Em um projeto Python típico, esse lugar é o `main.py`, o arquivo de startup, ou a factory da aplicação:

```python
# main.py — o único lugar que conhece todas as implementações concretas

import sqlite3
import smtplib

from repositorio import RepositorioSQLite
from notificador import NotificadorDePedido
from servico import ServicoDePedidos


def criar_servico() -> ServicoDePedidos:
    conexao = sqlite3.connect("pedidos.db")
    repositorio = RepositorioSQLite(conexao)

    smtp = smtplib.SMTP("smtp.empresa.com", 587)
    notificador = NotificadorDePedido(smtp_client=smtp)

    return ServicoDePedidos(
        repositorio=repositorio,
        notificador=notificador,
    )


if __name__ == "__main__":
    servico = criar_servico()
    pedido = servico.confirmar_pedido(pedido_id=1)
    print(f"Pedido {pedido.id} confirmado.")
```

O que o composition root deixa claro: `ServicoDePedidos` não sabe que existe SQLite. `NotificadorDePedido` não sabe que existe `ServicoDePedidos`. Cada peça conhece apenas o contrato da peça ao lado.

---

## 8. Quando Considerar uma Biblioteca

DI manual funciona bem — e para a maioria dos projetos, é tudo o que você precisa. Mas há situações onde a complexidade da composição começa a crescer: muitas dependências, ciclos de vida diferentes (singleton vs. transient), recriação de dependências por request em APIs.

Quando esse ponto chegar, as principais opções no ecossistema Python são `dependency-injector` e `lagom`. Ambas adicionam um container que gerencia a criação e o ciclo de vida das dependências — mas o que elas fazem é, no fundo, automatizar exatamente o que o `criar_servico()` faz acima.

Quem entende o mecanismo manual usa essas bibliotecas com clareza. Quem pula direto para o framework tende a tratar o container como uma caixa preta — e quando algo dá errado na composição, não sabe onde olhar.

---

## 9. Checklist de Boas Práticas

| # | Prática | Por quê |
|---|---|---|
| 1 | Injete dependências pelo construtor quando são essenciais | Torna obrigatórias as dependências que o objeto não pode funcionar sem |
| 2 | Use `Protocol` para definir contratos, não `ABC` | Conformidade estrutural: nenhuma herança forçada nas implementações |
| 3 | Crie implementações falsas simples nos testes | Mais controle e clareza do que `MagicMock` para dependências com contrato definido |
| 4 | Concentre a composição em um único ponto | Facilita entender o grafo de dependências e trocar implementações |
| 5 | Mantenha a camada de serviço sem imports de infraestrutura | Se `import sqlite3` aparece no serviço, algo está errado |
| 6 | Não injete mais do que o necessário | Uma classe que recebe 5 dependências provavelmente tem responsabilidades demais |
| 7 | Documente os contratos com docstrings nos Protocols | O Protocol é a interface pública — merece a mesma atenção que o código |

---

## 10. Conclusão

Injeção de Dependência não é uma feature do framework. É uma decisão de design — e uma das mais impactantes que você pode tomar num projeto Python.

O que muda na prática: classes que declaram o que precisam em vez de criar o que precisam. Testes que verificam comportamento sem depender de infraestrutura. Código que pode ser lido, alterado e estendido sem surpresas.

Nenhuma dessas propriedades exige biblioteca. Exige disciplina na hora de projetar a interface das classes — e é exatamente aí que `Protocol` se encaixa: define o contrato, deixa o mypy verificar, e permite que qualquer implementação entre sem herança forçada.

Há uma conexão direta com o que já discutimos nos artigos sobre [arquitetura hexagonal](https://www.riverfount.dev.br/posts/arquitetura_hexagonal_em_python/) e [primitive obsession](https://www.riverfount.dev.br/posts/primitive_obsession_no_python/): a camada de domínio não deve conhecer infraestrutura. DI é o mecanismo que torna isso possível na prática — sem ela, a arquitetura hexagonal fica no papel.

Se este artigo te fez repensar como você conecta as peças de um projeto, compartilhe: **[@riverfount@bolha.us](https://bolha.us/@riverfount)**
