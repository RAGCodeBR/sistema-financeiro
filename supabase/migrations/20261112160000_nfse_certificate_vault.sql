-- Certificate custody is server-only. This migration never changes financial rows.
create schema if not exists nfse_private;
revoke all on schema nfse_private from public, anon, authenticated;

create table nfse_private.issuers (
  cnpj text primary key check (cnpj ~ '^[0-9]{14}$')
);
insert into nfse_private.issuers(cnpj) values ('60371448000143');
create table nfse_private.certificates (
  issuer_cnpj text primary key references nfse_private.issuers(cnpj),
  id uuid not null unique,
  metadata jsonb not null,
  envelope jsonb not null,
  uploaded_by uuid not null references auth.users(id),
  uploaded_at timestamptz not null default now()
);
create table nfse_private.certificate_events (
  id bigint generated always as identity primary key,
  issuer_cnpj text not null references nfse_private.issuers(cnpj),
  actor_id uuid not null references auth.users(id),
  action text not null check (action in ('uploaded','replaced','removed','rejected')),
  fingerprint text,
  reason_code text,
  created_at timestamptz not null default now()
);
create table nfse_private.certificate_attempts (
  actor_id uuid not null references auth.users(id) on delete cascade,
  issuer_cnpj text not null references nfse_private.issuers(cnpj),
  window_start timestamptz not null,
  attempts integer not null,
  primary key (actor_id, issuer_cnpj)
);
alter table nfse_private.issuers enable row level security;
alter table nfse_private.certificates enable row level security;
alter table nfse_private.certificate_events enable row level security;
alter table nfse_private.certificate_attempts enable row level security;
revoke all on all tables in schema nfse_private from public, anon, authenticated;
revoke all on all sequences in schema nfse_private from public, anon, authenticated;

create function nfse_private.require_master(actor uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id = actor and role = 'master') then
    raise exception 'NFSE_FORBIDDEN' using errcode = '42501';
  end if;
end;
$$;
revoke all on function nfse_private.require_master(uuid) from public, anon, authenticated;

create function public.nfse_certificate_status(p_actor_id uuid, p_issuer_cnpj text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not exists(select 1 from public.profiles where id = p_actor_id and (role = 'master' or ('__income_write__' = any(allowed_units) and not ('nfse' = any(coalesce(hidden_screens, '{}')))))) then
    raise exception 'NFSE_FORBIDDEN' using errcode = '42501';
  end if;
  if not exists(select 1 from nfse_private.issuers where cnpj = p_issuer_cnpj) then raise exception 'NFSE_ISSUER_NOT_CONFIGURED'; end if;
  select jsonb_build_object('id', id, 'cnpj', metadata->>'cnpj', 'subject', metadata->>'subject', 'authority', metadata->>'authority',
    'fingerprint', metadata->>'fingerprint', 'validFrom', metadata->>'validFrom', 'validUntil', metadata->>'validUntil',
    'validatedAt', metadata->>'validatedAt', 'chainVerified', true, 'revocationStatus', 'not_checked', 'fiscalReady', false,
    'uploadedAt', uploaded_at) into result from nfse_private.certificates where issuer_cnpj = p_issuer_cnpj;
  return result;
end;
$$;

create function public.nfse_certificate_attempt(p_actor_id uuid, p_issuer_cnpj text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare count_attempts integer;
begin
  perform nfse_private.require_master(p_actor_id);
  insert into nfse_private.certificate_attempts(actor_id, issuer_cnpj, window_start, attempts)
    values (p_actor_id, p_issuer_cnpj, now(), 1)
    on conflict (actor_id, issuer_cnpj) do update set
      attempts = case when nfse_private.certificate_attempts.window_start <= now() - interval '10 minutes' then 1 else nfse_private.certificate_attempts.attempts + 1 end,
      window_start = case when nfse_private.certificate_attempts.window_start <= now() - interval '10 minutes' then now() else nfse_private.certificate_attempts.window_start end
    returning attempts into count_attempts;
  return count_attempts <= 5;
end;
$$;

create function public.nfse_certificate_save(p_actor_id uuid, p_issuer_cnpj text, p_id uuid, p_metadata jsonb, p_envelope jsonb, p_expected_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare current_id uuid;
begin
  perform nfse_private.require_master(p_actor_id);
  perform 1 from nfse_private.issuers where cnpj = p_issuer_cnpj for update;
  if not found then raise exception 'NFSE_ISSUER_NOT_CONFIGURED'; end if;
  select id into current_id from nfse_private.certificates where issuer_cnpj = p_issuer_cnpj;
  if current_id is distinct from p_expected_id then raise exception 'NFSE_CONFLICT'; end if;
  if p_metadata->>'cnpj' is distinct from p_issuer_cnpj or coalesce(p_metadata->>'fingerprint','') !~ '^[a-f0-9]{64}$'
    or p_metadata->>'chainVerified' is distinct from 'true' or p_metadata->>'fiscalReady' is distinct from 'false'
    or p_metadata->>'revocationStatus' is distinct from 'not_checked'
    or p_metadata->>'validUntil' is null or (p_metadata->>'validUntil')::timestamptz <= now()
    or p_metadata->>'validFrom' is null or (p_metadata->>'validFrom')::timestamptz > now()
    or p_metadata - array['cnpj','subject','authority','fingerprint','validFrom','validUntil','validatedAt','chainVerified','revocationStatus','fiscalReady'] <> '{}'::jsonb
    or p_envelope->>'version' is distinct from '1'
    or coalesce(p_envelope->>'keyId','') !~ '^[a-zA-Z0-9_-]{1,40}$'
    or length(coalesce(p_envelope->>'iv','')) <> 16
    or coalesce(p_envelope->>'iv','') !~ '^[A-Za-z0-9+/]{16}$'
    or length(coalesce(p_envelope->>'ciphertext','')) not between 100 and 1048576
    or coalesce(p_envelope->>'ciphertext','') !~ '^[A-Za-z0-9+/]+={0,2}$'
    or p_envelope - array['version','keyId','iv','ciphertext'] <> '{}'::jsonb
    then raise exception 'NFSE_INVALID_RECORD'; end if;
  insert into nfse_private.certificates(issuer_cnpj,id,metadata,envelope,uploaded_by) values
    (p_issuer_cnpj,p_id,p_metadata,p_envelope,p_actor_id)
    on conflict (issuer_cnpj) do update set id = excluded.id, metadata = excluded.metadata, envelope = excluded.envelope, uploaded_by = excluded.uploaded_by, uploaded_at = now();
  insert into nfse_private.certificate_events(issuer_cnpj,actor_id,action,fingerprint) values
    (p_issuer_cnpj,p_actor_id,case when current_id is null then 'uploaded' else 'replaced' end,p_metadata->>'fingerprint');
end;
$$;

create function public.nfse_certificate_remove(p_actor_id uuid, p_issuer_cnpj text, p_expected_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare current_id uuid; current_fingerprint text;
begin
  perform nfse_private.require_master(p_actor_id);
  perform 1 from nfse_private.issuers where cnpj = p_issuer_cnpj for update;
  select id, metadata->>'fingerprint' into current_id, current_fingerprint from nfse_private.certificates where issuer_cnpj = p_issuer_cnpj;
  if current_id is null or current_id is distinct from p_expected_id then raise exception 'NFSE_CONFLICT'; end if;
  delete from nfse_private.certificates where issuer_cnpj = p_issuer_cnpj;
  insert into nfse_private.certificate_events(issuer_cnpj,actor_id,action,fingerprint) values(p_issuer_cnpj,p_actor_id,'removed',current_fingerprint);
end;
$$;

create function public.nfse_certificate_rejected(p_actor_id uuid, p_issuer_cnpj text, p_reason_code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform nfse_private.require_master(p_actor_id);
  if p_reason_code !~ '^[A-Z_]{1,50}$' then raise exception 'NFSE_INVALID_RECORD'; end if;
  insert into nfse_private.certificate_events(issuer_cnpj,actor_id,action,reason_code) values(p_issuer_cnpj,p_actor_id,'rejected',p_reason_code);
end;
$$;

-- Even service callers cannot read the private table through the Data API.
-- The functions expose explicitly selected metadata and write-only custody.
revoke all on function public.nfse_certificate_status(uuid,text) from public, anon, authenticated;
revoke all on function public.nfse_certificate_attempt(uuid,text) from public, anon, authenticated;
revoke all on function public.nfse_certificate_save(uuid,text,uuid,jsonb,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.nfse_certificate_remove(uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.nfse_certificate_rejected(uuid,text,text) from public, anon, authenticated;
grant execute on function public.nfse_certificate_status(uuid,text) to service_role;
grant execute on function public.nfse_certificate_attempt(uuid,text) to service_role;
grant execute on function public.nfse_certificate_save(uuid,text,uuid,jsonb,jsonb,uuid) to service_role;
grant execute on function public.nfse_certificate_remove(uuid,text,uuid) to service_role;
grant execute on function public.nfse_certificate_rejected(uuid,text,text) to service_role;
