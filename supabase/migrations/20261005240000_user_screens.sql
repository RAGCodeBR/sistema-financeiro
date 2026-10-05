-- Controle de abas por usuário: lista de telas que devem ficar ocultas.
-- Vazio (padrão) = o usuário vê todas as abas a que já tem direito.
alter table public.profiles
  add column if not exists hidden_screens text[] not null default '{}';
