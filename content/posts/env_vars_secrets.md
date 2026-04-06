---
title: "O .env que você não deveria ter commitado"
date: 2026-04-06
draft: false
tags: ["python", "segurança", "configuração", "pydantic", "dynaconf", "secrets"]
cover:
  image: "images/covers/cover-dotenv-commitado.png"
  alt: "O .env que você não deveria ter commitado"
  relative: false
---

Existe uma busca no GitHub que retorna milhares de resultados úteis para um atacante:
`filename:.env DB_PASSWORD`. Repositórios públicos com arquivos `.env` commitados por
acidente, contendo senhas de banco, chaves de API, segredos JWT — tudo em texto claro,
indexado, pesquisável.

Não é incompetência. É o resultado natural de uma prática que parece razoável: colocar
credenciais num arquivo, adicionar esse arquivo ao `.gitignore`, e confiar que o
`.gitignore` vai proteger. Funciona até o dia que não funciona — um `git add .` no
momento errado, um novo membro do time que clona o repo e cria o `.env` a partir do
`.env.example` sem perceber que o exemplo já tem valores reais, ou um editor que cria
arquivos temporários fora do padrão ignorado.

O problema não é o `.env`. O problema é que `.env` é uma solução de conveniência tratada
como solução de segurança. Este artigo mostra a progressão correta: de `os.environ` bruto
até configuração validada com `pydantic-settings` e `dynaconf`, com os trade-offs explícitos
em cada etapa.

## O ponto de partida: `os.environ` direto

O código mais comum de configuração em projetos Python iniciais:

```python
import os

DATABASE_URL = os.environ["DATABASE_URL"]
SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-insecure")
DEBUG = os.environ.get("DEBUG", "false").lower() == "true"
```

Funciona. E tem três problemas sérios.

O primeiro é que erros de configuração aparecem em tempo de execução, não na inicialização.
`os.environ["DATABASE_URL"]` lança `KeyError` quando a variável não existe — mas só quando
essa linha é executada, não quando a aplicação sobe. Numa aplicação FastAPI, isso significa
que o servidor inicia normalmente, responde a health checks, e explode no primeiro request
que usa o banco.

O segundo é o valor padrão inseguro. `os.environ.get("SECRET_KEY", "dev-secret-insecure")`
é um padrão que vaza para produção com uma frequência alarmante. O dev esquece de setar a
variável no servidor, a aplicação sobe com o valor padrão, e os tokens JWT ficam assinados
com uma chave conhecida.

O terceiro é a conversão manual de tipos. Toda variável de ambiente é uma string. Converter
para `bool`, `int`, `list` ou qualquer outro tipo é responsabilidade do código — e cada
conversão é uma oportunidade para bug silencioso. `"false"` em Python é truthy. O código
acima faz a conversão corretamente, mas exige atenção manual em cada campo.

## `python-dotenv`: carregando `.env` no ambiente

Antes de chegar no `pydantic-settings`, vale entender o papel do `python-dotenv`, que é a
biblioteca que faz o `.env` funcionar em desenvolvimento.

```bash
uv add python-dotenv
```

```python
# settings.py
from dotenv import load_dotenv
import os

load_dotenv()  # lê o .env e popula os.environ

DATABASE_URL = os.environ["DATABASE_URL"]
```

O `.env` na raiz do projeto:

```
DATABASE_URL=postgresql://user:password@localhost:5432/mydb
SECRET_KEY=dev-only-secret-not-for-production
DEBUG=true
```

`load_dotenv()` lê esse arquivo e injeta as variáveis em `os.environ`. Em produção, as
variáveis vêm do ambiente real (Docker, Kubernetes, systemd) e o `load_dotenv()` não
sobrescreve variáveis já definidas — o comportamento padrão é não substituir.

O `.env` deve estar no `.gitignore`. O que vai no repositório é o `.env.example`, com
as chaves mas sem os valores:

```
DATABASE_URL=
SECRET_KEY=
DEBUG=false
```

Isso resolve o commit acidental desde que o time siga a convenção — o que é frágil por
depender de disciplina humana. Ainda não temos validação, ainda temos conversão manual
de tipos, e ainda é possível subir em produção com `SECRET_KEY` vazio.

## `pydantic-settings`: configuração como código

`pydantic-settings` transforma a configuração num objeto com tipos, validação automática
e falha explícita na inicialização se algo estiver errado.

```bash
uv add pydantic-settings
```

```python
# settings.py
from pydantic_settings import BaseSettings
from pydantic import SecretStr, PostgresDsn, field_validator
from typing import Literal


class Settings(BaseSettings):
    database_url: PostgresDsn
    secret_key: SecretStr
    debug: bool = False
    environment: Literal["development", "staging", "production"] = "production"
    allowed_hosts: list[str] = ["localhost"]

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
```

Quando a aplicação inicia, `Settings()` lê as variáveis de ambiente, valida os tipos e
lança `ValidationError` imediatamente se algo estiver faltando ou com formato errado. Não
tem surpresa em tempo de execução.

O campo `database_url: PostgresDsn` valida que a URL segue o formato correto de conexão
PostgreSQL — não é uma string qualquer. Se `DATABASE_URL=banana` estiver no ambiente, a
aplicação não sobe.

`SecretStr` merece atenção especial. É um tipo do Pydantic que armazena strings sensíveis
de forma que elas não aparecem em logs ou `repr`:

```python
>>> print(settings.secret_key)
**********
>>> repr(settings.secret_key)
"SecretStr('**********')"
>>> settings.secret_key.get_secret_value()
'o-valor-real-aqui'
```

Isso evita que um `print(settings)` de debug vaze credenciais em logs de produção — um
vetor de exposição mais comum do que parece.

O campo `allowed_hosts: list[str]` demonstra outra vantagem: o `pydantic-settings` aceita
listas via variável de ambiente usando JSON ou separação por vírgula:

```
ALLOWED_HOSTS=["app.example.com","api.example.com"]
# ou
ALLOWED_HOSTS=app.example.com,api.example.com
```

### Validação customizada

Alguns campos precisam de validação além do tipo. O caso mais comum é o comprimento mínimo
do segredo — como visto no [artigo sobre JWT](https://www.riverfount.dev.br/posts/jwt_tres_erros/),
um segredo curto para HS256 é vulnerável a força bruta.

```python
from pydantic import SecretStr, field_validator
import base64


class Settings(BaseSettings):
    secret_key: SecretStr
    database_url: PostgresDsn
    debug: bool = False

    @field_validator("secret_key")
    @classmethod
    def secret_key_must_be_strong(cls, v: SecretStr) -> SecretStr:
        value = v.get_secret_value()
        if len(value) < 32:
            raise ValueError(
                "SECRET_KEY deve ter no mínimo 32 caracteres. "
                "Gere um com: python -c \"import secrets; print(secrets.token_hex(32))\""
            )
        return v

    @field_validator("debug")
    @classmethod
    def debug_not_allowed_in_production(cls, v: bool, info) -> bool:
        # Acessar outros campos via info.data (disponível após validação dos campos anteriores)
        environment = info.data.get("environment", "production")
        if v and environment == "production":
            raise ValueError("DEBUG=True não é permitido em production")
        return v
```

Agora a aplicação não sobe com `SECRET_KEY=secret` nem com `DEBUG=true` em produção. O
erro aparece no `stdout` durante a inicialização, antes de qualquer request ser processado.

### Singleton e injeção de dependência

O padrão mais comum é instanciar `Settings` uma vez e reutilizar em todo o projeto:

```python
# settings.py
from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    secret_key: SecretStr
    debug: bool = False

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

O `@lru_cache` garante que `Settings()` é instanciado apenas uma vez — o arquivo `.env`
é lido e as variáveis são validadas na primeira chamada, e o resultado fica em cache para
as chamadas seguintes. Em FastAPI, isso se integra naturalmente com `Depends`:

```python
# routes.py
from fastapi import APIRouter, Depends
from .settings import Settings, get_settings

router = APIRouter()


@router.get("/health")
def health_check(settings: Settings = Depends(get_settings)):
    return {
        "status": "ok",
        "environment": settings.environment,
        "debug": settings.debug,
    }
```

E em testes, o `Depends` permite substituir as settings por uma versão de teste sem
modificar o código de produção:

```python
# tests/conftest.py
from app.settings import Settings, get_settings
from app.main import app


def get_test_settings() -> Settings:
    return Settings(
        database_url="postgresql://user:pass@localhost:5432/testdb",
        secret_key="test-secret-key-that-is-long-enough-32chars",
        debug=True,
        environment="development",
    )


app.dependency_overrides[get_settings] = get_test_settings
```

Isso é o padrão de injeção de dependência aplicado à configuração — o mesmo princípio
do [artigo sobre IoC com Dishka](https://www.riverfount.dev.br/posts/injecao_dependencia/).

## Ambientes múltiplos

Projetos reais têm pelo menos três ambientes: desenvolvimento local, staging e produção.
O `pydantic-settings` suporta múltiplos arquivos `.env` com precedência controlada:

```python
class Settings(BaseSettings):
    database_url: PostgresDsn
    secret_key: SecretStr
    debug: bool = False

    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local", ".env.production"),
        env_file_encoding="utf-8",
    )
```

Os arquivos são carregados em ordem, e valores definidos em arquivos posteriores
sobrescrevem os anteriores. `.env` tem os defaults de desenvolvimento, `.env.local` tem
overrides locais (no `.gitignore`), `.env.production` tem configurações de produção (também
no `.gitignore`, e idealmente não existe em disco — os valores vêm do ambiente).

Uma alternativa mais explícita é selecionar o arquivo baseado em variável de ambiente:

```python
import os
from pydantic_settings import BaseSettings, SettingsConfigDict


ENV = os.environ.get("APP_ENV", "development")


class Settings(BaseSettings):
    database_url: PostgresDsn
    secret_key: SecretStr
    debug: bool = False

    model_config = SettingsConfigDict(
        env_file=f".env.{ENV}",
        env_file_encoding="utf-8",
    )
```

Com `.env.development`, `.env.staging` e `.env.production` como arquivos separados —
todos no `.gitignore` exceto `.env.example.*`.

## O que o `.env` não resolve: secrets em produção

Para desenvolvimento local, `.env` é conveniente e suficiente. Para produção, há um
problema estrutural: o `.env` é um arquivo em disco, no servidor, com permissões que
precisam ser gerenciadas manualmente.

A progressão correta para produção é injetar secrets como variáveis de ambiente diretamente
no processo, sem arquivo intermediário. Em Docker:

```yaml
# docker-compose.yml (desenvolvimento)
services:
  api:
    image: myapp
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - SECRET_KEY=${DATABASE_URL}
```

```dockerfile
# Produção: variáveis vêm do orquestrador, não de arquivo
# Kubernetes Secret, AWS ECS Task Definition, etc.
```

Em Kubernetes, secrets são objetos separados injetados como variáveis de ambiente ou
volumes:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: app-secrets
type: Opaque
stringData:
  SECRET_KEY: "valor-real-aqui"
  DATABASE_URL: "postgresql://..."
---
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
        - name: api
          envFrom:
            - secretRef:
                name: app-secrets
```

Para aplicações que precisam de rotação de secrets sem redeploy, ou que têm múltiplos
serviços compartilhando credenciais, a solução é um cofre de secrets dedicado. HashiCorp
Vault, AWS Secrets Manager e GCP Secret Manager seguem o mesmo padrão: a aplicação se
autentica no cofre na inicialização e busca os secrets via API, sem que eles existam em
disco ou variáveis de ambiente do sistema operacional.

```python
# Exemplo com AWS Secrets Manager
import boto3
import json
from pydantic_settings import BaseSettings


def get_secret_from_aws(secret_name: str) -> dict:
    client = boto3.client("secretsmanager", region_name="us-east-1")
    response = client.get_secret_value(SecretId=secret_name)
    return json.loads(response["SecretString"])


class Settings(BaseSettings):
    database_url: PostgresDsn
    secret_key: SecretStr
    debug: bool = False

    @classmethod
    def from_aws_secrets(cls, secret_name: str) -> "Settings":
        secrets = get_secret_from_aws(secret_name)
        return cls(**secrets)


# Na inicialização em produção:
# settings = Settings.from_aws_secrets("myapp/production")
#
# Em desenvolvimento:
# settings = Settings()  # lê do .env
```

Isso separa o mecanismo de entrega dos secrets do código de configuração — o `Settings`
continua sendo validado pelo Pydantic independente de onde os valores vieram.

## `dynaconf`: quando a configuração é mais do que variáveis de ambiente

`pydantic-settings` resolve validação e tipagem — é a escolha certa quando o foco é
garantir que a aplicação não sobe com configuração errada. O Dynaconf resolve um problema
diferente: gerenciar configuração de múltiplos ambientes a partir de múltiplas fontes,
com merge automático e hierarquia de precedência.

```bash
uv add dynaconf
```

A diferença mais visível na prática: enquanto `pydantic-settings` lê variáveis de ambiente
e arquivos `.env`, o Dynaconf lê `.env`, `.toml`, `.yaml`, `.json`, Redis, Vault e
variáveis de ambiente — tudo ao mesmo tempo, com ordem de precedência configurável.

A estrutura básica de um projeto com Dynaconf:

```
myapp/
├── config.py
├── settings.toml        # configurações por ambiente
├── .secrets.toml        # secrets locais (no .gitignore)
└── .env                 # overrides de ambiente (no .gitignore)
```

O `settings.toml` organiza a configuração por ambiente sem precisar de múltiplos arquivos:

```toml
# settings.toml
[default]
debug = false
database_url = "postgresql://localhost:5432/myapp"
allowed_hosts = ["localhost"]

[development]
debug = true
database_url = "postgresql://localhost:5432/myapp_dev"

[staging]
database_url = "@format postgresql://localhost:5432/myapp_staging"
allowed_hosts = ["staging.example.com"]

[production]
allowed_hosts = ["app.example.com", "api.example.com"]
```

O `.secrets.toml` segue a mesma estrutura, mas fica fora do repositório:

```toml
# .secrets.toml (no .gitignore)
[default]
secret_key = "dev-secret-apenas-local"

[production]
secret_key = "chave-real-de-producao"
```

O `config.py` inicializa o Dynaconf apontando para esses arquivos:

```python
# config.py
from dynaconf import Dynaconf

settings = Dynaconf(
    envvar_prefix="MYAPP",       # variáveis de ambiente: MYAPP_SECRET_KEY, MYAPP_DEBUG
    settings_files=["settings.toml", ".secrets.toml"],
    environments=True,           # ativa a leitura por seção [development], [production]
    env_switcher="MYAPP_ENV",    # ENV=production para selecionar o ambiente
    load_dotenv=True,
)
```

Para selecionar o ambiente, basta setar a variável `MYAPP_ENV`:

```bash
MYAPP_ENV=production uvicorn app.main:app
```

O Dynaconf faz o merge automático: começa com os valores de `[default]`, sobrescreve com
os de `[production]`, e por fim aplica qualquer variável de ambiente com prefixo `MYAPP_`.
A precedência final é sempre: variável de ambiente > `.secrets.toml` > `settings.toml`.

O uso no código é direto:

```python
from config import settings

print(settings.DATABASE_URL)   # acesso por atributo, case-insensitive
print(settings.SECRET_KEY)
print(settings.DEBUG)
print(settings.current_env)    # "production", "development", etc.
```

### Dynaconf com validação

O Dynaconf tem seu próprio mecanismo de validação, que roda na inicialização:

```python
from dynaconf import Dynaconf, Validator

settings = Dynaconf(
    envvar_prefix="MYAPP",
    settings_files=["settings.toml", ".secrets.toml"],
    environments=True,
    env_switcher="MYAPP_ENV",
    validators=[
        Validator("SECRET_KEY", must_exist=True, len_min=32),
        Validator("DATABASE_URL", must_exist=True),
        Validator("DEBUG", is_type_of=bool),
        # Em produção, DEBUG deve ser False
        Validator("DEBUG", eq=False, when=Validator("MYAPP_ENV", eq="production")),
    ],
)
```

`settings.validators.validate_all()` pode ser chamado explicitamente na inicialização da
aplicação para garantir falha imediata com mensagem clara:

```python
# main.py
from config import settings

settings.validators.validate_all()  # lança ValidationError se algo estiver errado
```

### Quando usar cada um

O `pydantic-settings` é a escolha natural quando o projeto já usa Pydantic extensivamente
— em FastAPI, por exemplo, a integração com `Depends` e a consistência com os modelos de
request/response fazem sentido. A validação é mais expressiva para tipos complexos, e o
`SecretStr` é um recurso que o Dynaconf não tem nativamente.

O Dynaconf brilha quando a configuração é complexa por si só: múltiplos ambientes com
valores distintos, merge de fontes heterogêneas (TOML + Redis + Vault), ou projetos que
não usam FastAPI e não têm Pydantic como dependência central. A sintaxe TOML por ambiente
num único arquivo é mais legível do que múltiplos arquivos `.env.*`.

Os dois podem coexistir: Dynaconf para carregar e organizar a configuração por ambiente,
`pydantic-settings` para validar e tipar o resultado. Mas na maioria dos projetos, escolher
um e usar bem é suficiente.

## O checklist antes de fazer deploy

A maioria dos vazamentos acontece não por falta de conhecimento, mas por falta de processo.
O checklist mínimo:

Antes de qualquer commit, verificar se o `.gitignore` tem `.env*` (com exceção de
`.env.example*`). Antes de qualquer deploy, verificar que nenhuma variável de ambiente tem
valor padrão inseguro no código — `os.environ.get("SECRET_KEY", "fallback")` é um sinal
vermelho. Na inicialização da aplicação, o `Settings()` deve falhar explicitamente se
qualquer secret obrigatório estiver ausente ou fraco — não silenciosamente usar um default.

Uma ferramenta útil para o processo de desenvolvimento é o `truffleHog` ou o `git-secrets`,
que fazem scan do histórico do repositório em busca de padrões que parecem credenciais.
Rodá-los no CI evita que um commit acidental chegue ao repositório remoto.

---

`.env` não é o inimigo. É uma ferramenta com um escopo específico: conveniência em
desenvolvimento local. O problema é quando ele assume um papel que não é o dele —
mecanismo de segurança em produção, substituto para gestão de secrets, ou truque para
"não commitar credenciais" sem o processo que torna isso confiável.

`pydantic-settings` e `dynaconf` resolvem problemas diferentes e complementares:
validação com tipos e falha explícita na inicialização de um lado, gestão de múltiplos
ambientes e fontes heterogêneas do outro. O resto é processo e infraestrutura — e esse
passo é de cada equipe.

Comentários, casos que ficaram de fora, abordagens diferentes: a conversa continua no
Fediverse em `@riverfount@bolha.us`.
