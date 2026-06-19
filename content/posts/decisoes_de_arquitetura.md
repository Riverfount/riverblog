---
title: "Decisões de arquitetura para uma integração com webhook, retry e fallback"
date: 2026-06-18
draft: false
tags: ["arquitetura", "kafka", "resiliência", "sistemas distribuídos", "avançado"]
cover:
  image: "images/covers/cover-webhook-polling-fallback.png"
  alt: "Decisões de arquitetura para uma integração com webhook, retry e fallback"
  relative: false
---

Você precisa integrar com dois serviços externos de avaliação de crédito, e eles não se parecem em nada na hora de responder. O principal recebe a proposta, processa por alguns minutos e te chama de volta por um webhook. O fallback — acionado só quando o principal falha — não chama ninguém: você é quem precisa ficar perguntando se ele já terminou. A tentação é tratar tudo isso como uma chamada com um `try/except` em volta. No caminho feliz, funciona. É no resto que mora este artigo.

O texto parte do desenho ingênuo, mostra os três pontos onde ele quebra, e discute as decisões de arquitetura que sustentam o caso real — sem entrar em implementação. O foco é o formato do sistema, não o código.

## O desenho ingênuo (e por que ele quebra)

O primeiro instinto é tratar a avaliação como síncrona: recebe a proposta, tenta o principal num laço, se não der tenta o fallback, devolve o resultado. Esse desenho quebra por dois motivos, e nenhum deles aparece quando você testa com um caso feliz.

O primeiro é o tempo. O serviço principal leva minutos e responde por webhook — ou seja, não existe uma resposta para "aguardar" na mesma requisição. Segurar a conexão do cliente por minutos é inviável, e mesmo que fosse possível, o modelo de webhook pressupõe que o resultado volta por outro canal, mais tarde.

O segundo é a durabilidade. Se o processo cai entre receber a proposta e despachá-la, a proposta evapora. Num fluxo de crédito isso é inaceitável: toda proposta recebida precisa ter um destino rastreável, mesmo diante de deploy, crash ou indisponibilidade temporária dos bureaus.

A conclusão dos dois é a mesma: a ingestão precisa ser desacoplada do processamento, e o estado de cada proposta precisa viver fora da memória do processo.

## Dois serviços, dois contratos

Antes de desenhar qualquer coisa, vale encarar a assimetria que define todo o resto. Os dois serviços resolvem o mesmo problema de negócio, mas falam protocolos opostos.

![Os dois contratos: o serviço A empurra o resultado por webhook; o serviço B precisa ser consultado por polling](/images/webhook-polling-fallback/1-dois-contratos.svg)

Um empurra o resultado; o outro precisa ser puxado. Não há um mecanismo único que atenda os dois — a arquitetura precisa hospedar as duas formas ao mesmo tempo, e é essa convivência que gera quase toda a complexidade do sistema. Quem tenta forçar o B a se comportar como o A (ou vice-versa) acaba com um híbrido frágil.

## Desacoplar a ingestão: responda rápido, processe depois

O receptor faz o mínimo: valida a proposta, persiste com um estado inicial, publica numa fila durável e responde imediatamente. O cliente não recebe o resultado — recebe um protocolo para descobri-lo depois.

![Visão geral: o cliente recebe 202, o Kafka durável é consumido pelo cluster de consumers, que despacha para o A (webhook) ou, após 3 falhas, para o B (polling)](/images/webhook-polling-fallback/2-visao-geral.svg)

A escolha de uma fila durável — e não de uma fila em memória ou de uma chamada direta — não é gratuita. Ela dá duas garantias que o domínio exige: nenhuma proposta se perde se um worker cai, e existe um registro do que entrou, que serve tanto para reprocessamento quanto para auditoria. Num sistema financeiro, poder reconstruir "o que aconteceu com a proposta X" não é luxo, é requisito.

O `202 Accepted` com um identificador é o contrato com o cliente: "recebi, vou processar, consulte por aqui depois — ou eu te aviso". Esse identificador também vira a chave de idempotência que viaja por todo o fluxo e impede, lá na frente, que uma reentrega vire avaliação duplicada.

## As três tentativas: por que a fila não resolve sozinha

Aqui mora o erro mais comum. A regra "tente o principal três vezes antes de cair no fallback" soa como algo que a fila resolve sozinha. Com um broker de tarefas tradicional — RabbitMQ, SQS — quase resolve: há *redelivery*, *visibility timeout* e *dead-letter* nativos. Mas se a fila é um log particionado como o Kafka, a história é outra. O consumidor avança por *offsets*, e a tentação de "não confirmar a mensagem para tentar de novo depois" tem um efeito colateral brutal.

![Sem retry topics, a proposta que falha trava a partição inteira: head-of-line blocking](/images/webhook-polling-fallback/3-head-of-line-blocking.svg)

Isso é *head-of-line blocking*: uma única proposta problemática trava a partição inteira, e uma falha pontual vira um incidente generalizado. O padrão que resolve é o de **retry topics**. Em vez de reter a mensagem que falhou, o consumidor a republica num tópico de retry com atraso crescente e confirma o offset do tópico atual na hora. A mensagem "sai" da fila quente e vai esperar a vez dela num tópico separado.

![A escada de retry topics: cada falha republica a mensagem no próximo tópico com atraso e libera a partição; após a 3ª falha, a proposta segue para o fallback](/images/webhook-polling-fallback/4-retry-topics.svg)

O atraso de cada nível — `retry-30s`, `retry-2m` — é o que dá o *backoff* entre as tentativas, e os valores são ilustrativos: você os calibra observando o comportamento real do principal. Quando até a terceira falha, a mensagem não vai para um *dead-letter* genérico; vai para o tópico de fallback, que dispara o caminho do B.

Repare num detalhe que parece sutil e é a origem do problema mais traiçoeiro do sistema: enviar com sucesso **não** significa "aprovado". Significa apenas que o principal aceitou a proposta. O resultado vem depois, pelo webhook. Por isso o estado após o envio bem-sucedido é `AGUARDANDO_WEBHOOK_A`, e não um estado terminal.

## O fallback que você precisa consultar

Esgotadas as três tentativas, a proposta é enviada ao serviço B e marcada como `POLLING_B`. O envio é a parte fácil. A parte difícil é descobrir o resultado, porque o B não empurra nada — ninguém vai nos avisar quando ele terminar.

Como ninguém avisa, precisamos perguntar. Um processo agendado varre periodicamente as propostas em `POLLING_B` e consulta o B até obter resposta, com um teto de tempo para não consultar para sempre. Esse teto é o que separa um sistema saudável de um laço infinito educado: se o B não respondeu dentro do prazo aceitável, a proposta escala para revisão manual em vez de ficar sendo consultada eternamente. O custo de uma intervenção humana ocasional é muito menor do que o de uma proposta esquecida num estado intermediário.

## O webhook que pode nunca chegar

Volte ao detalhe do envio que "só significa que o principal aceitou". O requisito original manda cair no fallback quando o **envio** falha três vezes. Mas existe um terceiro modo de falha que não está escrito em lugar nenhum e é fácil de não prever: o principal aceitou a proposta, respondeu `200`, e o webhook simplesmente nunca chega. Rede, bug do outro lado, evento perdido — a causa não importa. Sem tratamento, a proposta fica presa em `AGUARDANDO_WEBHOOK_A` para sempre, e ninguém percebe até alguém reclamar.

A defesa contra o silêncio é um **watchdog**, e o lugar natural para ele é o mesmo processo agendado que já faz o polling do B. Além de consultar o fallback, ele varre as propostas que estão aguardando o webhook há mais tempo do que o SLA permite.

![O processo agendado faz o polling do serviço B e, como watchdog, varre as propostas presas aguardando o webhook além do SLA](/images/webhook-polling-fallback/5-polling-watchdog.svg)

Há uma decisão de arquitetura escondida nesse último ramo, e vale batê-la conscientemente. O que fazer com uma proposta cujo webhook do principal nunca chegou? Reencaminhar ao fallback parece natural — afinal, ela ainda precisa de avaliação. O risco é o principal responder atrasado **depois** que o fallback já avaliou, gerando dois resultados para a mesma proposta. A alternativa conservadora é mandar direto para revisão manual, eliminando qualquer chance de avaliação dupla ao custo de trabalho humano. Em crédito, eu defaultaria para a opção conservadora, habilitando o reencaminhamento apenas se o principal tiver histórico de atrasos benignos — e sempre com a idempotência do receptor de webhook como rede de segurança.

## A máquina de estados que amarra tudo

Tudo acima só se sustenta porque existe um estado canônico por proposta, vivendo no banco, com transições explícitas. Os estados são poucos; o que importa é como se transita entre eles.

![A máquina de estados da proposta e suas transições até os estados terminais](/images/webhook-polling-fallback/6-maquina-de-estados.svg)

O receptor do webhook é o melhor exemplo de por que as transições importam mais que os estados. Ele será chamado mais de uma vez (o principal reentrega callbacks) e pode ser chamado tarde demais (depois que o watchdog já escalou a proposta). A proteção contra os dois casos é a mesma: a transição é **condicional ao estado atual**, não incondicional. Só se aplica o resultado se a proposta ainda estiver aguardando; caso contrário, é um efeito nulo silencioso. É isso, somado à chave de idempotência que plantamos na ingestão, que garante que o mesmo resultado nunca seja contabilizado duas vezes — não importa quantas vezes o callback chegue, nem em que ordem.

O particionamento por `proposta_id` fecha o raciocínio: todos os eventos de uma mesma proposta caem na mesma partição e são processados em ordem, o que torna as transições previsíveis. O preço é reintroduzir acoplamento dentro da partição — e é justamente por isso que a saída rápida para os tópicos de retry, lá atrás, era tão importante.

## Resumo: um mecanismo para cada modo de falha

A arquitetura inteira pode ser lida como uma lista de modos de falha e suas defesas:

| Modo de falha | Mecanismo |
|---|---|
| Cliente não pode esperar minutos | Ingestão assíncrona: `202` + fila durável |
| Processo cai com proposta em trânsito | Estado persistido + log durável |
| Envio ao principal falha | Retry topics com backoff (sem travar a partição) |
| Principal indisponível após 3 tentativas | Fallback para o serviço consultado por polling |
| Fallback nunca responde | Teto de SLA → revisão manual |
| Webhook aceito mas nunca entregue | Watchdog varrendo estados presos |
| Webhook reentregue ou atrasado | Transição condicional ao estado (idempotência) |

A linha que costura tudo é simples de enunciar e fácil de subestimar: "falha" não é um evento único, é uma família de eventos — e vários deles são silenciosos. Cada modo silencioso é uma proposta presa que um dia vira um chamado de suporte. O trabalho da arquitetura não é evitar que falhas aconteçam; é garantir que nenhuma proposta consiga ficar presa sem que algo perceba.

Esse desenho ainda tem arestas que daria para explorar por horas — particionamento e ordenação sob carga, *at-least-once* versus *exactly-once*, reconciliação contábil entre os dois bureaus. Se quiser continuar a conversa — ou discordar da escolha de mandar para revisão manual em vez de reencaminhar ao fallback — me encontra no Fediverse em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
