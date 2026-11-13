import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cnpjCustomerData,
  cepCustomerData,
  mergeCustomerData,
  createCustomerLookup,
  validLookupCnpj,
} from "../src/lib/nfseCustomerLookup.ts";
const document = "60371448000143";
const company = {
  cnpj: document,
  razao_social: "EMPRESA SINTETICA LTDA",
  email: "teste@example.test",
  descricao_tipo_de_logradouro: "AVENIDA",
  logradouro: "TESTE",
  numero: "123",
  complemento: "SALA 10",
  bairro: "CENTRO",
  cep: "11045002",
  municipio: "Santos",
  uf: "SP",
  codigo_municipio_ibge: 3548500,
  opcao_pelo_simples: true,
  aliquota: 6,
};
const postal = {
  cep: "11045-002",
  logradouro: "Avenida Teste",
  bairro: "Boqueirão",
  localidade: "Santos",
  uf: "SP",
  ibge: "3548500",
  complemento: "lado ímpar",
};
const draft = () => ({
  id: crypto.randomUUID(),
  customerDocument: document,
  customerName: "",
  customerEmail: "",
  competence: "2026-11",
  description: "Descricao revisada",
  amount: "100,00",
  createdAt: "",
  updatedAt: "",
  serviceCity: "Sorriso / MT",
  serviceMunicipalityCode: "5107925",
  issWithheld: "nao",
  issRate: "",
});
test("CNPJ maps available customer data only, including seven-digit IBGE, without deriving taxes or service location", () => {
  assert.equal(validLookupCnpj("60.371.448/0001-43"), true);
  assert.equal(validLookupCnpj("11111111111111"), false);
  const data = cnpjCustomerData(company, document);
  assert.equal(data.customerName, company.razao_social);
  assert.equal(data.customerStreet, "AVENIDA TESTE");
  assert.equal(data.customerNumber, "123");
  assert.equal(data.customerComplement, "SALA 10");
  assert.equal(data.customerMunicipalityCode, "3548500");
  assert.equal(data.customerPostalCode, "11045-002");
  assert.equal("issRate" in data, false);
  assert.equal("serviceMunicipalityCode" in data, false);
  assert.equal("taxRegime" in data, false);
  assert.equal(
    cnpjCustomerData(
      {
        ...company,
        logradouro: "AVENIDA TESTE",
        codigo_municipio_ibge: null,
        codigo_municipio: 7071,
        email: null,
      },
      document,
    ).customerStreet,
    "AVENIDA TESTE",
  );
  assert.equal(
    cnpjCustomerData({ ...company, codigo_municipio_ibge: 7071 }, document)
      .customerMunicipalityCode,
    undefined,
  );
  assert.throws(
    () => cnpjCustomerData({ ...company, cnpj: "00000000000191" }, document),
    /não retornou dados válidos/,
  );
});
test("CEP supplies address and IBGE, keeping postal segment complement and customer unit separate", () => {
  const data = cepCustomerData(postal, "11045002");
  assert.equal(data.customerStreet, "Avenida Teste");
  assert.equal(data.customerMunicipalityCode, "3548500");
  assert.equal("customerNumber" in data, false);
  assert.equal("customerComplement" in data, false);
  assert.equal("customerName" in data, false);
  assert.throws(
    () => cepCustomerData({ erro: true }, "99999999"),
    /não encontrado/,
  );
  assert.throws(
    () => cepCustomerData({ ...postal, cep: "01001-000" }, "11045002"),
    /endereço válido/,
  );
});
test("automatic fields can update while manual fields and operation-specific tax/place data remain preserved", () => {
  const old = {
    ...draft(),
    customerName: "Nome digitado",
    customerStreet: "Rua digitada",
    customerCity: "Santos",
    customerState: "SP",
  };
  const merged = mergeCustomerData(
    old,
    cnpjCustomerData(company, document),
    {},
    new Set(["customerStreet"]),
    "cnpj",
  );
  assert.equal(merged.draft.customerName, "Nome digitado");
  assert.equal(merged.draft.customerStreet, "Rua digitada");
  assert.equal(merged.draft.customerNumber, "123");
  assert.equal(merged.draft.serviceMunicipalityCode, "5107925");
  assert.equal(merged.draft.issRate, "");
  assert.equal(merged.preserved, true);
  const update = mergeCustomerData(
    merged.draft,
    { customerNumber: "456", customerEmail: "outro@example.test" },
    merged.automatic,
    new Set(["customerStreet"]),
    "cnpj",
  );
  assert.equal(update.draft.customerNumber, "456");
  const erased = mergeCustomerData(
    { ...draft(), customerEmail: "" },
    { customerEmail: "public@example.test" },
    {},
    new Set(["customerEmail"]),
    "cnpj",
  );
  assert.equal(erased.draft.customerEmail, "");
});
test("a separately entered postcode cannot receive the company registry address or an IBGE from a different city", () => {
  const manual = { ...draft(), customerPostalCode: "78896-078" };
  const result = mergeCustomerData(
    manual,
    cnpjCustomerData(company, document),
    {},
    new Set(["customerPostalCode"]),
    "cnpj",
  );
  assert.equal(result.draft.customerName, company.razao_social);
  assert.equal(result.draft.customerPostalCode, "78896-078");
  assert.equal(result.draft.customerMunicipalityCode, undefined);
  const conflict = mergeCustomerData(
    { ...draft(), customerCity: "Sorriso", customerState: "MT" },
    cepCustomerData(postal, "11045002"),
    {},
    new Set(),
    "cep",
  );
  assert.equal(conflict.draft.customerCity, "Sorriso");
  assert.equal(conflict.draft.customerMunicipalityCode, undefined);
});
test("public queries validate identifiers, send no app credentials, cache successful results only and allow retry after rate limits", async () => {
  let calls = 0;
  const service = createCustomerLookup(async (url, options) => {
    calls++;
    assert.equal(url, "https://brasilapi.com.br/api/cnpj/v1/" + document);
    assert.equal(options.credentials, "omit");
    assert.equal(options.referrerPolicy, "no-referrer");
    assert.equal("Authorization" in options.headers, false);
    return new Response(JSON.stringify(company));
  });
  const signal = new AbortController().signal;
  await assert.rejects(service.cnpj("52998224725", signal));
  assert.equal(calls, 0);
  const first = await service.cnpj(document, signal);
  first.customerName = "MUTATED";
  assert.equal(
    (await service.cnpj(document, signal)).customerName,
    company.razao_social,
  );
  assert.equal(calls, 1);
  let count = 0;
  const retry = createCustomerLookup(async () =>
    ++count === 1
      ? new Response("", { status: 429 })
      : new Response(JSON.stringify(company)),
  );
  await assert.rejects(retry.cnpj(document, signal), /limite de acesso/);
  await retry.cnpj(document, signal);
  assert.equal(count, 2);
});
test("lookup failures and malformed or oversized responses leave manual entry available", async () => {
  const signal = new AbortController().signal;
  for (const [response, pattern] of [
    [new Response("not-json"), /não reconhecidos/],
    [new Response("{}"), /endereço válido/],
    [new Response("", { status: 503 }), /indisponível/],
    [new Response("x".repeat(256 * 1024 + 1)), /excedeu/],
  ])
    await assert.rejects(
      createCustomerLookup(async () => response).cep("11045002", signal),
      pattern,
    );
  const controller = new AbortController();
  controller.abort();
  let fetched = false;
  await assert.rejects(
    createCustomerLookup(async () => {
      fetched = true;
      return new Response("{}");
    }).cep("11045002", controller.signal),
    (e) => e.name === "AbortError",
  );
  assert.equal(fetched, false);
});
