# Certificado A1: recebimento, validação e custódia

## Escopo

Implementação preparada para o emissor único **60.371.448/0001-43**. O CNPJ autorizado vem da configuração do servidor e da tabela privada de emissores; editar o formulário do navegador não permite cadastrar um A1 de outro CNPJ. Não altera lançamentos financeiros nem habilita emissão fiscal.

Frontend: etapa **Certificado digital** do assistente. Backend: Edge Function `nfse-certificate`, com validação de usuário e perfil atual. Banco: migration `20261112160000_nfse_certificate_vault.sql`, em schema privado fora da Data API. Arquivos de A1 e segredos são ignorados pelo Git.

## Controles implementados

- Usuário autenticado e perfil consultados no servidor. Master cadastra, substitui e remove; usuários autorizados a gerenciar receitas podem consultar metadados, respeitando a ocultação da aba. RPCs revalidam permissões. Não se confia no perfil enviado pelo navegador.
- Origens CORS explícitas, sem curinga; sem cookies; HTTPS no cliente; nenhum redirecionamento de upload. Respostas `no-store`, erros sem conteúdo do arquivo, senha, token, detalhes do parser ou banco.
- Arquivos .pfx/.p12 limitados a 512 KB; limite de corpo aplicado também a streams, sem depender apenas de Content-Length. Máximo de cinco tentativas de escrita por usuário/emissor a cada dez minutos, persistido no banco.
- PKCS#12 com integridade/MAC, senha, limite de profundidade ASN.1 e parâmetros de derivação. Suporte RSA ≥ 2048 bits, assinatura SHA-256/384/512, chave privada correspondente, usos de assinatura e autenticação de cliente, política A1 ICP-Brasil e CNPJ em SAN otherName OID `2.16.76.1.3.3`.
- Datas e cadeia completa verificadas contra raízes administrativamente confiadas no servidor. Uma raiz presente no PFX não se torna confiável por ter sido enviada junto. Tipos ou algoritmos não suportados são rejeitados.
- A senha e o PFX original não são persistidos. Chave privada normalizada e cadeia são criptografadas com AES-256-GCM, IV aleatório e AAD contendo versão, emissor, ID do registro e ID da chave de criptografia. Chave mestra fica em secrets do ambiente, separada do banco. Nenhum endpoint devolve PFX, chave, senha ou envelope.
- Status devolve somente metadados explícitos: titular, CNPJ, autoridade, validade, fingerprint, datas e resultado das verificações. Não existe endpoint de download do certificado.
- Substituição e remoção exigem confirmação e ID esperado; bloqueio transacional por emissor impede sobrescrita concorrente. Validação rejeitada mantém o certificado anterior. Histórico registra ações, fingerprint e códigos de rejeição, sem payloads privados.
- Browser mantém arquivo e senha apenas no formulário em memória, limpa os campos no envio e não os coloca no localStorage, IndexedDB, URL ou logs. Strings em runtimes JavaScript não têm apagamento físico garantido; buffers controlados são limpos por melhor esforço.

## Limites explícitos

**Revogação ainda não é consultada.** Cadastro devolve `revocationStatus: not_checked` e `fiscalReady: false`, inclusive com cadeia válida. Antes de qualquer assinatura/transmissão fiscal, a futura integração precisa conferir LCR/OCSP e a validade novamente, com tratamento seguro de rede e indisponibilidade. Não há liberação fiscal a partir deste upload.

Retirar o A1 do cadastro ativo não o revoga na autoridade certificadora e não apaga imediatamente cópias existentes em backups do banco. As chaves e backups devem ter política de retenção e acesso restrito. A raiz de confiança é responsabilidade da operação: nunca usar certificados sintéticos de testes como raízes de produção.

## Ativação do backend

1. Revisar e aplicar **somente** a migration acima em transação, seguindo o registro de `supabase_migrations.schema_migrations` usado pelo projeto. Não executar `db push` indiscriminadamente sobre migrações históricas. Essa migration já foi aplicada e registrada no projeto `tzpoveyjetfobzeeybqu`; não repetir a ativação.
2. Obter as raízes públicas da ICP-Brasil pelo repositório oficial do ITI e conferir os fingerprints SHA-256 por uma fonte confiável. Intermediárias não devem ser adicionadas como raízes; devem acompanhar o PFX exportado com cadeia completa.
3. Gerar os segredos sem imprimir chaves, por exemplo:

   ```powershell
   node scripts/prepare-nfse-certificate-secrets.mjs --roots .local/icp-roots.pem --root-sha256 FINGERPRINT_SHA256_DA_RAIZ
   ```

   O arquivo de saída fica obrigatoriamente em `.local`, não sobrescreve um arquivo existente e contém `NFSE_ISSUER_CNPJ`, `NFSE_CERTIFICATE_KEYS`, `NFSE_CERTIFICATE_ACTIVE_KEY_ID`, `NFSE_ICP_ROOTS_PEM_B64` e `NFSE_ALLOWED_ORIGINS`. As raízes são públicas; a chave mestra gerada é secreta. Guardar a chave em um cofre separado antes de usar. Não usar nomes `VITE_*` para esses segredos.

4. Configurar secrets e publicar apenas a função necessária:

   ```powershell
   npx supabase secrets set --project-ref tzpoveyjetfobzeeybqu --env-file .local/nfse-certificate-secrets.env
   npx supabase functions deploy nfse-certificate --project-ref tzpoveyjetfobzeeybqu --use-api
   ```

   `verify_jwt = false` no gateway é intencional para compatibilidade com a chave pública moderna: a função faz a validação obrigatória do Bearer via `Auth.getUser`, consulta o perfil e só então processa o arquivo. Isso não permite upload anônimo. Secrets `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` vêm do ambiente da função.

5. Publicar o frontend, entrar como Master, abrir **NFS-e → Certificado digital** e consultar o status. Sem função, migration, chave ou raízes, o formulário continua fechado e mostra a pendência. Upload real deve ser feito somente nessa conexão autenticada e HTTPS, nunca por chat.
6. Verificar recusa de requisições anônimas e operadores, metadados sem segredos e auditoria. Não importar certificados sintéticos no projeto de produção.

### Preparação local desta implementação

O bundle RSA local foi obtido do [arquivo vigente oficial do ITI](https://www.gov.br/iti/pt-br/assuntos/repositorio/certificados-das-acs-da-icp-brasil-arquivo-unico-compactado) e conferido com o SHA-512 publicado pelo próprio repositório (`baa87acf275c74c775e9191868cc162bb324fddf7e4f6fdce2c5614fa4ed98f242c1dc1ad47331b41f4f59d8c85258eba698989bb726df17fa3fa121adde95a3`). Foram selecionadas apenas as raízes RSA autoassinadas v5, v10 e v12. Não foram incorporadas raízes de assinatura de código ou certificados de AC intermediária. As versões futuras ou algoritmos não suportados exigem revisão explícita.

Os arquivos `.local/icp-roots.pem`, `.local/icp-root-pins.json` e `.local/nfse-certificate-secrets.env` foram preparados; são ignorados pelo Git. O arquivo de segredos local tem ACL restrita ao usuário atual e SYSTEM e uma cópia protegida pelo Windows/DPAPI. Nenhum certificado privado real foi solicitado ou utilizado.

O SQL transacional `.local/activate-nfse-certificate.sql` foi aplicado e a função `nfse-certificate` foi publicada. A verificação remota confirmou RLS e schema privado, RPCs exclusivas de `service_role`, rejeição de usuários anônimos e origens não autorizadas, sem cadastrar certificados ou alterar lançamentos financeiros.

A gravação dos secrets foi recusada pelo Supabase por falta de permissão da conta conectada ao CLI. O envio permanece fechado até o ajuste desse acesso e a execução bem-sucedida do comando `secrets set` acima. Os valores públicos de CNPJ e origem de produção também estão definidos como padrão no servidor para permitir a consulta autenticada do estado de configuração; isso não substitui a chave privada de criptografia nem as raízes de confiança. A chave mestra não foi colocada no código, no banco ou no frontend.

## Rotação e recuperação

O envelope contém `keyId`. `NFSE_CERTIFICATE_KEYS` admite chaves antigas e a ativa. Para uma rotação sem indisponibilidade, adicionar nova chave, alterar a ativa e recriptografar os envelopes existentes em uma operação administrativa controlada antes de retirar chaves antigas. A rotina automática de recriptografia ainda não foi implementada; também é possível recadastrar o A1 na nova chave. Excluir a única chave que abre um envelope impede a recuperação daquele cadastro. Nenhuma chave deve ser copiada para o banco ou para o frontend.

## Validação do desenvolvimento

- Testes Node com PKCS#12 sintéticos gerados em memória: validações, erros, criptografia, autenticação, CORS, limites, substituição e remoção.
- Testes com PostgreSQL real via PGlite: RPCs, permissões de schema/tabelas/execute/TRUNCATE, status sem envelope, registros inválidos, auditoria, limites e conflitos.
- `deno check --no-config supabase/functions/nfse-certificate/index.ts` valida a compatibilidade da função. Parser fixado em `node-forge@1.4.3`, importado somente pelo servidor e pelos testes; não está no bundle do cliente.

Referências: [segredos nas Edge Functions](https://supabase.com/docs/guides/functions/secrets), [integração com Auth](https://supabase.com/docs/guides/functions/auth-legacy-jwt), [conceitos de validação ICP-Brasil](https://validar.iti.gov.br/conceitos.html), [OIDs ICP-Brasil](https://www.gov.br/iti/pt-br/assuntos/legislacao/documentos-principais/IN2020_15_DOCICP_04.01.pdf).
