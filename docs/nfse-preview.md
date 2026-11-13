# Preparação da emissão de NFS-e

A aba **NFS-e** está integrada ao menu existente, preservando a logo e a navegação. Aparece para Master e usuários com permissão de gerenciar receitas, respeitando a ocultação da aba por usuário. Isso é controle de interface para rascunhos; a autorização fiscal no servidor ainda será implementada.

Prévia independente: `npm run dev -- --host 127.0.0.1 --port 5173`, depois `http://127.0.0.1:5173/?preview=nfse`. A prévia só existe em desenvolvimento, não usa a sessão do Supabase e mantém seus dados separados dos usuários autenticados.

## Disponível

- Lista vazia inspirada na referência, ações, competência, ajuda e identificação do emissor.
- Assistente: dados da empresa, certificado, configurações e confirmação.
- Emissor único pré-preenchido com os dados confirmados pelo usuário: LAURO ALVES DE OLIVEIRA JUNIOR LTDA, CNPJ 60.371.448/0001-43, Santos/SP, Conselheiro Nebias 756, conj 1011, Boqueirao, CEP 11045-002, IBGE 3548500.
- Referência fiscal atualizada com inscrição municipal 3220285, Simples Nacional, apuração federal/municipal pelo SN, serviço 17.01.01 / 021 e NBS 1.1401.11.00. Os 6% informados do Simples ficam separados do ISS. Consulte [nfse-dados-fiscais.md](nfse-dados-fiscais.md).
- Salvamento parcial da configuração e preparação de rascunhos para vários tomadores PF/PJ, edição, exclusão com confirmação, busca e paginação de dez itens.
- Configuração e rascunhos em localStorage, separados por ID do usuário. Não sincronizam entre máquinas ou usuários. Falhas de leitura impedem sobrescrever o conteúdo existente; falhas de escrita são apresentadas.

## Limites desta etapa

Não há emissão, numeração fiscal, validação tributária, assinatura, envio ao governo, consulta de situação, geração de XML/PDF fiscal, cancelamento fiscal, mensagens a clientes ou criação de lançamentos financeiros. Os rascunhos continuam locais; a custódia do A1 adiciona uma migration e uma função de servidor próprias.

A etapa de certificado agora possui uma integração segura preparada no servidor, documentada em [nfse-certificado-a1.md](nfse-certificado-a1.md). Na prévia independente, o envio permanece fechado. No sistema autenticado, depende da ativação da função, migration e segredos; certificado e senha não entram nos rascunhos do navegador. O botão de emitir continua desabilitado. Salvar a configuração não significa estar habilitado para emitir.

## Próxima etapa

O perfil fiscal de referência foi recebido. O serviço de custódia do A1 está ativado; falta cadastrar o certificado do emissor. A sequência da integração inclui consulta de revogação, habilitação e parâmetros municipais, persistência no servidor, dados por operação, montagem/assinatura do XML, controle de DPS e homologação antes de habilitar emissão em produção. Os campos fiscais definitivos dependem do layout e regras aplicáveis.
