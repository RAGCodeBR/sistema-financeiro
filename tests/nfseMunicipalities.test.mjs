import assert from "node:assert/strict";
import { test } from "node:test";
import {
  customerServicePlace,
  parseMunicipalities,
  createMunicipalityLookup,
  servicePlace,
  stateForMunicipality,
} from "../src/lib/nfseMunicipalities.ts";
test("service place is built from a selected city or explicitly confirmed client municipality, keeping name and code together", () => {
  assert.deepEqual(
    servicePlace({ id: "3548500", name: "Santos", state: "SP" }),
    { serviceCity: "Santos / SP", serviceMunicipalityCode: "3548500" },
  );
  assert.deepEqual(
    customerServicePlace({
      customerCity: "Santos",
      customerState: "sp",
      customerMunicipalityCode: "3548500",
    }),
    { serviceCity: "Santos / SP", serviceMunicipalityCode: "3548500" },
  );
  assert.equal(
    customerServicePlace({
      customerCity: "Santos",
      customerState: "MT",
      customerMunicipalityCode: "3548500",
    }),
    null,
  );
  assert.equal(
    customerServicePlace({
      customerCity: "Santos",
      customerState: "",
      customerMunicipalityCode: "",
    }),
    null,
  );
  assert.equal(stateForMunicipality("5107925"), "MT");
});
test("municipality response rejects invalid IDs, wrong states, duplicates and invalid input", () => {
  assert.deepEqual(
    parseMunicipalities(
      [
        { id: 3550308, nome: "São Paulo" },
        { id: 3548500, nome: "Santos" },
      ],
      "SP",
    ).map((c) => c.name),
    ["Santos", "São Paulo"],
  );
  for (const value of [
    [{ id: 5107925, nome: "Sorriso" }],
    [{ id: 354850, nome: "Santos" }],
    [{ id: 3548500, nome: "" }],
    [
      { id: 3548500, nome: "Santos" },
      { id: 3548500, nome: "Santos" },
    ],
    null,
  ])
    assert.throws(() => parseMunicipalities(value, "SP"));
  assert.throws(() =>
    parseMunicipalities([{ id: 3548500, nome: "Santos" }], "__proto__"),
  );
});
test("UF lookup uses the official fixed host, omits application credentials and caches successful results", async () => {
  let count = 0;
  const lookup = createMunicipalityLookup(async (url, options) => {
    count++;
    assert.equal(
      url,
      "https://servicodados.ibge.gov.br/api/v1/localidades/estados/SP/municipios?orderBy=nome",
    );
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, undefined);
    return new Response(JSON.stringify([{ id: 3548500, nome: "Santos" }]));
  });
  const signal = new AbortController().signal;
  const first = await lookup("SP", signal);
  first[0].name = "MUTATED";
  assert.equal((await lookup("SP", signal))[0].name, "Santos");
  assert.equal(count, 1);
  for (const invalid of ["sp", "../SP", "constructor", "__proto__", "ZZ"])
    await assert.rejects(lookup(invalid, signal));
  assert.equal(count, 1);
});
test("failed and aborted municipality lookups can retry without stale cached data", async () => {
  let count = 0;
  const lookup = createMunicipalityLookup(async () =>
      ++count === 1
        ? new Response("", { status: 503 })
        : new Response(JSON.stringify([{ id: 3548500, nome: "Santos" }])),
    ),
    signal = new AbortController().signal;
  await assert.rejects(lookup("SP", signal), /indisponível/);
  assert.equal((await lookup("SP", signal))[0].id, "3548500");
  assert.equal(count, 2);
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    lookup("SP", aborted.signal),
    (e) => e.name === "AbortError",
  );
});
