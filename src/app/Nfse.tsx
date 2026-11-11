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
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  emptyNfseWorkspace,
  nfseStorageKey,
  parseNfseWorkspace,
  pendingNfseSetup,
  type NfseDraft,
  type NfseIssuer,
  type NfseSettings,
  type NfseWorkspace,
} from "../lib/nfseDrafts";
import { fmt, parseMoney } from "./shared";
import "../styles/nfse.css";

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
}: {
  storageScope?: string;
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
  const [deleting, setDeleting] = useState<NfseDraft | null>(null);
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

  function persist(next: NfseWorkspace, message: string) {
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
  function closeSetup() {
    setSetup(null);
    setStep(0);
  }
  function saveSetup(reviewed: boolean) {
    if (!setup) return;
    const next = { ...setup, setupReviewed: reviewed || setup.setupReviewed };
    if (
      persist(
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
  function saveDraft() {
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
      persist(
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
          <span /> Em preparação
        </span>
      </div>
      <div className="nf-local-note">
        <LockKeyhole />
        <p>
          <strong>Preparação local.</strong> Os rascunhos ficam neste navegador.
          A emissão e o envio do certificado serão liberados após a integração
          fiscal.
        </p>
      </div>
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
                  {input(
                    "specialRegime",
                    "Regime especial de tributação",
                    "A confirmar, se aplicável",
                  )}
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
              <div className="nf-certificate">
                <div className="nf-certificate-icon">
                  <ShieldCheck />
                </div>
                <div>
                  <span className="nf-tag nf-tag-amber">
                    Aguardando integração
                  </span>
                  <h4>Conecte o certificado com segurança</h4>
                  <p>
                    A empresa já possui um A1. A importação do arquivo .pfx ou
                    .p12 e a senha serão feitas em uma conexão protegida, quando
                    a integração estiver disponível.
                  </p>
                  <button className="nf-button" disabled>
                    <Upload /> Importar certificado A1
                  </button>
                  <small>
                    O arquivo e a senha não são solicitados nem armazenados
                    nesta prévia.
                  </small>
                </div>
              </div>
              <div className="nf-checklist">
                <div>
                  <FileCheck2 />
                  <span>
                    <b>Vínculo com o emissor</b>
                    <small>
                      CNPJ e titularidade serão verificados na integração.
                    </small>
                  </span>
                </div>
                <div>
                  <KeyRound />
                  <span>
                    <b>Validade do certificado</b>
                    <small>
                      A data de vencimento será exibida após a validação.
                    </small>
                  </span>
                </div>
                <div>
                  <LockKeyhole />
                  <span>
                    <b>Armazenamento protegido</b>
                    <small>
                      Acesso restrito ao serviço responsável pela emissão.
                    </small>
                  </span>
                </div>
              </div>
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
                  <Field label="Código de serviço municipal">
                    <input
                      value={settings.municipalServiceCode}
                      onChange={(event) =>
                        setSettings("municipalServiceCode", event.target.value)
                      }
                      placeholder="Se aplicável"
                      maxLength={60}
                    />
                  </Field>
                  <Field label="Município padrão da prestação">
                    <input
                      value={settings.serviceCity}
                      onChange={(event) =>
                        setSettings("serviceCity", event.target.value)
                      }
                      maxLength={250}
                    />
                  </Field>
                  <Field label="Alíquota de ISS (%)">
                    <input
                      value={settings.issRate}
                      onChange={(event) =>
                        setSettings("issRate", event.target.value)
                      }
                      placeholder="A confirmar"
                      inputMode="decimal"
                      maxLength={12}
                    />
                  </Field>
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
                  Esses campos são uma preparação do cadastro. Os tributos e
                  campos adicionais exigidos pelo emissor serão definidos com os
                  dados fiscais e a nota de exemplo.
                </span>
              </div>
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
                    <small>Certificado A1 ainda não conectado</small>
                  </div>
                </div>
              </Panel>
              <Panel
                icon={<AlertCircle />}
                title="O que falta para emitir"
                subtitle="Salvar o rascunho não habilita a emissão de notas."
              >
                <ul className="nf-pending">
                  {pendingNfseSetup(setup).map((item) => (
                    <li key={item}>
                      <span />
                      {item}
                    </li>
                  ))}
                  <li>
                    <span />
                    Validar uma nota de exemplo e os testes de homologação
                  </li>
                </ul>
              </Panel>
              <div className="nf-alert">
                <Info />
                <span>
                  Após salvar, você poderá preparar rascunhos para seus
                  clientes. Eles não têm número fiscal, não são enviados à
                  prefeitura e não geram receitas no financeiro.
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
                disabled={Boolean(load.error)}
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
                  disabled={Boolean(load.error)}
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
              Para emitir NFS-e, conclua o cadastro fiscal e conecte o
              certificado digital A1.{" "}
              <button onClick={() => openSetup()}>Configurar emissão</button>
            </span>
          </div>
          {workspace.drafts.length === 0 ? (
            <div className="nf-empty">
              <div className="nf-document-icon">
                <FileText />
              </div>
              <h3>Nenhuma NFS-e emitida</h3>
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
                  <p>Rascunhos locais. Nenhuma NFS-e foi emitida.</p>
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
                          <span className="nf-tag nf-tag-amber">Rascunho</span>
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
                      Este é um rascunho local. A emissão fiscal ainda não está
                      disponível.
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
                          setDraft({
                            ...draft,
                            customerName: event.target.value,
                          })
                        }
                        maxLength={250}
                      />
                    </Field>
                    <Field label="CPF / CNPJ do cliente">
                      <input
                        value={draft.customerDocument}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            customerDocument: event.target.value,
                          })
                        }
                        placeholder="Pode ser preenchido depois"
                        maxLength={25}
                      />
                    </Field>
                    <Field label="E-mail do cliente">
                      <input
                        type="email"
                        value={draft.customerEmail}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            customerEmail: event.target.value,
                          })
                        }
                        maxLength={250}
                      />
                    </Field>
                    <Field label="Competência">
                      <input
                        type="month"
                        value={draft.competence}
                        onChange={(event) =>
                          setDraft({ ...draft, competence: event.target.value })
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
                    <LockKeyhole /> Emitir NFS-e
                  </button>
                  <button
                    className="nf-button nf-primary"
                    type="submit"
                    disabled={Boolean(load.error)}
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
                    <strong>{deleting.customerName}</strong> deste navegador?
                    Esta ação não é um cancelamento fiscal: nenhuma nota foi
                    emitida.
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
                    disabled={Boolean(load.error)}
                    onClick={() => {
                      if (
                        persist(
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
                    O módulo está em preparação para um único emissor e vários
                    clientes.
                  </p>
                  <ol className="nf-info-steps">
                    <li>
                      Confira os dados da empresa e complete o cadastro fiscal
                      com o contador.
                    </li>
                    <li>
                      Conecte o certificado A1 quando a integração segura
                      estiver disponível.
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
                      No momento, apenas configurações e rascunhos são salvos
                      neste navegador. PDF, XML, envio e cancelamento fiscal
                      dependem da integração.
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
