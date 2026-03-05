---
title: "Argon2 em Python: o jeito certo de guardar senhas"
date: 2026-03-05
draft: false
tags: ["python", "segurança", "criptografia", "arquitetura"]
summary: "MD5, SHA-256 e bcrypt ainda aparecem em bases de código novas. O que está errado nessa escolha, como o Argon2 resolve o problema e por que o pepper é a camada extra que separa uma implementação boa de uma implementação sólida."
---

Este artigo foi inspirado pelo vídeo
[*O QUE NINGUÉM TE ENSINOU SOBRE ARMAZENAR SENHAS NO BANCO DE DADOS!*](https://youtu.be/VW2mywTTz80),
do Renato Augusto, do canal [RenatoAugustoTech](https://www.youtube.com/@RenatoAugustoTech).
Se você ainda não assistiu, vale muito o tempo — foi assistindo a ele que a ficha caiu sobre o quanto esse tema é negligenciado no dia a dia de quem desenvolve sistemas com autenticação. O Renato apresenta o problema com clareza e didática. A ideia aqui é ir um passo além: mostrar a implementação completa em Python com foco em decisões de arquitetura, incluindo o uso de **pepper** — uma técnica que a maioria das implementações deixa de fora e que pode ser a diferença entre um vazamento de banco de dados catastrófico e um incidente contido.

Existe um padrão que se repete em revisões de código de sistemas com autenticação. O desenvolvedor implementou o fluxo correto: formulário, validação, persistência. Mas na hora de gravar a senha, aparece algo assim:

```python
import hashlib
senha_hash = hashlib.sha256(senha.encode()).hexdigest()
```

Às vezes é MD5. Às vezes é `bcrypt` com o fator de custo padrão de 2012. A lógica parece razoável — afinal, a senha não está em texto puro. O problema é que "não está em texto puro" e "está protegida" são coisas completamente diferentes.

Este artigo explica por que isso importa, o que o Argon2 faz diferente, como o pepper adiciona uma camada de proteção que o banco de dados sozinho não oferece e como implementar tudo isso corretamente em Python — incluindo o detalhe que a maioria dos tutoriais ignora: o que fazer quando seus parâmetros de segurança ficam desatualizados.

## O problema com funções de hash genéricas

SHA-256, MD5 e SHA-1 foram projetados para velocidade. Eles existem para verificar integridade de arquivos, assinar certificados, construir MACs. Nesse contexto, velocidade é uma virtude.

Para senhas, velocidade é o inimigo.

Uma GPU moderna consegue calcular bilhões de hashes SHA-256 por segundo. Se um banco de dados vaza e o atacante tem os hashes, um ataque de dicionário com regras consegue quebrar a maioria das senhas comuns em minutos. A memória necessária para esse ataque é mínima, o paralelismo é trivial e o hardware especializado (ASICs) torna o processo ainda mais eficiente.

Funções de hash para senhas precisam ser deliberadamente lentas e consumir recursos suficientes para tornar ataques em larga escala economicamente inviáveis. Esse é exatamente o problema que o Argon2 resolve.

## O que é o Argon2

O Argon2 venceu a *Password Hashing Competition* em 2015 — uma competição pública com critérios explícitos de segurança, análise de resistência a hardware especializado e revisão pela comunidade criptográfica. Ele é a recomendação atual do OWASP e do RFC 9106 para hashing de senhas.

O algoritmo tem três variantes:

- **Argon2d**: maximiza resistência a ataques com GPU, mas é vulnerável a ataques de canal lateral. Não use para senhas.
- **Argon2i**: resistente a ataques de canal lateral, indicado para derivação de chaves criptográficas.
- **Argon2id**: híbrido entre as duas. É a variante recomendada para autenticação de usuários.

O que diferencia o Argon2 de bcrypt e scrypt não é apenas a segurança maior — é a **parametrização explícita e independente** de três dimensões de custo:

| Parâmetro | O que controla | Efeito no atacante |
|---|---|---|
| `time_cost` | Número de iterações | CPU mais cara por tentativa |
| `memory_cost` | RAM consumida (em KiB) | Inviabiliza paralelismo com GPU/ASIC |
| `parallelism` | Threads simultâneas | Exige hardware com múltiplos núcleos |

bcrypt só permite ajustar o tempo. scrypt permite memória e tempo, mas não threads. Argon2id controla os três de forma independente, o que permite calibrar o custo para o hardware disponível no servidor sem sacrificar nenhuma dimensão de resistência.

## Salt e pepper: qual a diferença e por que você precisa dos dois

Antes de ir para o código, vale esclarecer dois conceitos que costumam ser confundidos — e que têm papéis distintos na proteção das senhas.

O **salt** é um valor aleatório gerado individualmente para cada senha no momento do hash. Ele é armazenado junto com o hash no banco de dados e serve para garantir que duas senhas idênticas produzam hashes diferentes — o que invalida ataques de rainbow table e força o atacante a quebrar cada senha individualmente. O Argon2 gera e gerencia o salt automaticamente.

O **pepper** é um segredo global da aplicação — uma string longa e aleatória, única para toda a aplicação, que é concatenada à senha antes do hash e **nunca** armazenada no banco de dados. Ela vive exclusivamente como variável de ambiente no servidor.

A diferença estratégica é importante: o salt protege contra ataques que partem dos hashes no banco. O pepper protege contra o cenário em que o banco de dados inteiro vaza. Se um atacante obtém o dump do banco mas não tem acesso ao servidor (e portanto não conhece o pepper), os hashes são computacionalmente inúteis — mesmo com Argon2, sem o pepper não há como verificar nenhuma senha.

```
senha_final = senha_digitada + pepper
hash        = argon2id(senha_final)  ← isso vai para o banco
pepper      = APP_PEPPER             ← isso fica só no servidor
```

Juntos, salt e pepper cobrem cenários de ataque complementares. Separados, cada um cobre apenas metade do problema.

## Instalação

```bash
pip install argon2-cffi dynaconf
```

`argon2-cffi` é o binding Python para a implementação de referência em C do Argon2. [`dynaconf`](https://www.dynaconf.com) é uma biblioteca de gerenciamento de configuração que segue os princípios do [12-factor app](https://12factor.net/config) — ela unifica variáveis de ambiente, arquivos `.toml`/`.yaml`/`.json` e secrets em uma única interface, com suporte a múltiplos ambientes (development, testing, staging, production) e validação declarativa de configuração. É a forma mais robusta de lidar com o pepper e com os demais parâmetros da aplicação sem espalhar `os.environ` pelo código.

## Configurando o Dynaconf

Inicialize o Dynaconf na raiz do projeto:

```bash
dynaconf init -f toml
```

O comando gera três arquivos:

```
.
├── config.py       # ponto de importação do objeto settings
├── settings.toml   # configurações da aplicação (vai para o repositório)
└── .secrets.toml   # segredos locais (não vai para o repositório — já está no .gitignore)
```

Defina os parâmetros não sensíveis em `settings.toml`:

```toml
[default]
ARGON2_TIME_COST     = 3
ARGON2_MEMORY_COST   = 65536
ARGON2_PARALLELISM   = 4
ARGON2_HASH_LEN      = 32
ARGON2_SALT_LEN      = 16

[production]
ARGON2_MEMORY_COST   = 131072  # 128 MB em produção, se o hardware permitir
```

E o pepper em `.secrets.toml` — que **nunca deve ser versionado**:

```toml
[default]
APP_PEPPER = "substitua-por-um-valor-gerado-com-secrets-token-hex-32"
```

> Para gerar um pepper seguro: `python -c "import secrets; print(secrets.token_hex(32))"`

Em produção, prefira injetar o pepper via variável de ambiente do servidor (ou um serviço como AWS Secrets Manager) em vez de usar o `.secrets.toml` — o Dynaconf lê automaticamente variáveis de ambiente prefixadas — e o prefixo é configurável via `envvar_prefix` no `config.py`, não precisa ser necessariamente `DYNACONF_`. Você pode usar o nome da sua aplicação, `APP_`, ou qualquer convenção que faça sentido para o projeto:

```bash
# com o prefixo padrão
export DYNACONF_APP_PEPPER="seu-pepper-de-producao"

# ou com prefixo customizado, se você configurar envvar_prefix="MYAPP"
export MYAPP_APP_PEPPER="seu-pepper-de-producao"
```

O `config.py` gerado pelo `dynaconf init` já está pronto, mas adicione o `envvar_prefix` desejado e um `Validator` para garantir que o pepper esteja sempre presente antes de a aplicação subir:

```python
# config.py
from dynaconf import Dynaconf, Validator

settings = Dynaconf(
    settings_files=["settings.toml", ".secrets.toml"],
    envvar_prefix="MYAPP",  # variáveis de ambiente: MYAPP_APP_PEPPER, MYAPP_DEBUG, etc.
    validators=[
        Validator("APP_PEPPER", must_exist=True, len_min=32),
    ],
)
```

Se `APP_PEPPER` não estiver definido — ou for menor que 32 caracteres — a aplicação falha na inicialização com uma mensagem clara, antes de qualquer requisição ser processada. Esse comportamento ruidoso e precoce é exatamente o que se quer para uma configuração de segurança crítica.

## Uso básico com pepper

Com o Dynaconf configurado, o pepper e os parâmetros do Argon2 são lidos do objeto `settings`:

```python
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from config import settings

ph = PasswordHasher(
    time_cost=settings.ARGON2_TIME_COST,
    memory_cost=settings.ARGON2_MEMORY_COST,
    parallelism=settings.ARGON2_PARALLELISM,
    hash_len=settings.ARGON2_HASH_LEN,
    salt_len=settings.ARGON2_SALT_LEN,
)

def _aplicar_pepper(senha: str) -> str:
    """Concatena o pepper antes de qualquer operação de hash."""
    return senha + settings.APP_PEPPER

# Gerar hash
hash_gerado = ph.hash(_aplicar_pepper("senha_do_usuario"))
# $argon2id$v=19$m=65536,t=3,p=4$<salt_base64>$<hash_base64>

# Verificar
try:
    ph.verify(hash_gerado, _aplicar_pepper("senha_do_usuario"))
    # Verificação bem-sucedida
except VerifyMismatchError:
    # Senha incorreta
    pass
```

O ponto crítico: o pepper é aplicado **antes** do hash, não depois. O Argon2 recebe `senha + pepper` como entrada e gera o hash a partir disso. Na verificação, o mesmo pepper precisa ser aplicado antes de chamar `verify` — sem ele, a verificação sempre falhará, o que torna um vazamento de banco completamente inócuo para o atacante.

## Calibrando os parâmetros

Os parâmetros definidos em `settings.toml` são um ponto de partida razoável. A recomendação mínima do OWASP para Argon2id é `memory_cost=19456` (19 MB), `time_cost=2` e `parallelism=1`. Com o Dynaconf é simples sobrescrever esses valores por ambiente sem tocar no código — basta ajustar a seção `[production]` do `settings.toml` ou exportar a variável de ambiente correspondente no servidor.

Um critério prático: o hash de uma senha deve levar entre **200 ms e 500 ms** no seu hardware de produção. Se estiver abaixo disso, aumente `ARGON2_MEMORY_COST` ou `ARGON2_TIME_COST`. Se estiver acima, reduza — mas nunca abaixo dos mínimos do OWASP.

## O detalhe que a maioria ignora: rehash

O hash do Argon2 carrega os parâmetros com os quais foi gerado. Isso significa que é possível detectar, no momento do login, se o hash armazenado foi criado com parâmetros desatualizados — e recriá-lo silenciosamente com os parâmetros atuais, sem exigir nenhuma ação do usuário.

```python
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
from config import settings

ph = PasswordHasher(
    time_cost=settings.ARGON2_TIME_COST,
    memory_cost=settings.ARGON2_MEMORY_COST,
    parallelism=settings.ARGON2_PARALLELISM,
)

def _aplicar_pepper(senha: str) -> str:
    return senha + settings.APP_PEPPER

def autenticar(hash_armazenado: str, senha_digitada: str) -> tuple[bool, str | None]:
    """
    Retorna (autenticado, novo_hash).
    Se novo_hash não for None, salve no banco de dados — o hash foi atualizado.
    """
    senha_com_pepper = _aplicar_pepper(senha_digitada)

    try:
        ph.verify(hash_armazenado, senha_com_pepper)
    except VerifyMismatchError:
        return False, None
    except VerificationError:
        return False, None

    novo_hash = None
    if ph.check_needs_rehash(hash_armazenado):
        novo_hash = ph.hash(senha_com_pepper)

    return True, novo_hash
```

O fluxo é simples: autenticou → verificou se precisa de rehash → se sim, recriou o hash com pepper e parâmetros atuais → devolveu para ser persistido. Quando os parâmetros em `settings.toml` forem atualizados, os hashes antigos migrarem automaticamente a cada login — sem reset de senha, sem janela de manutenção.

## Implementação completa

Juntando tudo em uma estrutura utilizável em projetos reais:

```python
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
from dataclasses import dataclass
from config import settings

# Instância única — parâmetros lidos do Dynaconf, centralizados em settings.toml
HASHER = PasswordHasher(
    time_cost=settings.ARGON2_TIME_COST,
    memory_cost=settings.ARGON2_MEMORY_COST,
    parallelism=settings.ARGON2_PARALLELISM,
    hash_len=settings.ARGON2_HASH_LEN,
    salt_len=settings.ARGON2_SALT_LEN,
)


def _aplicar_pepper(senha: str) -> str:
    """Concatena o pepper global antes de qualquer operação de hash."""
    return senha + settings.APP_PEPPER


@dataclass
class ResultadoAutenticacao:
    autenticado: bool
    novo_hash: str | None = None  # Não-None indica que o banco deve ser atualizado


def gerar_hash(senha: str) -> str:
    """
    Gera o hash para armazenamento.
    O pepper é aplicado internamente — nunca armazene a senha em texto puro
    nem o pepper no banco de dados.
    """
    return HASHER.hash(_aplicar_pepper(senha))


def autenticar(hash_armazenado: str, senha_digitada: str) -> ResultadoAutenticacao:
    """
    Verifica credenciais e sinaliza necessidade de rehash quando aplicável.

    O campo novo_hash deve ser persistido no banco se não for None.
    Isso garante que hashes antigos sejam atualizados de forma transparente
    à medida que os parâmetros de segurança evoluem.
    """
    senha_com_pepper = _aplicar_pepper(senha_digitada)

    try:
        HASHER.verify(hash_armazenado, senha_com_pepper)
    except VerifyMismatchError:
        return ResultadoAutenticacao(autenticado=False)
    except (VerificationError, InvalidHashError):
        return ResultadoAutenticacao(autenticado=False)

    novo_hash = None
    if HASHER.check_needs_rehash(hash_armazenado):
        novo_hash = HASHER.hash(senha_com_pepper)

    return ResultadoAutenticacao(autenticado=True, novo_hash=novo_hash)


# --- Exemplo de uso ---
if __name__ == "__main__":
    hash_bd = gerar_hash("senha_segura_123")
    print(f"Hash: {hash_bd}\n")

    resultado = autenticar(hash_bd, "senha_segura_123")
    print(f"Autenticado: {resultado.autenticado}")
    print(f"Rehash necessário: {resultado.novo_hash is not None}")

    resultado_errado = autenticar(hash_bd, "senha_errada")
    print(f"\nTentativa inválida — Autenticado: {resultado_errado.autenticado}")
```

## Decisões de arquitetura

Alguns pontos que surgem quando essa implementação entra em um sistema maior:

**Onde instanciar o `PasswordHasher`?** Uma única instância por aplicação, centralizada — seja como singleton, seja injetada via container de dependências. Com o Dynaconf, os parâmetros vêm do `settings` e podem ser sobrescritos por ambiente sem nenhuma mudança no código.

**O rehash deve acontecer na camada de serviço ou de repositório?** Na camada de serviço. O repositório não precisa saber que um hash foi atualizado — ele só precisa persistir o que recebe. A decisão de quando e como rehashear é lógica de domínio.

**O que acontece se o pepper vazar junto com o banco?** O pepper perde eficácia se estiver no mesmo ambiente comprometido. Por isso ele nunca deve estar em arquivos de configuração versionados, nunca no banco, nunca em logs. O `.secrets.toml` do Dynaconf é automaticamente incluído no `.gitignore` — mas em produção a recomendação é injetar o pepper via variável de ambiente do servidor ou via serviço dedicado de secrets (AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault), que o Dynaconf também suporta nativamente.

**E as senhas já armazenadas sem pepper?** A migração é progressiva via rehash no login: ao autenticar com sucesso, aplique o pepper, recalcule o hash e persista o resultado. Usuários inativos nunca migrarão — o que exige manter o código de verificação legado (sem pepper) enquanto a migração ocorre, com uma flag no banco indicando qual versão do hash cada usuário possui.

**Timing attacks são uma preocupação aqui?** A biblioteca `argon2-cffi` implementa comparação em tempo constante internamente. Mas o tempo de resposta do endpoint de login em si ainda pode vazar informação se você retornar imediatamente em caso de usuário inexistente. O padrão correto é sempre executar o `verify` com um hash dummy antes de retornar, para que o tempo de resposta seja consistente independentemente de o usuário existir ou não.

## Comparativo final

| | MD5 / SHA-256 | bcrypt | Argon2id | Argon2id + pepper |
|---|---|---|---|---|
| Velocidade deliberadamente lenta | ❌ | ✅ | ✅ | ✅ |
| Resistência a GPU | ❌ | ⚠️ Moderada | ✅ | ✅ |
| Custo de memória configurável | ❌ | ❌ | ✅ | ✅ |
| Paralelismo configurável | ❌ | ❌ | ✅ | ✅ |
| Rehash automático | ❌ | ❌ | ✅ | ✅ |
| Protege contra vazamento isolado do banco | ❌ | ❌ | ❌ | ✅ |
| Recomendação OWASP atual | ❌ | ⚠️ Legacy | ✅ | ✅ |

## Conclusão

Argon2id resolve o problema de velocidade que torna SHA-256 e MD5 inadequados para senhas. O pepper resolve um problema diferente e complementar: garante que um vazamento isolado do banco de dados não seja suficiente para comprometer nenhuma credencial, porque o segredo necessário para verificar qualquer hash nunca esteve lá. O Dynaconf amarra tudo isso com uma camada de configuração que separa o que é parâmetro do que é segredo, valida a presença do pepper antes de a aplicação subir e facilita a evolução dos valores por ambiente sem tocar no código.

Usados juntos, os três eliminam os vetores de ataque mais comuns em sistemas de autenticação e deixam a configuração de segurança explícita, versionável e auditável.

A decisão de qual algoritmo usar para senhas não deveria ser tratada como detalhe de implementação. Ela afeta diretamente o risco que seus usuários correm em caso de vazamento — e vazamentos acontecem. A pergunta não é se, é quando.

O código está pronto. As bibliotecas são estáveis. Não há justificativa razoável para não fazer.

*Gostou do artigo? Tem dúvidas ou discordâncias? Me encontra no Mastodon em [@riverfount@bolha.us](https://bolha.us/@riverfount) — é lá que acontece a conversa.*