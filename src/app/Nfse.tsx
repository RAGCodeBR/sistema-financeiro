import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  FileCheck2,
  FileCode2,
  FileText,
  Info,
  KeyRound,
  List,
  LockKeyhole,
  Mail,
  MapPin,
  Pencil,
  Plus,
  Save,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  emptyNfseWorkspace,
  applyConfirmedNfseReference,
  nfseStorageKey,
  parseNfseWorkspace,
  pendingNfseSetup,
  nfseOperationDefaults,
  type NfseDraft,
  type NfseIssuer,
  type NfseSettings,
  type NfseWorkspace,
} from "../lib/nfseDrafts";
import { fmt, parseMoney } from "./shared";
import "../styles/nfse.css";
import NfseCertificate from "./NfseCertificate";
import type { NfseCertificateService } from "../lib/nfseCertificate";
import { NFSE_FISCAL_REFERENCE_VERSION } from "../lib/nfseFiscalReference";
import { nfseFiscalIssues, omitIssRate } from "../lib/nfseTaxProfile";
import type {
  NfseFiscalService,
  NfseFiscalState,
} from "../lib/nfseFiscalRemote";
import NfseHomologation from "./NfseHomologation";
import { useNfseCustomerLookup } from "./useNfseCustomerLookup";
import NfseServicePlace from "./NfseServicePlace";

const steps = [
  "Dados da empresa",
  "Certificado digital",
  "Configurações",
  "Confirmação",
];
const regimes: Record<string, string> = {
  mei: "MEI",
  simples: "Simples Nacional",
  presumido: "Lucro Presumido",
  real: "Lucro Real",
};
const monthNow = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};
function Field({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  return (
    <label className={`nf-field${wide ? " nf-field-wide" : ""}`}>
      <span id={id}>{label}</span>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<Record<string, unknown>>, {
            "aria-labelledby": id,
          })
        : children}
    </label>
  );
}
function Panel({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="nf-panel">
      <header>
        <h3>
          {icon}
          {title}
        </h3>
        <p>{subtitle}</p>
      </header>
      <div className="nf-panel-body">{children}</div>
    </section>
  );
}

export default function Nfse({
  storageScope = "local-preview",
  certificateService,
  canManageCertificate = false,
  fiscalService,
}: {
  storageScope?: string;
  certificateService?: NfseCertificateService;
  canManageCertificate?: boolean;
  fiscalService?: NfseFiscalService;
}) {
  // The parent keys the component by user ID; a login change never reuses drafts.
  const [load] = useState(() => {
    try {
      return {
        workspace: parseNfseWorkspace(
          localStorage.getItem(nfseStorageKey(storageScope)),
        ),
        error: "",
      };
    } catch (error) {
      return {
        workspace: emptyNfseWorkspace(),
        error:
          error instanceof SyntaxError
            ? "O rascunho salvo está ilegível. Os dados existentes foram preservados; o salvamento está bloqueado."
            : error instanceof Error
              ? error.message
              : "Não foi possível acessar os rascunhos deste navegador.",
      };
    }
  });
  const [workspace, setWorkspace] = useState(load.workspace);
  const [setup, setSetup] = useState<NfseWorkspace | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState(load.error);
  const [notice, setNotice] = useState("");
  const [month, setMonth] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [menu, setMenu] = useState(false);
  const [info, setInfo] = useState(false);
  const [draft, setDraft] = useState<NfseDraft | null>(null);
  const customerLookup = useNfseCustomerLookup(draft, setDraft);
  const [deleting, setDeleting] = useState<NfseDraft | null>(null);
  const [cloud, setCloud] = useState<NfseFiscalState | null>(null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSelection, setImportSelection] = useState<string[]>([]);
  function acceptCloud(state: NfseFiscalState) {
    setCloud(state);
    setWorkspace({
      version: 1,
      ...state.config,
      drafts: state.drafts.map((d) => d.payload),
    });
  }
  useEffect(() => {
    if (!fiscalService) return;
    let cancelled = false;
    setBusy(true);
    fiscalService
      .load()
      .then((state) => {
        if (!cancelled) {
          acceptCloud(state);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof Error
              ? e.message
              : "Não foi possível carregar os dados fiscais.",
          );
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fiscalService]);
  const heading = useRef<HTMLHeadingElement>(null);
  const configButton = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const hasModal = Boolean(draft || deleting || info);

  useEffect(() => {
    if (setup) heading.current?.focus();
  }, [step, Boolean(setup)]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(false);
        configButton.current?.focus();
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);
  useEffect(() => {
    if (!hasModal) return;
    const previous = document.activeElement as HTMLElement | null;
    const container = modalRef.current;
    container?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDraft(null);
        setDeleting(null);
        setInfo(false);
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        container?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
        ) || [],
      );
      const first = controls[0],
        last = controls.at(-1);
      if (!first) {
        event.preventDefault();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === container)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          document.activeElement === container)
      ) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [hasModal]);

  async function persist(next: NfseWorkspace, message: string) {
    if (fiscalService) {
      if (!cloud || busy) return false;
      setBusy(true);
      setError("");
      try {
        const { drafts: nextDrafts, version: _, ...config } = next;
        const { drafts: oldDrafts, version: __, ...oldConfig } = workspace;
        let state: NfseFiscalState;
        if (JSON.stringify(config) !== JSON.stringify(oldConfig))
          state = await fiscalService.execute({
            action: "config",
            config,
            revision: cloud.configRevision,
          });
        else {
          const removed = oldDrafts.find(
            (d) => !nextDrafts.some((n) => n.id === d.id),
          );
          const changed = nextDrafts.find(
            (d) =>
              JSON.stringify(d) !==
              JSON.stringify(oldDrafts.find((n) => n.id === d.id)),
          );
          if (removed)
            state = await fiscalService.execute({
              action: "remove",
              id: removed.id,
              revision: cloud.drafts.find((d) => d.payload.id === removed.id)
                ?.revision,
            });
          else if (changed)
            state = await fiscalService.execute({
              action: "draft",
              draft: changed,
              revision:
                cloud.drafts.find((d) => d.payload.id === changed.id)
                  ?.revision ?? null,
            });
          else return true;
        }
        acceptCloud(state);
        setNotice(
          "Dados salvos no servidor. Nenhuma nota de produção foi emitida.",
        );
        return true;
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "O salvamento não foi concluído.",
        );
        try {
          acceptCloud(await fiscalService.load());
        } catch {
          /* preserve form */
        }
        return false;
      } finally {
        setBusy(false);
      }
    }
    if (load.error) {
      setError(load.error);
      return false;
    }
    try {
      localStorage.setItem(nfseStorageKey(storageScope), JSON.stringify(next));
      setWorkspace(next);
      setError("");
      setNotice(message);
      return true;
    } catch {
      setError(
        "Não foi possível salvar neste navegador. Verifique o espaço e as permissões de armazenamento e tente novamente.",
      );
      return false;
    }
  }
  function openSetup(at = 0) {
    setSetup(structuredClone(workspace));
    setStep(at);
    setNotice("");
    setMenu(false);
  }
  function reviewFiscalReference() {
    try {
      setSetup(applyConfirmedNfseReference(setup || workspace));
      setStep(0);
      setNotice(
        "Dados fiscais confirmados aplicados à revisão. Confira os campos e salve a configuração para mantê-los neste navegador. Seus rascunhos de notas foram preservados.",
      );
      setError("");
      setMenu(false);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Confira o CNPJ do emissor.",
      );
    }
  }
  function closeSetup() {
    setSetup(null);
    setStep(0);
  }
  async function saveSetup(reviewed: boolean) {
    if (!setup) return;
    const next = { ...setup, setupReviewed: reviewed || setup.setupReviewed };
    if (
      await persist(
        next,
        "Configuração salva como rascunho neste navegador. A emissão fiscal continua indisponível.",
      )
    )
      closeSetup();
  }
  function newDraft() {
    if (!workspace.setupReviewed) {
      openSetup();
      return;
    }
    const now = new Date().toISOString();
    setDraft({
      ...nfseOperationDefaults(),
      serviceCode: workspace.settings.serviceCode,
      municipalServiceCode:
        fiscalService && cloud?.environment === 2
          ? ""
          : workspace.settings.municipalServiceCode,
      nbsCode: workspace.settings.nbsCode,
      issWithheld: workspace.settings.issWithheld,
      issRate: workspace.settings.issRate,
      id: crypto.randomUUID(),
      customerName: "",
      customerDocument: "",
      customerEmail: "",
      competence: monthNow(),
      description: workspace.settings.serviceDescription,
      amount: "",
      createdAt: now,
      updatedAt: now,
    });
    setNotice("");
  }
  async function saveDraft() {
    if (!draft) return;
    if (!draft.customerName.trim()) {
      setError(
        "Informe o nome ou razão social do cliente para identificar o rascunho.",
      );
      return;
    }
    if (
      draft.amount.trim() &&
      (!Number.isFinite(parseMoney(draft.amount)) ||
        parseMoney(draft.amount) <= 0)
    ) {
      setError(
        "Informe um valor de serviço maior que zero ou deixe o campo pendente.",
      );
      return;
    }
    const item = {
      ...draft,
      customerName: draft.customerName.trim(),
      updatedAt: new Date().toISOString(),
    };
    if (
      await persist(
        {
          ...workspace,
          drafts: [
            item,
            ...workspace.drafts.filter((note) => note.id !== item.id),
          ],
        },
        "Rascunho salvo. Nenhuma nota foi emitida e nenhum lançamento financeiro foi criado.",
      )
    ) {
      setDraft(null);
      setPage(1);
      setMonth("");
      setSearch("");
    }
  }
  const filtered = useMemo(
    () =>
      workspace.drafts.filter(
        (item) =>
          (!month || item.competence === month) &&
          `${item.customerName} ${item.customerDocument} ${item.description}`
            .toLocaleLowerCase("pt-BR")
            .includes(search.trim().toLocaleLowerCase("pt-BR")),
      ),
    [workspace.drafts, month, search],
  );
  const pages = Math.max(1, Math.ceil(filtered.length / 10));
  const activePage = Math.min(page, pages);
  const visible = filtered.slice((activePage - 1) * 10, activePage * 10);
  const issuer = setup?.issuer ?? workspace.issuer;
  const settings = setup?.settings ?? workspace.settings;
  const fiscalIssues = nfseFiscalIssues(issuer, settings);
  const noSeparateIss = omitIssRate(issuer, settings);
  const setIssuer = <K extends keyof NfseIssuer>(
    key: K,
    value: NfseIssuer[K],
  ) =>
    setSetup((old) =>
      old ? { ...old, issuer: { ...old.issuer, [key]: value } } : old,
    );
  const setSettings = <K extends keyof NfseSettings>(
    key: K,
    value: NfseSettings[K],
  ) =>
    setSetup((old) =>
      old ? { ...old, settings: { ...old.settings, [key]: value } } : old,
    );
  const input = (
    key: keyof NfseIssuer,
    label: string,
    placeholder = "",
    type = "text",
  ) => (
    <Field label={label}>
      <input
        type={type}
        value={String(issuer[key])}
        onChange={(event) => setIssuer(key, event.target.value)}
        placeholder={placeholder}
        maxLength={250}
      />
    </Field>
  );

  if (fiscalService && !cloud)
    return (
      <section className="nfse">
        <h2>NFS-e · homologação</h2>
        <p role="status">
          {busy
            ? "Carregando dados seguros do servidor…"
            : "O serviço fiscal não está disponível."}
        </p>
        {error && <p role="alert">{error}</p>}
        <button
          className="nf-button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              acceptCloud(await fiscalService.load());
              setError("");
            } catch (e) {
              setError(e instanceof Error ? e.message : "Falha ao carregar.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Tentar novamente
        </button>
      </section>
    );
  return (
    <section className="nfse" aria-label="Emissão de NFS-e">
      <div className="nf-heading">
        <div>
          <span className="nf-eyebrow">NOTAS FISCAIS DE SERVIÇO</span>
          <h2>
            {setup ? <Settings2 /> : <FileText />}
            {setup ? "Configurar a emissão de NFS-e" : "NFS-e"}
          </h2>
          <p>
            {setup
              ? "Prepare o cadastro do emissor em quatro etapas."
              : "Prepare suas notas e acompanhe a emissão em um só lugar."}
          </p>
        </div>
        <span className="nf-stage">
          <span /> {fiscalService ? "Homologação" : "Em preparação"}
        </span>
      </div>
      <div className="nf-local-note">
        <LockKeyhole />
        <p>
          {fiscalService ? (
            <>
              <strong>Ambiente de homologação.</strong> Rascunhos e histórico
              ficam no servidor. Os testes usam o A1 por conexão segura. A
              emissão em produção está bloqueada.
            </>
          ) : (
            <>
              <strong>Preparação local.</strong> Os rascunhos ficam neste
              navegador. O certificado é gerenciado em uma conexão segura com o
              servidor. A emissão fiscal continua em preparação.
            </>
          )}
        </p>
      </div>
      {fiscalService && cloud && (
        <>
          {load.workspace.drafts.some(
            (d) => !cloud.drafts.some((c) => c.payload.id === d.id),
          ) && (
            <div className="nf-alert">
              <div>
                <b>Há rascunhos antigos neste navegador.</b>
                <p>
                  Revise e selecione quais deseja copiar para o servidor. A
                  cópia local será preservada.
                </p>
                <button
                  className="nf-button"
                  disabled={busy}
                  onClick={() => setImporting(!importing)}
                >
                  Revisar rascunhos locais
                </button>
                {importing && (
                  <div>
                    {load.workspace.drafts
                      .filter(
                        (d) => !cloud.drafts.some((c) => c.payload.id === d.id),
                      )
                      .map((d) => (
                        <label className="nf-import-row" key={d.id}>
                          <input
                            type="checkbox"
                            checked={importSelection.includes(d.id)}
                            onChange={(e) =>
                              setImportSelection((old) =>
                                e.target.checked
                                  ? [...old, d.id]
                                  : old.filter((id) => id !== d.id),
                              )
                            }
                          />
                          <span>
                            {d.customerName} ·{" "}
                            {d.customerDocument || "Documento pendente"} ·{" "}
                            {d.amount || "Valor pendente"}
                          </span>
                        </label>
                      ))}
                    <button
                      className="nf-button"
                      disabled={busy || !importSelection.length}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          for (const id of importSelection) {
                            const item = load.workspace.drafts.find(
                              (d) => d.id === id,
                            );
                            if (item)
                              acceptCloud(
                                await fiscalService.execute({
                                  action: "draft",
                                  draft: item,
                                  revision: null,
                                }),
                              );
                          }
                          setImportSelection([]);
                          setImporting(false);
                          setNotice(
                            "Rascunhos selecionados copiados. Complete e revise os dados antes de preparar a DPS.",
                          );
                        } catch (e) {
                          setError(
                            e instanceof Error
                              ? e.message
                              : "A cópia não foi concluída.",
                          );
                          try {
                            acceptCloud(await fiscalService.load());
                          } catch {
                            /* retain local backup */
                          }
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Copiar selecionados para o servidor
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          <NfseHomologation
            service={fiscalService}
            state={cloud}
            onChange={acceptCloud}
            busy={busy}
            onBusy={setBusy}
            onError={setError}
            onEditDraft={(value) => {
              setDraft({ ...value });
              setNotice("");
            }}
          />
        </>
      )}
      {(setup || workspace).fiscalReferenceVersion <
        NFSE_FISCAL_REFERENCE_VERSION && (
        <div className="nf-alert">
          <FileCheck2 />
          <span>
            Há dados fiscais confirmados para o emissor: inscrição municipal,
            Simples Nacional, códigos do serviço e retenção.{" "}
            <button onClick={reviewFiscalReference}>
              Revisar e aplicar dados confirmados
            </button>
          </span>
        </div>
      )}
      {error && (
        <div className="nf-alert nf-error" role="alert">
          <AlertCircle />
          <span>{error}</span>
          <button
            aria-label="Fechar mensagem de erro"
            onClick={() => setError("")}
          >
            <X />
          </button>
        </div>
      )}
      {notice && (
        <div className="nf-alert nf-success" role="status">
          <Check />
          <span>{notice}</span>
          <button aria-label="Fechar mensagem" onClick={() => setNotice("")}>
            <X />
          </button>
        </div>
      )}
      {setup ? (
        <>
          <nav className="nf-steps" aria-label="Etapas da configuração">
            {steps.map((label, index) => (
              <button
                key={label}
                onClick={() => setStep(index)}
                aria-current={step === index ? "step" : undefined}
                className={
                  step === index ? "active" : index < step ? "visited" : ""
                }
              >
                <span>{index < step ? <Check /> : index + 1}</span>
                <b>{label}</b>
              </button>
            ))}
          </nav>
          <h3 ref={heading} tabIndex={-1} className="nf-step-heading">
            {
              [
                "Confira os dados da empresa que emitirá as notas.",
                "Prepare o certificado digital da empresa.",
                "Defina os padrões fiscais dos serviços.",
                "Revise o cadastro e as informações pendentes.",
              ][step]
            }
          </h3>
          {step === 0 && (
            <>
              <Panel
                icon={<Building2 />}
                title="Dados da empresa que saem na nota"
                subtitle="Documentos, inscrições e regime tributário do emissor."
              >
                <div className="nf-grid">
                  <Field label="Tipo">
                    <select
                      value={issuer.personType}
                      onChange={(event) =>
                        setIssuer(
                          "personType",
                          event.target.value as "PJ" | "PF",
                        )
                      }
                    >
                      <option value="PJ">Pessoa jurídica</option>
                      <option value="PF">Pessoa física</option>
                    </select>
                  </Field>
                  {input(
                    "legalName",
                    issuer.personType === "PJ"
                      ? "Razão social"
                      : "Nome completo",
                  )}
                  {input(
                    "document",
                    issuer.personType === "PJ"
                      ? "CNPJ do emissor"
                      : "CPF do emissor",
                  )}
                  {input("tradeName", "Nome fantasia", "Opcional")}
                  {input(
                    "municipalRegistration",
                    "Inscrição municipal",
                    "A confirmar com o contador",
                  )}
                  <Field label="Inscrição estadual">
                    <div className="nf-input-check">
                      <input
                        aria-label="Inscrição estadual"
                        value={
                          issuer.stateExempt
                            ? "ISENTA"
                            : issuer.stateRegistration
                        }
                        disabled={issuer.stateExempt}
                        onChange={(event) =>
                          setIssuer("stateRegistration", event.target.value)
                        }
                        maxLength={30}
                      />
                      <span>
                        <input
                          type="checkbox"
                          aria-label="Inscrição estadual isenta"
                          checked={issuer.stateExempt}
                          onChange={(event) =>
                            setIssuer("stateExempt", event.target.checked)
                          }
                        />{" "}
                        Isenta
                      </span>
                    </div>
                  </Field>
                  {input("cnae", "CNAE principal", "Código e atividade")}
                  <Field label="Regime tributário">
                    <select
                      value={issuer.taxRegime}
                      onChange={(event) =>
                        setIssuer("taxRegime", event.target.value)
                      }
                    >
                      <option value="">A confirmar</option>
                      {Object.entries(regimes).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Regime especial de tributação">
                    <select
                      value={issuer.specialRegime}
                      onChange={(event) =>
                        setIssuer("specialRegime", event.target.value)
                      }
                    >
                      <option value="">A confirmar</option>
                      {Object.entries({
                        "0": "Nenhum",
                        "1": "Ato cooperado",
                        "2": "Estimativa",
                        "3": "Microempresa municipal",
                        "4": "Notário ou registrador",
                        "5": "Profissional autônomo",
                        "6": "Sociedade de profissionais",
                        "9": "Outros",
                      }).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                      {issuer.specialRegime &&
                        !/^(?:[0-6]|9)$/.test(issuer.specialRegime) && (
                          <option value={issuer.specialRegime}>
                            {issuer.specialRegime} — revisar
                          </option>
                        )}
                    </select>
                  </Field>
                  {input("email", "E-mail", "contato@empresa.com.br", "email")}
                  {input("phone", "Telefone", "(13) 0000-0000", "tel")}
                </div>
              </Panel>
              <Panel
                icon={<MapPin />}
                title="Endereço da empresa"
                subtitle="Endereço do prestador que será informado no documento fiscal."
              >
                <div className="nf-grid">
                  {input("postalCode", "CEP")}
                  {input("street", "Logradouro")}
                  {input("number", "Número")}
                  {input("complement", "Complemento", "Opcional")}
                  {input("district", "Bairro")}
                  {input("city", "Cidade")}
                  {input("state", "UF")}
                  {input("municipalityCode", "Código IBGE do município")}
                </div>
              </Panel>
            </>
          )}
          {step === 1 && (
            <Panel
              icon={<KeyRound />}
              title="Certificado digital A1"
              subtitle="O certificado será usado pelo serviço de emissão para assinar e transmitir as notas."
            >
              <NfseCertificate
                issuerCnpj={issuer.document}
                service={certificateService}
                canManage={canManageCertificate}
              />
            </Panel>
          )}
          {step === 2 && (
            <>
              <Panel
                icon={<Settings2 />}
                title="Configurações de emissão"
                subtitle="Um único emissor, com notas destinadas a diferentes clientes PF ou PJ."
              >
                <div className="nf-grid">
                  <Field label="Portal utilizado atualmente">
                    <input value="GOV.BR — informado pela empresa" readOnly />
                  </Field>
                  <Field label="Município do emissor">
                    <input
                      value={`${issuer.city} / ${issuer.state}`}
                      readOnly
                    />
                  </Field>
                  <Field label="Conexão fiscal">
                    <input value="Pendente de configuração" readOnly />
                  </Field>
                  <Field label="Código de serviço nacional">
                    <input
                      value={settings.serviceCode}
                      onChange={(event) =>
                        setSettings("serviceCode", event.target.value)
                      }
                      placeholder="A confirmar com o contador"
                      maxLength={60}
                    />
                  </Field>
                  <Field label="Código de serviço municipal (opcional)">
                    <input
                      value={settings.municipalServiceCode}
                      onChange={(event) =>
                        setSettings("municipalServiceCode", event.target.value)
                      }
                      placeholder="Se aplicável"
                      maxLength={60}
                    />
                  </Field>
                  <Field label="Código NBS">
                    <input
                      value={settings.nbsCode}
                      onChange={(event) =>
                        setSettings("nbsCode", event.target.value)
                      }
                      placeholder="Ex.: 1.1401.11.00"
                      maxLength={16}
                    />
                  </Field>
                  <Field label="Apuração pelo Simples Nacional">
                    <select
                      value={settings.simplesAssessment}
                      onChange={(event) =>
                        setSettings("simplesAssessment", event.target.value)
                      }
                    >
                      <option value="">A confirmar</option>
                      <option value="1">
                        Tributos federais e ISS pelo Simples
                      </option>
                      <option value="2">
                        Federais pelo Simples; ISS fora do Simples
                      </option>
                      <option value="3">Federais e ISS fora do Simples</option>
                    </select>
                  </Field>
                  <Field label="Alíquota informada do Simples Nacional (%)">
                    <input
                      value={settings.simplesRate}
                      onChange={(event) =>
                        setSettings("simplesRate", event.target.value)
                      }
                      inputMode="decimal"
                      placeholder="Percentual total informado pelo contador"
                      maxLength={6}
                    />
                  </Field>
                  <Field label="Município de incidência do ISS">
                    <input
                      value={settings.issIncidenceCity}
                      onChange={(event) =>
                        setSettings("issIncidenceCity", event.target.value)
                      }
                      placeholder="Ex.: Santos / SP"
                      maxLength={250}
                    />
                  </Field>
                  <Field label="Código IBGE da incidência do ISS">
                    <input
                      value={settings.issIncidenceMunicipalityCode}
                      onChange={(event) =>
                        setSettings(
                          "issIncidenceMunicipalityCode",
                          event.target.value,
                        )
                      }
                      inputMode="numeric"
                      maxLength={7}
                    />
                  </Field>
                  <Field label="Município padrão da prestação">
                    <input
                      value={settings.serviceCity}
                      onChange={(event) =>
                        setSettings("serviceCity", event.target.value)
                      }
                      maxLength={250}
                      placeholder="Definir conforme cada serviço; pode ser diferente da incidência do ISS"
                    />
                  </Field>
                  <Field label="Alíquota específica do ISS (%)">
                    <input
                      value={
                        noSeparateIss
                          ? "Não destacar — ISS apurado pelo Simples"
                          : settings.issRate
                      }
                      readOnly={noSeparateIss}
                      onChange={(event) =>
                        setSettings("issRate", event.target.value)
                      }
                      placeholder="Se exigida, confirmar com o contador"
                      inputMode="decimal"
                      maxLength={12}
                    />
                  </Field>
                  {noSeparateIss && settings.issRate.trim() && (
                    <div className="nf-field-wide nf-alert nf-warning">
                      <AlertCircle />
                      <span>
                        Foi encontrada uma alíquota de ISS anterior (
                        {settings.issRate}%). No enquadramento atual ela deve
                        ser omitida.{" "}
                        <button onClick={() => setSettings("issRate", "")}>
                          Remover valor anterior
                        </button>
                      </span>
                    </div>
                  )}
                  <Field label="Retenção de ISS">
                    <select
                      value={settings.issWithheld}
                      onChange={(event) =>
                        setSettings(
                          "issWithheld",
                          event.target.value as NfseSettings["issWithheld"],
                        )
                      }
                    >
                      <option value="confirmar">
                        A confirmar por serviço e cliente
                      </option>
                      <option value="nao">Sem retenção como padrão</option>
                      <option value="sim">Com retenção como padrão</option>
                    </select>
                  </Field>
                  <Field label="Descrição padrão do serviço" wide>
                    <textarea
                      rows={3}
                      value={settings.serviceDescription}
                      onChange={(event) =>
                        setSettings("serviceDescription", event.target.value)
                      }
                      placeholder="Descrição que poderá ser ajustada em cada nota"
                      maxLength={8000}
                    />
                  </Field>
                </div>
              </Panel>
              <div className="nf-alert">
                <Info />
                <span>
                  Os 6% informados correspondem ao Simples Nacional, não à
                  alíquota destacada de ISS. Com apuração federal e municipal
                  pelo Simples e sem retenção, a alíquota de ISS não é informada
                  separadamente. Local da prestação e município de incidência do
                  ISS são campos diferentes e devem ser conferidos em cada
                  operação.
                </span>
              </div>
              {fiscalIssues.length > 0 && (
                <div className="nf-alert nf-warning">
                  <AlertCircle />
                  <span>
                    Antes de preparar a emissão, confira:{" "}
                    {fiscalIssues.join("; ")}.
                  </span>
                </div>
              )}
            </>
          )}
          {step === 3 && (
            <>
              <Panel
                icon={<FileCheck2 />}
                title="Confira a configuração"
                subtitle="Você pode salvar agora e completar as informações depois."
              >
                <div className="nf-summary">
                  <div>
                    <span>Emissor</span>
                    <b>{issuer.legalName || "A preencher"}</b>
                    <small>{issuer.document || "Documento a preencher"}</small>
                  </div>
                  <div>
                    <span>Município</span>
                    <b>
                      {issuer.city || "A preencher"} / {issuer.state || "—"}
                    </b>
                    <small>
                      {issuer.municipalRegistration
                        ? `Inscrição municipal: ${issuer.municipalRegistration}`
                        : "Inscrição municipal pendente"}
                    </small>
                  </div>
                  <div>
                    <span>Regime tributário</span>
                    <b>{regimes[issuer.taxRegime] || "A confirmar"}</b>
                    <small>
                      Consulte o status do A1 na etapa Certificado digital
                    </small>
                  </div>
                </div>
              </Panel>
              <Panel
                icon={<FileCheck2 />}
                title="Enquadramento do serviço"
                subtitle="Referência fiscal conferida com os dados fornecidos e a nota de exemplo."
              >
                <div className="nf-summary">
                  <div>
                    <span>Tributação nacional / municipal</span>
                    <b>
                      {settings.serviceCode || "A preencher"} /{" "}
                      {settings.municipalServiceCode || "A confirmar"}
                    </b>
                    <small>NBS: {settings.nbsCode || "A preencher"}</small>
                  </div>
                  <div>
                    <span>Simples Nacional</span>
                    <b>
                      {settings.simplesRate
                        ? `${settings.simplesRate}% — percentual informado`
                        : "A preencher"}
                    </b>
                    <small>
                      {noSeparateIss
                        ? "ISS sem alíquota destacada e sem retenção"
                        : "Conferir tributação e retenção do ISS"}
                    </small>
                  </div>
                  <div>
                    <span>Incidência do ISS</span>
                    <b>{settings.issIncidenceCity || "A preencher"}</b>
                    <small>
                      {settings.serviceCity
                        ? `Prestação padrão: ${settings.serviceCity}`
                        : "Local da prestação: definir por operação"}
                    </small>
                  </div>
                </div>
                {fiscalIssues.length === 0 && (
                  <p className="nf-fiscal-ready">
                    {fiscalService
                      ? "Configuração fiscal preparada para revisar notas em homologação. A emissão em produção permanece bloqueada."
                      : "Configuração fiscal preparada para revisão. O envio ao governo permanece desabilitado."}
                  </p>
                )}
              </Panel>
              <Panel
                icon={<AlertCircle />}
                title={
                  fiscalService
                    ? "Antes de testar a emissão"
                    : "O que falta para emitir"
                }
                subtitle={
                  fiscalService
                    ? "Salve a configuração e use o painel de homologação."
                    : "Salvar o rascunho não habilita a emissão de notas."
                }
              >
                <ul className="nf-pending">
                  {(fiscalService ? fiscalIssues : pendingNfseSetup(setup)).map(
                    (item) => (
                      <li key={item}>
                        <span />
                        {item}
                      </li>
                    ),
                  )}
                  <li>
                    <span />
                    {fiscalService
                      ? "Use Testar conexão para conferir o A1 e os parâmetros atuais do emissor nacional."
                      : "Conectar o A1 e validar a comunicação com o emissor em homologação"}
                  </li>
                </ul>
              </Panel>
              <div className="nf-alert">
                <Info />
                <span>
                  {fiscalService
                    ? "Após salvar, prepare um rascunho com os dados completos do cliente. A preparação da DPS e o envio de teste são ações separadas, com revisão e confirmação."
                    : "Após salvar, você poderá preparar rascunhos para seus clientes. Eles não têm número fiscal, não são enviados à prefeitura e não geram receitas no financeiro."}
                </span>
              </div>
            </>
          )}
          <footer className="nf-wizard-footer">
            <button className="nf-button nf-plain" onClick={closeSetup}>
              <ArrowLeft /> Voltar à lista
            </button>
            <div>
              <button
                className="nf-button"
                onClick={() => saveSetup(false)}
                disabled={
                  busy ||
                  Boolean(fiscalService ? !cloud?.canConfigure : load.error)
                }
              >
                <Save /> Salvar e continuar depois
              </button>
              {step > 0 && (
                <button className="nf-button" onClick={() => setStep(step - 1)}>
                  Voltar
                </button>
              )}
              {step < 3 ? (
                <button
                  className="nf-button nf-primary"
                  onClick={() => setStep(step + 1)}
                >
                  Avançar <ArrowRight />
                </button>
              ) : (
                <button
                  className="nf-button nf-primary"
                  disabled={
                    busy ||
                    Boolean(fiscalService ? !cloud?.canConfigure : load.error)
                  }
                  onClick={() => saveSetup(true)}
                >
                  <Check /> Salvar configuração de rascunho
                </button>
              )}
            </div>
          </footer>
        </>
      ) : (
        <>
          <div className="nf-toolbar">
            <div>
              <button className="nf-button nf-primary" onClick={newDraft}>
                <Plus /> Adicionar NFS-e
              </button>
              <div className="nf-menu" ref={menuRef}>
                <button
                  ref={configButton}
                  className="nf-button"
                  aria-haspopup="menu"
                  aria-expanded={menu}
                  onClick={() => setMenu(!menu)}
                >
                  <Settings2 /> Mais ações <ChevronDown />
                </button>
                {menu && (
                  <div role="menu">
                    <button role="menuitem" onClick={() => openSetup()}>
                      <Building2 /> Configurar emissor
                    </button>
                    <button role="menuitem" onClick={() => openSetup(1)}>
                      <KeyRound /> Certificado digital
                    </button>
                    <button
                      role="menuitem"
                      onClick={() => {
                        setInfo(true);
                        setMenu(false);
                      }}
                    >
                      <Info /> Sobre a emissão
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div>
              <List className="nf-muted-icon" />
              <label className="nf-month">
                Competência{" "}
                <input
                  type="month"
                  aria-label="Filtrar notas por competência"
                  value={month}
                  onChange={(event) => {
                    setMonth(event.target.value);
                    setPage(1);
                  }}
                />
              </label>
              {month && (
                <button
                  className="nf-icon-button"
                  aria-label="Limpar filtro de competência"
                  onClick={() => setMonth("")}
                >
                  <X />
                </button>
              )}
            </div>
          </div>
          <div className="nf-alert nf-warning">
            <AlertCircle />
            <span>
              {fiscalService
                ? "Para testar, revise o cadastro do emissor, salve uma nota e use o painel de homologação."
                : "Para emitir NFS-e, conclua o cadastro fiscal e conecte o certificado digital A1."}{" "}
              <button onClick={() => openSetup()}>Configurar emissão</button>
            </span>
          </div>
          {workspace.drafts.length === 0 ? (
            <div className="nf-empty">
              <div className="nf-document-icon">
                <FileText />
              </div>
              <h3>
                {fiscalService
                  ? "Nenhum rascunho salvo no servidor"
                  : "Nenhuma NFS-e emitida"}
              </h3>
              <p>
                Configure os dados da sua empresa e prepare notas fiscais de
                serviço para os seus clientes.
              </p>
              <div className="nf-empty-actions">
                <button className="nf-button nf-primary" onClick={newDraft}>
                  <Plus /> Adicionar NFS-e
                </button>
                <button className="nf-button" onClick={() => openSetup(1)}>
                  <KeyRound /> Configurar certificado digital
                </button>
              </div>
              <div className="nf-feature-grid">
                <div>
                  <span className="purple">
                    <Upload />
                  </span>
                  <div>
                    <h4>Emita e acompanhe</h4>
                    <p>
                      A situação da nota será atualizada após o retorno do
                      emissor.
                    </p>
                  </div>
                </div>
                <div>
                  <span className="blue">
                    <Mail />
                  </span>
                  <div>
                    <h4>Compartilhe com o cliente</h4>
                    <p>PDF e XML estarão disponíveis após a autorização.</p>
                  </div>
                </div>
                <div>
                  <span className="green">
                    <FileCode2 />
                  </span>
                  <div>
                    <h4>Organize os documentos</h4>
                    <p>
                      Mantenha o histórico fiscal de cada cliente em um só
                      lugar.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <section className="nf-panel nf-drafts">
              <header>
                <div>
                  <h3>
                    Notas em preparação{" "}
                    <span className="nf-count">{workspace.drafts.length}</span>
                  </h3>
                  <p>
                    {fiscalService
                      ? "Rascunhos no servidor. Consulte os testes e seus retornos no painel de homologação."
                      : "Rascunhos locais. Nenhuma NFS-e foi emitida."}
                  </p>
                </div>
                <label className="nf-search">
                  <Search />
                  <input
                    aria-label="Buscar rascunhos"
                    placeholder="Buscar cliente, documento ou serviço"
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setPage(1);
                    }}
                  />
                </label>
              </header>
              <div className="nf-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Cliente / tomador</th>
                      <th>Competência</th>
                      <th>Serviço</th>
                      <th>Valor</th>
                      <th>Situação</th>
                      <th>
                        <span className="nf-sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <b>{item.customerName}</b>
                          <small>
                            {item.customerDocument || "Documento pendente"}
                          </small>
                        </td>
                        <td>
                          {/^\d{4}-\d{2}$/.test(item.competence)
                            ? item.competence.split("-").reverse().join("/")
                            : "A preencher"}
                        </td>
                        <td className="nf-service-cell">
                          {item.description || "A preencher"}
                        </td>
                        <td className="nf-nowrap">
                          {item.amount &&
                          Number.isFinite(parseMoney(item.amount))
                            ? fmt(parseMoney(item.amount))
                            : "A preencher"}
                        </td>
                        <td>
                          <span className="nf-tag nf-tag-amber">
                            {cloud?.emissions.find((e) => e.draftId === item.id)
                              ?.status === "authorized"
                              ? "Autorizada em homologação"
                              : cloud?.emissions.find(
                                    (e) => e.draftId === item.id,
                                  )?.status === "prepared"
                                ? "DPS preparada"
                                : cloud?.emissions.some(
                                      (e) =>
                                        e.draftId === item.id &&
                                        ["sending", "unknown"].includes(
                                          e.status,
                                        ),
                                    )
                                  ? "Aguardando consulta"
                                  : "Rascunho"}
                          </span>
                        </td>
                        <td>
                          <div className="nf-row-actions">
                            <button
                              className="nf-icon-button"
                              aria-label={`Editar rascunho de ${item.customerName}`}
                              onClick={() => {
                                setDraft({ ...item });
                                setNotice("");
                              }}
                            >
                              <Pencil />
                            </button>
                            <button
                              className="nf-icon-button"
                              aria-label={`Excluir rascunho de ${item.customerName}`}
                              onClick={() => setDeleting(item)}
                            >
                              <Trash2 />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {visible.length === 0 && (
                      <tr>
                        <td colSpan={6} className="nf-no-results">
                          Nenhum rascunho encontrado para os filtros
                          selecionados.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <footer className="nf-pagination">
                <span>
                  {filtered.length} rascunho(s) · página {activePage} de {pages}
                </span>
                <div>
                  <button
                    className="nf-button"
                    disabled={activePage <= 1}
                    onClick={() => setPage(activePage - 1)}
                  >
                    Anterior
                  </button>
                  <button
                    className="nf-button"
                    disabled={activePage >= pages}
                    onClick={() => setPage(activePage + 1)}
                  >
                    Próxima
                  </button>
                </div>
              </footer>
            </section>
          )}
          <div className="nf-issuer-strip">
            <Building2 />
            <div>
              <b>{workspace.issuer.legalName || "Emissor a configurar"}</b>
              <span>
                {workspace.issuer.document} · {workspace.issuer.city} /{" "}
                {workspace.issuer.state}
              </span>
            </div>
            <button onClick={() => openSetup()}>
              Editar cadastro <ArrowRight />
            </button>
          </div>
        </>
      )}
      {hasModal && (
        <div
          className="nf-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setDraft(null);
              setDeleting(null);
              setInfo(false);
            }
          }}
        >
          <div
            className="nf-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="nf-modal-title"
            tabIndex={-1}
            ref={modalRef}
          >
            <header>
              <div>
                <span className="nf-eyebrow">NFS-e</span>
                <h3 id="nf-modal-title">
                  {draft
                    ? "Preparar rascunho de NFS-e"
                    : deleting
                      ? "Excluir rascunho?"
                      : "Como a emissão vai funcionar"}
                </h3>
              </div>
              <button
                className="nf-icon-button"
                aria-label="Fechar janela"
                onClick={() => {
                  setDraft(null);
                  setDeleting(null);
                  setInfo(false);
                }}
              >
                <X />
              </button>
            </header>
            {draft ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  saveDraft();
                }}
              >
                <div className="nf-modal-body">
                  <div className="nf-alert">
                    <Info />
                    <span>
                      {fiscalService
                        ? "Salve os dados e prepare a DPS no painel de homologação. Campos incompletos serão apontados antes do preparo."
                        : "Este é um rascunho local. A emissão fiscal ainda não está disponível."}
                    </span>
                  </div>
                  {error && (
                    <p className="nf-form-error" role="alert">
                      {error}
                    </p>
                  )}
                  <div className="nf-grid nf-grid-two">
                    <Field label="Nome ou razão social do cliente">
                      <input
                        autoComplete="off"
                        required
                        value={draft.customerName}
                        onChange={(event) =>
                          customerLookup.change(
                            "customerName",
                            event.target.value,
                          )
                        }
                        maxLength={250}
                      />
                    </Field>
                    <Field label="CPF / CNPJ do cliente">
                      <input
                        value={draft.customerDocument}
                        onChange={(event) =>
                          customerLookup.change(
                            "customerDocument",
                            event.target.value,
                          )
                        }
                        placeholder="Pode ser preenchido depois"
                        maxLength={25}
                      />
                    </Field>
                    <div className="nf-customer-lookup nf-field-wide">
                      <div
                        role="status"
                        aria-live="polite"
                        className={
                          customerLookup.company.kind === "error"
                            ? "nf-lookup-warning"
                            : ""
                        }
                      >
                        {customerLookup.company.message ||
                          "Ao completar um CNPJ válido, os dados disponíveis serão consultados automaticamente. Para CPF, preencha o cadastro manualmente."}
                      </div>
                      {customerLookup.canCompany && (
                        <button
                          type="button"
                          className="nf-button"
                          disabled={customerLookup.company.kind === "loading"}
                          onClick={customerLookup.retryCompany}
                        >
                          {customerLookup.company.kind === "loading"
                            ? "Consultando…"
                            : "Consultar CNPJ novamente"}
                        </button>
                      )}
                    </div>
                    <Field label="E-mail do cliente">
                      <input
                        type="email"
                        value={draft.customerEmail}
                        onChange={(event) =>
                          customerLookup.change(
                            "customerEmail",
                            event.target.value,
                          )
                        }
                        maxLength={250}
                      />
                    </Field>
                    <Field label="Competência">
                      <input
                        type={fiscalService ? "date" : "month"}
                        value={
                          fiscalService
                            ? draft.serviceDate || ""
                            : draft.competence
                        }
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            competence: event.target.value.slice(0, 7),
                            ...(fiscalService
                              ? { serviceDate: event.target.value }
                              : {}),
                          })
                        }
                      />
                    </Field>
                    <Field label="Descrição do serviço" wide>
                      <textarea
                        rows={4}
                        value={draft.description}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            description: event.target.value,
                          })
                        }
                        maxLength={8000}
                      />
                    </Field>
                    <Field label="Valor do serviço (R$)">
                      <input
                        value={draft.amount}
                        inputMode="decimal"
                        placeholder="A preencher"
                        onChange={(event) =>
                          setDraft({ ...draft, amount: event.target.value })
                        }
                        maxLength={25}
                      />
                    </Field>
                    <Field label="Situação">
                      <input readOnly value="Rascunho — sem validade fiscal" />
                    </Field>
                  </div>
                  {fiscalService && (
                    <>
                      <h4>Endereço do cliente / tomador</h4>
                      <div className="nf-grid nf-grid-two">
                        {(
                          [
                            ["customerPostalCode", "CEP do cliente"],
                            ["customerStreet", "Logradouro do cliente"],
                            ["customerNumber", "Número do cliente"],
                            ["customerComplement", "Complemento do cliente"],
                            ["customerDistrict", "Bairro do cliente"],
                            ["customerCity", "Cidade do cliente"],
                            ["customerState", "UF do cliente"],
                            [
                              "customerMunicipalityCode",
                              "Código IBGE do cliente",
                            ],
                          ] as const
                        ).map(([key, label]) => (
                          <Field label={label} key={key}>
                            <input
                              value={draft[key] || ""}
                              maxLength={key === "customerState" ? 2 : 250}
                              onChange={(e) =>
                                customerLookup.change(key, e.target.value)
                              }
                            />
                          </Field>
                        ))}
                        <NfseServicePlace
                          key={draft.id}
                          draft={draft}
                          onChange={(value) =>
                            setDraft((old) =>
                              old?.id === draft.id ? { ...old, ...value } : old,
                            )
                          }
                        />
                        {(
                          [
                            ["serviceCode", "Código nacional desta nota"],
                            [
                              "municipalServiceCode",
                              "Código municipal desta nota (opcional)",
                            ],
                            ["nbsCode", "NBS desta nota"],
                          ] as const
                        ).map(([key, label]) => (
                          <Field key={key} label={label}>
                            <input
                              value={draft[key] || ""}
                              placeholder={
                                key === "municipalServiceCode"
                                  ? "Vazio quando não se aplicar; não use 000"
                                  : undefined
                              }
                              maxLength={25}
                              onChange={(e) =>
                                customerLookup.change(key, e.target.value)
                              }
                            />
                          </Field>
                        ))}
                        <p className="nf-field-wide nf-alert">
                          O código municipal precisa estar cadastrado no
                          ambiente utilizado. Se não houver complemento
                          aplicável, deixe esse campo vazio nesta nota. O código
                          padrão do emissor será preservado.
                          {fiscalService &&
                            " Novos rascunhos de homologação começam sem complemento municipal; preencha somente quando aplicável ao ambiente de testes."}
                        </p>
                        <Field label="ISS retido nesta nota">
                          <select
                            value={draft.issWithheld || ""}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                issWithheld: e.target.value,
                                issRate:
                                  e.target.value === "nao" ? "" : draft.issRate,
                              })
                            }
                          >
                            <option value="">Confirmar com o contador</option>
                            <option value="nao">Não</option>
                            <option value="sim">Sim, pelo tomador</option>
                          </select>
                        </Field>
                        {draft.issWithheld === "sim" && (
                          <Field label="Alíquota do ISS retido (%)">
                            <input
                              value={draft.issRate || ""}
                              inputMode="decimal"
                              onChange={(e) =>
                                setDraft({ ...draft, issRate: e.target.value })
                              }
                            />
                          </Field>
                        )}
                        <Field label="Retenções federais nesta nota">
                          <select
                            value={draft.federalRetention || ""}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                federalRetention: e.target.value,
                              })
                            }
                          >
                            <option value="">Confirmar antes de testar</option>
                            <option value="nao">Sem retenções federais</option>
                            <option value="sim">
                              Com retenções — requer configuração adicional
                            </option>
                          </select>
                        </Field>
                      </div>
                      <div className="nf-customer-lookup">
                        <div
                          role="status"
                          aria-live="polite"
                          className={
                            customerLookup.address.kind === "error"
                              ? "nf-lookup-warning"
                              : ""
                          }
                        >
                          {customerLookup.address.message ||
                            "Ao completar o CEP, consultaremos o endereço e o código IBGE. Número e complemento podem precisar de preenchimento manual."}
                        </div>
                        {customerLookup.canAddress && (
                          <button
                            type="button"
                            className="nf-button"
                            disabled={customerLookup.address.kind === "loading"}
                            onClick={customerLookup.retryAddress}
                          >
                            {customerLookup.address.kind === "loading"
                              ? "Consultando…"
                              : "Consultar CEP novamente"}
                          </button>
                        )}
                      </div>
                      <p className="nf-lookup-source">
                        Consultas públicas: BrasilAPI (CNPJ) e ViaCEP (CEP).
                        Confira os dados antes de salvar. O local da prestação e
                        os impostos são definidos separadamente.
                      </p>
                    </>
                  )}
                </div>
                <footer>
                  <button
                    type="button"
                    className="nf-button"
                    onClick={() => {
                      setDraft(null);
                      setError(load.error);
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    className="nf-button"
                    disabled
                    title="Disponível após a integração fiscal"
                  >
                    <LockKeyhole />{" "}
                    {fiscalService ? "Produção bloqueada" : "Emitir NFS-e"}
                  </button>
                  <button
                    className="nf-button nf-primary"
                    type="submit"
                    disabled={busy || Boolean(!fiscalService && load.error)}
                  >
                    <Save /> Salvar rascunho
                  </button>
                </footer>
              </form>
            ) : deleting ? (
              <>
                <div className="nf-modal-body">
                  <p>
                    Excluir o rascunho de{" "}
                    <strong>{deleting.customerName}</strong>{" "}
                    {fiscalService ? "do servidor" : "deste navegador"}? Esta
                    ação não é um cancelamento fiscal: nenhuma nota foi emitida.
                  </p>
                  {error && (
                    <p role="alert" className="nf-form-error">
                      {error}
                    </p>
                  )}
                </div>
                <footer>
                  <button
                    className="nf-button"
                    onClick={() => setDeleting(null)}
                  >
                    Manter rascunho
                  </button>
                  <button
                    className="nf-button nf-danger"
                    disabled={busy || Boolean(!fiscalService && load.error)}
                    onClick={async () => {
                      if (
                        await persist(
                          {
                            ...workspace,
                            drafts: workspace.drafts.filter(
                              (item) => item.id !== deleting.id,
                            ),
                          },
                          "Rascunho excluído deste navegador.",
                        )
                      )
                        setDeleting(null);
                    }}
                  >
                    Excluir rascunho
                  </button>
                </footer>
              </>
            ) : (
              <>
                <div className="nf-modal-body">
                  <p>
                    O módulo atende um único emissor e vários clientes.{" "}
                    {fiscalService
                      ? "Os testes usam o ambiente nacional de homologação."
                      : "A emissão fiscal está em preparação."}
                  </p>
                  <ol className="nf-info-steps">
                    <li>
                      Confira os dados da empresa e complete o cadastro fiscal
                      com o contador.
                    </li>
                    <li>
                      {fiscalService
                        ? "Cadastre o A1 na custódia segura e use Testar conexão."
                        : "Conecte o certificado A1 quando a integração segura estiver disponível."}
                    </li>
                    <li>
                      Valide a integração em homologação antes de emitir notas
                      reais.
                    </li>
                    <li>
                      Depois, prepare, revise e envie as notas, acompanhando a
                      autorização.
                    </li>
                  </ol>
                  <div className="nf-alert">
                    <Info />
                    <span>
                      {fiscalService
                        ? "Configuração, rascunhos e histórico são salvos no servidor. Prepare a DPS, confira o XML e confirme o envio de teste. Em resposta incerta, consulte o resultado. A emissão em produção e o cancelamento fiscal permanecem indisponíveis."
                        : "No momento, apenas configurações e rascunhos são salvos neste navegador. PDF, XML, envio e cancelamento fiscal dependem da integração."}
                    </span>
                  </div>
                </div>
                <footer>
                  <button
                    className="nf-button nf-primary"
                    onClick={() => setInfo(false)}
                  >
                    Entendi
                  </button>
                </footer>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
