# Emissão de NFS-e: homologação

Estado confirmado em 13/11/2026: o usuário autorizou a DPS 6 no ambiente nacional de homologação, e o sistema recuperou o XML correspondente. A consulta oficial de DANFSe retornou 404; há um espelho de conferência identificado separadamente. Os testes locais passam, mas a emissão em produção permanece bloqueada. O site é publicado em GitHub Pages; a comunicação fiscal online ainda depende da hospedagem do serviço Node/OpenSSL e da configuração de `NFSE_NODE_SERVICE_URL`. Publicar o frontend e a função Edge não substitui essa etapa de infraestrutura.

O servidor informa `transmissionAvailable` na leitura autenticada. Enquanto o serviço Node não estiver configurado no site público, a tela mostra a indisponibilidade, bloqueia consultas fiscais/preparo/transmissão/PDF oficial e mantém histórico, cadastro, XML e espelho acessíveis. O ambiente local Node continua com a transmissão de homologação disponível. A disponibilidade é informada pelo runtime e verificada novamente no servidor, independentemente do estado dos botões.

O módulo agora salva configuração, rascunhos e histórico no servidor e prepara DPS para o ambiente nacional de testes. O único emissor é 60.371.448/0001-43. O fluxo fiscal não cria lançamentos financeiros, não envia e-mails e não emite notas em produção.

## Uso

1. Abra NFS-e e revise/salve a configuração do emissor nas quatro etapas existentes. O A1 cadastrado continua na custódia criptografada.
2. Use **Testar conexão** para conferir validade, cadeia, revogação e convênio de Santos. A consulta não emite documentos.
3. Adicione um rascunho. Preencha o cliente, CPF/CNPJ, endereço com IBGE, data completa da competência, local de prestação, serviço, valor e retenções da operação. Campos pendentes são permitidos no rascunho e bloqueiam o preparo.
4. Salve, selecione o rascunho no painel e escolha **Preparar DPS de teste**. O servidor reserva série/número, valida o XSD e assina com o A1. Confira o XML e use **Revisar envio**.
5. A transmissão exige **Confirmar envio em homologação**. O retorno fica no histórico. Em falhas de comunicação, use **Consultar resultado**; não há reenvio automático. O XML autorizado só é aceito se corresponder integralmente à DPS enviada. O DANFSe depende da disponibilidade do serviço oficial de testes.
6. Uma DPS preparada pode ser descartada antes da transmissão. Sua numeração permanece no histórico; edite e salve o rascunho para preparar uma nova revisão. Isso não é cancelamento fiscal. Notas autorizadas e envios inconclusivos ficam bloqueados para alteração. Rejeições definitivas permitem corrigir e salvar o rascunho.

Rascunhos antigos do navegador não são enviados automaticamente: o usuário seleciona e confirma a cópia. O arquivo local permanece preservado. A configuração antiga também não substitui a configuração compartilhada do servidor.

Master configura, prepara, transmite, consulta e descarta testes. Operadores com permissão de receitas e acesso à NFS-e salvam/consultam seus próprios rascunhos. As permissões são verificadas novamente no servidor e nas RPCs. O Master pode acompanhar os rascunhos da empresa.

## Fiscal e segurança

- Suporte inicial: ME/EPP com tributos federais e ISS integralmente pelo Simples, sem regime especial. Operações com retenções federais e outros enquadramentos ficam bloqueadas para revisão fiscal.
- Os 6% informados vão em `pTotTribSN`. Em operação sem retenção, `pAliq` é omitida. Com ISS retido pelo tomador, exige-se uma alíquota específica de 1,80% a 5%, informada para a operação.
- Competência usa data completa. Local da prestação e município de incidência do ISS são distintos; não se usa o município do cliente como incidência por padrão.
- Série de aplicação própria `00001`; sequência atômica por emissor/ambiente/série. A série `70000` da nota de referência pertence ao emissor Web e não é reutilizada.
- A combinação rascunho/revisão é idempotente. Um estado `sending`/`unknown` só pode ser consultado; não se transforma em novo envio. E0014/duplicidade exige consulta, sem liberar edição como rejeição comum.
- Configuração e rascunhos usam revisão para impedir sobrescrita por outra sessão. Snapshot e XML do teste são imutáveis. O certificado é aberto somente na memória do serviço; sua senha não é armazenada.
- LCRs são obtidas em domínios explícitos das autoridades, com limites de bytes/nós ASN.1, sem redirecionamentos. Exige-se assinatura, emissor e validade atual para a folha e intermediárias. Revogação ou indisponibilidade bloqueiam assinatura/transmissão. LCRs indiretas/delta/extensões críticas não suportadas ficam bloqueadas. Não há fallback que ignore a revogação.
- SQL privado, RLS, revogação de permissões diretas inclusive TRUNCATE e RPCs exclusivas de `service_role`. XML, chave privada e leases internos não aparecem na listagem.
- `tpAmb=2` e hosts de produção restrita são fixos no servidor, com validação adicional no SQL. Não existe opção para trocar para produção pelo navegador.

## Ativação e validação em 13/11/2026

A migration `20261113180000_nfse_homologation.sql` foi aplicada em transação no projeto `tzpoveyjetfobzeeybqu` e registrada no histórico, sem reaplicar migrations antigas. A função `nfse-fiscal` foi publicada via CLI. As checagens confirmaram zero acesso direto por anon/authenticated, configuração pendente de revisão e nenhum rascunho ou emissão inserido durante a ativação. O site público ainda usa sua versão anterior; os novos arquivos de frontend estão locais e sem commit.

Os secrets da custódia existente são reutilizados. `NFSE_ALLOWED_ORIGINS` inclui o site público e os endereços locais `http://localhost:5173` e `http://127.0.0.1:5173`, para desenvolvimento autenticado. Credenciais de infraestrutura não substituem o login do FinCore.

O A1 real foi usado apenas em memória para consultas autenticadas de homologação. Node e Deno confirmaram mTLS, as três autoridades da cadeia e LCRs atuais, sem revogação. Santos retornou adesão ao emissor nacional. A consulta do serviço `17.01.01.021` não retornou alíquota municipal (404 sem cadastro); no perfil integral do Simples sem retenção isso não força alíquota: `pAliq` é omitida e o serviço ainda será validado no envio da DPS. Com retenção e parâmetros ausentes, o preparo fica bloqueado.

Foram verificados XSD e assinatura com certificados sintéticos, permissões e transições com PostgreSQL/PGlite, fluxo de tela em desktop/celular com respostas isoladas e inicialização/autenticação/CORS da função publicada. Nenhuma DPS real foi transmitida, nem em homologação. A aceitação fiscal ponta a ponta depende do primeiro envio de teste pelo usuário autenticado, após revisão de dados.

Prévia sem acesso ao servidor: `http://localhost:5173/?preview=nfse&homologacao=1`. Ela só existe no Vite DEV, usa dados em memória e informa explicitamente que consultas/emissões estão desabilitadas. Para testar o serviço real, abra a aplicação local sem `preview`, entre no FinCore e acesse NFS-e.

Antes de liberar produção: concluir o envio e a recuperação de uma nota de teste, confirmar eventuais exigências atuais de leiaute/IBS/CBS e enquadramento com o contador, validar numeração própria, regras de cancelamento e recuperação de resultados inconclusivos. Esta etapa não implementa cancelamento/substituição fiscal nem envio automático ao cliente.

## Fontes e compatibilidade

As cópias dos XSDs oficiais 1.01 e seus SHA-256 estão em `supabase/functions/nfse-fiscal/schemas/source.json`. O carregador remove a declaração DOCTYPE do esquema XMLDSig para impedir buscas externas. No `TSSerieDPS`, normaliza somente os delimitadores `^`/`$` publicados em estilo .NET, pois no regex de XML Schema/libxml2 eles seriam literais; a validação própria também limita séries de 1 a 49999. Os arquivos oficiais permanecem intactos.

As APIs atuais de parâmetros municipais são separadas da Sefin. A consulta usa código com máscara `17.01.01.021`, conforme comportamento confirmado do serviço oficial; nove dígitos sem máscara retornaram erro de formato. Nenhuma alíquota é inferida a partir desse erro.

- [Endereços oficiais dos ambientes](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao)
- [Swagger Sefin de homologação](https://sefin.producaorestrita.nfse.gov.br/API/SefinNacional/swagger/docs/v1)
- [OpenAPI de parâmetros municipais](https://adn.producaorestrita.nfse.gov.br/parametrizacao/swagger/v1/swagger.json)
- [Manual nacional das APIs](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf)
- [Esquemas de homologação 1.01 — NT009 release 1, 20/10/2026](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/esquemas_prod_restrita_20261020.zip)

### Rejeição E1235 por diferença entre produção e homologação

O primeiro envio realizado pelo usuário foi rejeitado com `E1235` (esquema XML). A análise do XML armazenado confirmou que a validação local utilizava o pacote de produção de 09/02/2026, enquanto a homologação já utiliza a NT009 release 1 de 20/10/2026. O leiaute continua com `versao="1.01"`, mas exige `finNFSe=0` depois de `tpEmit` e posiciona `cNBS` antes de `xDescServ`.

Os esquemas embarcados foram substituídos pelos arquivos oficiais de homologação, com hashes atualizados em `source.json`; a geração da DPS segue os dois requisitos. Testes sintéticos validam assinatura/XSD e comprovam a rejeição das duas estruturas antigas. A análise somente em memória do documento rejeitado, com esses ajustes de estrutura, também passou no novo XSD; isso não valida sua assinatura anterior nem confirma autorização fiscal.

Nenhum XML histórico foi alterado e nenhuma DPS foi reenviada durante a correção. Para testar novamente, o usuário deve editar e salvar o rascunho rejeitado, preparar a nova revisão e confirmar o envio em homologação. A rejeição anterior permanece no histórico. A aceitação fiscal depende do próximo retorno do serviço nacional. Produção continua desabilitada; seus esquemas não devem ser inferidos a partir do ambiente de testes.

### Horário de emissão e rejeição E0008

A segunda DPS enviada pelo usuário passou do erro de esquema, mas recebeu `E0008`. Seu `dhEmi` foi gerado com `+00:00`, a partir de `created_at` do banco. A consulta autenticada e somente de leitura ao governo confirmou resposta de processamento em `-03:00` e diferença entre relógios de aproximadamente um segundo; a emissão precedia o retorno da rejeição em cerca de 15 segundos. Isso aponta para incompatibilidade na interpretação do offset UTC, sem comprovar o comportamento interno do validador nacional.

Novas DPS expressam o instante original de `created_at` no fuso `America/Sao_Paulo`, incluindo offset explícito, segundos e virada de data local. Não se subtraem horas arbitrariamente nem se alteram a competência ou documentos já assinados. Testes verificam a equivalência dos instantes em UTC e a validade no XSD, inclusive à meia-noite. Nenhum novo envio foi feito automaticamente; a confirmação da correção no ambiente nacional depende da revisão/salvamento do rascunho e de novo envio confirmado pelo usuário. A regra oficial `E0008` está no [Anexo I de homologação](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/anexo_i-sefin_adn-dps_nfse-snnfse_prodrest-v1-01-20261020.xlsx).

### Código municipal e rejeição E0314 em homologação

A terceira DPS enviada pelo usuário recebeu `E0314` para `cTribNac=170101` / `cTribMun=021`, competência 13/11/2026. O complemento 021 consta na nota de referência e continua preservado na configuração. Consultas autenticadas e somente de leitura ao ambiente de testes de Santos retornaram 404/“Alíquotas não encontradas” para `17.01.01.021` e 200 para `17.01.01.000` (serviço nacional sem complemento). Isso confirma parâmetros diferentes para os dois identificadores; não prova que o código usado na nota de produção seja incorreto.

O leiaute oficial admite ausência de `cTribMun` (ocorrência 0–1). Quando o usuário deixa o campo municipal vazio no rascunho, o preparo agora consulta o serviço nacional, sem restaurar o código padrão do emissor. O identificador 000 é usado apenas na consulta de parâmetros, nunca no XML da DPS, onde é proibido por E0315. Os 2% retornados para a consulta nacional não substituem os 6% informados do Simples nem geram `pAliq` no perfil integral sem retenção.

Para este teste, é possível revisar o mesmo rascunho, deixar o campo municipal vazio, salvar, preparar outra revisão e confirmar manualmente o envio de homologação. A aceitação fiscal depende do retorno nacional. Nenhuma configuração salva, rascunho real ou emissão histórica foi alterada durante o diagnóstico; não há remoção automática de código para contornar rejeições. Antes de produção, confirme o complemento aplicável com o cadastro fiscal/contador.

A consulta sem alíquota deixou de marcar o serviço como validado. Ela apenas permite o preparo no perfil integral sem retenção e mostra aviso de que o código municipal ainda precisa ser conferido. A conexão com certificado/convênio não equivale à autorização de um serviço. Regras e ocorrência do campo: [Anexo I de homologação, E0314/E0315 e leiaute cTribMun](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita/anexo_i-sefin_adn-dps_nfse-snnfse_prodrest-v1-01-20261020.xlsx).

### Inscrição municipal e CNC — correção do E0120

A quinta DPS enviada pelo usuário recebeu `E0120`. A integração incluía a inscrição municipal de forma incondicional. O cadastro do emissor continua com a inscrição fornecida pelo usuário, `3220285`; apagar esse dado não é a solução. No leiaute nacional, a inclusão de `prest/IM` depende de registro complementar no CNC do município emissor: E0116 exige a inscrição quando há registro; E0120 proíbe seu envio quando não há. A nota de referência também não exibe inscrição municipal do prestador.

O servidor agora consulta `GET https://adn.producaorestrita.nfse.gov.br/cnc/consulta/cad?codMunicipio=3548500&inscricaoFederal=60371448000143` com o A1, antes do preparo e novamente antes da transmissão. O usuário não controla o host, o documento consultado ou a decisão por parâmetros do navegador. Só HTTP 404 com `TipoAmbiente=HOMOLOGACAO`, `StatusProcessamento=NENHUM_DOCUMENTO_LOCALIZADO`, ausência de registros e erros vazios permite omitir a IM. Resposta genérica, acesso negado ou indisponibilidade bloqueiam o preparo/envio.

Quando há registros, a integração exige correspondência de CNPJ, município, ambiente e inscrição configurada, um registro único, habilitação para emissão e início de vigência até a competência. Ela não substitui automaticamente a inscrição nem ignora registros divergentes. O governo continua responsável pelas demais validações cadastrais e tributárias. Uma DPS preparada cujo envio da IM diverge da consulta atual é bloqueada antes do POST; deve ser descartada e substituída por uma revisão confirmada pelo usuário.

A consulta real, somente de leitura, confirmou ausência de cadastro complementar no CNC de homologação do Lauro. O XML gerado em memória com essa decisão omite IM, preserva `3220285` no cadastro e o local confirmado pelo usuário, Serra Negra/SP (`3551603`), e passa no XSD atual. Nenhuma numeração foi reservada e nenhum POST de emissão foi executado durante a verificação. Histórico, configurações e rascunhos reais foram preservados.

Novos rascunhos em homologação começam com o complemento municipal vazio, sujeito à revisão do usuário. A configuração padrão `021` permanece preservada e notas existentes não são modificadas. O botão **Editar rascunho** aparece junto às rejeições quando o rascunho não tem outra DPS bloqueando edição (preparando/preparada/enviando/pendente/autorizada). Salvar uma revisão e preparar a nova DPS continuam separados da confirmação de envio. Os metadados mínimos da consulta CNC aparecem no painel de conexão; não há cópia do cadastro completo do governo para o navegador.

Não são necessários novos campos ou migrations: a decisão é obtida pelo servidor, a inscrição cadastral permanece no snapshot e o XML assinado registra o conteúdo efetivamente preparado. A configuração de produção continua bloqueada e deve consultar o respectivo ambiente quando for implementada. Documentação primária: [API CNC Consulta](https://adn.producaorestrita.nfse.gov.br/cnc/consulta/docs/index.html) e regras E0116/E0120 do Anexo I de homologação.

## Visualização da nota autorizada e indisponibilidade do DANFSe

Após a autorização da DPS 6 pelo usuário, a consulta autenticada à rota oficial de DANFSe de homologação retornou HTTP 404, sem PDF. A documentação do próprio serviço de DANFSe também retornou 404. A falha do download não modifica a autorização e não justifica preparar ou transmitir outra nota. A rota indicada pelos manuais permanece separada de qualquer representação gerada pelo sistema; não se tenta procurar a chave em produção.

O componente agora mostra andamento, erro e confirmação de download junto ao registro da nota, além de um link **Abrir PDF** quando um PDF é obtido. O erro ficava antes abaixo de todo o histórico. O botão **DANFSe de teste** continua consultando somente o PDF oficial; não apresenta HTML, JSON ou uma cópia local como documento oficial.

O botão separado **Espelho em PDF** permite conferir os dados enquanto o serviço oficial está indisponível. A representação é gerada no navegador a partir do XML autorizado e imutável salvo no servidor, não do rascunho atual. O leitor exige namespace nacional, NFS-e com chave e identificador da DPS correspondentes, ambiente 2 e CNPJ do emissor; rejeita XML de outra nota/ambiente, ambiguidades, DOCTYPE/entidades e tamanho excessivo. Não consulta serviços externos para montar o espelho.

Todas as páginas identificam **SEM VALIDADE FISCAL** e que o espelho do FinCore não substitui o DANFSe oficial. Valores ausentes não são inferidos como zero, e não se calculam novos tributos. O PDF mostra os dados disponíveis no XML de emitente, tomador, serviço, competência, prestação/incidência, valores e retenções. Download e visualização não alteram lançamentos, rascunhos ou situação fiscal. Testes isolados de navegador verificam erro visível no registro, download do PDF oficial quando disponível, download do espelho e ausência de reenvio fiscal.

## Preenchimento do cliente por CNPJ e CEP

No formulário do cliente, completar um CNPJ numérico válido inicia, após uma breve pausa, uma consulta pública na BrasilAPI. Razão social, e-mail e endereço são preenchidos quando disponíveis, incluindo número, complemento e código IBGE retornados pelo cadastro. Completar um CEP consulta o ViaCEP e preenche os campos de endereço disponíveis e o código IBGE; número e complemento do imóvel são mantidos para revisão. O complemento de trecho postal do ViaCEP não é usado como sala/apartamento do cliente.

Campos manuais são preservados, inclusive quando editados durante a consulta. Campos preenchidos automaticamente podem acompanhar a troca de CNPJ/CEP. Respostas atrasadas são descartadas quando o identificador muda ou a janela é fechada. O código IBGE de um CEP não é aplicado a uma cidade manual divergente. Um CEP informado separadamente também impede copiar o endereço de outro CEP retornado pelo CNPJ. Há botões para consultar novamente e avisos para endereço inexistente, indisponibilidade e limite de acesso. A consulta não bloqueia o preenchimento e o salvamento manual de rascunhos.

Somente os identificadores CNPJ/CEP são enviados aos serviços públicos, sem tokens/sessão/certificado do FinCore. As consultas têm timeout, limites de resposta e cache temporário em memória. Não há consulta pública de CPF. O local da prestação, serviço, impostos, retenções e cadastro do emissor não são inferidos a partir do cliente. Os dados só são salvos com a ação de salvar rascunho. A disponibilidade/atualização dessas bases não substitui a revisão do cadastro pelo usuário.

Consultas reais de CNPJ/CEP com CORS no navegador foram verificadas. Testes isolados cobrem digitação parcial, cache, campos manuais, troca de CNPJ com resposta antiga pendente, erro de CEP com salvamento manual e layout no celular.

Referências dos provedores: [campos CNPJ da BrasilAPI](https://github.com/BrasilAPI/BrasilAPI/blob/main/pages/docs/doc/cnpj.json), [ViaCEP](https://viacep.com.br/).

### Município da prestação sem digitação do código

O bloco **Onde o serviço foi prestado?** oferece **Usar o município do cliente**, desmarcado inicialmente. Ao marcar, local e código IBGE da prestação acompanham o município do cliente identificado por CNPJ/CEP enquanto a nota está em edição. Se o município do cliente estiver incompleto, os campos ficam pendentes, sem assumir o município do emissor. Os valores escolhidos são salvos no rascunho; a opção de acompanhar o cliente não é uma regra global para outras notas.

Para outro local, o usuário seleciona UF e município. A consulta da [API oficial de localidades do IBGE](https://servicodados.ibge.gov.br/api/docs/localidades) fornece o código de sete dígitos; nome/UF e código são aplicados juntos. O código da prestação fica somente para leitura no fluxo normal. Trocar a UF limpa a seleção anterior e respostas atrasadas de outra UF são descartadas. Há nova tentativa e preenchimento manual alternativo quando a consulta está indisponível. O local da prestação continua separado do município de incidência do ISS e não altera o enquadramento tributário.

Editar manualmente cidade ou UF do cliente invalida o código antigo do cliente, para impedir que fique associado a outro município. A consulta por CEP pode preenchê-lo novamente quando cidade/UF forem compatíveis. A lista oficial por UF foi testada com CORS no navegador, além de cenários isolados de sincronização por CEP, seleção de outro município, trocas rápidas de UF, falha/nova tentativa e reabertura de rascunho.

## Correção de limite de CPU na consulta do A1

Atualização posterior: a comunicação com a Sefin exigiu um serviço Node/OpenSSL, além da correção de CPU descrita abaixo. A migration de recuperação foi aplicada, e o serviço local está separado do Vite. Consulte [inicialização, limites e publicação do serviço fiscal](../server/nfse/README.md). A função Edge só transmite quando esse serviço compatível está configurado; os testes locais usam diretamente o backend Node.

O primeiro teste autenticado na função hospedada encontrou `CPU Time exceeded`. O cliente mostrava equivocadamente “serviço não ativado” ao receber `WORKER_LIMIT` do gateway. A implantação estava ativa; o custo era a conversão de todos os registros da LCR da autoridade em objetos ASN.1/PKIjs.

A leitura passou a percorrer a sequência DER de números de série sem criar uma árvore de objetos para cada registro. Limites de tamanho/nós/estrutura permanecem ativos. PKIjs continua validando metadados e verificando a assinatura sobre os bytes originais e completos de `TBSCertList`, incluindo todos os registros. Há testes de LCR grande com 25 mil entradas, número de série no final da lista e adulteração tanto da assinatura quanto do conteúdo assinado. Datas, cadeia, extensões críticas e bloqueios de revogação não foram dispensados.

A verificação administrativa temporária e somente de leitura, executada no próprio Supabase, confirmou LCRs das três autoridades em 112 ms de tempo total de consulta/verificação, comunicação mTLS e convênio de Santos HTTP 200. Nenhuma DPS foi transmitida. A função temporária foi removida após a verificação. O cliente agora distingue limite de processamento, falha de inicialização, sessão inválida e endpoint inexistente.
