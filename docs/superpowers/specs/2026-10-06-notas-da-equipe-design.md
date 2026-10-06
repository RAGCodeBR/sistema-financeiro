# Notas da equipe — design

Data: 2026-10-06 · Status: aprovado no chat

## Objetivo
Controlar, mês a mês, quais colaboradores/prestadores de serviço já enviaram a
nota fiscal, guardar o arquivo da nota e permitir vê-lo na tela, baixar e editar.

## Decisões
- Recorrência **mensal com dia limite** por colaborador. Status do mês:
  **Enviada** (há nota), **Pendente** (sem nota, dentro do prazo),
  **Atrasada** (sem nota, passou do dia limite).
- Lista **única** da equipe (sem centro de custo).
- **Não** cria lançamento/despesa automaticamente.
- Acesso: Master + usuários com o check "Permitir acesso às Notas da equipe"
  (flag `__team_notes__` em `profiles.allowed_units`, mesmo padrão de `__reports__`).

## Dados (migração `20261006170000_team_notes.sql`)
- `team_members`: id, name, service, document, email, expected_amount,
  due_day (1–31), active, created_at.
- `team_invoices`: id, member_id (cascade), competence `YYYY-MM`,
  invoice_number, amount, issue_date, files `text[]`, notes, created_at;
  único por (member_id, competence).
- Função `can_view_team_notes()` = master ou flag. RLS nas duas tabelas.
- Bucket privado `team-notes` (10 MB, PDF/PNG/JPG) com políticas
  `can_view_team_notes()`. Caminho: `<invoice_id>/<timestamp>-<nome ASCII>`.

## Tela (aba "Notas da equipe", abaixo de Fornecedores/clientes)
- Navegador de mês; contadores clicáveis Enviadas / Pendentes / Atrasadas.
- Lista do mês: colaborador, serviço, dia limite, status, valor, ações.
  Mostra colaboradores ativos criados até o mês + quem tem nota no mês.
- Colaborador: criar, editar (inclui ativar/inativar), excluir (confirmação).
- Nota: registrar/editar (nº, valor, emissão, observações, arquivos).
- Visualizador: PDF em `<iframe>`, imagem em `<img>`, via URL assinada;
  botões Baixar e Editar.

## Organização do código
- `src/app/shared.tsx`: helpers comuns (fmt, parseMoney, CurrencyInput,
  labelMonth, Month) movidos do App.tsx.
- `src/app/TeamNotes.tsx`: a tela nova, autocontida (carrega os próprios dados).
- `src/lib/bridge.ts`: funções de leitura/escrita e storage.
- `App.tsx`: permissão, menu, roteamento da tela e check em Usuários.

## Fora do escopo
Despesa automática, lembrete por e-mail, mais de uma nota por mês por colaborador
(vários arquivos na mesma nota resolvem).
