import type { NfseDraft } from "./nfseDrafts.ts";
export const municipalityStates: Record<string, string> = {
  AC: "12",
  AL: "27",
  AP: "16",
  AM: "13",
  BA: "29",
  CE: "23",
  DF: "53",
  ES: "32",
  GO: "52",
  MA: "21",
  MT: "51",
  MS: "50",
  MG: "31",
  PA: "15",
  PB: "25",
  PR: "41",
  PE: "26",
  PI: "22",
  RJ: "33",
  RN: "24",
  RS: "43",
  RO: "11",
  RR: "14",
  SC: "42",
  SP: "35",
  SE: "28",
  TO: "17",
};
export type Municipality = { id: string; name: string; state: string };
export type ServicePlace = Pick<
  NfseDraft,
  "serviceCity" | "serviceMunicipalityCode"
>;
const validState = (value: string) =>
  /^[A-Z]{2}$/.test(value) && Object.hasOwn(municipalityStates, value);
export const stateForMunicipality = (code: string) =>
  Object.keys(municipalityStates).find(
    (uf) => /^\d{7}$/.test(code) && code.startsWith(municipalityStates[uf]),
  ) || "";
export const servicePlace = (city: Municipality): ServicePlace => ({
  serviceCity: `${city.name} / ${city.state}`,
  serviceMunicipalityCode: city.id,
});
export function customerServicePlace(draft: NfseDraft): ServicePlace | null {
  const state = (draft.customerState || "").toUpperCase().trim(),
    id = draft.customerMunicipalityCode || "",
    name = (draft.customerCity || "").trim();
  return name && validState(state) && stateForMunicipality(id) === state
    ? servicePlace({ id, name, state })
    : null;
}
export function parseMunicipalities(
  value: unknown,
  state: string,
): Municipality[] {
  if (
    !validState(state) ||
    !Array.isArray(value) ||
    !value.length ||
    value.length > 2000
  )
    throw new Error(
      "A lista de municípios não pôde ser lida. Tente novamente.",
    );
  const seen = new Set<string>();
  const result = value.map((item) => {
    const id = String(item?.id ?? ""),
      name = typeof item?.nome === "string" ? item.nome.trim() : "";
    if (
      !/^\d{7}$/.test(id) ||
      !id.startsWith(municipalityStates[state]) ||
      !name ||
      name.length > 150 ||
      /[\x00-\x1f]/.test(name) ||
      seen.has(id)
    )
      throw new Error(
        "A consulta retornou municípios incompatíveis com a UF selecionada.",
      );
    seen.add(id);
    return { id, name, state };
  });
  return result.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
export function createMunicipalityLookup(fetcher: typeof fetch = fetch) {
  const cache = new Map<string, Municipality[]>();
  return async (
    state: string,
    signal: AbortSignal,
  ): Promise<Municipality[]> => {
    if (!validState(state)) throw new Error("Selecione uma UF válida.");
    if (signal.aborted)
      throw new DOMException("Consulta cancelada", "AbortError");
    const cached = cache.get(state);
    if (cached) return cached.map((x) => ({ ...x }));
    let response: Response;
    try {
      response = await fetcher(
        `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state}/municipios?orderBy=nome`,
        {
          signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]),
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
          headers: { Accept: "application/json" },
        },
      );
    } catch (e) {
      if (signal.aborted) throw e;
      throw new Error(
        "A consulta de municípios está indisponível. Tente novamente ou use o município do cliente.",
      );
    }
    if (!response.ok)
      throw new Error(
        "A consulta de municípios está indisponível. Tente novamente.",
      );
    const reader = response.body?.getReader();
    if (!reader) throw new Error("A consulta retornou uma lista vazia.");
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 2 * 1024 * 1024) {
          await reader.cancel();
          throw new Error(
            "A consulta de municípios excedeu o limite de resposta.",
          );
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error(
        "A consulta de municípios retornou uma resposta não reconhecida.",
      );
    }
    const result = parseMunicipalities(value, state);
    if (signal.aborted)
      throw new DOMException("Consulta cancelada", "AbortError");
    cache.set(state, result);
    return result.map((x) => ({ ...x }));
  };
}
export const lookupMunicipalities = createMunicipalityLookup();
