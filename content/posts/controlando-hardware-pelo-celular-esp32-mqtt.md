---
title: "Controlando Hardware pelo Celular: Uma Experiência com ESP32 e MQTT"
date: 2026-03-11
author: Riverfount
draft: false
tags: [esp32, mqtt, iot, embarcados, c, mosquitto]
mastodon_toot_id: "116241007513275199"
cover:
  image: "images/covers/cover-esp32-mqtt-celular.png"
  alt: "Controlando Hardware pelo Celular: Uma Experiência com ESP32 e MQTT"
  relative: false
---

O [post anterior](/posts/hello-world-hardware-esp32) mostrou o Blink — o Hello World do hardware embarcado. Um LED piscando sozinho, controlado por um timer, sem nenhuma interação externa. Era o suficiente para validar o ambiente, mas deixava uma pergunta óbvia no ar: e se a gente quiser controlar esse LED de verdade? De outro dispositivo, em tempo real, sem cabos?

Essa pergunta levou ao experimento deste post: usar o protocolo MQTT para acionar um LED no ESP32 a partir de um celular, com um broker Mosquitto rodando localmente no PC. O resultado funcionou. O caminho até lá teve algumas surpresas que valem ser documentadas.

---

## O que é MQTT e por que ele faz sentido para IoT

MQTT é um protocolo de mensageria leve, baseado no modelo publish/subscribe. Em vez de um dispositivo chamar diretamente o outro, ambos se comunicam através de um intermediário chamado broker. Quem publica uma mensagem não precisa saber quem vai recebê-la — basta enviar para um tópico. Quem quer receber se inscreve nesse tópico.

Esse modelo tem uma vantagem prática enorme em IoT: o ESP32 não precisa abrir uma porta, não precisa conhecer o IP do celular, não precisa lidar com reconexões do cliente. Ele apenas mantém uma conexão com o broker e reage quando uma mensagem chega. O protocolo foi projetado para redes instáveis e dispositivos com recursos limitados — o que descreve bem o cenário de embarcados.

Para este experimento, o broker escolhido foi o **Mosquitto**, rodando localmente no PC com EndeavourOS (Arch Linux). A instalação é trivial:

```bash
sudo pacman -S mosquitto
sudo systemctl enable --now mosquitto
```

Uma observação importante: por padrão, versões recentes do Mosquitto recusam conexões anônimas. É necessário editar o arquivo de configuração para permitir acesso local:

```
# /etc/mosquitto/mosquitto.conf
listener 1883
allow_anonymous true
```

---

## A arquitetura do sistema

O sistema tem três partes:

**Broker (PC):** o Mosquitto recebe todas as mensagens e as distribui para os inscritos no tópico correspondente.

**Publisher (celular):** o app IoT MQTT Panel envia comandos (`ON`, `OFF`, `TOGGLE`) para o tópico `esp32/led`.

**Subscriber (ESP32):** o microcontrolador fica inscrito no tópico e executa a ação correspondente ao comando recebido.

Todos precisam estar na mesma rede Wi-Fi. O ESP32 conecta ao Wi-Fi e depois ao broker pelo IP do PC. O celular conecta ao broker pelo mesmo IP. O broker é o ponto central que coordena tudo.

---

## O código no ESP32

O firmware foi escrito em C puro com ESP-IDF, usando o PlatformIO como ambiente de desenvolvimento no VSCode. O projeto foi estruturado em torno de um único callback MQTT que centraliza toda a lógica de controle.

### Inicialização do LED

A configuração do pino segue o padrão do ESP-IDF com a struct `gpio_config_t`. O ponto de atenção aqui é o `pin_bit_mask` — ele usa deslocamento de bits para selecionar o pino, o que permite configurar múltiplos pinos numa única chamada se necessário:

```c
static void led_init(void)
{
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << LED_GPIO),
        .mode         = GPIO_MODE_OUTPUT,
        .pull_up_en   = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_conf);
    gpio_set_level(LED_GPIO, 0);
}
```

### Conexão Wi-Fi com FreeRTOS

A conexão Wi-Fi no ESP-IDF é event-driven. Em vez de um loop de polling, o driver dispara eventos que o código trata em handlers registrados. O `xEventGroupWaitBits` bloqueia a execução do `app_main` até o Wi-Fi conectar — uma sincronização limpa entre a task principal e o handler de eventos:

```c
// Bloqueia até obter IP
xEventGroupWaitBits(wifi_event_group, WIFI_CONNECTED_BIT,
                    false, true, portMAX_DELAY);
```

O handler de desconexão tenta reconectar automaticamente e, com uma modificação posterior, passou a logar o código de motivo da desconexão — o que foi essencial para diagnosticar um problema de credenciais durante os testes:

```c
} else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
    wifi_event_sta_disconnected_t *disconn = (wifi_event_sta_disconnected_t *)event_data;
    ESP_LOGW(TAG, "Wi-Fi desconectado, motivo: %d", disconn->reason);
    esp_wifi_connect();
}
```

### O callback MQTT

O coração do sistema é o `mqtt_event_handler`. Ele é registrado para todos os eventos MQTT e reage a dois em particular: `MQTT_EVENT_CONNECTED` (onde faz o subscribe no tópico) e `MQTT_EVENT_DATA` (onde processa o comando recebido).

Uma sutileza importante: o payload MQTT não termina com `\0`. É um buffer bruto com tamanho explícito. Por isso a comparação não pode usar `strcmp` — precisa de `strncmp` com o `data_len` como limite.

---

## Os problemas que apareceram

### 1. Rede 5GHz

O ESP32 suporta apenas Wi-Fi 2.4GHz. A rede disponível no ambiente era dual-band e o celular estava conectado à faixa 5GHz. O ESP32 conectava na 2.4GHz, mas o celular estava em outra faixa — o broker recebia os comandos do celular, mas o ESP32 estava tecnicamente em uma sub-rede diferente. Solução: garantir que os três dispositivos estejam na mesma faixa.

### 2. O TOGGLE não funcionava

A implementação inicial usava `gpio_get_level()` para ler o estado atual do pino antes de invertê-lo. Funcionou nos primeiros testes, mas revelou um comportamento conhecido do ESP32: em modo output, `gpio_get_level()` nem sempre retorna o nível que foi setado — depende do hardware e da versão do chip.

A solução foi manter uma variável de estado em software:

```c
static int led_state = 0;

// No handler MQTT:
} else if (cmd_cmp(event->data, event->data_len, "TOGGLE")) {
    led_state = !led_state;
    gpio_set_level(LED_GPIO, led_state);
}
```

### 3. Payload com espaço e capitalização inconsistente

O app IoT MQTT Panel enviava `TOGGLE ` (com espaço no final) em alguns botões, e `Toggle` em outros, dependendo de como o widget foi configurado. O `strncmp` é case-sensitive e não ignora espaços, então os comandos chegavam e caíam no else de "comando desconhecido".

A solução foi uma função auxiliar de comparação que remove espaços do final e usa `strncasecmp` para ignorar capitalização:

```c
static int cmd_cmp(const char *data, int len, const char *cmd)
{
    while (len > 0 && isspace((unsigned char)data[len - 1]))
        len--;
    return strncasecmp(data, cmd, len) == 0 && strlen(cmd) == len;
}
```

Depois disso, `ON`, `on`, `On`, `ON ` — qualquer variação passa a funcionar.

---

## Configurando o app no celular

O app usado foi o **IoT MQTT Panel** (Android). A configuração é simples: criar uma conexão apontando para o IP do PC na porta 1883, criar um dashboard e adicionar widgets do tipo Button ou Switch com o tópico `esp32/led` e os payloads correspondentes.

Um detalhe prático: o app tem um campo de payload separado para estado ON e OFF nos widgets Switch. Se o payload não estiver exatamente igual ao que o firmware espera — mesmo considerando o tratamento de espaços e capitalização — o comando chega mas não é reconhecido. O log serial do ESP32 é o melhor lugar para diagnosticar isso:

```bash
pio device monitor
```

---

## O que este experimento demonstrou

MQTT é surpreendentemente simples de colocar no ar para um caso de uso como este. O broker Mosquitto instala e sobe em menos de dois minutos no Arch. O cliente ESP-IDF tem uma API bem projetada — registrar um handler e fazer subscribe são poucas linhas de código.

O modelo event-driven do ESP-IDF se encaixa bem com MQTT. Não há um loop principal ocupado esperando mensagens — o firmware dorme e acorda apenas quando algo chega. Isso é eficiente para embarcados e resulta em código estruturalmente mais limpo do que um polling explícito.

Os problemas que apareceram foram todos de integração — rede, payload, estado de GPIO — e não de protocolo. O MQTT em si se comportou exatamente como esperado. Isso é um bom sinal para projetos maiores: a camada de comunicação é estável e previsível.

O próximo passo natural é adicionar feedback de estado: o ESP32 publicando de volta o estado do LED para um tópico de telemetria, e o app exibindo esse estado em tempo real. Mas isso fica para o próximo post.

---

## Código completo

```c
#include <stdio.h>
#include <string.h>
#include <ctype.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "mqtt_client.h"
#include "driver/gpio.h"

// ===================== CONFIGURAÇÕES =====================
#define WIFI_SSID       "sua-rede-wifi"       // nome da sua rede 2.4GHz
#define WIFI_PASS       "sua-senha"            // senha da rede
#define MQTT_BROKER_URI "mqtt://SEU_IP_LOCAL"  // IP do PC com Mosquitto
#define MQTT_TOPIC      "esp32/led"
#define LED_GPIO        GPIO_NUM_2
// =========================================================

static const char *TAG = "ESP32_MQTT_LED";
static EventGroupHandle_t wifi_event_group;
#define WIFI_CONNECTED_BIT BIT0

static int led_state = 0;

static int cmd_cmp(const char *data, int len, const char *cmd)
{
    while (len > 0 && isspace((unsigned char)data[len - 1]))
        len--;
    return strncasecmp(data, cmd, len) == 0 && strlen(cmd) == (size_t)len;
}

static void mqtt_event_handler(void *handler_args, esp_event_base_t base,
                                int32_t event_id, void *event_data)
{
    esp_mqtt_event_handle_t event = (esp_mqtt_event_handle_t)event_data;

    switch ((esp_mqtt_event_id_t)event_id) {

        case MQTT_EVENT_CONNECTED:
            ESP_LOGI(TAG, "Conectado ao broker MQTT");
            esp_mqtt_client_subscribe(event->client, MQTT_TOPIC, 0);
            ESP_LOGI(TAG, "Inscrito no tópico: %s", MQTT_TOPIC);
            break;

        case MQTT_EVENT_DISCONNECTED:
            ESP_LOGW(TAG, "Desconectado do broker MQTT");
            break;

        case MQTT_EVENT_DATA:
            ESP_LOGI(TAG, "Payload: [%.*s]", event->data_len, event->data);

            if (cmd_cmp(event->data, event->data_len, "ON")) {
                led_state = 1;
                gpio_set_level(LED_GPIO, led_state);
                ESP_LOGI(TAG, "LED ligado!");

            } else if (cmd_cmp(event->data, event->data_len, "OFF")) {
                led_state = 0;
                gpio_set_level(LED_GPIO, led_state);
                ESP_LOGI(TAG, "LED desligado!");

            } else if (cmd_cmp(event->data, event->data_len, "TOGGLE")) {
                led_state = !led_state;
                gpio_set_level(LED_GPIO, led_state);
                ESP_LOGI(TAG, "LED -> %s", led_state ? "ON" : "OFF");

            } else {
                ESP_LOGW(TAG, "Comando desconhecido");
            }
            break;

        case MQTT_EVENT_ERROR:
            ESP_LOGE(TAG, "Erro no cliente MQTT");
            break;

        default:
            break;
    }
}

static void led_init(void)
{
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << LED_GPIO),
        .mode         = GPIO_MODE_OUTPUT,
        .pull_up_en   = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type    = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_conf);
    gpio_set_level(LED_GPIO, 0);
}

static void mqtt_start(void)
{
    esp_mqtt_client_config_t mqtt_cfg = {
        .broker.address.uri = MQTT_BROKER_URI,
    };

    esp_mqtt_client_handle_t client = esp_mqtt_client_init(&mqtt_cfg);
    esp_mqtt_client_register_event(client, ESP_EVENT_ANY_ID,
                                   mqtt_event_handler, NULL);
    esp_mqtt_client_start(client);
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                                int32_t event_id, void *event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();

    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        wifi_event_sta_disconnected_t *disconn = (wifi_event_sta_disconnected_t *)event_data;
        ESP_LOGW(TAG, "Wi-Fi desconectado, motivo: %d", disconn->reason);
        esp_wifi_connect();

    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *ev = (ip_event_got_ip_t *)event_data;
        ESP_LOGI(TAG, "IP obtido: " IPSTR, IP2STR(&ev->ip_info.ip));
        xEventGroupSetBits(wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

static void wifi_init(void)
{
    wifi_event_group = xEventGroupCreate();

    esp_netif_init();
    esp_event_loop_create_default();
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    esp_wifi_init(&cfg);

    esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL);
    esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL);

    wifi_config_t wifi_config = {
        .sta = {
            .ssid     = WIFI_SSID,
            .password = WIFI_PASS,
        },
    };

    esp_wifi_set_mode(WIFI_MODE_STA);
    esp_wifi_set_config(WIFI_IF_STA, &wifi_config);
    esp_wifi_start();

    ESP_LOGI(TAG, "Aguardando conexão Wi-Fi...");
    xEventGroupWaitBits(wifi_event_group, WIFI_CONNECTED_BIT,
                        false, true, portMAX_DELAY);
}

void app_main(void)
{
    nvs_flash_init();
    led_init();
    wifi_init();
    mqtt_start();
}
```

> **Nota de segurança:** nunca publique credenciais reais de rede em repositórios públicos ou artigos. Use variáveis de ambiente, o `menuconfig` do ESP-IDF, ou um arquivo de configuração separado fora do controle de versão.