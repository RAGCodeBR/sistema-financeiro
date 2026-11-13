-- Cloud drafts and sandbox-only fiscal workflow. No financial rows are touched.
create table nfse_private.fiscal_settings (
 issuer_cnpj text primary key references nfse_private.issuers(cnpj), payload jsonb not null,
 revision bigint not null default 1, updated_by uuid references auth.users(id), updated_at timestamptz not null default now()
);
create table nfse_private.fiscal_drafts (
 id uuid primary key, issuer_cnpj text not null references nfse_private.issuers(cnpj), payload jsonb not null,
 revision bigint not null default 1, created_by uuid not null references auth.users(id), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table nfse_private.dps_counters (
 issuer_cnpj text not null references nfse_private.issuers(cnpj), environment smallint not null check(environment=2),
 series integer not null check(series between 1 and 49999), last_number bigint not null check(last_number between 1 and 999999999999999),
 primary key(issuer_cnpj,environment,series)
);
create table nfse_private.fiscal_emissions (
 id uuid primary key, issuer_cnpj text not null references nfse_private.issuers(cnpj), draft_id uuid not null references nfse_private.fiscal_drafts(id),
 draft_revision bigint not null, config_revision bigint not null, environment smallint not null check(environment=2),
 series integer not null check(series between 1 and 49999), dps_number bigint not null,
 dps_id text not null unique check(dps_id ~ '^DPS[0-9]{42}$'),
 status text not null check(status in ('preparing','prepared','sending','authorized','rejected','unknown','failed','discarded')),
 snapshot jsonb not null, signed_xml text, response_xml text, access_key text check(access_key is null or access_key ~ '^[0-9]{50}$'),
 certificate_fingerprint text, errors jsonb not null default '[]', lease uuid not null, lease_until timestamptz not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(draft_id,draft_revision), unique(issuer_cnpj,environment,series,dps_number)
);
create table nfse_private.fiscal_events (
 id bigint generated always as identity primary key, actor_id uuid references auth.users(id), issuer_cnpj text not null references nfse_private.issuers(cnpj),
 action text not null, record_id uuid, details jsonb not null default '{}', created_at timestamptz not null default now()
);
create table nfse_private.fiscal_checks (
 issuer_cnpj text primary key references nfse_private.issuers(cnpj), certificate_fingerprint text not null,
 revocation_status text not null check(revocation_status in ('good','unknown','revoked')),
 checked_at timestamptz not null, valid_until timestamptz, eligible boolean, connection jsonb not null default '{}'
);
alter table nfse_private.fiscal_settings enable row level security;
alter table nfse_private.fiscal_drafts enable row level security;
alter table nfse_private.dps_counters enable row level security;
alter table nfse_private.fiscal_emissions enable row level security;
alter table nfse_private.fiscal_events enable row level security;
alter table nfse_private.fiscal_checks enable row level security;
revoke all on all tables in schema nfse_private from public,anon,authenticated;
revoke all on all sequences in schema nfse_private from public,anon,authenticated;

create function nfse_private.require_fiscal_access(actor uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles where id=actor and (role='master' or ('__income_write__'=any(allowed_units) and not('nfse'=any(coalesce(hidden_screens,'{}')))))) then raise exception 'NFSE_FORBIDDEN' using errcode='42501'; end if;
end;
$$;
revoke all on function nfse_private.require_fiscal_access(uuid) from public,anon,authenticated;

create function public.nfse_fiscal_load(p_actor_id uuid,p_issuer_cnpj text) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; master boolean;
begin
 perform nfse_private.require_fiscal_access(p_actor_id);
 select role='master' into master from public.profiles where id=p_actor_id;
 select jsonb_build_object('config',s.payload,'configRevision',s.revision,
 'drafts',coalesce((select jsonb_agg(jsonb_build_object('payload',d.payload,'revision',d.revision) order by d.updated_at desc,d.id) from nfse_private.fiscal_drafts d where d.issuer_cnpj=p_issuer_cnpj and d.deleted_at is null and (master or d.created_by=p_actor_id)),'[]'),
 'emissions',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'draftId',e.draft_id,'draftRevision',e.draft_revision,'status',e.status,'dpsId',e.dps_id,'number',e.dps_number::text,'series',e.series,'environment',2,'accessKey',e.access_key,'errors',e.errors,'createdAt',e.created_at,'updatedAt',e.updated_at) order by e.created_at desc) from nfse_private.fiscal_emissions e where e.issuer_cnpj=p_issuer_cnpj and (master or e.created_by=p_actor_id)),'[]'),
 'connection',(select jsonb_build_object('revocationStatus',c.revocation_status,'checkedAt',c.checked_at,'validUntil',c.valid_until,'eligible',c.eligible,'details',c.connection) from nfse_private.fiscal_checks c join nfse_private.certificates cert on cert.issuer_cnpj=c.issuer_cnpj and cert.metadata->>'fingerprint'=c.certificate_fingerprint where c.issuer_cnpj=p_issuer_cnpj),
 'canConfigure',master,'canIssue',master,'environment',2,'productionEnabled',false)
 into result from nfse_private.fiscal_settings s where s.issuer_cnpj=p_issuer_cnpj;
 if result is null then raise exception 'NFSE_SETTINGS_NOT_CONFIGURED'; end if;
 return result;
end;
$$;

create function public.nfse_fiscal_config_save(p_actor_id uuid,p_issuer_cnpj text,p_payload jsonb,p_expected_revision bigint) returns bigint language plpgsql security definer set search_path='' as $$
declare rev bigint;
begin
 perform nfse_private.require_master(p_actor_id);
 if regexp_replace(p_payload->'issuer'->>'document','[^0-9]','','g') is distinct from p_issuer_cnpj or octet_length(p_payload::text)>64000 then raise exception 'NFSE_INVALID_DATA'; end if;
 update nfse_private.fiscal_settings set payload=p_payload,revision=revision+1,updated_by=p_actor_id,updated_at=now() where issuer_cnpj=p_issuer_cnpj and revision=p_expected_revision returning revision into rev;
 if rev is null then raise exception 'NFSE_CONFLICT'; end if;
 insert into nfse_private.fiscal_events(actor_id,issuer_cnpj,action,details)values(p_actor_id,p_issuer_cnpj,'configuration_saved',jsonb_build_object('revision',rev));
 return rev;
end;
$$;

create function public.nfse_fiscal_draft_save(p_actor_id uuid,p_issuer_cnpj text,p_id uuid,p_payload jsonb,p_expected_revision bigint default null) returns bigint language plpgsql security definer set search_path='' as $$
declare current_row nfse_private.fiscal_drafts; rev bigint; master boolean;
begin
 perform nfse_private.require_fiscal_access(p_actor_id);
 select role='master' into master from public.profiles where id=p_actor_id;
 if p_payload->>'id' is distinct from p_id::text or length(trim(coalesce(p_payload->>'customerName','')))=0 or octet_length(p_payload::text)>40000
 or p_payload-array['id','customerName','customerDocument','customerEmail','competence','description','amount','createdAt','updatedAt','serviceDate','customerPostalCode','customerStreet','customerNumber','customerComplement','customerDistrict','customerCity','customerState','customerMunicipalityCode','serviceCity','serviceMunicipalityCode','serviceCode','municipalServiceCode','nbsCode','issWithheld','issRate','federalRetention'] <> '{}' then raise exception 'NFSE_INVALID_DATA';end if;
 perform 1 from nfse_private.issuers where cnpj=p_issuer_cnpj for no key update;
 select * into current_row from nfse_private.fiscal_drafts where id=p_id for update;
 if found then
  if current_row.issuer_cnpj<>p_issuer_cnpj or not(master or current_row.created_by=p_actor_id)then raise exception 'NFSE_FORBIDDEN' using errcode='42501';end if;
  if current_row.deleted_at is not null or current_row.revision is distinct from p_expected_revision then raise exception 'NFSE_CONFLICT';end if;
  if exists(select 1 from nfse_private.fiscal_emissions where draft_id=p_id and status in ('preparing','prepared','sending','unknown','authorized'))then raise exception 'NFSE_DRAFT_LOCKED';end if;
  update nfse_private.fiscal_drafts set payload=p_payload,revision=revision+1,updated_at=now() where id=p_id returning revision into rev;
 else
  if p_expected_revision is not null then raise exception 'NFSE_CONFLICT';end if;
  insert into nfse_private.fiscal_drafts(id,issuer_cnpj,payload,created_by)values(p_id,p_issuer_cnpj,p_payload,p_actor_id) returning revision into rev;
 end if;
 insert into nfse_private.fiscal_events(actor_id,issuer_cnpj,action,record_id)values(p_actor_id,p_issuer_cnpj,'draft_saved',p_id);
 return rev;
end;
$$;

create function public.nfse_fiscal_draft_remove(p_actor_id uuid,p_issuer_cnpj text,p_id uuid,p_expected_revision bigint)returns void language plpgsql security definer set search_path='' as $$
declare row nfse_private.fiscal_drafts;master boolean;
begin
 perform nfse_private.require_fiscal_access(p_actor_id);select role='master'into master from public.profiles where id=p_actor_id;
 select * into row from nfse_private.fiscal_drafts where id=p_id and issuer_cnpj=p_issuer_cnpj for update;
 if not found or not(master or row.created_by=p_actor_id)then raise exception 'NFSE_FORBIDDEN' using errcode='42501';end if;
 if row.revision<>p_expected_revision or row.deleted_at is not null then raise exception 'NFSE_CONFLICT';end if;
 if exists(select 1 from nfse_private.fiscal_emissions where draft_id=p_id)then raise exception 'NFSE_DRAFT_LOCKED';end if;
 update nfse_private.fiscal_drafts set deleted_at=now(),revision=revision+1 where id=p_id;
 insert into nfse_private.fiscal_events(actor_id,issuer_cnpj,action,record_id)values(p_actor_id,p_issuer_cnpj,'draft_removed',p_id);
end;
$$;

create function public.nfse_fiscal_certificate(p_issuer_cnpj text)returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('id',id,'metadata',metadata,'envelope',envelope) from nfse_private.certificates where issuer_cnpj=p_issuer_cnpj
$$;

create function public.nfse_fiscal_check_save(p_issuer_cnpj text,p_fingerprint text,p_result jsonb)returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from nfse_private.certificates where issuer_cnpj=p_issuer_cnpj and metadata->>'fingerprint'=p_fingerprint)then raise exception 'NFSE_CERTIFICATE_CHANGED';end if;
 if p_result->>'status' not in('good','unknown','revoked')or octet_length(p_result::text)>64000 then raise exception 'NFSE_INVALID_DATA';end if;
 insert into nfse_private.fiscal_checks(issuer_cnpj,certificate_fingerprint,revocation_status,checked_at,valid_until,eligible,connection)
 values(p_issuer_cnpj,p_fingerprint,p_result->>'status',now(),(p_result->>'validUntil')::timestamptz,(p_result->>'eligible')::boolean,coalesce(p_result->'connection','{}'))
 on conflict(issuer_cnpj)do update set certificate_fingerprint=excluded.certificate_fingerprint,revocation_status=excluded.revocation_status,checked_at=excluded.checked_at,valid_until=excluded.valid_until,eligible=excluded.eligible,connection=excluded.connection;
end;
$$;

create function public.nfse_fiscal_begin(p_actor_id uuid,p_issuer_cnpj text,p_draft_id uuid,p_draft_revision bigint,p_config_revision bigint)returns jsonb language plpgsql security definer set search_path='' as $$
declare d nfse_private.fiscal_drafts;c nfse_private.fiscal_settings;e nfse_private.fiscal_emissions;num bigint;new_id uuid;token uuid;
begin
 perform nfse_private.require_master(p_actor_id);
 select * into d from nfse_private.fiscal_drafts where id=p_draft_id and issuer_cnpj=p_issuer_cnpj and deleted_at is null for update;
 if not found or d.revision<>p_draft_revision then raise exception 'NFSE_CONFLICT';end if;
 select * into c from nfse_private.fiscal_settings where issuer_cnpj=p_issuer_cnpj for share;
 if c.revision is distinct from p_config_revision then raise exception 'NFSE_CONFLICT';end if;
 select * into e from nfse_private.fiscal_emissions where draft_id=p_draft_id and draft_revision=p_draft_revision;
 if found then
  if e.status in('failed','preparing')and e.lease_until<now() then update nfse_private.fiscal_emissions set lease=gen_random_uuid(),lease_until=now()+interval '2 minutes',status='preparing',errors='[]' where id=e.id returning * into e;
  else return jsonb_build_object('existing',true,'record',to_jsonb(e));end if;
 else
  insert into nfse_private.dps_counters(issuer_cnpj,environment,series,last_number)values(p_issuer_cnpj,2,1,1)
  on conflict(issuer_cnpj,environment,series)do update set last_number=nfse_private.dps_counters.last_number+1 returning last_number into num;
  new_id=gen_random_uuid();token=gen_random_uuid();
  insert into nfse_private.fiscal_emissions(id,issuer_cnpj,draft_id,draft_revision,config_revision,environment,series,dps_number,dps_id,status,snapshot,lease,lease_until,created_by)
  values(new_id,p_issuer_cnpj,p_draft_id,d.revision,c.revision,2,1,num,'DPS'||(c.payload->'issuer'->>'municipalityCode')||'2'||p_issuer_cnpj||'00001'||lpad(num::text,15,'0'),'preparing',jsonb_build_object('config',c.payload,'draft',d.payload),token,now()+interval '2 minutes',p_actor_id) returning * into e;
  insert into nfse_private.fiscal_events(actor_id,issuer_cnpj,action,record_id,details)values(p_actor_id,p_issuer_cnpj,'dps_reserved',new_id,jsonb_build_object('environment',2,'dpsId',e.dps_id));
 end if;
 return jsonb_build_object('existing',false,'record',to_jsonb(e));
end;
$$;

create function public.nfse_fiscal_record(p_actor_id uuid,p_issuer_cnpj text,p_id uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare e nfse_private.fiscal_emissions;master boolean;
begin
 perform nfse_private.require_fiscal_access(p_actor_id);select role='master'into master from public.profiles where id=p_actor_id;
 select * into e from nfse_private.fiscal_emissions where id=p_id and issuer_cnpj=p_issuer_cnpj;
 if not found or not(master or e.created_by=p_actor_id)then raise exception 'NFSE_FORBIDDEN' using errcode='42501';end if;
 return to_jsonb(e);
end;
$$;

create function public.nfse_fiscal_transition(p_actor_id uuid,p_id uuid,p_lease uuid,p_from text,p_to text,p_data jsonb default '{}')returns void language plpgsql security definer set search_path='' as $$
declare e nfse_private.fiscal_emissions;
begin
 perform nfse_private.require_master(p_actor_id);
 if not ((p_from='preparing'and p_to in('prepared','failed'))or(p_from='prepared'and p_to in('sending','discarded'))or(p_from='sending'and p_to in('authorized','rejected','unknown'))or(p_from='unknown'and p_to in('authorized','rejected','unknown')))then raise exception 'NFSE_INVALID_TRANSITION';end if;
 select * into e from nfse_private.fiscal_emissions where id=p_id for update;
 if not found or e.lease<>p_lease or e.status<>p_from then raise exception 'NFSE_CONFLICT';end if;
 if p_to='sending' and not exists(select 1 from nfse_private.certificates where issuer_cnpj=e.issuer_cnpj and metadata->>'fingerprint'=e.certificate_fingerprint)then raise exception 'NFSE_CERTIFICATE_CHANGED';end if;
 if p_to='prepared'and(coalesce(p_data->>'signedXml','')not like '%<tpAmb>2</tpAmb>%' or coalesce(p_data->>'signedXml','')like '%<tpAmb>1</tpAmb>%')then raise exception 'NFSE_PRODUCTION_DISABLED';end if;
 if p_to='authorized'and(coalesce(p_data->>'accessKey','')!~'^[0-9]{50}$'or length(coalesce(p_data->>'responseXml',''))<50)then raise exception 'NFSE_INVALID_DATA';end if;
 update nfse_private.fiscal_emissions set status=p_to,
 signed_xml=coalesce(p_data->>'signedXml',signed_xml),response_xml=coalesce(p_data->>'responseXml',response_xml),access_key=coalesce(p_data->>'accessKey',access_key),certificate_fingerprint=coalesce(p_data->>'certificateFingerprint',certificate_fingerprint),
 errors=coalesce(p_data->'errors',errors),updated_at=now(),lease_until=case when p_to='failed'then now()else lease_until end where id=p_id;
 insert into nfse_private.fiscal_events(actor_id,issuer_cnpj,action,record_id,details)values(p_actor_id,e.issuer_cnpj,p_to,p_id,jsonb_build_object('environment',2));
end;
$$;

-- Fresh revocation status is metadata only; custody remains inaccessible.
create or replace function public.nfse_certificate_status(p_actor_id uuid,p_issuer_cnpj text)returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform nfse_private.require_fiscal_access(p_actor_id);
 if not exists(select 1 from nfse_private.issuers where cnpj=p_issuer_cnpj)then raise exception 'NFSE_ISSUER_NOT_CONFIGURED';end if;
 select jsonb_build_object('id',cert.id,'cnpj',cert.metadata->>'cnpj','subject',cert.metadata->>'subject','authority',cert.metadata->>'authority','fingerprint',cert.metadata->>'fingerprint','validFrom',cert.metadata->>'validFrom','validUntil',cert.metadata->>'validUntil','validatedAt',cert.metadata->>'validatedAt','chainVerified',true,
 'revocationStatus',case when c.revocation_status='good'and c.valid_until<=now()then'unknown'else coalesce(c.revocation_status,'not_checked')end,'revocationCheckedAt',c.checked_at,'fiscalReady',false,'uploadedAt',cert.uploaded_at)
 into result from nfse_private.certificates cert left join nfse_private.fiscal_checks c on c.issuer_cnpj=cert.issuer_cnpj and c.certificate_fingerprint=cert.metadata->>'fingerprint' where cert.issuer_cnpj=p_issuer_cnpj;
 return result;
end;
$$;
do $$declare item record;begin
 for item in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and(p.proname like 'nfse_fiscal_%'or p.proname='nfse_certificate_status')loop
  execute format('revoke all on function %s from public,anon,authenticated',item.signature);
  execute format('grant execute on function %s to service_role',item.signature);
 end loop;
end;$$;

-- Confirmed issuer only; setup requires explicit review in the application.
insert into nfse_private.fiscal_settings(issuer_cnpj,payload)values('60371448000143','{"fiscalReferenceVersion":1,"issuer":{"personType":"PJ","document":"60.371.448/0001-43","legalName":"LAURO ALVES DE OLIVEIRA JUNIOR LTDA","tradeName":"","municipalRegistration":"3220285","stateRegistration":"","stateExempt":false,"taxRegime":"simples","specialRegime":"0","cnae":"","email":"","phone":"","postalCode":"11045-002","street":"CONSELHEIRO NEBIAS","number":"756","complement":"CONJ 1011","district":"BOQUEIRAO","city":"Santos","state":"SP","municipalityCode":"3548500"},"settings":{"serviceCode":"17.01.01","municipalServiceCode":"021","nbsCode":"1.1401.11.00","serviceDescription":"CONSULTORIA EMPRESARIAL","simplesAssessment":"1","simplesRate":"6","issRate":"","issWithheld":"nao","serviceCity":"","issIncidenceCity":"Santos / SP","issIncidenceMunicipalityCode":"3548500"},"setupReviewed":false}'::jsonb);
