---
title: "JWT: três erros que todo mundo comete na primeira implementação"
date: 2026-03-26
draft: false
tags: ["python", "jwt", "segurança", "autenticação", "intermediário"]
cover:
  image: "images/covers/cover-jwt-erros-implementacao.png"
  alt: "JWT: três erros que todo mundo comete na primeira implementação"
  relative: false
---

Você abre o README do `PyJWT`, copia o exemplo de dez linhas, gera um token, valida do outro lado — e funciona. O token tem o `user_id`, expira em uma hora, a assinatura bate. O que pode estar errado?

Bastante coisa. JWT é um dos padrões mais mal implementados em aplicações web, não porque seja complicado, mas porque os exemplos básicos funcionam mesmo com configurações que criam vulnerabilidades sérias. O código roda, os testes passam, e os problemas aparecem meses depois — ou não aparecem, porque ninguém tentou explorar.

Este artigo começa com uma implementação que parece correta e mostra os três erros mais comuns: o algoritmo `none`, tokens sem revogação, e segredos fracos. Para cada um: o que está errado, como explorar, e como corrigir.

## O ponto de partida

```python
import jwt
from datetime import datetime, timedelta

SECRET = "secret"

def create_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.utcnow() + timedelta(hours=1),
    }
    return jwt.encode(payload, SECRET, algorithm="HS256")

def verify_token(token: str) -> dict:
    return jwt.decode(token, SECRET, algorithms=["HS256"])
```

Funciona. Mas tem três problemas que vamos desmontar um a um.

## Erro 1: aceitar o algoritmo que o token declara

O JWT tem três partes separadas por ponto: header, payload e assinatura, todas em Base64URL. O header declara qual algoritmo foi usado para assinar. Numa implementação ingênua, o servidor lê esse header e usa o algoritmo que o *token informa* para validar — não o algoritmo que o servidor espera.

O algoritmo `none` é válido pela especificação original do JWT. Ele significa "sem assinatura". Um token com `"alg": "none"` no header e assinatura vazia é tecnicamente bem-formado, e versões antigas de bibliotecas (incluindo `PyJWT < 2.0`) aceitavam isso por padrão.

O ataque é direto: pegar um token válido, decodificar o Base64URL do header e do payload, modificar o payload (por exemplo, trocar `"sub": "42"` por `"sub": "1"` para virar admin), remontar com `"alg": "none"` e assinatura vazia.

```python
import base64
import json

# Simula um token legítimo decodificado
header = base64.urlsafe_b64encode(
    json.dumps({"alg": "none", "typ": "JWT"}).encode()
).rstrip(b"=").decode()

payload = base64.urlsafe_b64encode(
    json.dumps({"sub": "1", "exp": 9999999999}).encode()
).rstrip(b"=").decode()

# Token forjado: sem assinatura
forged = f"{header}.{payload}."
```

Na versão atual do `PyJWT`, isso já não funciona da forma mais óbvia — a biblioteca exige que você passe `algorithms` explicitamente no `decode`, e ela rejeita `none` por padrão se você passar qualquer algoritmo real. Mas o problema continua latente em duas situações.

A primeira é quando o código usa `options={"verify_signature": False}` para "testar" e esse flag escapa para produção. A segunda é a variante RS256 → HS256: quando o servidor usa RS256 (chave pública/privada), um atacante pode tentar recodificar o token com HS256 usando a chave *pública* como segredo, se o servidor aceitar ambos os algoritmos.

O fix é simples e deve ser seguido à risca: nunca use `algorithms=["HS256", "RS256"]` junto. Defina um algoritmo único e seja explícito.

```python
ALGORITHM = "HS256"

def verify_token(token: str) -> dict:
    return jwt.decode(
        token,
        SECRET,
        algorithms=[ALGORITHM],  # lista com um único item
    )
```

Se a aplicação precisa suportar múltiplos algoritmos por razões de migração, use lógica explícita: inspecione o header *fora* do `decode`, valide que o algoritmo está na lista de permitidos, e só então decodifique.

## Erro 2: não ter mecanismo de revogação

JWT é stateless por design. O servidor não guarda nada — a validade está dentro do token. Isso é a vantagem principal e o problema principal ao mesmo tempo.

Considere o cenário mais comum: um usuário reporta que o celular foi roubado. Você quer invalidar a sessão dele imediatamente. Com JWT puro, não tem como. O token continua válido até expirar, e se o `exp` for de 24 horas ou 7 dias (o que é comum em apps mobile), o atacante tem uma janela enorme.

O mesmo problema aparece em logout. A maioria das implementações de "logout com JWT" simplesmente apaga o token do lado do cliente. O token em si continua válido. Quem capturou via XSS ou interceptação ainda consegue usar.

Há duas abordagens para revogação. A primeira é manter uma blocklist de tokens revogados. O servidor guarda os `jti` (JWT ID) dos tokens invalidados, e verifica na blocklist a cada request. O `jti` é uma claim padrão do JWT, um UUID único por token.

```python
import uuid
from datetime import datetime, timedelta
import redis

r = redis.Redis(host="localhost", port=6379, db=0)

def create_token(user_id: int) -> str:
    jti = str(uuid.uuid4())
    exp = datetime.utcnow() + timedelta(hours=1)
    payload = {
        "sub": str(user_id),
        "exp": exp,
        "jti": jti,
    }
    return jwt.encode(payload, SECRET, algorithm=ALGORITHM)

def revoke_token(token: str) -> None:
    payload = jwt.decode(token, SECRET, algorithms=[ALGORITHM])
    jti = payload["jti"]
    # TTL = tempo restante até o token expirar naturalmente
    exp = datetime.utcfromtimestamp(payload["exp"])
    ttl = int((exp - datetime.utcnow()).total_seconds())
    if ttl > 0:
        r.setex(f"revoked:{jti}", ttl, "1")

def verify_token(token: str) -> dict:
    payload = jwt.decode(token, SECRET, algorithms=[ALGORITHM])
    jti = payload["jti"]
    if r.exists(f"revoked:{jti}"):
        raise jwt.InvalidTokenError("Token revogado")
    return payload
```

A segunda abordagem é usar tokens de vida curta com refresh tokens. O access token expira em 15 minutos. O refresh token (opaco, armazenado no servidor) dura 30 dias e é o único que precisa de revogação. Na maioria dos fluxos de logout e sessão comprometida, só o refresh token precisa ser invalidado.

```python
def create_access_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.utcnow() + timedelta(minutes=15),
        "type": "access",
    }
    return jwt.encode(payload, SECRET, algorithm=ALGORITHM)

def create_refresh_token(user_id: int) -> str:
    # Refresh token é um UUID opaco guardado no banco
    token = str(uuid.uuid4())
    expires_at = datetime.utcnow() + timedelta(days=30)
    # Persistir no banco: INSERT INTO refresh_tokens (token, user_id, expires_at)
    return token
```

As duas abordagens introduzem estado no servidor, o que tecnicamente compromete o "stateless puro" do JWT. Isso é um trade-off real. A escolha depende do contexto: para APIs públicas com tokens de vida muito curta, a blocklist pode ser dispensada. Para qualquer coisa com usuários reais e sessões que importam, alguma forma de revogação é necessária.

## Erro 3: segredo fraco e sem rotação

O código do início usa `SECRET = "secret"`. Isso é óbvio demais para passar em code review, mas variações do problema são comuns: segredos de 16 caracteres, segredos hardcoded no código (commitados no git), segredos lidos de variáveis de ambiente sem validação de tamanho.

HS256 é um HMAC com SHA-256. A força da assinatura depende inteiramente do comprimento e da entropia do segredo. Um segredo curto é vulnerável a ataques de força bruta offline — o atacante captura um token válido e testa segredos até a assinatura bater. Ferramentas como `hashcat` têm suporte nativo a JWT HS256.

O mínimo razoável para HS256 é um segredo de 256 bits (32 bytes) gerado com um CSPRNG. Não uma string legível por humanos — bytes aleatórios.

```python
import secrets

# Gerar uma vez e salvar como variável de ambiente
SECRET = secrets.token_bytes(32)
```

Para produção, o segredo não deve estar no código nem no `.env` commitado. O artigo sobre variáveis de ambiente e secrets vai cobrir isso em detalhe, mas o fluxo básico é: segredo gerado uma vez, armazenado em cofre (Vault, AWS Secrets Manager, GCP Secret Manager), injetado como variável de ambiente na inicialização do serviço.

Se a aplicação já usa RS256 ou ES256, o problema do segredo fraco não existe da mesma forma — mas a gestão da chave privada vira o problema equivalente. Chave privada no repositório é o mesmo erro com outro nome.

A rotação de segredos é o passo que quase ninguém implementa. O plano mínimo: suporte a múltiplas versões de chave no verify (aceitar tokens assinados com a chave anterior durante uma janela de transição), troque a chave periodicamente, invalide tokens antigos após a janela.

```python
# Suporte a múltiplas chaves durante rotação
SECRETS = {
    "v2": b"<novo segredo de 32 bytes>",
    "v1": b"<segredo anterior>",
}
CURRENT_VERSION = "v2"

def create_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.utcnow() + timedelta(hours=1),
        "kid": CURRENT_VERSION,  # key ID no payload
    }
    secret = SECRETS[CURRENT_VERSION]
    return jwt.encode(payload, secret, algorithm=ALGORITHM)

def verify_token(token: str) -> dict:
    # Decodifica sem verificar para ler o kid
    unverified = jwt.decode(token, options={"verify_signature": False}, algorithms=[ALGORITHM])
    kid = unverified.get("kid", "v1")
    secret = SECRETS.get(kid)
    if not secret:
        raise jwt.InvalidTokenError("Versão de chave desconhecida")
    return jwt.decode(token, secret, algorithms=[ALGORITHM])
```

## Juntando tudo

Uma implementação que cobre os três problemas fica assim:

```python
import uuid
import secrets
from datetime import datetime, timedelta
import jwt
import redis

SECRET = secrets.token_bytes(32)  # em produção: vem do cofre de secrets
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 15

r = redis.Redis(host="localhost", port=6379, db=0)

def create_access_token(user_id: int) -> str:
    jti = str(uuid.uuid4())
    exp = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": str(user_id),
        "exp": exp,
        "iat": datetime.utcnow(),
        "jti": jti,
        "type": "access",
    }
    return jwt.encode(payload, SECRET, algorithm=ALGORITHM)

def verify_access_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, SECRET, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise ValueError("Token expirado")
    except jwt.InvalidTokenError as e:
        raise ValueError(f"Token inválido: {e}")

    if payload.get("type") != "access":
        raise ValueError("Tipo de token incorreto")

    jti = payload["jti"]
    if r.exists(f"revoked:{jti}"):
        raise ValueError("Token revogado")

    return payload

def revoke_access_token(token: str) -> None:
    payload = jwt.decode(
        token,
        SECRET,
        algorithms=[ALGORITHM],
        options={"verify_exp": False},  # pode estar expirado, mas ainda revogamos
    )
    jti = payload["jti"]
    exp = datetime.utcfromtimestamp(payload["exp"])
    ttl = max(0, int((exp - datetime.utcnow()).total_seconds()))
    if ttl > 0:
        r.setex(f"revoked:{jti}", ttl, "1")
```

Algoritmo fixo no verify, `jti` em todo token, revogação via Redis com TTL automático, segredo com entropia adequada. Não é a implementação mais sofisticada possível — mas cobre o que a maioria das implementações "que funcionam" não cobre.

---

JWT é um daqueles padrões que a especificação deixou flexível demais para ser seguro por padrão. Defaults ruins, algoritmos opcionais problemáticos, ausência de revogação no design original. Conhecendo as armadilhas, dá para usar bem. Sem conhecê-las, é fácil ter uma implementação que passa em todos os testes e falha quando importa.

Se você usa JWT de forma diferente do que está aqui — ou se encontrou outros erros comuns que ficaram de fora — a conversa continua no Fediverse em `@riverfount@bolha.us`.
