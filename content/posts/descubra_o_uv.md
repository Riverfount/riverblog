+++
date = '2025-11-27'
draft = false
title = 'Descubra o UV: Gerenciador de Projetos Python para Iniciantes'
tags = ["python", "ferramentas", "uv"]
+++
O UV é um gerenciador de pacotes e projetos Python extremamente rápido, escrito em Rust, que substitui ferramentas como `pip`, `venv` e `pipenv` por comandos simples e automação de ambientes virtuais. Ele conecta gerenciamento de versões do Python, instalação de dependências e execução de scripts em um único comando, proporcionando agilidade no desenvolvimento.​

## Instalação Rápida

Para começar, instale o UV facilmente via terminal:

* Linux/macOS: `curl -LsSf https://astral.sh/uv/install.sh | sh`
* Windows PowerShell: `irm https://astral.sh/uv/install.ps1 | iex`

Confirme a instalação com `uv --version` para garantir que está pronto para uso.

## Criando e Executando Projetos

Com `uv init nome_do_projeto`, você cria um projeto Python completo com estrutura padrão, pyproject.toml, README.md, .gitignore e ambiente virtual configurado automaticamente. Navegue para a pasta (`cd nome_do_projeto`) e rode scripts diretamente usando:

```shell
uv run nome_do_script.py
```

Esse comando executa o script dentro do ambiente virtual gerenciado pelo UV, sem necessidade de ativação manual, mantendo o isolamento e limpeza do ambiente, ideal para aplicações Flask ou qualquer projeto Python.​

## Gerenciando Dependências

Adicione pacotes facilmente:

```shell
uv add requests flask numpy
```

Esses comandos instalam as dependências dentro do ambiente virtual do projeto, gerenciam o arquivo pyproject.toml e criam um arquivo de bloqueio uv.lock para garantir ambientes reproduzíveis. Para remover pacotes, use `uv remove nome_pacote`, e para atualizar use `uv update`.​

## Ambientes Virtuais e Comandos Úteis

O UV cria e gerencia ambientes virtuais automaticamente, mas você também pode criar manualmente com:

```shell
uv venv --python 3.12
```

Além disso, você pode listar dependências (`uv list`), sincronizar ambiente (`uv sync`) e executar ferramentas CLI do Python com `uvx nome_da_ferramenta` sem instalar globalmente.

O destaque é o comando `uv run`, que, além de executar scripts simples, pode ser usado para executar projetos Flask, testes ou qualquer outro comando Python garantindo que tudo rode no ambiente adequado e isolado do sistema.​

## Para Aprofundar

Esta é uma visão introdutória do UV, focada nos conceitos básicos para iniciantes. Para explorar mais recursos avançados, personalização e exemplos detalhados, recomenda-se a leitura da documentação oficial, que está bem completa e constantemente atualizada em <https://docs.astral.sh/uv/>. Assim, você poderá aproveitar todo o potencial dessa poderosa ferramenta para gerenciar seus projetos Python com eficiência e facilidade.

Compartilhe conosco suas experiẽncias com gerenciamento de projetos python usando `uv` no Mastodon em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
