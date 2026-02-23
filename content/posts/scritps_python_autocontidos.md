+++
date = '2025-11-28'
draft = false
title = 'Scripts Python Autocontidos: Como Rodar Qualquer `.py` com Dependências Embutidas no UV'
+++
Você já precisou compartilhar um script Python com colegas e teve que explicar: “Instala o Python 3.12, cria um venv, instala requests e rich, depois roda”? Com o gerenciador UV, isso acabou.

Agora é possível escrever um único arquivo `.py` que já traz suas dependências dentro dele, como `requests<3` e `rich`, e rodar tudo com apenas `uv run script.py`. Neste guia, você vai aprender como usar o bloco `# /// script` do UV para transformar scripts comuns em artefatos autocontidos, reprodutíveis e portáteis — perfeitos para automações, ferramentas internas e protótipos.

## 1. O que é o bloco `# /// script`

O UV entende um cabeçalho especial em arquivos Python, baseado no PEP 723, que permite declarar dependências diretamente no script. Ele tem esse formato:

```python
# /// script
# dependencies = [
#   "nome-do-pacote>=versão",
#   "outro-pacote<versão",
# ]
# ///
```

Esse bloco é um TOML comentado, então o Python ignora, mas o UV o lê como metadados do script. Ele define:

* Quais pacotes são necessários (`dependencies`).
* A versão mínima de Python (`requires-python`).
* O índice de pacotes, se for diferente do PyPI (`index-url`).

Com isso, o script vira um “mini-projeto” que carrega suas próprias dependências.

## 2. Instalando o UV (pré-requisito)

Antes de tudo, instale o UV no seu sistema:

```bash
# Linux/macOS
curl -LsSf https://astral.sh/uv/install.sh | sh

# Windows (PowerShell)
irm https://astral.sh/uv/install.ps1 | iex
```

Depois, verifique se está tudo certo:

```bash
uv --version
```

Se aparecer a versão, o UV está pronto para usar.

## 3. Criando um script com dependências embutidas

Vamos criar um exemplo prático: um script que faz uma requisição HTTP com `requests` e mostra a saída formatada com `rich`.

Crie um arquivo `http_client.py` com o seguinte conteúdo:

```python
#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "requests>=2.31.0,<3",
#   "rich>=13.0.0",
# ]
# ///

import requests
from rich.console import Console
from rich.table import Table

console = Console()

def main():
    url = "https://httpbin.org/json"
    console.print(f"[bold blue]Fazendo GET em {url}...[/bold blue]")

    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()

        table = Table(title="Dados retornados")
        table.add_column("Chave")
        table.add_column("Valor")

        for key, value in data.items():
            table.add_row(str(key), str(value))

        console.print(table)
    except requests.RequestException as e:
        console.print(f"[bold red]Erro na requisição: {e}[/bold red]")

if __name__ == "__main__":
    main()
```

Esse script já traz:

* Um shebang que usa `uv run --script` para executar diretamente.
* Um bloco `# /// script` com `requests` e `rich` como dependências.
* Um código real que usa essas bibliotecas para mostrar dados em uma tabela bonita.

## 4. Rodando o script pela primeira vez

Na pasta onde está `http_client.py`, execute:

```bash
uv run http_client.py
```

Na primeira execução, o UV vai:

1. Ler o bloco `# /// script`.
2. Criar um ambiente isolado para esse script.
3. Instalar `requests` e `rich` (e suas dependências) nesse ambiente.
4. Executar o script dentro desse ambiente.

Nas execuções seguintes, ele reutiliza o ambiente e roda direto, sem instalar nada de novo.

## 5. Adicionando dependências com `uv add --script`

Se precisar adicionar mais uma biblioteca (por exemplo, `typer` para CLI), use:

```bash
uv add --script http_client.py typer
```

Esse comando atualiza automaticamente o bloco `# /// script` no topo do arquivo, adicionando `"typer"` à lista de dependências. Depois disso, basta importar e usar `typer` no código.

## 6. Tornando o script executável (opcional)

Para rodar o script diretamente como um comando, torne-o executável:

```bash
chmod +x http_client.py
```

Agora é possível executá-lo sem chamar `uv run` explicitamente:

```bash
./http_client.py
```

O shebang `#!/usr/bin/env -S uv run --script` garante que o UV será usado para rodar o script com o ambiente correto.

## 7. Quando usar esse padrão

Esse modelo é ideal para:

* Scripts de automação interna (CI, deploy, backup, etc.).
* Ferramentas de linha de comando que circulam entre times.
* Protótipos e PoCs que precisam de bibliotecas externas.
* Scripts que você quer rodar em servidores sem configurar projeto completo.

Evite usar isso para:

* Aplicações grandes com múltiplos módulos e estrutura de projeto.
* Projetos que já usam `pyproject.toml` e `uv init`.

## 8. Dicas para produção

* Sempre declare versões mínimas e máximas (`requests>=2.31.0,<3`) para evitar quebras.
* Use `requires-python` para garantir que o script não rode em versões incompatíveis.
* Em CI/CD, prefira usar `uv sync` em projetos completos, mas mantenha scripts autocontidos para tarefas pontuais.
* Se quiser lock exato, o UV pode gerar um `script.py.lock` para fixar versões exatas.

## Conclusão

Com o bloco `# /// script` do UV, scripts Python deixam de ser “códigos soltos” e viram artefatos autocontidos: trazem suas dependências, versão de Python e ambiente embutidos.

Basta instalar o UV, escrever o cabeçalho `# /// script` e rodar com `uv run`. O resultado é mais produtividade, menos setup manual e scripts que “simplesmente funcionam” em qualquer máquina com UV instalado.
Compartilhe suas experiências conosco no Mastodon em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
