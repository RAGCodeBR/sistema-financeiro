import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { NfseDraft } from "../lib/nfseDrafts";
import {
  customerLookup,
  customerDataFields,
  lookupDigits,
  validLookupCnpj,
  validLookupCep,
  mergeCustomerData,
  type CustomerData,
  type CustomerDataField,
  type CustomerLookupService,
} from "../lib/nfseCustomerLookup";
type Status = {
  kind: "idle" | "loading" | "success" | "error" | "info";
  message: string;
};
const idle: Status = { kind: "idle", message: "" };
const addressFields = customerDataFields.filter(
  (key) =>
    ![
      "customerName",
      "customerEmail",
      "customerNumber",
      "customerComplement",
      "customerPostalCode",
    ].includes(key),
);
export function useNfseCustomerLookup(
  draft: NfseDraft | null,
  setDraft: Dispatch<SetStateAction<NfseDraft | null>>,
  service: CustomerLookupService = customerLookup,
) {
  const [company, setCompany] = useState<Status>(idle),
    [address, setAddress] = useState<Status>(idle),
    [companyRetry, retryCompany] = useState(0),
    [addressRetry, retryAddress] = useState(0);
  const owned = useRef<CustomerData>({}),
    edited = useRef(new Set<CustomerDataField>()),
    manualCep = useRef(false),
    latest = useRef(draft);
  latest.current = draft;
  const id = draft?.id,
    document = lookupDigits(draft?.customerDocument || ""),
    cep = lookupDigits(draft?.customerPostalCode || "");
  useEffect(() => {
    owned.current = {};
    edited.current.clear();
    manualCep.current = false;
    setCompany(idle);
    setAddress(idle);
  }, [id]);
  function change<K extends keyof NfseDraft>(key: K, value: NfseDraft[K]) {
    if (customerDataFields.includes(key as CustomerDataField))
      edited.current.add(key as CustomerDataField);
    if (key === "customerPostalCode") manualCep.current = true;
    const changingCompany =
      key === "customerDocument" &&
      lookupDigits(String(value || "")) !== document;
    const changingCep =
      key === "customerPostalCode" && lookupDigits(String(value || "")) !== cep;
    if (changingCompany) manualCep.current = false;
    setDraft((old) => {
      if (!old) return old;
      const next = { ...old, [key]: value };
      const reset = changingCompany
        ? customerDataFields
        : changingCep
          ? addressFields
          : [];
      for (const field of reset) {
        if (
          !edited.current.has(field) &&
          owned.current[field] &&
          old[field] === owned.current[field]
        )
          next[field] = "";
        delete owned.current[field];
      }
      if (changingCompany) edited.current.clear();
      if (
        (key === "customerCity" || key === "customerState") &&
        String(old[key] || "")
          .trim()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toUpperCase() !==
          String(value || "")
            .trim()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toUpperCase()
      ) {
        next.customerMunicipalityCode = "";
        delete owned.current.customerMunicipalityCode;
        edited.current.delete("customerMunicipalityCode");
      }
      return next;
    });
  }
  useEffect(() => {
    setCompany(idle);
    if (!id || document.length !== 14) return;
    if (!validLookupCnpj(document)) {
      setCompany({
        kind: "info",
        message:
          "Confira os dígitos do CNPJ para consultar. Para CPF, preencha os dados manualmente.",
      });
      return;
    }
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(async () => {
      setCompany({
        kind: "loading",
        message: "Consultando dados públicos do CNPJ…",
      });
      try {
        const data = await service.cnpj(document, controller.signal);
        if (!active) return;
        setDraft((old) => {
          if (
            !old ||
            old.id !== id ||
            lookupDigits(old.customerDocument) !== document
          )
            return old;
          const merged = mergeCustomerData(
            old,
            data,
            owned.current,
            edited.current,
            "cnpj",
          );
          owned.current = merged.automatic;
          return merged.draft;
        });
        setCompany({
          kind: "success",
          message:
            "Consulta do CNPJ concluída. Campos vazios foram preenchidos; dados informados manualmente foram preservados. Revise o cadastro.",
        });
      } catch (e) {
        if (active && !controller.signal.aborted)
          setCompany({
            kind: "error",
            message:
              e instanceof Error
                ? e.message
                : "Consulta indisponível. Preencha manualmente.",
          });
      }
    }, 600);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [id, document, companyRetry, service, setDraft]);
  useEffect(() => {
    setAddress(idle);
    if (!id || !validLookupCep(cep)) return;
    const current = latest.current;
    if (
      !manualCep.current &&
      !addressRetry &&
      current &&
      addressFields.every((key) => String(current[key] || "").trim())
    )
      return;
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(async () => {
      setAddress({
        kind: "loading",
        message: "Consultando endereço pelo CEP…",
      });
      try {
        const data = await service.cep(cep, controller.signal);
        if (!active) return;
        setDraft((old) => {
          if (
            !old ||
            old.id !== id ||
            lookupDigits(old.customerPostalCode || "") !== cep
          )
            return old;
          const automatic = manualCep.current ? owned.current : {};
          const merged = mergeCustomerData(
            old,
            data,
            automatic,
            edited.current,
            "cep",
          );
          owned.current = { ...owned.current, ...merged.automatic };
          return merged.draft;
        });
        setAddress({
          kind: "success",
          message:
            "Consulta do CEP concluída. Revise o endereço e informe número e complemento, se necessário. Campos manuais foram preservados.",
        });
      } catch (e) {
        if (active && !controller.signal.aborted)
          setAddress({
            kind: "error",
            message:
              e instanceof Error
                ? e.message
                : "Consulta indisponível. Preencha manualmente.",
          });
      }
    }, 600);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [id, cep, addressRetry, service, setDraft]);
  return {
    company,
    address,
    change,
    retryCompany: () => retryCompany((n) => n + 1),
    retryAddress: () => retryAddress((n) => n + 1),
    canCompany: validLookupCnpj(document),
    canAddress: validLookupCep(cep),
  };
}
