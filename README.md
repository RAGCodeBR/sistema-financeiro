
# Sistema Financeiro

Interface financeira interativa criada no Figma Make e preparada para evoluir como aplicação React/Vite.

## Funcionalidades iniciais

- Dashboard com KPIs, análise de receitas, atividades e pendências.
- Modais para nova despesa, nova receita e transferências.
- Navegação financeira, filtros de período, relatórios e ações rápidas.
- Layout responsivo com menu para dispositivos móveis.

## Desenvolvimento

```bash
npm install
npm run dev
```

## Publicação

O GitHub Actions publica automaticamente o conteúdo de `dist` no GitHub Pages a cada push na branch `main`.

## Cadastro de fornecedores e clientes

A única aba **Fornecedores e clientes**, abaixo de Plano de contas, separa os dois tipos em guias. A migração `supabase/migrations/20261005190000_counterparties.sql` foi aplicada ao projeto Supabase `tzpoveyjetfobzeeybqu` em 05/10/2026. Ela cria os cadastros por centro de custo, vincula os lançamentos existentes pelos nomes já informados e mantém compatibilidade com versões anteriores do formulário. A interface permanece apenas no checkout local até ser publicada separadamente. `npm run build` não aplica migrações.

Editar e excluir cadastros também exigem essa migração. Excluir arquiva o fornecedor/cliente, removendo-o das opções de novos lançamentos sem apagar ou alterar o histórico financeiro; o cadastro pode ser restaurado na própria tela.

No lançamento, o campo fornecedor/favorecido ou cliente/pagador sugere os contatos do tipo e centro de custo selecionados e também aceita texto novo. Após a migração, o banco registra automaticamente o nome novo quando o lançamento é salvo ou editado; o cadastro criado aparece na aba após atualizar a lista. Para fornecedores criados dessa forma, o campo "O que fornece" pode ser preenchido depois em Editar.
  
