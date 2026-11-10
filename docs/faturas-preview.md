# Conferência local de faturas de cartão

Execute `npm install` e `npm run dev:faturas`. A prévia abre em
<http://127.0.0.1:5173/?preview=faturas>, sem login e sem conexão ao Supabase.
O parâmetro de prévia está disponível somente no servidor de desenvolvimento.

## Usar a prévia

1. Selecione ou arraste PDF, PNG, JPG ou WebP para a área de importação. O
   modelo Itaú validado com texto selecionável mantém a leitura direta;
   outros modelos e imagens passam pela conferência assistida. Se houver uma amostra em
   `.local/fatura-itau.pdf`, o servidor local a carrega automaticamente.
2. Confira vencimento, total das movimentações, saldo anterior, pagamentos e
   total a pagar. Os totais precisam fechar; divergências aparecem como avisos.
3. Abra cada item para escolher PJ/PF, centro de custo e categoria, ou marcar
   uma compra não reconhecida. As descrições não determinam automaticamente
   se a compra é pessoal ou empresarial.
4. Para comparar, carregue o Excel exportado pelo FinCore. Use um período que
   cubra as compras e os vencimentos relevantes, sem restringir indevidamente
   os centros. São aceitos os cabeçalhos `Vencimento`/`Data`, `Centro`/`Centro
   de custo`, `Descrição`, `Tipo`, `Categoria`, `Fornecedor / cliente`,
   `Valor (R$)`, `Parcela` e `Pagamento / recebimento`.
5. Confirme explicitamente os vínculos sugeridos. Mesmo valor não comprova
   correspondência. Dois itens concorrendo pelo mesmo lançamento são
   destacados e não podem ser vinculados simultaneamente a ele.
6. Use **Revisar distribuição** e escolha **Baixar Excel** ou **Baixar PDF**.
   O relatório contém toda a conferência, independentemente da página ou
   filtro em exibição, com classificação, centros, categorias, observações e
   pendências. Pagamentos e parcelas futuras ficam separados. Essa ação não
   cria despesas.
   No PDF, PJ e PF têm seções próprias, com distribuição, subtotal e detalhe
   dos itens. Pendências ficam em outra seção, e pagamentos/parcelas futuras
   são apresentados ao final, sem compor os subtotais atuais.

7. No resumo, confira o vencimento e a situação de pagamento identificados,
   a quantidade e o total das despesas novas, vínculos e compensações.
   **Confirmar e gerar lançamentos locais** cria despesas apenas no navegador
   e abre **Lançamentos gerados**. Na versão autenticada, a confirmação usa
   a rotina transacional do banco, quando a migração estiver habilitada.
8. Use os seletores **Cartão** e **Fatura** para alternar os documentos já
   importados. Os cartões são identificados pela numeração mascarada e banco;
   cada ciclo mantém sua própria origem. Importar um novo arquivo adiciona uma
   fatura à biblioteca, sem substituir outras. O documento original é guardado em
   IndexedDB, separado por usuário, para reabrir ao trocar de cartão.

A criação considera apenas itens validados. Compras não reconhecidas e itens
incompletos ficam pendentes. Correspondências exigem vínculo explícito ou
confirmação de que se trata de uma despesa diferente. Identificadores de origem
incluem cartão, vencimento, tipo, data, estabelecimento, valor, parcela e a
ocorrência de compras idênticas, evitando duplicação em reimportações e novas
versões do PDF. Uma exclusão posterior do lançamento exige revisão do histórico;
reimportar não recria silenciosamente esse registro.

O vencimento é preenchido pelo documento; a data original da compra é preservada
separadamente. Faturas com valor a pagar geram despesas previstas. A quitação só
é inferida quando saldo anterior, pagamentos detalhados e movimentações fecham
com total a pagar zero. Um vencimento passado não significa pagamento. Sem
evidência suficiente, a despesa fica prevista, sem solicitar dados ao cliente.
O PDF emitido antes do pagamento não informa uma quitação posterior.
Se uma nova versão comprovar a quitação, o resumo oferece a confirmação da
baixa das despesas geradas anteriormente pela importação. Só são atualizados
lançamentos ainda previstos, com valor, centro e categoria preservados; itens
alterados exigem revisão. Essa atualização não duplica despesas nem reverte
automaticamente lançamentos já pagos.

Créditos são abatidos exclusivamente de despesas novas no mesmo grupo PJ/PF,
centro e categoria, priorizando encargos. As despesas são criadas pelo valor
líquido; valores originais e compensações ficam no histórico da importação.
Itens integralmente compensados não viram despesas de valor zero nem receitas.
Créditos sem base suficiente ou ainda não classificados bloqueiam a confirmação.

Os rascunhos ficam no armazenamento local do navegador, associados ao hash
SHA-256 do PDF. Na prévia, biblioteca, lançamentos e histórico de origem são
salvos localmente; limpar os dados do navegador remove esses dados. Reimportar
o mesmo arquivo recupera as decisões; não acrescenta linhas à fatura existente.
O PDF e a base Excel não são enviados a serviços externos pela ferramenta.

**Remover fatura**, abaixo dos seletores de cartão e fatura, pede confirmação
antes de retirar a fatura da biblioteca deste navegador e apagar o PDF e o
rascunho locais. Havendo outras faturas, a tela abre outra automaticamente;
ao remover a última, volta à importação. A amostra local não reaparece após
essa remoção, inclusive ao recarregar a página.

Despesas já geradas, vínculos e histórico de origem são preservados tanto na
prévia quanto no sistema integrado. Remover a fatura não estorna nem exclui
lançamentos financeiros; eventuais correções são feitas em Lançamentos.
Reimportar o PDF recupera os itens confirmados pelo histórico e não cria
duplicações. Dados já confirmados no Supabase não são apagados por essa ação.

## Compras não reconhecidas e estornos

Ao reabrir uma compra não reconhecida, há três ações: **Manter em apuração**
salva a observação e mantém a pendência; **Reconhecer compra** libera novamente
a classificação PJ/PF; **Marcar como estornada** registra valor integral, data
e observação do cancelamento confirmado pelo banco. Estornos parciais não
encerram a ocorrência nesta versão e devem permanecer em apuração.

O vínculo com um crédito é opcional e pode ser adicionado depois em
**Detalhar estorno**. O seletor oferece créditos ainda não processados nas
faturas importadas do mesmo cartão e do mesmo valor, inclusive de outro
vencimento. Um crédito só pode resolver uma compra e não pode ser reutilizado
na compensação de outras despesas. Não há associação automática por descrição.

Compras encerradas recebem a tag **Estornada** e o filtro **Estornadas**.
Elas saem de A validar e de Não reconhecidas. Um crédito associado recebe
**Crédito de estorno** e também sai das pendências. Ambos ficam em uma seção
separada da distribuição e dos relatórios PDF/Excel, com valor, data,
observação e referência ao crédito. Os valores e totais originais do PDF são
preservados: a marcação não cria despesa nem receita e não presume que o
banco alterou o documento original.

Compras já lançadas ou vinculadas e créditos já compensados não podem ser
encerrados por esse fluxo: exigem correção financeira em Lançamentos.
Na prévia, os estornos ficam no histórico local por identidade de origem e
continuam reconhecidos ao remover/reimportar o PDF ou importar outra versão.
No sistema autenticado, são salvos imediatamente no Supabase pela rotina
`record_card_refund`, sem depender de gerar outras despesas. Alterações têm
histórico de auditoria; acesso e escrita são verificados no servidor.

## Integração no sistema

A aba **Cartões e faturas** reutiliza o mesmo componente, compara as despesas
acessíveis ao usuário e usa os centros e categorias cadastrados. O rascunho
é separado por usuário. A prévia sem login usa os centros iniciais do projeto
e categorias de demonstração. O grupo PF usa o centro existente Pessoa Física;
os demais centros são apresentados no grupo PJ nesta primeira versão.

Compras, encargos e créditos compõem a movimentação atual. Pagamentos e
parcelas futuras são exibidos separadamente. As datas das parcelas futuras
são as datas originais das compras, não vencimentos futuros calculados.
Uma parcela importada mantém sua numeração, mas editar o lançamento não
converte essa despesa em uma nova série nem gera outras parcelas futuras.
IOF consolidado usa o vencimento da fatura como referência e indica isso
no detalhe do item. Créditos entram com sinal negativo, sem virar novas
despesas positivas.

O leitor específico foi desenvolvido e conferido com o modelo Itaú fornecido.
Outros layouts usam extração genérica e conferência assistida. Nubank PF/PJ
ainda precisa das amostras reais para ganhar um leitor específico validado.
O tipo do cartão não determina a classificação PJ/PF das compras.

## Importação por arquivos, imagens e leitura assistida

A área de arrastar recebe até 10 arquivos e 100 MB por lote, com limite de
25 MB por arquivo. A fila mostra o resultado de cada arquivo, pausa quando
é necessária conferência e continua após confirmar ou cancelar aquele arquivo.
Um erro de arquivo não descarta os seguintes. Cada arquivo corresponde a uma
fatura: para uma fatura fotografada em várias páginas, reúna todas em um PDF.

PDFs com texto usam PDF.js; páginas sem camada textual e imagens PNG, JPG e
WebP usam OCR em português no navegador. São aceitas até 100 páginas por PDF,
das quais até 20 podem exigir OCR, e imagens de até 40 megapixels. PDFs com
senha precisam ser desbloqueados; HEIC precisa ser exportado para JPG.
**Cancelar lote** interrompe a leitura e cancela os itens restantes da fila.

Tesseract.js, o motor e o modelo de idioma são dependências versionadas. O
Vite serve/copia esses recursos em `ocr/` no mesmo site, respeitando o caminho
do GitHub Pages. Os documentos não são enviados a APIs de OCR nem a IA externa;
nenhuma chave adicional de serviço é necessária. A leitura de imagens pode
demorar mais que a leitura de um PDF textual.

A conferência assistida exibe original e texto extraído e permite escolher
um cartão existente ou conferir banco, final, vencimento, nome do cartão e
identificação mascarada, sem cadastrar o número completo. Permite corrigir,
incluir e remover itens, ajustar datas, tipos, valores, parcelas e páginas,
com paginação. Datas curtas só recebem ano após haver contexto de vencimento.
Totais ausentes ficam vazios; a soma extraída não vira silenciosamente o
total do documento. A conclusão exige confirmação explícita de que todas as
páginas e linhas foram conferidas e valida a soma dos itens e o resumo.
Pagamentos e parcelas futuras permanecem separados, e créditos têm sinal
negativo. PDFs com vários cartões identificados exigem separação por cartão.

Depois dessa revisão, a fatura entra no fluxo normal de classificação PJ/PF,
comparação e confirmação de lançamentos. A leitura assistida não garante
interpretação automática de todo modelo: linhas sem padrão ou texto ruim
podem exigir correção manual ou uma nova imagem. A confirmação financeira
continua nas mesmas funções e validações do Supabase; esta mudança não exige
nova migração. Cartões sem identidade visual usam um desenho neutro com banco,
nome opcional, final e vencimento. Relatórios usam o banco correto no título
e no nome do arquivo. As decisões são recuperadas ao reimportar um arquivo
já conferido, inclusive quando sua leitura inicial foi por imagem.

## Banco de dados e ativação

A migração `supabase/migrations/20261106190000_card_statement_import.sql`
habilita a confirmação no sistema autenticado. Sua aplicação ao ambiente de
destino é independente da publicação do frontend: o workflow de GitHub Pages
executa os testes e o build, mas não aplica migrações no Supabase.

A migração seguinte, `supabase/migrations/20261106210000_card_refund_reviews.sql`,
habilita o registro e os vínculos de estornos e atualiza a confirmação de
faturas para excluir essas movimentações da criação financeira. Ambas precisam
ser aplicadas em ordem. Sem a segunda, a conferência existente continua
funcionando, mas o formulário de estorno informa que a integração precisa ser
habilitada e não afirma ter encerrado uma ocorrência no servidor.

`supabase/migrations/20261107120000_card_import_permissions.sql` restringe as
permissões das tabelas de importação à leitura autenticada, inclusive em
projetos que concedem ALL por padrão a novas tabelas públicas. A escrita
permanece nas funções autenticadas; TRUNCATE direto também é revogado.

`confirm_card_statement` valida totais, identidade de origem, classificação,
acesso ao centro, categoria, vínculos e compensações no servidor. Uma trava
por cartão/ciclo e restrições únicas tornam a operação idempotente. Todos os
lançamentos e o histórico são confirmados na mesma transação; uma falha reverte
o conjunto. As tabelas de importação têm políticas de leitura e não permitem
escrita direta pelo navegador. A rotina autenticada verifica cada permissão.

O adaptador do Supabase retorna despesas novas e registros existentes em uma
repetição, permitindo recuperar a interface após uma resposta de rede perdida.
Vínculos manuais existentes mantêm os dados financeiros originais; a importação
não altera seu valor ou baixa. A confirmação de quitação posterior se restringe
às despesas criadas pela própria importação e ainda consistentes com a origem.

## Arquivos locais e verificação

`.local/` está no `.gitignore`. A amostra não fica em `public/`, não é
incorporada ao build e só é disponibilizada por uma rota de desenvolvimento
para conexões de loopback. Não adicione faturas reais aos arquivos versionados.

Verificações: `node --test tests/*.test.mjs` e `npm run build`. Os testes usam
dados sintéticos para leitura em colunas, centavos, créditos, parcelas,
divergências, correspondências ambíguas e validação de classificações. O SQL
é executado em PostgreSQL local com PGlite, incluindo permissões, idempotência,
isolamento entre cartões, rollback, créditos e reimportação após exclusão.
