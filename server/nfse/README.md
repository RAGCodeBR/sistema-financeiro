# Serviço de homologação NFS-e (Node.js)

A Sefin de homologação exige HTTP/1.1 e uma negociação mTLS que o runtime Deno/Rustls do Supabase não concluiu nas consultas reais: HTTP/2 retornou `HTTP_1_1_REQUIRED`; HTTP/1.1 terminou em reset. A consulta idêntica com Node/OpenSSL e o mesmo A1 retornou HTTP 404 com E2404, resposta oficial indicando ausência da DPS. Não há desativação da validação TLS nem uso de algoritmos inseguros. [Discussão do runtime sobre mTLS/IIS](https://github.com/denoland/deno/issues/32245).

O serviço Node reutiliza o handler fiscal, a validação do certificado/LCR, os schemas, a assinatura, a autenticação e as RPCs do Supabase. Só o transporte muda para `node:https`, com TLS 1.2 ou superior, validação do servidor, hosts fixos de homologação e tamanho de corpo explícito. Continua restrito a `tpAmb=2`. Não há reenvio automático de POST.

## Desenvolvimento local

Execute `npm run dev:nfse` na raiz e mantenha também o Vite ativo. O bootstrap usa o arquivo privado já preparado em `.local/nfse-certificate-secrets.env` e o acesso autenticado ao Supabase CLI para fornecer os valores apenas ao ambiente do processo filho. Ele não imprime nem grava as chaves em arquivos de código. O serviço escuta apenas `127.0.0.1:8789`. O frontend Vite DEV usa esse endereço automaticamente; a sessão do FinCore é mantida.

`GET /health` informa somente disponibilidade e ambiente. `/nfse-fiscal` aplica o mesmo CORS, login e permissões do handler seguro. O navegador recebe apenas respostas fiscais; nunca recebe a service key, a chave mestra, o envelope ou a chave privada do certificado. Nome, CPF/CNPJ, endereço e valores não são registrados nos logs do servidor. O A1 continua criptografado no Supabase e é aberto somente em memória para a operação.

O bootstrap captura internamente `projects api-keys --reveal --output json`: sem `--reveal`, a CLI devolvia uma representação não utilizável da chave secreta moderna. Nenhuma chave é impressa. O servidor verifica o acesso ao banco antes de começar a escutar, e o health só informa `authConfigured: true` após essa verificação. Erros de credencial técnica retornam `SERVER_AUTH_CONFIG`/HTTP 503; JWT de usuário inválido continua retornando 401, e perfil ausente retorna 403. Uma falha de configuração do servidor não deve ser apresentada como expiração do login.

## Publicação futura

O backend Node ainda precisa ser hospedado para atender o site público. Há um Dockerfile, que deve ser construído com a raiz do repositório como contexto: `docker build -f server/nfse/Dockerfile -t fincore-nfse .`. O container foi preparado, mas a construção de uma imagem Docker não foi executada nesta máquina. Use HTTPS no provedor e configure secrets pelo painel/gestor de segredos:

O workflow de publicação do GitHub Pages também constrói essa imagem no runner Linux, sem certificados nem secrets, antes de publicar o frontend. Essa checagem valida o empacotamento; não hospeda nem inicia um serviço fiscal público. No ambiente local, o Vite bloqueia acesso estático à pasta `.local`, arquivos de ambiente e certificados/chaves.

- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` do projeto.
- `NFSE_CERTIFICATE_KEYS` e `NFSE_ICP_ROOTS_PEM_B64` iguais aos da custódia existente.
- `NFSE_ALLOWED_ORIGINS` com a origem exata autorizada do site.
- Opcionalmente, `NFSE_CRL_ALLOWED_HOSTS`, para autoridades previamente conferidas.
- `PORT` (8789 por padrão) e `NFSE_NODE_HOST` (o container usa `0.0.0.0`).

Depois, configure `NFSE_NODE_SERVICE_URL=https://SEU-SERVICO/nfse-fiscal` nos secrets do Supabase. A função `nfse-fiscal` encaminha as chamadas para esse serviço sem alterar o endereço da API usado pelo frontend publicado. O endpoint exige HTTPS, caminho fixo e não aceita credenciais/query no URL. A sessão do usuário é verificada novamente no Node; cookies e Host do gateway não são encaminhados. Enquanto esse serviço não estiver configurado, a Edge Function mantém leituras/rascunhos, mas bloqueia testes de comunicação e transmissões para não criar novos envios inconclusivos.

## DPS pendente e recuperação

A migration `20261113210000_nfse_retry_after_lookup.sql` adiciona uma RPC exclusiva de service_role, com Master validado novamente no banco. Após consultar a DPS, somente HTTP 404 **com o código oficial E2404** permite liberar uma nova revisão. Um 404 genérico, falha de rede, ambiente de produção, chave de acesso presente ou resposta inconclusiva não liberam reenvio.

Na tela: **Consultar resultado → Revisar nova tentativa → Confirmar liberação da mesma DPS**. O servidor consulta outra vez; se a ausência continuar confirmada, reativa o mesmo registro com novo lease. Número, série, XML e dados ficam preservados. Nenhum POST ocorre nessa liberação. O usuário ainda precisa usar **Revisar envio → Confirmar envio em homologação**. Havendo autorização na consulta, o XML correspondente é recuperado e o registro é autorizado, sem reenvio.

A correção foi verificada com consulta real da DPS 1 e retorno E2404, testes de CORS/login do serviço local, transporte Node sem retentativa, permissões/lease/prova recente no PostgreSQL/PGlite e fluxo de recuperação isolado no navegador. Nenhuma DPS foi transmitida como parte dessas verificações.
