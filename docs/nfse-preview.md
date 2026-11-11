# Preparação da emissão de NFS-e

A aba **NFS-e** está integrada ao menu existente, preservando a logo e a navegação. Aparece para Master e usuários com permissão de gerenciar receitas, respeitando a ocultação da aba por usuário. Isso é controle de interface para rascunhos; a autorização fiscal no servidor ainda será implementada.

Prévia independente: `npm run dev -- --host 127.0.0.1 --port 5173`, depois `http://127.0.0.1:5173/?preview=nfse`. A prévia só existe em desenvolvimento, não usa a sessão do Supabase e mantém seus dados separados dos usuários autenticados.

## Disponível

- Lista vazia inspirada na referência, ações, competência, ajuda e identificação do emissor.
- Assistente: dados da empresa, certificado, configurações e confirmação.
- Emissor único pré-preenchido com os dados confirmados pelo usuário: LAURO ALVES DE OLIVEIRA JUNIOR LTDA, CNPJ 60.371.448/0001-43, Santos/SP, Conselheiro Nebias 756, conj 1011, Boqueirao, CEP 11045-002, IBGE 3548500.
- Regime tributário, inscrição municipal, CNAE, serviço e tributação pendentes, sem inferir isenção ou alíquotas.
- Salvamento parcial da configuração e preparação de rascunhos para vários tomadores PF/PJ, edição, exclusão com confirmação, busca e paginação de dez itens.
- Configuração e rascunhos em localStorage, separados por ID do usuário. Não sincronizam entre máquinas ou usuários. Falhas de leitura impedem sobrescrever o conteúdo existente; falhas de escrita são apresentadas.

## Limites desta etapa

Não há emissão, numeração fiscal, validação tributária, assinatura, envio ao governo, consulta de situação, geração de XML/PDF fiscal, cancelamento fiscal, mensagens a clientes ou criação de lançamentos financeiros. Não há alterações de banco de dados ou novas dependências.

O botão de importar A1 está desabilitado. Nenhum arquivo de certificado, senha ou token é solicitado ou armazenado no módulo. O botão de emitir também está desabilitado. Salvar a configuração não significa estar habilitado para emitir.

## Próxima etapa

Receber inscrição municipal, regime tributário e XML/PDF de uma nota já emitida; confirmar habilitação do emissor e serviços utilizados; definir integração direta ou provedor fiscal; implementar armazenamento seguro do A1 e segredos no servidor, permissões e auditoria; validar homologação e só então habilitar produção. Os campos fiscais definitivos dependem do layout e regras aplicáveis.
