-- Reuse the immutable DPS only after an authenticated, recent E2404 lookup.
-- No automatic POST and no change to series, number, XML or financial entries.
create function public.nfse_fiscal_resume(p_actor_id uuid,p_issuer_cnpj text,p_id uuid,p_lease uuid,p_checked_at timestamptz,p_http_status integer,p_national_code text)returns void language plpgsql security definer set search_path='' as $$
declare e nfse_private.fiscal_emissions;
begin
 perform nfse_private.require_master(p_actor_id);
 if p_http_status is distinct from 404 or p_national_code is distinct from 'E2404' or p_checked_at is null or p_checked_at<now()-interval '2 minutes' or p_checked_at>now()+interval '30 seconds' then raise exception 'NFSE_LOOKUP_REQUIRED';end if;
 select * into e from nfse_private.fiscal_emissions where id=p_id and issuer_cnpj=p_issuer_cnpj for update;
 if not found or e.status<>'unknown' or e.lease is distinct from p_lease or e.environment<>2 or e.signed_xml is null then raise exception 'NFSE_CONFLICT';end if;
 if not exists(select 1 from nfse_private.certificates where issuer_cnpj=p_issuer_cnpj and metadata->>'fingerprint'=e.certificate_fingerprint)then raise exception 'NFSE_CERTIFICATE_CHANGED';end if;
 update nfse_private.fiscal_emissions set status='prepared',lease=gen_random_uuid(),lease_until=now()+interval '2 minutes',errors='[]',updated_at=now()where id=e.id;
 insert into nfse_private.fiscal_events(actor_id,issuer_cnpj,action,record_id,details)values(p_actor_id,p_issuer_cnpj,'retry_prepared',e.id,jsonb_build_object('environment',2,'dpsId',e.dps_id,'lookupStatus',404,'nationalCode','E2404','checkedAt',p_checked_at));
end;$$;
revoke all on function public.nfse_fiscal_resume(uuid,text,uuid,uuid,timestamptz,integer,text)from public,anon,authenticated;
grant execute on function public.nfse_fiscal_resume(uuid,text,uuid,uuid,timestamptz,integer,text)to service_role;
