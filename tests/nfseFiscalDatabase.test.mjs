import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { emptyNfseWorkspace } from "../src/lib/nfseDrafts.ts";
let db;
const master = "11111111-1111-4111-8111-111111111111",
  operator = "22222222-2222-4222-8222-222222222222",
  other = "33333333-3333-4333-8333-333333333333",
  issuer = "60371448000143";
const call = async (name, args) =>
  (
    await db.query(
      `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) result`,
      args,
    )
  ).rows[0].result;
before(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create table public.profiles(id uuid primary key references auth.users(id),role text,allowed_units text[] default '{}',hidden_screens text[] default '{}');grant usage on schema public to anon,authenticated,service_role;alter default privileges grant all on tables to anon,authenticated;alter default privileges grant all on sequences to anon,authenticated;`,
  );
  for (const file of [
    "20261112160000_nfse_certificate_vault.sql",
    "20261113180000_nfse_homologation.sql",
    "20261113210000_nfse_retry_after_lookup.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    );
  await db.query("insert into auth.users values($1),($2),($3)", [
    master,
    operator,
    other,
  ]);
  await db.query(
    "insert into public.profiles values($1,'master','{}','{}'),($2,'operador',array['__income_write__'],'{}'),($3,'operador',array['__income_write__'],'{}')",
    [master, operator, other],
  );
  await db.exec("set role service_role");
});
after(async () => db?.close());
test("cloud settings seeded without customers and config saves use master plus revision", async () => {
  const initial = await call("nfse_fiscal_load", [master, issuer]);
  assert.equal(initial.environment, 2);
  assert.equal(initial.productionEnabled, false);
  assert.equal(initial.config.issuer.municipalRegistration, "3220285");
  assert.equal(initial.config.setupReviewed, false);
  assert.deepEqual(initial.drafts, []);
  await assert.rejects(
    call("nfse_fiscal_config_save", [
      operator,
      issuer,
      JSON.stringify(emptyNfseWorkspace()),
      1,
    ]),
    /FORBIDDEN/,
  );
  await call("nfse_fiscal_config_save", [
    master,
    issuer,
    JSON.stringify({ ...emptyNfseWorkspace(), setupReviewed: true }),
    1,
  ]);
  await assert.rejects(
    call("nfse_fiscal_config_save", [
      master,
      issuer,
      JSON.stringify(emptyNfseWorkspace()),
      1,
    ]),
    /CONFLICT/,
  );
});
test("draft ownership, optimistic locking, sandbox-only numbering and idempotent reservation", async () => {
  const id = crypto.randomUUID(),
    payload = { id, customerName: "SYNTHETIC TEST" };
  await call("nfse_fiscal_draft_save", [
    operator,
    issuer,
    id,
    JSON.stringify(payload),
    null,
  ]);
  assert.equal(
    (await call("nfse_fiscal_load", [other, issuer])).drafts.length,
    0,
  );
  await assert.rejects(
    call("nfse_fiscal_draft_save", [
      other,
      issuer,
      id,
      JSON.stringify(payload),
      1,
    ]),
    /FORBIDDEN/,
  );
  await assert.rejects(
    call("nfse_fiscal_draft_save", [
      operator,
      issuer,
      id,
      JSON.stringify(payload),
      null,
    ]),
    /CONFLICT/,
  );
  const started = await call("nfse_fiscal_begin", [master, issuer, id, 1, 2]),
    again = await call("nfse_fiscal_begin", [master, issuer, id, 1, 2]);
  assert.equal(started.existing, false);
  assert.equal(again.existing, true);
  assert.equal(started.record.dps_id, again.record.dps_id);
  assert.equal(started.record.environment, 2);
  assert.match(started.record.dps_id, /^DPS\d{42}$/);
  const e = started.record;
  await assert.rejects(
    call("nfse_fiscal_transition", [
      master,
      e.id,
      e.lease,
      "preparing",
      "prepared",
      JSON.stringify({ signedXml: "<tpAmb>1</tpAmb>" }),
    ]),
    /PRODUCTION_DISABLED/,
  );
  const fp = "a".repeat(64),
    metadata = {
      cnpj: issuer,
      subject: "TEST",
      authority: "TEST",
      fingerprint: fp,
      validFrom: "2025-01-01T00:00:00Z",
      validUntil: "2030-01-01T00:00:00Z",
      validatedAt: new Date().toISOString(),
      chainVerified: true,
      revocationStatus: "not_checked",
      fiscalReady: false,
    };
  await call("nfse_certificate_save", [
    master,
    issuer,
    crypto.randomUUID(),
    JSON.stringify(metadata),
    JSON.stringify({
      version: 1,
      keyId: "test",
      iv: "a".repeat(16),
      ciphertext: "a".repeat(300),
    }),
    null,
  ]);
  await call("nfse_fiscal_transition", [
    master,
    e.id,
    e.lease,
    "preparing",
    "prepared",
    JSON.stringify({
      signedXml: "<tpAmb>2</tpAmb>",
      certificateFingerprint: fp,
    }),
  ]);
  await assert.rejects(
    call("nfse_fiscal_draft_save", [
      operator,
      issuer,
      id,
      JSON.stringify(payload),
      1,
    ]),
    /DRAFT_LOCKED/,
  );
  await call("nfse_fiscal_transition", [
    master,
    e.id,
    e.lease,
    "prepared",
    "sending",
    "{}",
  ]);
  await assert.rejects(
    call("nfse_fiscal_transition", [
      master,
      e.id,
      e.lease,
      "prepared",
      "sending",
      "{}",
    ]),
    /CONFLICT/,
  );
  await call("nfse_fiscal_transition", [
    master,
    e.id,
    e.lease,
    "sending",
    "unknown",
    "{}",
  ]);
  await assert.rejects(
    call("nfse_fiscal_transition", [
      master,
      e.id,
      e.lease,
      "unknown",
      "sending",
      "{}",
    ]),
    /INVALID_TRANSITION/,
  );
  const load = await call("nfse_fiscal_load", [master, issuer]);
  assert.equal("lease" in load.emissions[0], false);
  assert.equal("snapshot" in load.emissions[0], false);
});
test("every fiscal RPC and private table remains inaccessible to browsers", async () => {
  await db.exec("reset role");
  const funcs = (
    await db.query(
      "select p.oid::regprocedure::text signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'nfse_fiscal_%'",
    )
  ).rows;
  for (const role of ["anon", "authenticated"]) {
    for (const { signature } of funcs)
      assert.equal(
        (
          await db.query("select has_function_privilege($1,$2,'execute') ok", [
            role,
            signature,
          ])
        ).rows[0].ok,
        false,
      );
    for (const table of [
      "fiscal_settings",
      "fiscal_drafts",
      "fiscal_emissions",
      "fiscal_events",
      "fiscal_checks",
    ])
      for (const privilege of [
        "select",
        "insert",
        "update",
        "delete",
        "truncate",
      ])
        assert.equal(
          (
            await db.query("select has_table_privilege($1,$2,$3) ok", [
              role,
              "nfse_private." + table,
              privilege,
            ])
          ).rows[0].ok,
          false,
        );
  }
  await db.exec("set role service_role");
});
