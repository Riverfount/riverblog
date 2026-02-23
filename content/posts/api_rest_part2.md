+++
date = '2025-11-04'
draft = false
title = 'O que é uma API REST? Segunda parte ...'
+++
Dando continuidade ao artigo **"O que é uma API REST? Explicação Detalhada para Desenvolvedores"**, esta segunda parte aprofunda-se em um método HTTP essencial que não foi coberto anteriormente: o **PATCH**, destacando seu papel na atualização parcial de recursos. Enquanto no artigo inicial exploramos os métodos GET, POST, PUT e DELETE para operações completas de criação, leitura, atualização e exclusão, aqui explicamos como o PATCH permite modificações mais precisas e eficientes, sem a necessidade de substituir o recurso inteiro.

Além disso, como as APIs REST são uma forte implementação do protocolo HTTP, entender os **códigos de status** retornados pelo servidor é fundamental para um desenvolvimento eficaz e para os consumidores da API interpretarem corretamente o resultado das requisições. Nesta parte, exploraremos os códigos mais comuns e seu significado prático para o ciclo de vida das requisições REST.

## Método PATCH: Atualização Parcial de Recursos

O método **PATCH** é destinado a aplicar modificações parciais a um recurso existente, diferentemente do PUT, que exige o envio da representação completa do recurso para substituí-lo. PATCH permite enviar apenas os campos que precisam ser alterados, tornando as requisições mais leves e eficientes, especialmente úteis em aplicações onde pequenas mudanças são frequentes.

Por exemplo, imagine uma API para gerenciamento de usuários. Se você deseja atualizar apenas o e-mail do usuário com ID 123, uma requisição PATCH adequada seria:

```http
PATCH /api/usuarios/123
Content-Type: application/json

{
  "email": "novoemail@exemplo.com"
}
```

Neste caso, somente o campo “email” será alterado, enquanto os demais dados permanecem inalterados. O servidor pode responder com um código **200 OK** acompanhando a representação atualizada do recurso, ou **204 No Content** se não devolver corpo na resposta.

### Diferença entre PATCH e PUT

| Característica             | PUT                               | PATCH                            |
|---------------------------|----------------------------------|---------------------------------|
| Atualização               | Substituição completa do recurso | Modificação parcial             |
| Envio do recurso          | Representação completa            | Apenas alterações               |
| Idempotência              | Sim                              | Nem sempre, mas pode ser        |
| Uso típico                | Atualizar todo recurso            | Atualizar partes específicas    |



## Códigos de Status HTTP Usados em APIs REST

Os códigos de status são mensagens padrão do protocolo HTTP que indicam o resultado da requisição, contribuindo para a interpretação e a resposta adequadas na comunicação entre cliente e servidor.

### Códigos mais comuns e seus significados:

- **200 OK**: Requisição bem-sucedida, geralmente ao recuperar ou modificar recursos.
- **201 Created**: Recurso criado com sucesso em resposta a uma requisição POST.
- **204 No Content**: Requisição realizada com êxito, sem conteúdo a ser retornado (ex: DELETE, PATCH sem corpo).
- **400 Bad Request**: Requisição mal formada ou inválida.
- **401 Unauthorized**: Falha na autenticação, sem permissão para acessar o recurso.
- **403 Forbidden**: Cliente está autenticado, mas não autorizado a acessar o recurso.
- **404 Not Found**: O recurso requisitado não existe.
- **405 Method Not Allowed**: Método HTTP não suportado pelo recurso.
- **409 Conflict**: Conflito na requisição (ex: duplicação de recurso).
- **500 Internal Server Error**: Erro inesperado no servidor.

### Exemplo prático com criação de recurso

Ao criar um usuário via POST, o servidor responde:

```http
HTTP/1.1 201 Created
Location: /api/usuarios/123
Content-Type: application/json

{
  "id": 123,
  "nome": "João",
  "email": "joao@example.com"
}
```

### Exemplo prático com atualização parcial (PATCH)

Requisição:

```http
PATCH /api/usuarios/123
Content-Type: application/json

{
  "telefone": "999999999"
}
```

Resposta:

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": 123,
  "nome": "João",
  "email": "joao@example.com",
  "telefone": "999999999"
}
```
## Conclusão 

Concluímos esta série de dois artigos sobre API REST, nos quais consolidamos um entendimento sólido sobre os princípios e práticas que tornam uma API RESTful eficiente e alinhada às necessidades modernas de desenvolvimento. No primeiro artigo, exploramos os fundamentos da arquitetura REST, demonstrando como os métodos HTTP convencionais estruturam o ciclo de vida dos recursos em uma API, a importância da comunicação stateless, e o papel da padronização na construção de interfaces interoperáveis e escaláveis. Na sequência, aprofundamos a discussão ao destacar o método PATCH como uma alternativa para atualizações parciais, essencial para operações mais eficientes e flexíveis, além de detalhar a relevância dos códigos de status HTTP para garantir clareza e robustez na comunicação entre cliente e servidor.

Esses conceitos, juntos, formam a base para o design e implementação de APIs REST que atendem tanto às expectativas dos consumidores quanto às demandas de escalabilidade e manutenção do backend. Compreender e aplicar corretamente tais práticas é fundamental para engenheiros de software que desejam construir sistemas interconectados, seguros e responsivos. O aprendizado contínuo e a adoção das melhores práticas REST são essenciais para acompanhar a evolução tecnológica e assegurar soluções de alta qualidade no desenvolvimento web e além. Esta série pretendeu não só informar, mas também inspirar a prática efetiva e consciente na criação de APIs RESTful.

Contate-nos no Mastodon em **[@riverfount@bolha.us](https://bolha.us/@riverfount)**.
