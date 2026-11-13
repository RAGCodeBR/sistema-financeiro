import type { NfseDraft } from "./nfseDrafts.ts";
export const customerDataFields = [
  "customerName",
  "customerEmail",
  "customerPostalCode",
  "customerStreet",
  "customerNumber",
  "customerComplement",
  "customerDistrict",
  "customerCity",
  "customerState",
  "customerMunicipalityCode",
] as const;
export type CustomerDataField = (typeof customerDataFields)[number];
export type CustomerData = Partial<Record<CustomerDataField, string>>;
export type CustomerLookupService = {
  cnpj: (value: string, signal: AbortSignal) => Promise<CustomerData>;
  cep: (value: string, signal: AbortSignal) => Promise<CustomerData>;
};
export const lookupDigits = (value: string) => value.replace(/[.\s/()-]/g, "");
export const validLookupCep = (value: string) =>
  /^\d{8}$/.test(lookupDigits(value));
export function validLookupCnpj(value: string) {
  const text = lookupDigits(value);
  if (!/^\d{14}$/.test(text) || /^(\d)\1+$/.test(text)) return false;
  for (let length = 12; length <= 13; length++) {
    const sum = [...text.slice(0, length)].reduce(
        (n, d, i) => n + Number(d) * (((length - 1 - i) % 8) + 2),
        0,
      ),
      rest = sum % 11;
    if ((rest < 2 ? 0 : 11 - rest) !== Number(text[length])) return false;
  }
  return true;
}
const text = (value: unknown, max = 250) =>
  typeof value === "string"
    ? value
        .trim()
        .replace(/[\x00-\x1f]/g, " ")
        .slice(0, max)
    : "";
const ibge = (value: unknown) =>
  /^\d{7}$/.test(String(value ?? "")) ? String(value) : "";
const postcode = (value: unknown) => {
  const digits = lookupDigits(String(value ?? ""));
  return /^\d{8}$/.test(digits)
    ? digits.slice(0, 5) + "-" + digits.slice(5)
    : "";
};
const state = (value: unknown) =>
  /^[A-Z]{2}$/.test(text(value).toUpperCase()) ? text(value).toUpperCase() : "";
const clean = (data: CustomerData) =>
  Object.fromEntries(Object.entries(data).filter(([, v]) => v)) as CustomerData;
export function cnpjCustomerData(
  value: Record<string, unknown>,
  expected: string,
): CustomerData {
  const document =
    typeof value.cnpj === "number"
      ? String(value.cnpj).padStart(14, "0")
      : String(value.cnpj ?? "");
  if (
    lookupDigits(document) !== lookupDigits(expected) ||
    !text(value.razao_social)
  )
    throw new Error(
      "A consulta não retornou dados válidos para esse CNPJ. Confira e preencha manualmente.",
    );
  const street = text(value.logradouro),
    type = text(value.descricao_tipo_de_logradouro, 50),
    email = text(value.email);
  return clean({
    customerName: text(value.razao_social, 150),
    customerEmail: /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ? email : "",
    customerPostalCode: postcode(value.cep),
    customerStreet:
      type &&
      street &&
      !street.toUpperCase().startsWith(type.toUpperCase() + " ")
        ? `${type} ${street}`.slice(0, 250)
        : street,
    customerNumber: text(value.numero, 60),
    customerComplement: text(value.complemento),
    customerDistrict: text(value.bairro),
    customerCity: text(value.municipio),
    customerState: state(value.uf),
    customerMunicipalityCode: ibge(value.codigo_municipio_ibge),
  });
}
export function cepCustomerData(
  value: Record<string, unknown>,
  expected: string,
): CustomerData {
  if (value.erro === true || value.erro === "true")
    throw new Error(
      "CEP não encontrado. Confira o número ou preencha o endereço manualmente.",
    );
  if (
    lookupDigits(String(value.cep ?? "")) !== lookupDigits(expected) ||
    !text(value.localidade) ||
    !state(value.uf)
  )
    throw new Error(
      "A consulta não retornou um endereço válido. Você pode preenchê-lo manualmente.",
    );
  // ViaCEP's complemento describes a postal segment, not the client's unit.
  return clean({
    customerPostalCode: postcode(value.cep),
    customerStreet: text(value.logradouro),
    customerDistrict: text(value.bairro),
    customerCity: text(value.localidade),
    customerState: state(value.uf),
    customerMunicipalityCode: ibge(value.ibge),
  });
}
const cityKey = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
export function mergeCustomerData(
  draft: NfseDraft,
  data: CustomerData,
  automatic: CustomerData,
  edited: ReadonlySet<CustomerDataField>,
  kind: "cnpj" | "cep",
) {
  const next = { ...draft },
    owned = { ...automatic };
  let filled = 0,
    preserved = false;
  const differentPostcode =
    kind === "cnpj" &&
    draft.customerPostalCode &&
    data.customerPostalCode &&
    lookupDigits(draft.customerPostalCode) !==
      lookupDigits(data.customerPostalCode);
  for (const key of customerDataFields) {
    const value = data[key];
    if (!value) continue;
    if (differentPostcode && !["customerName", "customerEmail"].includes(key)) {
      preserved = true;
      continue;
    }
    if (
      kind === "cep" &&
      key === "customerMunicipalityCode" &&
      ((draft.customerCity &&
        data.customerCity &&
        cityKey(draft.customerCity) !== cityKey(data.customerCity)) ||
        (draft.customerState &&
          data.customerState &&
          draft.customerState.toUpperCase() !== data.customerState))
    ) {
      preserved = true;
      continue;
    }
    const current = String(next[key] ?? "");
    if (!edited.has(key) && (!current.trim() || automatic[key] === current)) {
      next[key] = value;
      owned[key] = value;
      if (current !== value) filled++;
    } else if (current !== value) preserved = true;
  }
  return { draft: next, automatic: owned, filled, preserved };
}
export function createCustomerLookup(
  fetcher: typeof fetch = fetch,
): CustomerLookupService {
  const cache = new Map<string, { expires: number; data: CustomerData }>();
  async function request(
    kind: "cnpj" | "cep",
    raw: string,
    signal: AbortSignal,
  ) {
    const value = lookupDigits(raw);
    if (!(kind === "cnpj" ? validLookupCnpj(value) : validLookupCep(value)))
      throw new Error(
        kind === "cnpj"
          ? "Confira os 14 dígitos e os dígitos verificadores do CNPJ."
          : "Informe um CEP com 8 dígitos.",
      );
    if (signal.aborted)
      throw new DOMException("Consulta cancelada", "AbortError");
    const key = kind + ":" + value,
      existing = cache.get(key);
    if (existing && existing.expires > Date.now()) return { ...existing.data };
    const url =
      kind === "cnpj"
        ? `https://brasilapi.com.br/api/cnpj/v1/${value}`
        : `https://viacep.com.br/ws/${value}/json/`;
    let response: Response;
    try {
      response = await fetcher(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
        headers: { Accept: "application/json" },
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error(
        `A consulta de ${kind === "cnpj" ? "CNPJ" : "CEP"} está indisponível. Tente novamente ou preencha os dados manualmente.`,
      );
    }
    if (response.status === 404)
      throw new Error(
        `${kind === "cnpj" ? "CNPJ" : "CEP"} não encontrado. Confira e preencha manualmente se necessário.`,
      );
    if (response.status === 429)
      throw new Error(
        "O serviço de consulta atingiu o limite de acesso. Aguarde antes de tentar novamente; o preenchimento manual está disponível.",
      );
    if (!response.ok)
      throw new Error(
        "O serviço de consulta está indisponível. Você pode preencher os dados manualmente.",
      );
    const reader = response.body?.getReader();
    if (!reader)
      throw new Error(
        "A consulta retornou uma resposta vazia. Preencha manualmente.",
      );
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value: chunk, done } = await reader.read();
        if (done) break;
        size += chunk.length;
        if (size > 256 * 1024) {
          await reader.cancel();
          throw new Error(
            "A resposta da consulta excedeu o limite. Preencha manualmente.",
          );
        }
        chunks.push(chunk);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let body: any;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new Error();
    } catch {
      throw new Error(
        "O serviço de consulta retornou dados não reconhecidos. Preencha manualmente.",
      );
    }
    const data =
      kind === "cnpj"
        ? cnpjCustomerData(body, value)
        : cepCustomerData(body, value);
    if (signal.aborted)
      throw new DOMException("Consulta cancelada", "AbortError");
    if (cache.size >= 40) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + 5 * 60000, data });
    return { ...data };
  }
  return {
    cnpj: (value, signal) => request("cnpj", value, signal),
    cep: (value, signal) => request("cep", value, signal),
  };
}
export const customerLookup = createCustomerLookup();
