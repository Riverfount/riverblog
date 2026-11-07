---
title: 'VPN IPsec com SAML do FortiGate no Arch Linux, sem FortiClient'
date: 2026-11-07
draft: false
tags: ['FortiGate', 'strongSwan', 'IPsec', 'SAML', 'ArchLinux']
cover:
  image: 'images/covers/cover-vpn-fortgate.png'
  alt: 'VPN IPsec com SAML do FortiGate no Arch Linux, sem FortiClient'
  relative: false
---

Eu não queria ter que manter uma VM com Windows só para conectar na VPN da empresa. O problema é que a VPN da ACME (nome fictício) usa um FortiGate com IPsec/IKEv2 e login via SAML, e essa combinação é justamente a que menos tem suporte no Linux. Depois de uma tarde inteira de tentativa e erro, consegui deixar tudo funcionando no Arch com strongSwan e um projeto open source pequeno, mas muito bem pensado. Este texto é o registro do que funcionou, e também do que não funcionou, para poupar o tempo de quem estiver no mesmo barco.

<!--more-->

## O que não funcionou

Minha primeira tentativa foi o caminho óbvio: criar uma conexão IPsec no NetworkManager usando o plugin do strongSwan. Não deu certo por dois motivos. O plugin se recusa a conectar se a PSK tiver menos de 20 caracteres (a mensagem é `Pre-shared key is too short`), e, mesmo que a chave fosse maior, ele não sabe nada sobre o login SAML, que é um fluxo proprietário da Fortinet.

Depois fui para o FortiClient. A versão gratuita para Linux (o pacote `forticlient-vpn`, 7.4.3 no meu caso) até aceita importar o XML de configuração exportado de um FortiClient no Windows, mas ela simplesmente não tem o motor IPsec. A conexão fica eternamente em "Connecting", e nenhum log registra tentativa alguma. Descobri depois que o binário `iked` dessa edição é, na verdade, o cliente de SSL VPN. A versão completa do FortiClient para Linux suporta IPsec com SAML, mas depende de licença e do EMS da empresa.

Um detalhe que me custou um bom tempo: eu tinha restos de tentativas antigas na máquina, incluindo um `ipsec start` esquecido rodando o strongSwan "clássico" e um `charon-nm` travado. Os dois disputavam as portas UDP 500 e 4500, e isso gerava erros silenciosos que não tinham nada a ver com o problema real. Se você já mexeu com IPsec nessa máquina, vale limpar tudo antes:

```bash
nmcli connection delete "VPN ACME"
sudo pkill -x starter; sudo pkill -x charon; sudo pkill -x charon-nm
sudo pacman -Rns networkmanager-strongswan strongswan
```

O strongSwan volta logo adiante, mas sem o plugin do NetworkManager.

## O que funcionou

A solução foi o [fortigate-saml-vpn](https://github.com/quincampoix/fortigate-saml-vpn), um CLI em Python que faz a parte do SAML e entrega o resultado para o strongSwan. O fluxo é assim: o script abre a página de login do FortiGate no navegador (no meu caso, `https://vpn.acme.example:8884/...`), você entra com a conta corporativa normalmente, e o FortiGate redireciona para `http://localhost:8020` com um `tokenid`. O script então carrega no strongSwan um UID temporário como identidade EAP e esse token como senha EAP. Na negociação IKEv2, o servidor se autentica pela PSK e você se autentica por EAP-MSCHAPv2 usando o token. Depois disso, o FortiGate entrega o IP virtual e o DNS interno.

Vale dizer que o projeto é experimental, e o próprio autor recomenda ler o código antes de usar em ambiente corporativo, porque ele executa comandos com `sudo`. O código é curto e dá para revisar em poucos minutos.

## Tirando os parâmetros do XML

A TI me mandou um backup da configuração do FortiClient para Windows (um `.conf` que, na verdade, é um XML). Tudo de que eu precisava estava na seção `<ipsecvpn>`. Esta é a correspondência que usei:

| No XML do FortiClient                   | No strongSwan ou no projeto   |
| --------------------------------------- | ----------------------------- |
| `version` = 2                           | `version = 2`                 |
| `server`                                | `remote_addrs` e `gateway`    |
| `authentication_method` = Preshared Key | `remote { auth = psk }`       |
| `localid`                               | `local { id = ... }`          |
| `sso_enabled` e `xauth` = 1             | `local { auth = eap }`        |
| `ike_saml_port`                         | `saml_port` no `config.toml`  |
| `proposals` e `dhgroup`                 | `proposals` e `esp_proposals` |
| `mode_config` = 1                       | `vips = 0.0.0.0`              |
| `remote_networks` = 0.0.0.0/0           | `remote_ts = 0.0.0.0/0`       |
| `key_life`                              | `rekey_time`                  |

Um ponto que me confundiu no começo: a porta que aparece na configuração (8884 aqui) não é a porta do IPsec, e sim a porta do login SAML no FortiGate (o `auth-ike-saml-port`). A negociação IPsec continua usando as portas padrão 500 e 4500.

## Configurando o strongSwan

Primeiro, instale só o strongSwan, sem o plugin do NetworkManager:

```bash
sudo pacman -S strongswan
```

O serviço que interessa é o `strongswan.service`, que usa o `charon-systemd` e o `swanctl`. O `strongswan-starter` é o antigo `ipsec start` e deve ficar desativado.

A configuração vai em `/etc/swanctl/conf.d/fortinet.conf`, e esse nome precisa ser exatamente esse. Perdi um tempo aqui porque, no começo, tinha dado outro nome ao arquivo. O projeto faz um `include /etc/swanctl/conf.d/fortinet.conf` dentro do `strongswan.py` e só sobrepõe a identidade EAP temporária. Com qualquer outro nome, a conexão é carregada sem a seção `children`, a PSK é descarregada da memória do strongSwan, e o erro que aparece é `CHILD_SA config 'fortigate' not found`, que não dá nenhuma pista da causa. Isso não está no README do projeto.

```
connections {
    fortigate {
        version = 2
        rekey_time = 86400s
        remote_addrs = vpn.acme.example

        local {
            auth = eap
            id = vpn_saml_acme
        }
        remote {
            auth = psk
        }

        proposals = <PROPOSTAS_IKE>
        vips = 0.0.0.0
        fragmentation = yes
        mobike = no
        dpd_delay = 20s

        children {
            fortigate {
                local_ts = dynamic
                remote_ts = 0.0.0.0/0
                esp_proposals = <PROPOSTAS_ESP>
                rekey_time = 43200s
                life_time = 46800s
                dpd_action = clear
            }
        }
    }
}

secrets {
    ike-fortigate {
        id = vpn_saml_acme
        secret = 0s<PSK_EM_BASE64>
    }
}
```

As propostas seguem o formato `cifra-integridade-grupoDH` e saem das seções `<proposals>` e `<dhgroup>` do XML. Por exemplo, uma proposta `AES256|SHA256` com grupo DH 14 vira `aes256-sha256-modp2048`. Se tiver mais de uma, separe por vírgula, na mesma ordem do XML. Se elas não baterem com as do FortiGate, o erro é `NO_PROPOSAL_CHOSEN`.

Sobre a PSK: escrevi primeiro entre aspas e o strongSwan reclamou de `unterminated string detected`, porque a chave tinha caracteres especiais. A saída foi gravar em base64, que o strongSwan aceita com o prefixo `0s` e sem aspas. Para gerar o valor sem deixar a chave no histórico do shell:

```bash
read -rs PSK && printf '%s' "$PSK" | base64; unset PSK
```

Como o arquivo guarda a PSK, deixe-o legível só pelo root, e depois carregue a configuração:

```bash
sudo chmod 600 /etc/swanctl/conf.d/fortinet.conf
sudo swanctl --load-all
sudo swanctl --list-conns
```

## Instalando o projeto (e dois bugs no pyproject.toml)

```bash
git clone https://github.com/quincampoix/fortigate-saml-vpn.git ~/projetos/fortigate-saml-vpn
cd ~/projetos/fortigate-saml-vpn
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e .
```

Aqui a instalação falhou, e o problema estava no `pyproject.toml`. A lista `dependencies` tinha sido escrita abaixo do cabeçalho `[tool.setuptools.packages.find]`, e no TOML isso a coloca dentro dessa tabela, não em `[project]`. O setuptools mais recente valida o esquema e rejeita com `tool.setuptools.packages must be valid exactly by one definition`. Depois de mover a lista para o lugar certo, apareceu um segundo erro, `project.dependencies[0] must be pep508`, porque faltava uma vírgula entre as restrições de versão. O trecho corrigido ficou assim:

```toml
[project]
# ... demais campos ...
dependencies = [
    "vici>=6.0.3,<7",
]

[tool.setuptools.packages.find]
where = ["src"]
```

Pretendo mandar essas correções para o projeto, junto com uma nota sobre o nome obrigatório do `fortinet.conf`.

O projeto também precisa de um `config.toml` na raiz do repositório:

```toml
[fortigate]
gateway = "vpn.acme.example"
saml_port = 8884

[strongswan]
connection = "fortigate"
```

Esse arquivo tem o endereço da VPN da sua empresa, então não o inclua em commits. Eu coloquei no `.git/info/exclude`, que funciona como um `.gitignore` local.

## O certificado com cadeia incompleta

Na primeira tentativa de conexão, o script parou com `CERTIFICATE_VERIFY_FAILED: unable to get local issuer certificate`. No navegador o site abria normalmente, o que deixou o erro ainda mais estranho. O motivo é que o FortiGate enviava só o próprio certificado, sem o intermediário da autoridade certificadora. Navegadores buscam esse intermediário sozinhos, mas o OpenSSL e o Python não.

Desativar a verificação de TLS estava fora de questão, porque é justamente por ali que passa o login SAML. Então resolvi localmente, adicionando o intermediário à confiança do sistema. Primeiro, para ver quem emitiu o certificado do servidor:

```bash
openssl s_client -connect vpn.acme.example:8884 -servername vpn.acme.example -showcerts </dev/null 2>/dev/null | grep -E '^ *[0-9]+ s:|^ *i:|Verify return code'
```

O próprio certificado informa onde baixar o intermediário, no campo _CA Issuers_:

```bash
openssl s_client -connect vpn.acme.example:8884 -servername vpn.acme.example </dev/null 2>/dev/null | openssl x509 -noout -text | grep 'CA Issuers'
```

Com a URL em mãos, baixei, conferi e importei:

```bash
curl -sSf -o /tmp/intermediario.crt <URL_DO_INTERMEDIARIO>
openssl x509 -inform DER -in /tmp/intermediario.crt -noout -subject -issuer -enddate
sudo trust anchor --store /tmp/intermediario.crt
```

Antes do último comando, confira se o `subject` do arquivo baixado é exatamente o emissor que o servidor mostrou e se o `issuer` é uma raiz em que o sistema já confia. Depois disso, o `openssl s_client` passou a mostrar `Verify return code: 0 (ok)`. Anote a data de validade do intermediário, porque ele vai precisar ser trocado quando expirar. O certo mesmo é a TI configurar a cadeia completa no FortiGate, e eu já avisei.

## Conectando

Com tudo isso no lugar:

```bash
fortigate-saml-vpn connect
```

O navegador abre, você faz login, aparece uma página dizendo que a autenticação deu certo, e o terminal mostra `VPN connected successfully`. No log do strongSwan (`sudo journalctl -f -u strongswan`) dá para acompanhar a negociação inteira, até o `CHILD_SA fortigate{1} established`. Para testar, pinguei o DNS interno e ele respondeu pelo túnel.

Vale lembrar que o túnel é completo (`0.0.0.0/0`). Enquanto você estiver conectado, todo o tráfego IPv4 da máquina passa pela rede da empresa.

## Fazendo o DNS interno funcionar

O túnel funcionava, mas os nomes internos não resolviam. O FortiGate envia o DNS da empresa pelo IKEv2, e o plugin `resolve` do strongSwan tenta aplicá-lo pelo `resolvconf`. Só que, no Arch, o `resolvconf` é o do systemd e precisa do `systemd-resolved` rodando. Na minha máquina, o NetworkManager escrevia o `/etc/resolv.conf` diretamente, e o log mostrava `Could not activate remote peer 'org.freedesktop.resolve1'`.

Antes de chegar à solução, tentei um atalho: configurar o `path` do plugin para um caminho inexistente, achando que o strongSwan escreveria direto no `/etc/resolv.conf`. Não funciona. Com o `path` definido explicitamente, ele sempre tenta executar o comando, mesmo que ele não exista. Deixe essa linha comentada.

A solução foi a mesma que o guia do projeto sugere: usar o `systemd-resolved`. Isso muda o DNS do sistema inteiro, então guardei uma cópia do arquivo antigo:

```bash
sudo systemctl enable --now systemd-resolved
sudo cp /etc/resolv.conf /etc/resolv.conf.nm-backup
sudo ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf
sudo systemctl restart NetworkManager
```

Depois, em `/etc/strongswan.d/charon/resolve.conf`, configurei o plugin para aplicar o DNS na interface de rede real, em vez do padrão `lo.ipsec`:

```
resolve {
    load = yes
    resolvconf {
        iface = eno1
        # path = /sbin/resolvconf
    }
}
```

Use a interface da sua rota padrão (`ip route show default` mostra qual é). Aqui é a `eno1`, o cabo. Se você usa a VPN só pelo Wi-Fi, troque por `wlan0` ou equivalente. Depois de mudar esse arquivo, reinicie o strongSwan com `sudo systemctl restart strongswan`. No meu caso, o restart costuma demorar até 90 segundos, porque o `charon-systemd` é lento para encerrar e o systemd acaba forçando. É só esperar.

Com a VPN conectada, `resolvectl dns eno1` passa a mostrar o DNS da empresa, e uma consulta reversa como `resolvectl query 10.0.0.53` devolve um nome interno. Ao desconectar, o DNS da VPN é removido. A interface fica sem DNS próprio até o NetworkManager reaplicar a configuração, mas os servidores globais continuam funcionando. Se quiser restaurar na hora, use `sudo nmcli device reapply eno1`.

## Deixando mais prático

Para não precisar ativar o venv sempre, uso o direnv. Com o hook no `~/.bashrc` (`eval "$(direnv hook bash)"`), basta criar um `.envrc` na raiz do repositório:

```bash
export VIRTUAL_ENV="$PWD/.venv"
PATH_add "$VIRTUAL_ENV/bin"
```

Depois, rode `direnv allow`. Coloquei esse arquivo também no `.git/info/exclude`.

E, para conectar de qualquer pasta, criei três aliases no `~/.bashrc`:

```bash
FSV_DIR="$HOME/projetos/fortigate-saml-vpn"
alias vpn-on='(cd "$FSV_DIR" && ./.venv/bin/fortigate-saml-vpn connect)'
alias vpn-off='(cd "$FSV_DIR" && ./.venv/bin/fortigate-saml-vpn disconnect)'
alias vpn-status='(cd "$FSV_DIR" && ./.venv/bin/fortigate-saml-vpn status)'
```

Os parênteses fazem o `cd` acontecer num subshell. Assim, o `config.toml` é encontrado, e o terminal continua na pasta em que você estava. O `sudo` vai pedir senha, porque o projeto chama o `swanctl` com privilégios.

## Se algo der errado

Os erros que encontrei pelo caminho, para referência rápida:

- `CERTIFICATE_VERIFY_FAILED`: falta o certificado intermediário, ou ele expirou.
- `CHILD_SA config 'fortigate' not found`: o arquivo do strongSwan não se chama `fortinet.conf`.
- `unterminated string detected`: a PSK tem caracteres especiais. Use base64 com `0s`.
- Nomes internos não resolvem: confira se o `systemd-resolved` está ativo, se o `iface` é a interface certa e o que mostra o `resolvectl dns`.
- Erros estranhos e sem explicação: veja se não sobrou outro processo IPsec usando as portas, com `pgrep -a 'starter|charon'`.

Para acompanhar a conexão, `sudo journalctl -f -u strongswan` e `sudo swanctl --list-sas` resolvem quase tudo.

No fim, deu bem mais trabalho do que instalar um cliente oficial, mas não precisei usar VM nenhuma, e agora entendo cada peça do que está acontecendo. Fica o agradecimento ao autor do fortigate-saml-vpn, que resolveu a parte que eu achava impossível.

---

Se você tentou algo parecido, ficou preso em alguma etapa ou encontrou um jeito melhor de resolver alguma dessas partes, quero saber. Me chama no Mastodon: **[@riverfount@bolha.us](https://bolha.us/@riverfount)**
