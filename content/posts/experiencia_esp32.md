
+++
date = 2026-03-08
draft = false
title = "O Hello World do Hardware: Piscando um LED com ESP32"
tags = ["ESP32", "Hardware", "Embarcados", "PlatformIO", "C++", "Relato de Experiência"]
+++
O blog tem bastante conteúdo sobre software — princípios, boas práticas, Python, APIs. Mas há um lado da computação que sempre esteve no horizonte: o hardware embarcado. Este é o primeiro relato de experiência nessa direção, e começa pelo início: o famoso *Blink* — o Hello World do hardware.

A ideia é simples. Pegar uma ESP32, um resistor, um LED, montar o circuito numa protoboard e gravar um programa que faça o LED piscar. O que parece ser coisa de uma tarde revelou algumas surpresas que valem ser registradas.

## O Setup

**Hardware:**
- ESP32 DevKit V1 (38 pinos, chip USB-serial CP2102)
- Resistor de 68Ω (faixas azul, cinza, preto, dourado)
- LED vermelho
- Protoboard

**Software:**
- VSCode com extensão PlatformIO
- Framework Arduino (mais sobre isso adiante)
- Arch Linux

A escolha do PlatformIO em vez do Arduino IDE clássico foi intencional. O PlatformIO oferece IntelliSense, gerenciamento de dependências por projeto, terminal integrado e uma experiência muito mais próxima do desenvolvimento profissional. Para quem já trabalha com VSCode no dia a dia, a transição é natural.

## O Circuito

O circuito é elementar. O fluxo de corrente é:

```
GPIO2 → Resistor → Anodo (+) do LED → Cátodo (–) do LED → GND
```

![Diagrama do circuito ESP32 Blink](/images/circuito_esp32_blink.png)

Na prática, a montagem trouxe algumas descobertas.

A primeira foi o tamanho da placa. O ESP32 DevKit V1 de 38 pinos é mais largo que o Arduino Uno e ocupa praticamente toda a largura de uma protoboard de 830 furos, deixando apenas uma coluna livre para os componentes externos. A solução foi usar duas protoboards lado a lado.

A segunda foi sobre os resistores. O kit tinha resistores de 68Ω em vez dos 220Ω planejados — identificados pelas faixas azul, cinza, preto e dourado. Para o projeto, funcionou sem problemas. O GPIO2 da ESP32 suporta até 40mA e o circuito operou com cerca de 22mA a 3.3V.

O terceiro ponto — e o mais instrutivo — foi um erro clássico de protoboard: **o resistor e o LED não estavam conectados em série**. A perna de saída do resistor e a perna longa do LED precisam estar na *mesma linha* do protoboard para se conectarem internamente. Um detalhe que qualquer diagrama mal elaborado esconde e que só fica evidente quando você resolve testar cada parte do circuito isoladamente.

> **Dica:** Antes de montar o circuito completo, teste cada componente individualmente. No caso do LED, basta encostar a perna longa no pino 3V3 da ESP32 e a perna curta no GND para confirmar que está funcionando.

## O Ambiente de Desenvolvimento

Instalar o PlatformIO é direto. Depois de instalar a extensão no VSCode, basta criar um novo projeto, selecionar a placa e o framework. O primeiro build demora porque o PlatformIO baixa o framework completo, mas as compilações seguintes são rápidas.

A intenção original era usar o **ESP-IDF** — o framework oficial da Espressif, em C puro, mais próximo do metal. O projeto foi configurado assim no `platformio.ini`:

```ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = espidf
monitor_speed = 115200
```

O problema apareceu na compilação. O ESP-IDF tem incompatibilidades conhecidas com Python 3.13, que removeu o módulo `pkg_resources`. Tentativas de instalar dependências manualmente e forçar versões anteriores do platform não resolveram de forma limpa.

A solução pragmática foi migrar para o **framework Arduino**, que é estável nesse ambiente e para um Blink simples produz o mesmo resultado:

```ini
[env:esp32dev]
platform = espressif32
board = esp32dev
framework = arduino
monitor_speed = 115200
```

## O Código

Com o framework Arduino no PlatformIO, o arquivo é `src/main.cpp`:

```cpp
#include <Arduino.h>

#define LED_PIN 2

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(1000);
  digitalWrite(LED_PIN, LOW);
  delay(1000);
}
```

Para gravar na placa, pelo terminal do VSCode:

```bash
pio run --target upload
```

Se a gravação travar em `Connecting...`, segure o botão **BOOT** da ESP32 enquanto o upload inicia e solte quando aparecer `Writing at 0x00001000`.

Um detalhe interessante: o GPIO2 é o mesmo pino do LED onboard da ESP32. Ao rodar o código, o LED azul da placa pisca junto com o LED externo — um feedback visual imediato que confirma que o firmware foi gravado corretamente.

## Lições da Experiência

- **Continuidade de circuito vem primeiro.** O erro mais comum em protoboard é não conectar componentes em série corretamente. A perna de saída do resistor e a perna longa do LED precisam compartilhar a mesma linha.
- **Teste componente a componente.** Identificar onde está o problema é muito mais fácil quando cada parte foi validada isoladamente antes da montagem completa.
- **ESP32 DevKit V1 precisa de espaço.** Com 38 pinos, a placa é larga. Planeje o layout antes de montar.
- **ESP-IDF + Python 3.13 tem atritos.** Para começar, o framework Arduino no PlatformIO é a escolha mais segura. O ESP-IDF fica para quando o projeto exigir acesso mais fino ao hardware.

## Conclusão

O LED piscou. E junto com ele, o LED onboard da placa — como se a ESP32 confirmasse que o negócio estava feito.

O Blink é simples, mas o caminho até ele ensina mais do que qualquer tutorial que pule os problemas. Protoboard com trilha ruim, jumpers incompatíveis, ambiente Python quebrando a toolchain — tudo isso faz parte da experiência real com hardware embarcado.

O próximo passo é explorar sensores, comunicação serial e o WiFi embutido da ESP32. Mas isso fica para os próximos relatos.

### Resultado final

![Circuito montado](/images/resultado_final.gif)

## P.S. — A Migração para C com ESP-IDF

Depois da publicação deste artigo, o objetivo original foi retomado: usar o **ESP-IDF em C puro**, mais próximo do metal, em vez do framework Arduino em C++.

O problema com Python 3.13 que levou à solução com Arduino foi resolvido com uma combinação de ajustes. O ambiente virtual do PlatformIO foi recriado com Python 3.12 via `uv`, e o `setuptools` foi fixado na versão 69.5.1 — a última que ainda expõe o módulo `pkg_resources`, removido nas versões mais recentes. O `platformio.ini` também precisou fixar versões específicas da plataforma e do framework para garantir estabilidade:

```ini
[env:esp32dev]
platform = espressif32@6.5.0
board = esp32dev
framework = espidf
monitor_speed = 115200
platform_packages =
    framework-espidf@~3.50102.0
```

Com o ambiente estável, o código migrou para C puro com a estrutura nativa do ESP-IDF — `app_main()` no lugar de `setup()/loop()`, e as APIs de GPIO do próprio framework no lugar das abstrações do Arduino:

```c
#include 
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"

#define LED_PIN GPIO_NUM_2

void app_main(void) {
    gpio_reset_pin(LED_PIN);
    gpio_set_direction(LED_PIN, GPIO_MODE_OUTPUT);

    while (1) {
        gpio_set_level(LED_PIN, 1);
        vTaskDelay(1000 / portTICK_PERIOD_MS);
        gpio_set_level(LED_PIN, 0);
        vTaskDelay(1000 / portTICK_PERIOD_MS);
    }
}
```

O resultado final é o mesmo — o LED pisca. Mas agora com C puro, sem a camada de abstração do Arduino, com acesso direto às APIs do FreeRTOS e do hardware da Espressif. É uma base muito mais sólida para o que vem a seguir.

Contate-nos no Mastodon em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.