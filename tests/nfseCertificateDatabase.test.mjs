import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
let db;
const master='11111111-1111-4111-8111-111111111111', operator='22222222-2222-4222-8222-222222222222', blocked='33333333-3333-4333-8333-333333333333';
const issuer='60371448000143';
const metadata={cnpj:issuer,subject:'TEST ONLY',authority:'TEST ONLY',fingerprint:'a'.repeat(64),validFrom:'2025-01-01T00:00:00Z',validUntil:'2030-01-01T00:00:00Z',validatedAt:new Date().toISOString(),chainVerified:true,revocationStatus:'not_checked',fiscalReady:false};
const envelope={version:1,keyId:'test_v1',iv:'a'.repeat(16),ciphertext:'a'.repeat(300)};
const call=async (name,args) => (await db.query(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
const save=(id,expected=null,meta=metadata,sealed=envelope,actor=master) => call('nfse_certificate_save',[actor,issuer,id,JSON.stringify(meta),JSON.stringify(sealed),expected]);
before(async () => {
  db=new PGlite();
  await db.exec(`create role authenticated; create role anon; create role service_role; create schema auth;
    create table auth.users(id uuid primary key);
    create table public.profiles(id uuid primary key references auth.users(id),role text,allowed_units text[] default '{}',hidden_screens text[] default '{}');
    grant usage on schema public to authenticated,anon,service_role;
    alter default privileges grant all on tables to anon,authenticated;
    alter default privileges grant all on sequences to anon,authenticated;`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261112160000_nfse_certificate_vault.sql',import.meta.url),'utf8'));
  await db.query('insert into auth.users(id) values($1),($2),($3)',[master,operator,blocked]);
  await db.query("insert into public.profiles(id,role,allowed_units,hidden_screens) values($1,'master','{}','{}'),($2,'operador',array['__income_write__'],'{}'),($3,'operador',array['__income_write__'],array['nfse'])",[master,operator,blocked]);
  await db.exec('set role service_role');
});
after(async()=>{await db?.close();});
test('vault schema, tables, sequences and service RPCs are inaccessible to anonymous and authenticated clients, including TRUNCATE',async()=>{
  await db.exec('reset role');
  for(const role of ['anon','authenticated']) {
    for(const fn of ['nfse_certificate_status(uuid,text)','nfse_certificate_attempt(uuid,text)','nfse_certificate_save(uuid,text,uuid,jsonb,jsonb,uuid)','nfse_certificate_remove(uuid,text,uuid)','nfse_certificate_rejected(uuid,text,text)']) {
      const row=(await db.query('select has_function_privilege($1,$2,\'execute\') ok',[role,'public.'+fn])).rows[0]; assert.equal(row.ok,false);
    }
    assert.equal((await db.query("select has_schema_privilege($1,'nfse_private','usage') ok",[role])).rows[0].ok,false);
    for(const privilege of ['select','insert','update','delete','truncate']) assert.equal((await db.query("select has_table_privilege($1,'nfse_private.certificates',$2) ok",[role,privilege])).rows[0].ok,false);
  }
  await db.exec('set role service_role');
});
test('vault stores one encrypted record, status selects metadata only, and rejects implicit replacement',async()=>{
  const id=crypto.randomUUID(); await save(id);
  const status=await call('nfse_certificate_status',[master,issuer]);
  assert.equal(status.id,id); assert.equal('envelope' in status,false); assert.equal('uploaded_by' in status,false);
  assert.equal(status.revocationStatus,'not_checked'); assert.equal(status.fiscalReady,false);
  await assert.rejects(save(crypto.randomUUID()),/NFSE_CONFLICT/);
  const next=crypto.randomUUID(); await save(next,id);
  assert.equal((await call('nfse_certificate_status',[master,issuer])).id,next);
  await assert.rejects(call('nfse_certificate_remove',[master,issuer,id]),/NFSE_CONFLICT/);
  await call('nfse_certificate_remove',[master,issuer,next]);
  assert.equal(await call('nfse_certificate_status',[master,issuer]),null);
  await db.exec('reset role');
  const events=(await db.query('select action from nfse_private.certificate_events order by id')).rows.map(row=>row.action);
  assert.deepEqual(events,['uploaded','replaced','removed']);
  assert.equal((await db.query('select count(*)::int n from nfse_private.certificates')).rows[0].n,0);
  await db.exec('set role service_role');
});
test('vault rechecks master permissions and allows only permitted operators to view metadata',async()=>{
  await assert.rejects(save(crypto.randomUUID(),null,metadata,envelope,operator),/NFSE_FORBIDDEN/);
  assert.equal(await call('nfse_certificate_status',[operator,issuer]),null);
  await assert.rejects(call('nfse_certificate_status',[blocked,issuer]),/NFSE_FORBIDDEN/);
  await assert.rejects(call('nfse_certificate_status',[master,'00000000000000']),/NFSE_ISSUER_NOT_CONFIGURED/);
});
test('vault rejects plaintext fields, mismatched issuer, expired metadata and accidental fiscal-ready flags',async()=>{
  for(const meta of [{...metadata,password:'NO'}, {...metadata,cnpj:'00000000000000'}, {...metadata,fiscalReady:true}, {...metadata,validUntil:'2021-01-01T00:00:00Z'}, {...metadata,fingerprint:null}]) await assert.rejects(save(crypto.randomUUID(),null,meta),/NFSE_INVALID_RECORD/);
  await assert.rejects(save(crypto.randomUUID(),null,metadata,{...envelope,privateKey:'NO'}),/NFSE_INVALID_RECORD/);
});
test('vault rate limits are persisted and scoped to the authorized actor, and rejection audit has only a code',async()=>{
  for(let i=0;i<5;i++) assert.equal(await call('nfse_certificate_attempt',[master,issuer]),true);
  assert.equal(await call('nfse_certificate_attempt',[master,issuer]),false);
  await assert.rejects(call('nfse_certificate_attempt',[operator,issuer]),/NFSE_FORBIDDEN/);
  await call('nfse_certificate_rejected',[master,issuer,'INVALID_PFX']);
  await assert.rejects(call('nfse_certificate_rejected',[master,issuer,'password=SECRET']),/NFSE_INVALID_RECORD/);
});
