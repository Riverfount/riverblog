---
title: "O Primeiro Plugin para niri + DankMaterialShell"
date: 2026-03-13
draft: false
author: "Riverfount"
tags: ["linux", "niri", "wayland", "quickshell", "qml", "danklinux"]
mastodon_toot_id: "116224872750613436"
cover:
  image: "images/covers/cover-primeiro-plugin-niri-danklinux.png"
  alt: "Primeiro Plugin Niri: Uma Experiência com DankLinux"
  relative: false

---

O blog tem bastante conteúdo sobre software, Python e hardware embarcado. Mas há um lado que nunca apareceu por aqui: o ambiente de trabalho em si. Este é o primeiro relato sobre o setup com o compositor Wayland **niri** e o **DankMaterialShell** — e começa pelo primeiro plugin criado do zero para esse ambiente.

A motivação foi simples: queria ver no painel a versão do kernel em uso e o tempo de uptime do sistema. Sem abrir terminal, sem script externo. Só um widget discreto na barra mostrando `6.19.6-arch1-1  ⏱ 7h 54m`.

O que parecia ser coisa de meia hora revelou algumas camadas de surpresa que valem ser documentadas.

## O ambiente

O setup é um HP 250 G9 rodando EndeavourOS com o compositor Wayland **niri**. A barra e o shell visual são fornecidos pelo **DankMaterialShell** (DMS) v1.4.3, um projeto baseado em [Quickshell](https://quickshell.outfoxxed.me/) que expõe uma API de plugins em QML — a mesma linguagem usada no Qt. O DMS cuida de tudo: barra de tarefas, notificações, applets de rede, áudio, bluetooth.

O sistema de plugins funciona com uma pasta em `~/.config/DankMaterialShell/plugins/` contendo um manifesto `plugin.json` e o componente QML principal. O DMS carrega e injeta o widget na barra automaticamente.

## A ideia

Para exibir o kernel, `uname -r` resolve na hora. Para o uptime, a primeira opção óbvia seria `uptime -p`, mas esse comando traz um prefixo "up" e varia conforme a locale do sistema. A alternativa mais sólida é ler direto de `/proc/uptime`, que contém os segundos de uptime desde o boot como um número puro, e processar via `awk`.

A lógica ficou assim:

```bash
awk '{
  s=int($1);
  d=int(s/86400);
  h=int((s%86400)/3600);
  m=int((s%3600)/60);
  if(d>0) printf "%dd %dh %dm", d, h, m;
  else if(h>0) printf "%dh %dm", h, m;
  else printf "%dm", m
}' /proc/uptime
```

A saída é adaptativa: `3d 2h 15m` quando há dias, `5h 42m` quando não, `38m` nos primeiros momentos após o boot. Sem prefixos desnecessários, sem zeros que não acrescentam nada.

## Estrutura do plugin

O manifesto é direto:

```json
{
  "id": "sysinfo",
  "name": "SysInfo",
  "description": "Mostra versão do kernel e uptime no painel",
  "version": "1.0.0",
  "author": "river",
  "icon": "memory",
  "type": "widget",
  "component": "./SysInfo.qml"
}
```

O componente QML usa `Process` do Quickshell para executar os comandos e capturar a saída, e um `Timer` para atualizar o uptime a cada 60 segundos:

```qml
import QtQuick
import Quickshell
import Quickshell.Io
import qs.Common
import qs.Widgets
import qs.Modules.Plugins

PluginComponent {
    id: root

    property string kernelVersion: "..."
    property string uptimeText: "..."

    Process {
        id: kernelProc
        command: ["uname", "-r"]
        running: true
        stdout: StdioCollector {
            onStreamFinished: root.kernelVersion = text.trim()
        }
    }

    Process {
        id: uptimeProc
        command: ["sh", "-c", "awk '{s=int($1);d=int(s/86400);h=int((s%86400)/3600);m=int((s%3600)/60);if(d>0)printf \"%dd %dh %dm\",d,h,m;else if(h>0)printf \"%dh %dm\",h,m;else printf \"%dm\",m}' /proc/uptime"]
        running: true
        stdout: StdioCollector {
            onStreamFinished: root.uptimeText = text.trim()
        }
    }

    Timer {
        interval: 60000
        running: true
        repeat: true
        onTriggered: uptimeProc.running = true
    }

    horizontalBarPill: Component {
        Row {
            spacing: Theme.spacingS

            DankIcon {
                name: "memory"
                size: Theme.iconSize
                color: Theme.primary
                anchors.verticalCenter: parent.verticalCenter
            }

            StyledText {
                text: root.kernelVersion + "   ⏱ " + root.uptimeText
                font.pixelSize: Theme.fontSizeSmall
                color: Theme.surfaceText
                anchors.verticalCenter: parent.verticalCenter
            }
        }
    }

    verticalBarPill: Component {
        Column {
            spacing: Theme.spacingXS

            StyledText {
                text: root.kernelVersion
                font.pixelSize: Theme.fontSizeSmall
                color: Theme.surfaceText
                anchors.horizontalCenter: parent.horizontalCenter
            }

            StyledText {
                text: root.uptimeText
                font.pixelSize: Theme.fontSizeSmall
                color: Theme.onSurfaceVariant
                anchors.horizontalCenter: parent.horizontalCenter
            }
        }
    }
}
```

Parece simples. E é — quando se sabe o que usar. Chegar nesse código final levou algumas tentativas.

## O que deu errado primeiro

A primeira versão usou `SplitParser` como coletor de stdout, que aparece em alguns exemplos online de Quickshell. O DMS rejeitou na hora:

```
SplitParser is not a type
```

Trocando para `StdioCollector` com o sinal `onStreamEnded`, o erro mudou:

```
Cannot assign to non-existent property "onStreamEnded"
```

Tentando `onDone`, mesmo resultado. A documentação oficial do Quickshell não cobre esses detalhes com clareza, e a versão empacotada no DMS nem sempre corresponde aos exemplos mais recentes que aparecem em buscas.

A solução foi simples mas não óbvia: procurar como o próprio DMS usa esses tipos internamente.

```bash
grep -A 3 "StdioCollector" /usr/share/quickshell/dms/Services/KeybindsService.qml
```

O retorno foi imediato:

```qml
stdout: StdioCollector {
    onStreamFinished: {
        root.cheatsheet = JSON.parse(text);
    }
}
```

O sinal correto é `onStreamFinished`. Não está na documentação de forma destacada, mas está no código que já funciona em produção. Essa é a fonte mais confiável quando a documentação fica vaga.

## O problema de cache

Após corrigir o arquivo, o DMS continuava reportando o erro antigo. Verificar o arquivo mostrava o conteúdo correto — mas o erro no log ainda apontava para a versão antiga, inclusive com o número de linha original.

O DMS mantém cache agressivo. Nem `dms ipc call plugins reload` nem `dms restart` foram suficientes para limpar. A solução foi parar o serviço de verdade:

```bash
rm -rf ~/.cache/quickshell/
rm -rf ~/.cache/DankMaterialShell/
systemctl --user stop dms.service
systemctl --user start dms.service
dms ipc call plugins enable sysinfo
```

```
PLUGIN_ENABLE_SUCCESS: sysinfo
```

## O resultado

O widget apareceu na barra exatamente como planejado, com kernel e uptime lado a lado, atualizando automaticamente a cada minuto. Sem daemon externo, sem polybar, sem script em cron. Tudo dentro do ecossistema niri + DMS + Quickshell.

![Plugin sysinfo rodando no painel com kernel 6.19.6-arch1-1 e 7h 54m de uptime](/images/sysinfo-panel.png)

## O que ficou de aprendizado

O principal atalho para desenvolver plugins no DMS é usar o próprio código-fonte do shell como referência. Quando um tipo ou sinal não se comporta como o esperado, `grep -r` em `/usr/share/quickshell/dms/` resolve mais rápido do que qualquer busca externa — o código que já funciona em produção mostra exatamente como os tipos são usados nessa versão específica.

O segundo ponto é sobre o cache: alterações em arquivos QML não são suficientes para recarregar o estado do Quickshell em memória. Para desenvolvimento iterativo, um `systemctl --user restart dms` limpo (com cache deletado) evita muita confusão.

E sobre o uptime em si: `/proc/uptime` é mais confiável do que `uptime -p` para scripts, porque não depende de locale nem de formatação variável entre distribuições. O número bruto em segundos e um pouco de `awk` resolvem com mais controle.