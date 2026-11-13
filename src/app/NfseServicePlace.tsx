import { useEffect, useState } from "react";
import type { NfseDraft } from "../lib/nfseDrafts";
import {
  customerServicePlace,
  lookupMunicipalities,
  municipalityStates,
  servicePlace,
  stateForMunicipality,
  type Municipality,
  type ServicePlace,
} from "../lib/nfseMunicipalities";
export default function NfseServicePlace({
  draft,
  onChange,
}: {
  draft: NfseDraft;
  onChange: (value: ServicePlace) => void;
}) {
  const [sameCustomer, setSameCustomer] = useState(false),
    [state, setState] = useState(() =>
      stateForMunicipality(draft.serviceMunicipalityCode || ""),
    ),
    [cities, setCities] = useState<Municipality[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [manual, setManual] = useState(false);
  const customer = customerServicePlace(draft),
    id = draft.serviceMunicipalityCode || "";
  useEffect(() => {
    if (!sameCustomer) return;
    const value = customerServicePlace(draft) || {
      serviceCity: "",
      serviceMunicipalityCode: "",
    };
    if (
      value.serviceCity !== draft.serviceCity ||
      value.serviceMunicipalityCode !== draft.serviceMunicipalityCode
    )
      onChange(value);
  }, [
    sameCustomer,
    draft.customerCity,
    draft.customerState,
    draft.customerMunicipalityCode,
    draft.serviceCity,
    draft.serviceMunicipalityCode,
    onChange,
  ]);
  useEffect(() => {
    setError("");
    setCities([]);
    if (!state || sameCustomer || manual) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    lookupMunicipalities(state, controller.signal)
      .then((items) => {
        if (active) setCities(items);
      })
      .catch((e) => {
        if (active && !controller.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Consulta de municípios indisponível.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [state, sameCustomer, manual, retry]);
  return (
    <section
      className="nf-service-place nf-field-wide"
      aria-label="Município da prestação"
    >
      <h4>Onde o serviço foi prestado?</h4>
      <label className="nf-service-place-copy">
        <input
          type="checkbox"
          checked={sameCustomer}
          onChange={(e) => {
            setSameCustomer(e.target.checked);
            setManual(false);
            setError("");
            if (!e.target.checked) setState(stateForMunicipality(id));
          }}
        />
        Usar o município do cliente
      </label>
      <p>
        Marque se o serviço ocorreu no mesmo município do cliente. Para outro
        local, selecione a UF e a cidade; o código é preenchido automaticamente.
      </p>
      {sameCustomer && !customer && (
        <p role="status">
          Aguardando o município do cliente. Preencha o CNPJ ou CEP e confira
          cidade e UF.
        </p>
      )}
      <div className="nf-grid nf-grid-two">
        {!sameCustomer && !manual && (
          <label className="nf-field">
            <span>UF da prestação</span>
            <select
              aria-label="UF da prestação"
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                onChange({ serviceCity: "", serviceMunicipalityCode: "" });
              }}
            >
              <option value="">Selecione a UF</option>
              {Object.keys(municipalityStates)
                .sort()
                .map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="nf-field">
          <span>Local da prestação</span>
          {sameCustomer || manual ? (
            <input
              aria-label="Local da prestação"
              readOnly={sameCustomer}
              value={draft.serviceCity || ""}
              onChange={(e) =>
                onChange({
                  serviceCity: e.target.value,
                  serviceMunicipalityCode: "",
                })
              }
            />
          ) : (
            <select
              aria-label="Local da prestação"
              value={id}
              disabled={!state || loading || Boolean(error)}
              onChange={(e) => {
                const city = cities.find((c) => c.id === e.target.value);
                onChange(
                  city
                    ? servicePlace(city)
                    : { serviceCity: "", serviceMunicipalityCode: "" },
                );
              }}
            >
              <option value="">
                {loading ? "Carregando municípios…" : "Selecione o município"}
              </option>
              {id && !cities.some((c) => c.id === id) && (
                <option value={id}>
                  {draft.serviceCity || "Município salvo"}
                </option>
              )}
              {cities.map((city) => (
                <option key={city.id} value={city.id}>
                  {city.name}
                </option>
              ))}
            </select>
          )}
        </label>
        <label className="nf-field">
          <span>Código IBGE da prestação</span>
          <input
            aria-label="Código IBGE da prestação"
            value={id}
            readOnly={!manual || sameCustomer}
            placeholder="Preenchido automaticamente"
            maxLength={7}
            inputMode="numeric"
            onChange={(e) =>
              onChange({
                serviceCity: draft.serviceCity || "",
                serviceMunicipalityCode: e.target.value
                  .replace(/\D/g, "")
                  .slice(0, 7),
              })
            }
          />
        </label>
      </div>
      {loading && <p role="status">Consultando municípios…</p>}
      {error && (
        <div className="nf-customer-lookup">
          <div role="status">{error}</div>
          <button
            type="button"
            className="nf-button"
            onClick={() => setRetry((n) => n + 1)}
          >
            Tentar novamente
          </button>
          <button
            type="button"
            className="nf-button"
            onClick={() => setManual(true)}
          >
            Preencher local manualmente
          </button>
        </div>
      )}
      {manual && (
        <>
          <p>
            Preenchimento manual disponível enquanto a consulta está
            indisponível. Confira o município e seu código antes de preparar a
            DPS.
          </p>
          <button
            type="button"
            className="nf-button"
            onClick={() => {
              setManual(false);
              setRetry((n) => n + 1);
            }}
          >
            Voltar à seleção de município
          </button>
        </>
      )}
    </section>
  );
}
