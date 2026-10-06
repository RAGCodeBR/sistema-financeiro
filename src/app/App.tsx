import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import {
  readAuthenticatedRows,
  supabase,
  supabasePublishableKey,
  supabaseUrl,
} from "../lib/supabase";
import {
  createRemoteCostCenter,
  updateRemoteCostCenter,
  deleteRemoteCostCenter,
  uploadEntryAttachment,
  signedAttachmentUrl,
  removeEntryAttachments,
  deleteRemoteCategory,
  deleteRemoteEntries,
  deleteRemoteEntrySeries,
  saveRemoteCategory,
  saveRemoteCounterparty,
  saveRemoteEntries,
  setRemoteCounterpartyArchived,
} from "../lib/bridge";
import { addMonthsClamped, changedSeriesFields, seriesDueDate } from "../lib/seriesDates";
import { CurrencyInput, Month, fmt, labelMonth, moneyInput, parseMoney } from "./shared";
import TeamNotesScreen from "./TeamNotes";
import {
  AlertTriangle,
  Bell,
  BarChart3,
  Building2,
  CalendarClock,
  ChevronRight,
  CreditCard,
  FileText,
  LayoutDashboard,
  Menu,
  Paperclip,
  Plus,
  ReceiptText,
  Repeat2,
  Tag,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Kind = "receita" | "despesa";
type Unit = string;
type CostCenter = {
  name: Unit;
  initials: string;
  colorKey: string;
  color: string;
  tint: string;
};
type CostCenterRow = { name: Unit; initials: string; color?: string };
type Entry = {
  id: string;
  seriesId?: string;
  kind: Kind;
  unit: Unit;
  account: string;
  category: string;
  description: string;
  beneficiary: string;
  counterpartyId?: string | null;
  pix: string;
  amount: number;
  date: string;
  status: "previsto" | "realizado";
  recurrence: "nenhuma" | "mensal";
  installments: number;
  installment?: string;
  notes?: string;
  attachments?: string[];
  juros?: number;
  paidDate?: string;
};
// Valor que efetivamente saiu/entrou: numa despesa já paga, soma os juros.
const entryValue = (entry: Entry) =>
  entry.amount + (entry.kind === "despesa" && entry.status === "realizado" ? entry.juros || 0 : 0);
// Dias de atraso de uma despesa paga: diferença entre pagamento e vencimento.
const lateDays = (entry: Entry) =>
  entry.paidDate && entry.paidDate > entry.date
    ? Math.round((Date.parse(`${entry.paidDate}T12:00:00`) - Date.parse(`${entry.date}T12:00:00`)) / 86400000)
    : 0;
type Category = {
  id: string;
  name: string;
  kind: Kind;
  unit: Unit;
  icon?: string;
  color?: string;
};
type Account = { id: string; name: string; unit: Unit };
type Counterparty = {
  id: string;
  kind: Kind;
  unit: Unit;
  name: string;
  provides: string;
  archived?: boolean;
};
type User = {
  id: string;
  name: string;
  email: string;
  role: "master" | "operador";
  units: Unit[];
  canViewReports: boolean;
  canViewTeamNotes: boolean;
  hiddenScreens: string[];
};
// Abas que o Master pode ocultar por usuário (a aba "Usuários" é sempre
// exclusiva do Master, então não entra aqui).
const toggleableScreens: { id: string; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "lancamentos", label: "Lançamentos" },
  { id: "contas", label: "Contas" },
  { id: "categorias", label: "Plano de contas" },
  { id: "contatos", label: "Fornecedores/clientes" },
  { id: "relatorios", label: "Relatórios" },
];
// Paleta fixa de cores para os centros de custo. As classes Tailwind ficam
// escritas por extenso aqui para que o build as inclua no CSS final.
type CostCenterColor = { key: string; label: string; swatch: string; color: string; tint: string };
const costCenterColors: CostCenterColor[] = [
  { key: "indigo", label: "Índigo", swatch: "#4f46e5", color: "bg-indigo-600", tint: "border-indigo-100 bg-indigo-50" },
  { key: "blue", label: "Azul", swatch: "#2563eb", color: "bg-blue-600", tint: "border-blue-100 bg-blue-50" },
  { key: "emerald", label: "Verde", swatch: "#059669", color: "bg-emerald-600", tint: "border-emerald-100 bg-emerald-50" },
  { key: "teal", label: "Turquesa", swatch: "#0d9488", color: "bg-teal-600", tint: "border-teal-100 bg-teal-50" },
  { key: "amber", label: "Âmbar", swatch: "#f59e0b", color: "bg-amber-500", tint: "border-amber-100 bg-amber-50" },
  { key: "orange", label: "Laranja", swatch: "#f97316", color: "bg-orange-500", tint: "border-orange-100 bg-orange-50" },
  { key: "rose", label: "Rosa", swatch: "#e11d48", color: "bg-rose-600", tint: "border-rose-100 bg-rose-50" },
  { key: "fuchsia", label: "Magenta", swatch: "#c026d3", color: "bg-fuchsia-600", tint: "border-fuchsia-100 bg-fuchsia-50" },
  { key: "violet", label: "Violeta", swatch: "#7c3aed", color: "bg-violet-600", tint: "border-violet-100 bg-violet-50" },
  { key: "slate", label: "Grafite", swatch: "#475569", color: "bg-slate-600", tint: "border-slate-100 bg-slate-50" },
];
const costCenterColorByKey = new Map(costCenterColors.map((item) => [item.key, item]));
const resolveCostCenterColor = (key: string | undefined) =>
  costCenterColorByKey.get(key || "") ?? costCenterColors[0];
const makeCostCenter = (name: Unit, initials: string, colorKey: string): CostCenter => {
  const palette = resolveCostCenterColor(colorKey);
  return { name, initials, colorKey: palette.key, color: palette.color, tint: palette.tint };
};
const units: CostCenter[] = [
  makeCostCenter("Marketing", "MK", "fuchsia"),
  makeCostCenter("Sítio", "SI", "emerald"),
  makeCostCenter("Consultoria", "CO", "blue"),
  makeCostCenter("Pessoa Física", "PF", "amber"),
];
const reportsAccessFlag = "__reports__";
// Libera a aba "Notas da equipe" (além do Master).
const teamNotesAccessFlag = "__team_notes__";
const profileAccess = (values: string[] | null | undefined) => {
  const raw = values || [];
  return {
    units: raw.filter((value) => value !== reportsAccessFlag && value !== teamNotesAccessFlag),
    canViewReports: raw.includes(reportsAccessFlag),
    canViewTeamNotes: raw.includes(teamNotesAccessFlag),
  };
};
const costCenterVisual = (row: CostCenterRow): CostCenter => {
  const existing = units.find((unit) => unit.name === row.name);
  const colorKey = row.color || existing?.colorKey || "indigo";
  return makeCostCenter(
    row.name,
    row.initials || row.name.slice(0, 2).toLocaleUpperCase("pt-BR"),
    colorKey,
  );
};
const defaults: Category[] = [
  {
    id: "hon",
    name: "Honorários",
    kind: "receita",
    unit: "Consultoria",
    icon: "💼",
  },
  { id: "ven", name: "Vendas", kind: "receita", unit: "Marketing", icon: "📈" },
  { id: "prod", name: "Produção", kind: "receita", unit: "Sítio", icon: "🌱" },
  {
    id: "sal",
    name: "Salário",
    kind: "receita",
    unit: "Pessoa Física",
    icon: "💰",
  },
  {
    id: "for",
    name: "Fornecedores",
    kind: "despesa",
    unit: "Consultoria",
    icon: "🏭",
  },
  {
    id: "tra",
    name: "Tráfego pago",
    kind: "despesa",
    unit: "Marketing",
    icon: "📣",
  },
  { id: "ins", name: "Insumos", kind: "despesa", unit: "Sítio", icon: "🚜" },
  {
    id: "mor",
    name: "Moradia",
    kind: "despesa",
    unit: "Pessoa Física",
    icon: "🏠",
  },
];
const baseAccounts: Account[] = [
    "Conta corrente",
    "Conta digital",
    "Cartão de crédito",
    "Caixa",
  ].map((name, index) => ({ id: `conta-${index}`, name, unit: "Consultoria" })),
  icons = [
    "🏷️",
    "💼",
    "📈",
    "🌱",
    "💰",
    "🏭",
    "📣",
    "🚜",
    "🏠",
    "🧾",
    "⚙️",
    "👤",
    "🍽️",
    "🚙",
    "💳",
  ];
const id = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
const entryScheduleLabel = (entry: Entry) =>
  entry.recurrence === "mensal"
    ? entry.installment
      ? `Recorrente mensal · Parcela ${entry.installment}`
      : "Recorrente mensal"
    : entry.installment
      ? `Parcela ${entry.installment}`
      : "Lançamento único";
const recurringOccurrenceId = (seriesId: string, date: string, slot = "") => {
  const source = slot ? `${seriesId}:${date}:${slot}` : `${seriesId}:${date}`;
  let a = 0x811c9dc5,
    b = 0x9e3779b9,
    c = 0x85ebca6b,
    d = 0xc2b2ae35;
  for (let i = 0; i < source.length; i += 1) {
    const code = source.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b);
    c = Math.imul(c ^ code, 0xc2b2ae35);
    d = Math.imul(d ^ code, 0x27d4eb2f);
  }
  const raw = [a, b, c, d]
    .map((value) => (value >>> 0).toString(16).padStart(8, "0"))
    .join("");
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-4${raw.slice(13, 16)}-8${raw.slice(17, 20)}-${raw.slice(20, 32)}`;
};
const counterpartyKey = (kind: Kind, name: string) =>
  JSON.stringify([
    kind,
    name.trim().replace(/\s+/g, " ").toLocaleLowerCase("pt-BR"),
  ]);
const contactIdentity = (kind: Kind, unit: Unit, name: string) =>
  `${unit}:${counterpartyKey(kind, name)}`;
const contactsWithLegacyEntries = (saved: Counterparty[], entries: Entry[]) => {
  const byIdentity = new Map<string, Counterparty>();
  saved.forEach((contact) =>
    byIdentity.set(contactIdentity(contact.kind, contact.unit, contact.name), contact),
  );
  entries.forEach((entry) => {
    if (!entry.beneficiary?.trim()) return;
    const key = contactIdentity(entry.kind, entry.unit, entry.beneficiary);
    if (!byIdentity.has(key))
      byIdentity.set(key, {
        id: `legacy:${key}`,
        kind: entry.kind,
        unit: entry.unit,
        name: entry.beneficiary.trim(),
        provides: "",
      });
  });
  return [...byIdentity.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );
};
type SameMonthPart = { date: string; amount: string };
const sameMonthParts = (count: number, total: number, baseDate: string) => {
  const safeCount = Math.max(2, Math.min(12, Math.floor(count) || 2));
  const totalCents = Math.round(Math.max(0, total || 0) * 100);
  const baseCents = Math.floor(totalCents / safeCount);
  const remainder = totalCents - baseCents * safeCount;
  const base = new Date(`${baseDate}T12:00:00`);
  const lastDay = new Date(
    base.getFullYear(),
    base.getMonth() + 1,
    0,
  ).getDate();
  const firstDay = Math.min(base.getDate(), lastDay);
  return Array.from({ length: safeCount }, (_, index) => {
    const day =
      safeCount === 1
        ? firstDay
        : Math.round(
            firstDay + ((lastDay - firstDay) * index) / (safeCount - 1),
          );
    const date = new Date(base.getFullYear(), base.getMonth(), day)
      .toISOString()
      .slice(0, 10);
    return {
      date,
      amount: moneyInput((baseCents + (index < remainder ? 1 : 0)) / 100),
    };
  });
};

function nextRecurringEntries(entries: Entry[]) {
  const startOfCurrentMonth = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  );
  const endOfWindow = new Date(
    new Date().getFullYear(),
    new Date().getMonth() + 36,
    0,
  );
  const generated: Entry[] = [];
  const series = new Map<string, Entry[]>();

  entries
    .filter((entry) => entry.recurrence === "mensal" && entry.seriesId)
    .forEach((entry) => {
      const group = series.get(entry.seriesId!) || [];
      group.push(entry);
      series.set(entry.seriesId!, group);
    });

  series.forEach((occurrences) => {
    const latestMonth = [...occurrences]
      .map((entry) => entry.date.slice(0, 7))
      .sort()
      .at(-1);
    if (!latestMonth) return;
    // The last month in a series is its template. A normal recurring entry
    // has one template; an adiantamento + saldo series has two or more, each
    // retaining its own date, amount, PIX and other details every month.
    const templates = occurrences
      .filter((entry) => entry.date.startsWith(latestMonth))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!templates.length) return;
    const nextMonth = new Date(`${latestMonth}-01T12:00:00`);
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    // A gap can happen when nobody opens the system for a long time. Do not
    // invent old financial commitments in that case: preserve real history
    // and resume the forecast from the current month onward.
    if (nextMonth < startOfCurrentMonth)
      nextMonth.setTime(startOfCurrentMonth.getTime());
    while (nextMonth <= endOfWindow) {
      const lastDay = new Date(
        nextMonth.getFullYear(),
        nextMonth.getMonth() + 1,
        0,
      ).getDate();
      templates.forEach((template, index) => {
        const sourceDate = new Date(`${template.date}T12:00:00`);
        const dueDate = new Date(
          nextMonth.getFullYear(),
          nextMonth.getMonth(),
          Math.min(sourceDate.getDate(), lastDay),
        )
          .toISOString()
          .slice(0, 10);
        generated.push({
          ...template,
          // Deterministic IDs make concurrent projections from Master and
          // operators safe. Multi-part monthly series include their position
          // so two payments on the same day never collide.
          id: recurringOccurrenceId(
            template.seriesId!,
            dueDate,
            templates.length > 1 ? template.installment || String(index) : "",
          ),
          date: dueDate,
          status: "previsto",
        });
      });
      nextMonth.setMonth(nextMonth.getMonth() + 1);
    }
  });
  return generated;
}
function Icon({
  category,
  small = false,
}: {
  category?: Category;
  small?: boolean;
}) {
  return category?.icon?.startsWith("data:") ? (
    <img
      src={category.icon}
      alt=""
      className={`${small ? "h-5 w-5" : "h-8 w-8"} rounded-full object-cover`}
    />
  ) : (
    <span
      style={{ backgroundColor: category?.color || "#e2e8f0" }}
      className={`flex ${small ? "h-5 w-5 text-xs" : "h-8 w-8"} items-center justify-center rounded-full`}
    >
      {category?.icon || "🏷️"}
    </span>
  );
}
function ScopeDialog({
  action,
  close,
  one,
  series,
}: {
  action: "editar" | "excluir";
  close: () => void;
  one: () => void;
  series: () => void;
}) {
  const verb = action === "editar" ? "alterar" : "excluir";
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div
          className={`mb-4 flex h-11 w-11 items-center justify-center rounded-full ${action === "excluir" ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"}`}
        >
          {action === "excluir" ? "−" : "✎"}
        </div>
        <h2 className="text-lg font-extrabold text-[#14213d]">
          {action === "editar"
            ? "Alterar lançamento recorrente"
            : "Excluir lançamento recorrente"}
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          Você quer {verb} somente este lançamento ou todos os lançamentos desta
          série?
        </p>
        <div className="mt-6 grid gap-3">
          <button
            onClick={one}
            className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
          >
            Somente este lançamento
          </button>
          <button
            onClick={series}
            className={`rounded-xl px-4 py-3 text-sm font-bold text-white ${action === "excluir" ? "bg-red-600" : "bg-blue-700"}`}
          >
            {action === "editar"
              ? "Alterar toda a série"
              : "Excluir toda a série"}
          </button>
          <button
            onClick={close}
            className="py-1 text-sm font-bold text-gray-400"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
function DeleteCategoryDialog({
  category,
  close,
  remove,
}: {
  category: Category;
  close: () => void;
  remove: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-red-100 text-xl font-bold text-red-600">
          −
        </div>
        <h2 className="text-lg font-extrabold text-[#14213d]">
          Excluir categoria
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          Excluir <strong>{category.name}</strong> do centro de custo{" "}
          <strong>{category.unit}</strong>?
        </p>
        <p className="mt-2 text-xs leading-5 text-gray-400">
          Os lançamentos já cadastrados serão preservados. Esta categoria apenas
          deixará de aparecer em novos lançamentos.
        </p>
        {error && (
          <p className="mt-4 text-sm font-bold text-red-600">{error}</p>
        )}
        <div className="mt-6 flex gap-3">
          <button
            onClick={close}
            disabled={busy}
            className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await remove();
              } catch (reason) {
                setError(
                  reason instanceof Error
                    ? reason.message
                    : "Não foi possível excluir a categoria.",
                );
                setBusy(false);
              }
            }}
            disabled={busy}
            className="flex-1 rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {busy ? "Excluindo..." : "Excluir categoria"}
          </button>
        </div>
      </div>
    </div>
  );
}
function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (authError || !data.user) {
      setError(
        authError?.message.toLowerCase().includes("email not confirmed")
          ? "Este acesso ainda precisa ser ativado pelo link enviado ao e-mail cadastrado."
          : "E-mail ou senha inválidos.",
      );
      setBusy(false);
      return;
    }
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, role, allowed_units, hidden_screens")
      .eq("id", data.user.id)
      .single();
    if (profileError || !profile) {
      await supabase.auth.signOut();
      setError(
        "Seu perfil de acesso não está configurado. Fale com o administrador.",
      );
      setBusy(false);
      return;
    }
    const access = profileAccess(profile.allowed_units);
    const user = {
      id: data.user.id,
      name: profile.full_name,
      email: data.user.email || email,
      role: profile.role as User["role"],
      units: access.units,
      canViewReports: access.canViewReports,
      canViewTeamNotes: access.canViewTeamNotes,
      hiddenScreens: profile.hidden_screens ?? [],
    };
    localStorage.setItem("fincore.user", JSON.stringify(user));
    onLogin(user);
  };
  return (
    <main className="min-h-screen bg-[#e8edf5] p-3 text-[#14213d] sm:p-5">
      <div className="mx-auto grid min-h-[calc(100vh-24px)] max-w-[1500px] overflow-hidden rounded-[2rem] bg-white shadow-2xl lg:grid-cols-[1.15fr_.85fr]">
        <section className="relative flex flex-col justify-between overflow-hidden bg-[#14213d] p-9 text-white sm:p-14">
          <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-blue-500/25 blur-3xl" />
          <div className="absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-indigo-500/20 blur-3xl" />
          <p className="relative text-xl font-extrabold tracking-tight">
            fincore
          </p>
          <div className="relative max-w-xl py-12">
            <p className="mb-5 text-xs font-extrabold tracking-[.2em] text-blue-200">
              GESTÃO FINANCEIRA
            </p>
            <h1 className="text-5xl font-extrabold leading-[1.04] sm:text-6xl">
              Clareza para decidir. Controle para crescer.
            </h1>
            <p className="mt-7 max-w-lg text-lg leading-relaxed text-blue-100">
              Organize receitas, despesas, contas e operações com uma visão
              financeira construída para o seu dia a dia.
            </p>
          </div>
          <p className="relative text-sm text-blue-200">
            fincore · gestão que acompanha suas decisões
          </p>
        </section>
        <section className="flex items-center justify-center bg-[#f8fafc] p-8 sm:p-14">
          <form onSubmit={submit} className="w-full max-w-md">
            <img
              src="/sistema-financeiro/fincore-logo-transparent.png"
              alt="Fincore"
              className="mb-12 w-64 max-w-full"
            />
            <p className="text-xs font-extrabold tracking-widest text-blue-700">
              BEM-VINDO
            </p>
            <h2 className="mt-2 text-3xl font-extrabold">
              Acesse sua operação
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-gray-500">
              Entre para acompanhar o que importa no seu negócio.
            </p>
            <label className="mt-8 block text-xs font-bold text-gray-600">
              E-mail
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 p-3.5 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            <label className="mt-4 block text-xs font-bold text-gray-600">
              Senha
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 p-3.5 text-sm font-normal outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
            </label>
            {error && (
              <p className="mt-3 text-sm font-bold text-red-600">{error}</p>
            )}
            <button
              disabled={busy}
              className="mt-6 w-full rounded-xl bg-blue-700 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-700/20 disabled:cursor-wait disabled:opacity-70"
            >
              {busy ? "Entrando..." : "Entrar no Fincore"}
            </button>
            <p className="mt-6 text-center text-xs text-gray-400">
              Acesso protegido e gerenciado pelo administrador.
            </p>
          </form>
        </section>
      </div>
    </main>
  );
}

function NewCategory({
  close,
  save,
  category,
  allowedUnits,
}: {
  close: () => void;
  save: (c: Category) => Promise<void>;
  category?: Category | null;
  allowedUnits: typeof units;
}) {
  const [name, setName] = useState(category?.name ?? ""),
    [kind, setKind] = useState<Kind>(category?.kind ?? "despesa"),
    [unit, setUnit] = useState<Unit>(
      category?.unit ?? allowedUnits[0]?.name ?? "Consultoria",
    ),
    [icon, setIcon] = useState(category?.icon ?? "🏷️"),
    [color, setColor] = useState(category?.color ?? "#3b82f6"),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState("");
  const upload = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => setIcon(String(r.result));
    r.readAsDataURL(f);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (name.trim()) {
            setSaving(true);
            setSaveError("");
            try {
              await save({
                id: category?.id ?? id(),
                name: name.trim(),
                kind,
                unit,
                icon,
                color,
              });
              close();
            } catch (error) {
              setSaveError(
                error instanceof Error
                  ? error.message
                  : "Não foi possível salvar no banco.",
              );
            } finally {
              setSaving(false);
            }
          }
        }}
        className="w-full max-w-lg rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="font-extrabold text-[#14213d]">
              {category ? "Editar categoria" : "Nova categoria"}
            </h2>
            <p className="text-xs text-gray-400">
              Vinculada a apenas um centro de custo.
            </p>
          </div>
          <button type="button" onClick={close}>
            <X />
          </button>
        </header>
        <div className="space-y-4 p-6">
          <label className="block text-xs font-bold text-gray-600">
            Nome
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
              placeholder="Ex.: Manutenção de máquinas"
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-bold">
              Tipo
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
                className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
              >
                <option value="receita">Receita</option>
                <option value="despesa">Despesa</option>
              </select>
            </label>
            <label className="text-xs font-bold">
              Centro de custo
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as Unit)}
                className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
              >
                {allowedUnits.map((u) => (
                  <option key={u.name}>{u.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <p className="mb-2 text-xs font-bold">Ícone</p>
            <div className="flex flex-wrap gap-2">
              {icons.map((x) => (
                <button
                  type="button"
                  onClick={() => setIcon(x)}
                  className={`h-9 w-9 rounded-lg border text-lg ${icon === x ? "border-blue-600 bg-blue-50" : ""}`}
                  key={x}
                >
                  {x}
                </button>
              ))}
              <label className="flex h-9 items-center rounded-lg border px-2 text-xs font-bold">
                Anexar
                <input
                  type="file"
                  accept="image/*"
                  onChange={upload}
                  className="hidden"
                />
              </label>
            </div>
          </div>
          <label className="block text-xs font-bold">
            Cor da categoria
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="ml-3 h-8 w-12 align-middle"
            />
          </label>
        </div>
        <footer className="relative flex gap-3 border-t bg-gray-50 px-6 py-4">
          <button
            type="button"
            onClick={close}
            className="flex-1 rounded-xl border py-2.5 text-sm font-bold"
          >
            Cancelar
          </button>
          <button
            disabled={saving}
            className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {saving
              ? "Salvando no banco..."
              : category
                ? "Salvar alteracoes"
                : "Criar categoria"}
          </button>
          {saveError && (
            <p className="absolute -top-5 left-6 text-xs font-bold text-red-600">
              {saveError}
            </p>
          )}
        </footer>
      </form>
    </div>
  );
}
function CostCenterForm({
  editing,
  close,
  save,
}: {
  editing?: CostCenter | null;
  close: () => void;
  save: (name: string, initials: string, color: string) => Promise<void>;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [initials, setInitials] = useState(editing?.initials ?? "");
  const [color, setColor] = useState(editing?.colorKey ?? costCenterColors[0].key);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const isEdit = Boolean(editing);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <form onSubmit={async (event) => {
        event.preventDefault();
        setSaving(true);
        setError("");
        try {
          await save(name.trim().replace(/\s+/g, " "), initials.trim().toLocaleUpperCase("pt-BR"), color);
          close();
        } catch (saveError) {
          setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o centro de custo.");
        } finally {
          setSaving(false);
        }
      }} className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b px-6 py-4">
          <div>
            <h2 className="font-extrabold text-[#14213d]">{isEdit ? "Editar plano de contas" : "Novo plano de contas"}</h2>
            <p className="mt-1 text-xs text-slate-500">{isEdit ? "Ajuste a sigla e a cor deste centro de custo." : "Cria um centro de custo com categorias próprias."}</p>
          </div>
          <button type="button" onClick={close} aria-label="Fechar"><X className="h-5 w-5" /></button>
        </header>
        <div className="space-y-4 p-6">
          <label className="block text-xs font-bold text-slate-700">Nome do centro de custo
            <input required minLength={2} maxLength={80} value={name} disabled={isEdit} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Nova operação" className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal disabled:cursor-not-allowed disabled:text-slate-400" />
            {isEdit && <span className="mt-1 block font-normal text-slate-400">O nome não pode ser alterado.</span>}
          </label>
          <label className="block text-xs font-bold text-slate-700">Sigla (opcional)
            <input maxLength={4} value={initials} onChange={(event) => setInitials(event.target.value)} placeholder="Ex.: NO" className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal" />
          </label>
          <div className="text-xs font-bold text-slate-700">Cor do plano
            <div className="mt-2 flex flex-wrap gap-2">
              {costCenterColors.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setColor(item.key)}
                  aria-label={item.label}
                  aria-pressed={color === item.key}
                  title={item.label}
                  className={`h-8 w-8 rounded-full border-2 transition ${color === item.key ? "border-slate-900 ring-2 ring-slate-300" : "border-white"}`}
                  style={{ backgroundColor: item.swatch }}
                />
              ))}
            </div>
          </div>
          {!isEdit && <p className="text-xs text-slate-500">Depois de criar, use “Nova categoria” para cadastrar as receitas e despesas deste plano.</p>}
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p>}
        </div>
        <footer className="flex gap-3 border-t bg-gray-50 px-6 py-4">
          <button type="button" onClick={close} className="flex-1 rounded-xl border py-2.5 text-sm font-bold">Cancelar</button>
          <button disabled={saving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? "Salvando…" : isEdit ? "Salvar alterações" : "Criar plano"}</button>
        </footer>
      </form>
    </div>
  );
}
function DeleteCostCenter({
  center,
  categoryCount,
  entryCount,
  close,
  confirm,
}: {
  center: CostCenter;
  categoryCount: number;
  entryCount: number;
  close: () => void;
  confirm: () => Promise<void>;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const matches = typed.trim() === center.name;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (!matches) return;
        setBusy(true);
        setError("");
        try {
          await confirm();
          close();
        } catch (deleteError) {
          setError(deleteError instanceof Error ? deleteError.message : "Não foi possível excluir o plano.");
        } finally {
          setBusy(false);
        }
      }} className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b px-6 py-4">
          <div>
            <h2 className="font-extrabold text-red-700">Excluir “{center.name}”</h2>
            <p className="mt-1 text-xs text-slate-500">Esta ação não pode ser desfeita.</p>
          </div>
          <button type="button" onClick={close} aria-label="Fechar"><X className="h-5 w-5" /></button>
        </header>
        <div className="space-y-4 p-6">
          <div className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">
            Ao excluir este plano, também serão apagados <b>permanentemente</b>:
            <ul className="mt-2 list-disc pl-4 font-normal">
              <li>{categoryCount} categoria(s)</li>
              <li>{entryCount} lançamento(s)</li>
              <li>as contas e os favorecidos deste centro</li>
            </ul>
          </div>
          <label className="block text-xs font-bold text-slate-700">Para confirmar, digite o nome do plano: <span className="text-red-600">{center.name}</span>
            <input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={center.name} className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal" />
          </label>
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p>}
        </div>
        <footer className="flex gap-3 border-t bg-gray-50 px-6 py-4">
          <button type="button" onClick={close} className="flex-1 rounded-xl border py-2.5 text-sm font-bold">Cancelar</button>
          <button disabled={!matches || busy} className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? "Excluindo…" : "Excluir tudo"}</button>
        </footer>
      </form>
    </div>
  );
}

function ContactsScreen({
  contacts,
  allowedUnits,
  tableReady,
  save,
  archive,
}: {
  contacts: Counterparty[];
  allowedUnits: typeof units;
  tableReady: boolean;
  save: (contact: Counterparty) => Promise<void>;
  archive: (contact: Counterparty, archived: boolean) => Promise<void>;
}) {
  const [kind, setKind] = useState<Kind>("despesa");
  const [editing, setEditing] = useState<Counterparty | null>(null);
  const [unit, setUnit] = useState<Unit>(allowedUnits[0]?.name ?? "Consultoria");
  const [name, setName] = useState("");
  const [provides, setProvides] = useState("");
  const [saving, setSaving] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<Counterparty | null>(null);
  const [error, setError] = useState("");
  const relevant = contacts.filter(
    (contact) =>
      contact.kind === kind &&
      !contact.archived &&
      allowedUnits.some((allowed) => allowed.name === contact.unit),
  );
  const archivedContacts = contacts.filter(
    (contact) =>
      contact.kind === kind &&
      contact.archived &&
      allowedUnits.some((allowed) => allowed.name === contact.unit),
  );
  const title = kind === "despesa" ? "Fornecedores" : "Clientes / pagadores";
  const reset = () => {
    setEditing(null);
    setName("");
    setProvides("");
    setError("");
  };
  const selectKind = (nextKind: Kind) => {
    setKind(nextKind);
    reset();
    setUnit(allowedUnits[0]?.name ?? "Consultoria");
  };
  const changeArchive = async (contact: Counterparty, archived: boolean) => {
    setArchiveBusy(true);
    setError("");
    try {
      await archive(contact, archived);
      if (editing?.id === contact.id) reset();
      setConfirmArchive(null);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Não foi possível alterar o cadastro.");
      setConfirmArchive(null);
    } finally {
      setArchiveBusy(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!tableReady) return;
    const cleanName = name.trim().replace(/\s+/g, " ");
    if (!cleanName) return setError("Informe um nome.");
    if (kind === "despesa" && !provides.trim())
      return setError("Informe o que este fornecedor fornece.");
    if (
      relevant.some(
        (contact) =>
          contact.id !== editing?.id &&
          contactIdentity(kind, contact.unit, contact.name) ===
            contactIdentity(kind, unit, cleanName),
      )
    )
      return setError("Este nome já está cadastrado neste centro de custo.");
    if (
      archivedContacts.some(
        (contact) =>
          contactIdentity(kind, contact.unit, contact.name) ===
          contactIdentity(kind, unit, cleanName),
      )
    )
      return setError("Este cadastro está arquivado. Restaure-o na lista abaixo.");
    setSaving(true);
    setError("");
    try {
      await save({
        id: editing?.id ?? id(),
        kind,
        unit,
        name: cleanName,
        provides: kind === "despesa" ? provides.trim() : "",
      });
      reset();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-extrabold text-[#14213d]">Cadastro de fornecedores e clientes</h2>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Tipo de cadastro">
        {(["despesa", "receita"] as Kind[]).map((tabKind) => (
          <button key={tabKind} type="button" role="tab" aria-selected={kind === tabKind} onClick={() => selectKind(tabKind)} className={`rounded-xl px-4 py-2 text-sm font-bold ${kind === tabKind ? "bg-blue-700 text-white" : "border bg-white text-slate-600"}`}>
            {tabKind === "despesa" ? "Fornecedores" : "Clientes / pagadores"}
          </button>
        ))}
      </div>
      <div>
        <h3 className="font-extrabold text-[#14213d]">{title}</h3>
        <p className="text-xs text-gray-500">
          {kind === "despesa"
            ? "Cadastre o fornecedor e o que ele fornece para selecioná-lo nas despesas."
            : "Cadastre quem paga para selecioná-lo nas receitas."}
        </p>
      </div>
      {!tableReady && (
        <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          Prévia local: os nomes dos lançamentos antigos aparecem abaixo. Para criar ou alterar cadastros compartilhados, ainda é necessário aplicar a migração ao banco.
        </p>
      )}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
      <form onSubmit={submit} className="grid gap-3 rounded-2xl bg-white p-5 shadow-sm md:grid-cols-[1fr_1fr_auto] md:items-end">
        <label className="text-xs font-bold text-slate-700">
          Nome
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
            placeholder={kind === "despesa" ? "Nome do fornecedor" : "Nome do cliente / pagador"}
            disabled={!tableReady}
          />
        </label>
        <label className="text-xs font-bold text-slate-700">
          Centro de custo
          <select
            value={unit}
            onChange={(event) => setUnit(event.target.value as Unit)}
            className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
            disabled={!tableReady || !!editing}
          >
            {allowedUnits.map((allowed) => <option key={allowed.name}>{allowed.name}</option>)}
          </select>
        </label>
        {kind === "despesa" && (
          <label className="text-xs font-bold text-slate-700 md:col-span-2">
            O que fornece
            <input
              value={provides}
              onChange={(event) => setProvides(event.target.value)}
              className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
              placeholder="Ex.: serviços de limpeza, insumos, consultoria"
              disabled={!tableReady}
            />
          </label>
        )}
        <div className="flex gap-2 md:col-start-3">
          {editing && <button type="button" onClick={reset} className="rounded-xl border px-4 py-3 text-xs font-bold">Cancelar</button>}
          <button type="submit" disabled={!tableReady || saving || !allowedUnits.length} className="rounded-xl bg-blue-700 px-4 py-3 text-xs font-bold text-white disabled:opacity-50">
            {saving ? "Salvando…" : editing ? "Salvar" : "Cadastrar"}
          </button>
        </div>
      </form>
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h3 className="mb-3 font-extrabold text-[#14213d]">Cadastrados ({relevant.length})</h3>
        {relevant.length ? (
          <div className="divide-y">
            {relevant.map((contact) => (
              <div key={contact.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-bold text-slate-800">{contact.name}</p>
                  <p className="text-xs text-gray-500">
                    {contact.unit}
                    {kind === "despesa" && ` · ${contact.provides || "O que fornece não informado"}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {contact.id.startsWith("legacy:") && (
                    <span className="text-[11px] font-medium text-amber-700">Aguardando banco</span>
                  )}
                  <button type="button" disabled={!tableReady || contact.id.startsWith("legacy:")} title={!tableReady || contact.id.startsWith("legacy:") ? "Disponível após aplicar a migração do banco" : undefined} onClick={() => {
                    setEditing(contact);
                    setUnit(contact.unit);
                    setName(contact.name);
                    setProvides(contact.provides);
                    setError("");
                  }} className="rounded-lg border px-3 py-1.5 text-xs font-bold text-blue-700 disabled:cursor-not-allowed disabled:opacity-40">
                    Editar
                  </button>
                  <button type="button" disabled={!tableReady || contact.id.startsWith("legacy:")} title={!tableReady || contact.id.startsWith("legacy:") ? "Disponível após aplicar a migração do banco" : undefined} onClick={() => {
                    setConfirmArchive(contact);
                    setError("");
                  }} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 disabled:cursor-not-allowed disabled:opacity-40">
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-5 text-center text-sm text-gray-400">Nenhum nome informado nos lançamentos deste acesso.</p>
        )}
      </section>
      {archivedContacts.length > 0 && (
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h3 className="mb-3 font-extrabold text-[#14213d]">Arquivados ({archivedContacts.length})</h3>
          <div className="divide-y">
            {archivedContacts.map((contact) => (
              <div key={contact.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-bold text-slate-600">{contact.name}</p>
                  <p className="text-xs text-gray-400">{contact.unit}</p>
                </div>
                <button type="button" disabled={archiveBusy} onClick={() => void changeArchive(contact, false)} className="rounded-lg border px-3 py-1.5 text-xs font-bold text-blue-700 disabled:opacity-50">
                  Restaurar
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {confirmArchive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="presentation" onClick={() => setConfirmArchive(null)}>
          <section role="dialog" aria-modal="true" aria-labelledby="archive-contact-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(event) => event.stopPropagation()}>
            <h3 id="archive-contact-title" className="text-lg font-extrabold text-[#14213d]">Excluir {confirmArchive.name}?</h3>
            <p className="mt-2 text-sm text-gray-600">O cadastro será arquivado e sairá das opções de novos lançamentos. Os lançamentos antigos e seus valores serão preservados.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirmArchive(null)} className="rounded-xl border px-4 py-2 text-xs font-bold">Cancelar</button>
              <button type="button" disabled={archiveBusy} onClick={() => void changeArchive(confirmArchive, true)} className="rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{archiveBusy ? "Arquivando…" : "Excluir cadastro"}</button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function EntryForm({
  kind: initial,
  categories,
  contacts,
  contactsTableReady,
  allowedUnits,
  editing,
  scope: initialScope,
  close,
  save,
}: {
  kind: Kind;
  categories: Category[];
  contacts: Counterparty[];
  contactsTableReady: boolean;
  allowedUnits: typeof units;
  editing: Entry | null;
  scope?: "one" | "series";
  close: () => void;
  save: (
    x: Omit<Entry, "id">,
    scope: "one" | "series",
    sameMonthParts?: SameMonthPart[],
  ) => Promise<void>;
}) {
  const [kind, setKind] = useState<Kind>(editing?.kind ?? initial),
    [unit, setUnit] = useState<Unit>(editing?.unit ?? allowedUnits[0]?.name ?? "Consultoria"),
    [category, setCategory] = useState(editing?.category ?? ""),
    [description, setDescription] = useState(editing?.description ?? ""),
    [beneficiary, setBeneficiary] = useState(editing?.beneficiary ?? ""),
    [contactPickerOpen, setContactPickerOpen] = useState(false),
    [contactSearch, setContactSearch] = useState(""),
    [contactActiveIndex, setContactActiveIndex] = useState(-1),
    [counterpartyId, setCounterpartyId] = useState<string>(
      editing?.counterpartyId ??
        (editing
          ? contacts.find(
              (contact) =>
                contact.kind === editing.kind &&
                contact.unit === editing.unit &&
                counterpartyKey(contact.kind, contact.name) ===
                  counterpartyKey(editing.kind, editing.beneficiary || ""),
            )?.id
          : undefined) ??
        "",
    ),
    [pix, setPix] = useState(editing?.pix ?? ""),
    [notes, setNotes] = useState(editing?.notes ?? ""),
    [juros, setJuros] = useState(editing?.juros ? String(editing.juros) : ""),
    [paidDate, setPaidDate] = useState(editing?.paidDate ?? ""),
    [amount, setAmount] = useState(editing ? String(editing.amount) : ""),
    [date, setDate] = useState(
      editing?.date ?? new Date().toISOString().slice(0, 10),
    ),
    [status, setStatus] = useState<Entry["status"]>(
      editing?.status ?? "previsto",
    ),
    [recurrence, setRecurrence] = useState(editing?.recurrence === "mensal"),
    [installments, setInstallments] = useState(editing?.installments ?? 1),
    [sameMonthInstallments, setSameMonthInstallments] = useState(false),
    [sameMonthPartCount, setSameMonthPartCount] = useState(2),
    [sameMonthPartsState, setSameMonthPartsState] = useState<SameMonthPart[]>(
      [],
    ),
    [scope, setScope] = useState<"one" | "series">(initialScope ?? "one"),
    [existingAttachments, setExistingAttachments] = useState<string[]>(editing?.attachments ?? []),
    [newFiles, setNewFiles] = useState<File[]>([]),
    [removedAttachments, setRemovedAttachments] = useState<string[]>([]),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState("");
  const attachmentName = (path: string) => {
    const base = path.split("/").pop() || path;
    return base.replace(/^\d+-/, "");
  };
  const openAttachment = async (path: string) => {
    try {
      const url = await signedAttachmentUrl(path);
      window.open(url, "_blank", "noopener");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Não foi possível abrir o arquivo.");
    }
  };
  const available = categories.filter(
    (c) => c.unit === unit && c.kind === kind,
  );
  const selectableContacts = contacts.filter(
    (contact) =>
      contact.kind === kind &&
      allowedUnits.some((allowed) => allowed.name === contact.unit) &&
      !contact.archived,
  );
  const matchingContacts = selectableContacts
    .filter((contact) =>
      `${contact.name} ${contact.unit}`
        .toLocaleLowerCase("pt-BR")
        .includes(contactSearch.trim().toLocaleLowerCase("pt-BR")),
    )
    .sort((a, b) =>
      Number(b.unit === unit) - Number(a.unit === unit) ||
      a.name.localeCompare(b.name, "pt-BR"),
    );
  const chooseContact = (contact: Counterparty) => {
    setUnit(contact.unit);
    setBeneficiary(contact.name);
    setCounterpartyId(contact.id);
    setContactPickerOpen(false);
    setContactSearch("");
    setContactActiveIndex(-1);
  };
  useEffect(() => {
    if (!available.some((c) => c.name === category))
      setCategory(available[0]?.name ?? "");
  }, [kind, unit, categories]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = parseMoney(amount);
    const contactName = beneficiary.trim().replace(/\s+/g, " ");
    if (!description.trim()) {
      setSaveError("Informe uma descrição para o lançamento.");
      return;
    }
    if (!Number.isFinite(v) || v <= 0) {
      setSaveError("Informe um valor válido, por exemplo 1.500,00.");
      return;
    }
    if (!category) {
      setSaveError("Selecione uma categoria antes de salvar.");
      return;
    }
    if (
      contactName &&
      contacts.some(
        (contact) =>
          contact.archived &&
          contact.id !== editing?.counterpartyId &&
          contact.unit === unit &&
          contact.kind === kind &&
          counterpartyKey(kind, contact.name) === counterpartyKey(kind, contactName),
      )
    ) {
      setSaveError("Este contato está arquivado. Restaure-o na aba Fornecedores e clientes antes de usar.");
      return;
    }
    if (sameMonthInstallments) {
      const partsTotal = sameMonthPartsState.reduce(
        (sum, part) => sum + parseMoney(part.amount),
        0,
      );
      const validDates = sameMonthPartsState.every(
        (part) =>
          part.date &&
          part.date.slice(0, 7) === date.slice(0, 7) &&
          Number.isFinite(parseMoney(part.amount)) &&
          parseMoney(part.amount) > 0,
      );
      if (!validDates) {
        setSaveError(
          "Informe uma data e um valor válido para cada parcela deste mês.",
        );
        return;
      }
      if (Math.round(partsTotal * 100) !== Math.round(v * 100)) {
        setSaveError("A soma das parcelas precisa ser igual ao valor total.");
        return;
      }
    }
    setSaving(true);
    setSaveError("");
    try {
      const folder = editing?.id ?? (crypto.randomUUID?.() ?? `${Date.now()}`);
      const uploaded: string[] = [];
      for (const file of newFiles) {
        // A chave do Storage precisa ser ASCII: remove acentos e troca
        // qualquer caractere fora de [A-Za-z0-9._-] por "_".
        const safe = file.name
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/[^\w.\-]+/g, "_");
        const path = `${folder}/${Date.now()}-${safe}`;
        await uploadEntryAttachment(path, file);
        uploaded.push(path);
      }
      const attachments = [...existingAttachments, ...uploaded];
      await save(
        {
          kind,
          unit,
          // Every centre has its own financial account. Keeping this derived
          // prevents the duplicated centre/account selectors from diverging.
          account: unit,
          category,
          description,
          beneficiary: contactName,
          counterpartyId: contactsTableReady
            ? counterpartyId && !counterpartyId.startsWith("legacy:")
              ? counterpartyId
              : null
            : undefined,
          pix: kind === "despesa" ? pix : "",
          notes,
          amount: v,
          date,
          status,
          recurrence: recurrence ? "mensal" : "nenhuma",
          installments: sameMonthInstallments ? 1 : installments,
          attachments,
          juros: kind === "despesa" ? parseMoney(juros) || 0 : 0,
          paidDate: kind === "despesa" ? paidDate || undefined : undefined,
        },
        scope,
        sameMonthInstallments ? sameMonthPartsState : undefined,
      );
      if (removedAttachments.length) {
        try {
          await removeEntryAttachments(removedAttachments);
        } catch (cleanupError) {
          console.error("Fincore: falha ao remover arquivos antigos", cleanupError);
        }
      }
      close();
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar no banco.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <form
        onSubmit={submit}
        className="max-h-[94vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="font-extrabold text-[#14213d]">
              {editing ? "Editar" : "Novo"} lançamento
            </h2>
            <p className="text-xs text-gray-400">
              A categoria é filtrada pelo plano de contas do centro escolhido.
            </p>
          </div>
          <button type="button" onClick={close}>
            <X />
          </button>
        </header>
        <div className="space-y-5 p-6">
          <div className="grid grid-cols-2 overflow-hidden rounded-xl border text-sm font-bold">
            <button
              type="button"
              onClick={() => {
                setKind("despesa");
                setCounterpartyId("");
                setBeneficiary("");
              }}
              className={`p-3 ${kind === "despesa" ? "bg-red-600 text-white" : "text-gray-500"}`}
            >
              Despesa
            </button>
            <button
              type="button"
              onClick={() => {
                setKind("receita");
                setCounterpartyId("");
                setBeneficiary("");
              }}
              className={`p-3 ${kind === "receita" ? "bg-emerald-600 text-white" : "text-gray-500"}`}
            >
              Receita
            </button>
          </div>
          <div className="max-w-sm">
            <label className="text-xs font-bold">
              Centro de custo
              <select
                value={unit}
                onChange={(e) => {
                  setUnit(e.target.value as Unit);
                  setCounterpartyId("");
                  setBeneficiary("");
                }}
                className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
              >
                {allowedUnits.map((u) => (
                  <option key={u.name}>{u.name}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-xs font-bold">
            Categoria
            <select
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
            >
              <option value="" disabled>
                Selecione uma categoria
              </option>
              {available.map((c) => (
                <option key={c.id}>{c.name}</option>
              ))}
            </select>
            {!available.length && (
              <span className="mt-1 block text-red-600">
                Cadastre uma categoria para este centro no Plano de contas.
              </span>
            )}
          </label>
          <label className="block text-xs font-bold">
            Descrição
            <input
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
            />
          </label>
          <div
            className={`grid gap-4 ${kind === "despesa" ? "sm:grid-cols-2" : "max-w-sm"}`}
          >
            <div className="relative text-xs font-bold" onBlur={(event) => {
              if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))) {
                setContactPickerOpen(false);
                setContactActiveIndex(-1);
              }
            }}>
              <label htmlFor="entry-counterparty">
                {kind === "despesa"
                  ? "Fornecedor / favorecido (opcional)"
                  : "Cliente / pagador (opcional)"}
              </label>
              <div className="relative mt-1.5">
                <input
                  id="entry-counterparty"
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={contactPickerOpen}
                  aria-controls="entry-counterparty-options"
                  value={beneficiary}
                  onFocus={() => {
                    setContactSearch("");
                    setContactPickerOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setContactPickerOpen(false);
                      setContactActiveIndex(-1);
                    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      event.preventDefault();
                      setContactPickerOpen(true);
                      setContactActiveIndex((index) =>
                        event.key === "ArrowDown"
                          ? Math.min(index + 1, matchingContacts.length - 1)
                          : Math.max(index - 1, 0),
                      );
                    } else if (event.key === "Enter" && contactPickerOpen && contactActiveIndex >= 0 && matchingContacts[contactActiveIndex]) {
                      event.preventDefault();
                      chooseContact(matchingContacts[contactActiveIndex]);
                    }
                  }}
                  onChange={(event) => {
                    const value = event.target.value;
                    const match = selectableContacts.find(
                      (contact) =>
                        contact.unit === unit &&
                        counterpartyKey(kind, contact.name) === counterpartyKey(kind, value),
                    );
                    setBeneficiary(value);
                    setCounterpartyId(match?.id ?? "");
                    setContactSearch(value);
                    setContactActiveIndex(-1);
                    setContactPickerOpen(true);
                  }}
                  placeholder={kind === "despesa" ? "Selecione ou digite o fornecedor" : "Selecione ou digite o cliente"}
                  className="w-full rounded-xl border bg-gray-50 p-3 pr-10 text-sm font-normal focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                />
                <button type="button" aria-label="Mostrar contatos cadastrados" aria-expanded={contactPickerOpen} onClick={() => {
                  setContactSearch("");
                  setContactActiveIndex(-1);
                  setContactPickerOpen((open) => !open);
                }} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500">
                  <ChevronRight className={`h-4 w-4 transition-transform ${contactPickerOpen ? "rotate-90" : "rotate-0"}`} />
                </button>
              {contactPickerOpen && (
                <div id="entry-counterparty-options" role="listbox" className="absolute left-0 right-0 top-full z-[60] mt-1 max-h-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 text-left shadow-xl">
                  {matchingContacts.length ? matchingContacts.map((contact, index) => (
                    <button key={contact.id} type="button" role="option" aria-selected={contactActiveIndex === index} onClick={() => chooseContact(contact)} className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold ${contactActiveIndex === index ? "bg-blue-50 text-blue-800" : "text-slate-800 hover:bg-slate-50"}`}>
                      <span className="truncate">{contact.name}</span>
                      <span className="shrink-0 text-[11px] font-normal text-slate-500">{contact.unit}</span>
                    </button>
                  )) : (
                    <p className="px-3 py-2.5 text-xs font-normal text-slate-500">{beneficiary.trim() ? "Nome novo: salve o lançamento para cadastrá-lo." : "Nenhum contato cadastrado."}</p>
                  )}
                </div>
              )}
              </div>
              <span className="mt-1 block text-[11px] font-normal text-gray-500">
                Escolha um contato de qualquer centro permitido ou digite um nome novo. Ao escolher outro centro, o lançamento muda para ele.
              </span>
            </div>
            {kind === "despesa" && (
              <label className="text-xs font-bold">
                Chave PIX ou dados de pagamento
                <input
                  value={pix}
                  onChange={(e) => setPix(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
                />
              </label>
            )}
          </div>
          <label className="block text-xs font-bold">
            Observacoes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
            />
          </label>
          <div className="block text-xs font-bold">
            Anexos (boleto, comprovante, nota)
            <div className="mt-1.5 space-y-2">
              {existingAttachments.map((path) => (
                <div key={path} className="flex items-center gap-2 rounded-xl border bg-gray-50 p-2 text-xs font-normal">
                  <Paperclip className="h-4 w-4 shrink-0 text-slate-500" />
                  <button type="button" onClick={() => void openAttachment(path)} className="flex-1 truncate text-left text-blue-700 hover:underline">
                    {attachmentName(path)}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExistingAttachments((old) => old.filter((item) => item !== path));
                      setRemovedAttachments((old) => [...old, path]);
                    }}
                    className="rounded px-1.5 py-0.5 font-bold text-red-600 hover:bg-red-50"
                    aria-label={`Remover ${attachmentName(path)}`}
                  >
                    Remover
                  </button>
                </div>
              ))}
              {newFiles.map((file, index) => (
                <div key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2 text-xs font-normal">
                  <Paperclip className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span className="flex-1 truncate">{file.name} <span className="text-emerald-700">(novo)</span></span>
                  <button
                    type="button"
                    onClick={() => setNewFiles((old) => old.filter((_, i) => i !== index))}
                    className="rounded px-1.5 py-0.5 font-bold text-red-600 hover:bg-red-50"
                    aria-label={`Remover ${file.name}`}
                  >
                    Remover
                  </button>
                </div>
              ))}
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white p-3 text-xs font-bold text-slate-600 hover:border-blue-300 hover:text-blue-700">
                <Plus className="h-4 w-4" />
                Anexar arquivo (PDF, PNG ou JPG)
                <input
                  type="file"
                  accept="image/png,image/jpeg,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const picked = Array.from(event.target.files ?? []);
                    const tooBig = picked.find((file) => file.size > 10 * 1024 * 1024);
                    if (tooBig) {
                      setSaveError(`O arquivo "${tooBig.name}" passa de 10 MB. Reduza o tamanho e tente novamente.`);
                    } else {
                      setNewFiles((old) => [...old, ...picked]);
                      setSaveError("");
                    }
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-xs font-bold">
              Valor
              <CurrencyInput value={amount} onChange={setAmount} />
            </label>
            <label className="text-xs font-bold">
              Data
              <input
                required
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
              />
            </label>
            <label className="text-xs font-bold">
              Situação
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Entry["status"])}
                className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
              >
                <option value="previsto">Previsto</option>
                <option value="realizado">Realizado</option>
              </select>
            </label>
          </div>
          {kind === "despesa" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-xs font-bold">
                Juros pagos (R$)
                <CurrencyInput value={juros} onChange={setJuros} required={false} />
                <span className="mt-1 block font-normal text-slate-400">Opcional. Soma ao total pago.</span>
              </label>
              <label className="text-xs font-bold">
                Data do pagamento
                <input
                  type="date"
                  value={paidDate}
                  onChange={(e) => setPaidDate(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
                />
                <span className="mt-1 block font-normal text-slate-400">Mede o atraso em relação ao vencimento (campo Data).</span>
              </label>
            </div>
          )}
          <div className="grid gap-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4 sm:grid-cols-2">
            <label className="flex items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                checked={recurrence}
                onChange={(e) => {
                  setRecurrence(e.target.checked);
                  if (e.target.checked) setInstallments(1);
                }}
              />
              <Repeat2 className="h-4 w-4 text-blue-600" />
              Recorrente mensal
            </label>
            {!recurrence && !sameMonthInstallments && (
              <label className="flex items-center gap-2 text-sm font-bold">
                <CalendarClock className="h-4 w-4 text-blue-600" />
                Parcelar em meses
                <input
                  min="1"
                  max="120"
                  type="number"
                  value={installments}
                  onChange={(e) =>
                    setInstallments(Math.max(1, Number(e.target.value) || 1))
                  }
                  className="w-16 rounded-lg border bg-white p-1.5 text-center font-normal"
                />
              </label>
            )}
            {editing?.seriesId && (
              <label className="col-span-full flex gap-3 text-xs font-bold text-blue-800">
                Alterar:{" "}
                <span>
                  <input
                    type="radio"
                    checked={scope === "one"}
                    onChange={() => setScope("one")}
                  />{" "}
                  Este mês
                </span>
                <span>
                  <input
                    type="radio"
                    checked={scope === "series"}
                    onChange={() => setScope("series")}
                  />{" "}
                  Toda a série
                </span>
              </label>
            )}
            {!editing && (
              <div className="col-span-full border-t border-blue-100 pt-3">
                <label className="flex items-center gap-2 text-sm font-bold">
                  <input
                    type="checkbox"
                    checked={sameMonthInstallments}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      setSameMonthInstallments(enabled);
                      if (enabled) {
                        setInstallments(1);
                        setSameMonthPartsState(
                          sameMonthParts(
                            sameMonthPartCount,
                            parseMoney(amount) || 0,
                            date,
                          ),
                        );
                      }
                    }}
                  />
                  Dividir dentro de cada mês
                </label>
                <p className="mt-1 text-xs text-blue-700">
                  Ideal para adiantamento e saldo de salário, ou pagamentos em
                  2x e 3x no mesmo mês.
                </p>
              </div>
            )}
            {sameMonthInstallments && !editing && (
              <div className="col-span-full space-y-3 rounded-xl bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    Quantidade de parcelas
                    <input
                      min="2"
                      max="12"
                      type="number"
                      value={sameMonthPartCount}
                      onChange={(e) => {
                        const count = Math.max(
                          2,
                          Math.min(12, Number(e.target.value) || 2),
                        );
                        setSameMonthPartCount(count);
                        setSameMonthPartsState(
                          sameMonthParts(count, parseMoney(amount) || 0, date),
                        );
                      }}
                      className="w-16 rounded-lg border bg-gray-50 p-1.5 text-center font-normal"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setSameMonthPartsState(
                        sameMonthParts(
                          sameMonthPartCount,
                          parseMoney(amount) || 0,
                          date,
                        ),
                      )
                    }
                    className="text-xs font-bold text-blue-700 hover:text-blue-900"
                  >
                    Dividir valor igualmente
                  </button>
                </div>
                {sameMonthPartsState.map((part, index) => (
                  <div
                    key={index}
                    className="grid gap-2 sm:grid-cols-[auto_1fr_1fr] sm:items-end"
                  >
                    <span className="pb-3 text-xs font-extrabold text-blue-700">
                      {index + 1}ª parcela
                    </span>
                    <label className="text-[11px] font-bold text-gray-500">
                      Data
                      <input
                        type="date"
                        value={part.date}
                        onChange={(e) =>
                          setSameMonthPartsState((old) =>
                            old.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, date: e.target.value }
                                : item,
                            ),
                          )
                        }
                        className="mt-1 block w-full rounded-lg border bg-gray-50 p-2 text-sm font-normal"
                      />
                    </label>
                    <label className="text-[11px] font-bold text-gray-500">
                      Valor
                      <CurrencyInput
                        value={part.amount}
                        onChange={(value) =>
                          setSameMonthPartsState((old) =>
                            old.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, amount: value }
                                : item,
                            ),
                          )
                        }
                        className="mt-1 block rounded-lg p-2"
                      />
                    </label>
                  </div>
                ))}
                <p className="text-xs font-bold text-blue-800">
                  Total das parcelas:{" "}
                  {fmt(
                    sameMonthPartsState.reduce(
                      (sum, part) => sum + (parseMoney(part.amount) || 0),
                      0,
                    ),
                  )}{" "}
                  · Total do lançamento: {fmt(parseMoney(amount) || 0)}
                </p>
              </div>
            )}
            {recurrence && !sameMonthInstallments && (
              <p className="col-span-full text-xs text-blue-700">
                O valor será repetido mensalmente, sem divisão.
              </p>
            )}
            {recurrence && sameMonthInstallments && (
              <p className="col-span-full text-xs text-blue-700">
                Cada parcela será repetida todos os meses, nas datas e valores
                definidos acima.
              </p>
            )}
            {!recurrence && installments > 1 && (
              <p className="col-span-full text-xs text-blue-700">
                Lançamento com fim: {installments} parcelas mensais de{" "}
                {fmt((parseMoney(amount) || 0) / installments)}.
              </p>
            )}
          </div>
        </div>
        <footer className="relative flex gap-3 border-t bg-gray-50 px-6 py-4">
          <button
            type="button"
            onClick={close}
            className="flex-1 rounded-xl border py-2.5 text-sm font-bold"
          >
            Cancelar
          </button>
          <button
            disabled={saving}
            className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {saving ? "Salvando no banco..." : "Salvar"}
          </button>
          {saveError && (
            <p className="absolute -top-5 left-6 text-xs font-bold text-red-600">
              {saveError}
            </p>
          )}
        </footer>
      </form>
    </div>
  );
}
function UsersAdmin({
  users,
  centers,
  reload,
  createUser,
  resetPassword,
  toggleReports,
  updatePermissions,
}: {
  users: User[];
  centers: CostCenter[];
  reload: () => Promise<void>;
  createUser: (data: {
    name: string;
    email: string;
    password: string;
    units: Unit[];
    canViewReports: boolean;
  }) => Promise<void>;
  resetPassword: (user: User) => Promise<void>;
  toggleReports: (user: User) => Promise<void>;
  updatePermissions: (
    user: User,
    units: Unit[],
    canViewReports: boolean,
    hiddenScreens: string[],
    canViewTeamNotes: boolean,
  ) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedUnits, setSelectedUnits] = useState<Unit[]>([]);
  const [canViewReports, setCanViewReports] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUnits, setEditUnits] = useState<Unit[]>([]);
  const [editCanViewReports, setEditCanViewReports] = useState(false);
  const [editHiddenScreens, setEditHiddenScreens] = useState<string[]>([]);
  const [editCanViewTeamNotes, setEditCanViewTeamNotes] = useState(false);
  const [savingPermissions, setSavingPermissions] = useState(false);
  const toggleUnit = (unit: Unit) =>
    setSelectedUnits((current) =>
      current.includes(unit)
        ? current.filter((item) => item !== unit)
        : [...current, unit],
    );
  const recover = async (user: User) => {
    setError("");
    setMessage("");
    try {
      await resetPassword(user);
      setMessage(`Senha de ${user.name} redefinida com sucesso.`);
    } catch (recoverError) {
      setError(
        recoverError instanceof Error
          ? recoverError.message
          : "Não foi possível enviar o link de redefinição.",
      );
    }
  };
  const startEditingPermissions = (user: User) => {
    setError("");
    setMessage("");
    setEditingUserId(user.id);
    setEditUnits(user.units);
    setEditCanViewReports(user.canViewReports);
    setEditHiddenScreens(user.hiddenScreens ?? []);
    setEditCanViewTeamNotes(user.canViewTeamNotes);
  };
  const toggleEditUnit = (unit: Unit) =>
    setEditUnits((current) =>
      current.includes(unit)
        ? current.filter((item) => item !== unit)
        : [...current, unit],
    );
  // Guardamos as abas OCULTAS; o check na tela marca as abas liberadas.
  const toggleEditScreen = (screenId: string) =>
    setEditHiddenScreens((current) =>
      current.includes(screenId)
        ? current.filter((item) => item !== screenId)
        : [...current, screenId],
    );
  const savePermissions = async (user: User) => {
    setSavingPermissions(true);
    setError("");
    try {
      await updatePermissions(user, editUnits, editCanViewReports, editHiddenScreens, editCanViewTeamNotes);
      setEditingUserId(null);
      setMessage(`Permissões de ${user.name} atualizadas.`);
    } catch (permissionError) {
      setError(
        permissionError instanceof Error
          ? permissionError.message
          : "Não foi possível atualizar as permissões.",
      );
    } finally {
      setSavingPermissions(false);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await createUser({
        name,
        email,
        password,
        units: selectedUnits,
        canViewReports,
      });
    } catch (createError) {
      setError(
        createError instanceof Error
          ? createError.message
          : "Não foi possível criar o usuário.",
      );
      setBusy(false);
      return;
    }
    setName("");
    setEmail("");
    setPassword("");
    setSelectedUnits([]);
    setCanViewReports(false);
    setMessage(
      "Usuário criado. Ele já pode acessar somente os centros definidos.",
    );
    await reload();
    setBusy(false);
  };
  return (
    <section className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]">
      <form onSubmit={submit} className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="mb-5">
          <h2 className="font-extrabold text-slate-900">Novo usuário</h2>
          <p className="text-xs text-gray-400">
            Crie um acesso e determine os centros de custo visíveis.
          </p>
        </div>
        <div className="space-y-4">
          <label className="block text-xs font-bold text-gray-600">
            Nome
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
              placeholder="Ex.: Bete Silva"
            />
          </label>
          <label className="block text-xs font-bold text-gray-600">
            E-mail
            <input
              required
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
              placeholder="nome@empresa.com"
            />
          </label>
          <label className="block text-xs font-bold text-gray-600">
            Senha inicial
            <input
              required
              minLength={6}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
              placeholder="Mínimo de 6 caracteres"
            />
          </label>
          <fieldset>
            <legend className="text-xs font-bold text-gray-600">
              Centros de custo permitidos
            </legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {centers.map((unit) => (
                <label
                  key={unit.name}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-xs font-bold ${selectedUnits.includes(unit.name) ? "border-blue-300 bg-blue-50 text-blue-800" : "bg-white text-gray-600"}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedUnits.includes(unit.name)}
                    onChange={() => toggleUnit(unit.name)}
                  />
                  {unit.name}
                </label>
              ))}
            </div>
          </fieldset>
          <label
            className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-xs font-bold ${canViewReports ? "border-violet-300 bg-violet-50 text-violet-800" : "bg-white text-gray-600"}`}
          >
            <input
              type="checkbox"
              checked={canViewReports}
              onChange={(event) => setCanViewReports(event.target.checked)}
            />
            Permitir acesso à aba Relatórios
          </label>
          {error && (
            <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">
              {error}
            </p>
          )}
          {message && (
            <p className="rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-700">
              {message}
            </p>
          )}
          <button
            disabled={busy}
            className="w-full rounded-xl bg-blue-700 py-3 text-sm font-bold text-white disabled:opacity-60"
          >
            {busy ? "Criando..." : "Criar acesso"}
          </button>
        </div>
      </form>
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="mb-5">
          <h2 className="font-extrabold text-slate-900">Usuários ativos</h2>
          <p className="text-xs text-gray-400">
            O Master enxerga tudo; operadores enxergam apenas os centros
            liberados.
          </p>
        </div>
        <div className="grid gap-3">
          {users.map((user) => (
            <div
              key={user.id}
              className="rounded-xl border p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-slate-900">{user.name}</p>
                  <p className="text-xs text-gray-400">
                    {user.email || "E-mail não informado"} ·{" "}
                    {user.role === "master" ? "Master" : "Operador"}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {user.role === "master" ? (
                    <span className="rounded-full bg-blue-700 px-2 py-1 text-xs font-bold text-white">
                      Todos os centros
                    </span>
                  ) : (
                    <>
                      {user.units.map((unit) => (
                        <span
                          key={unit}
                          className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700"
                        >
                          {unit}
                        </span>
                      ))}
                      {user.canViewReports && (
                        <span className="rounded-full bg-violet-50 px-2 py-1 text-xs font-bold text-violet-700">
                          Relatórios
                        </span>
                      )}
                      {user.canViewTeamNotes && (
                        <span className="rounded-full bg-teal-50 px-2 py-1 text-xs font-bold text-teal-700">
                          Notas da equipe
                        </span>
                      )}
                      <button
                        onClick={() => startEditingPermissions(user)}
                        className="rounded-lg border border-blue-200 px-2.5 py-1.5 text-xs font-bold text-blue-700"
                      >
                        Editar permissões
                      </button>
                      <button
                        onClick={() => void toggleReports(user)}
                        className="rounded-lg border border-violet-200 px-2.5 py-1.5 text-xs font-bold text-violet-700"
                      >
                        {user.canViewReports
                          ? "Remover relatórios"
                          : "Autorizar relatórios"}
                      </button>
                      <button
                        onClick={() => void recover(user)}
                        className="rounded-lg border border-amber-200 px-2.5 py-1.5 text-xs font-bold text-amber-700"
                      >
                        Redefinir senha
                      </button>
                    </>
                  )}
                </div>
              </div>
              {user.role !== "master" && editingUserId === user.id && (
                <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                  <p className="text-xs font-extrabold text-slate-800">
                    Centros de custo que {user.name} pode visualizar e movimentar
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {centers.map((unit) => (
                      <label
                        key={unit.name}
                        className="flex cursor-pointer items-center gap-2 rounded-lg border bg-white p-2 text-xs font-bold text-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={editUnits.includes(unit.name)}
                          onChange={() => toggleEditUnit(unit.name)}
                        />
                        {unit.name}
                      </label>
                    ))}
                  </div>
                  <p className="mt-4 text-xs font-extrabold text-slate-800">
                    Abas que {user.name} pode usar
                  </p>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {toggleableScreens
                      .filter((screen) => screen.id !== "relatorios")
                      .map((screen) => (
                        <label
                          key={screen.id}
                          className="flex cursor-pointer items-center gap-2 rounded-lg border bg-white p-2 text-xs font-bold text-slate-700"
                        >
                          <input
                            type="checkbox"
                            checked={!editHiddenScreens.includes(screen.id)}
                            onChange={() => toggleEditScreen(screen.id)}
                          />
                          {screen.label}
                        </label>
                      ))}
                  </div>
                  <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs font-bold text-violet-800">
                    <input
                      type="checkbox"
                      checked={editCanViewReports}
                      onChange={(event) =>
                        setEditCanViewReports(event.target.checked)
                      }
                    />
                    Permitir acesso à aba Relatórios
                  </label>
                  <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs font-bold text-teal-800">
                    <input
                      type="checkbox"
                      checked={editCanViewTeamNotes}
                      onChange={(event) =>
                        setEditCanViewTeamNotes(event.target.checked)
                      }
                    />
                    Permitir acesso à aba Notas da equipe
                  </label>
                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      onClick={() => setEditingUserId(null)}
                      className="rounded-lg border bg-white px-3 py-2 text-xs font-bold text-slate-600"
                    >
                      Cancelar
                    </button>
                    <button
                      disabled={savingPermissions || !editUnits.length}
                      onClick={() => void savePermissions(user)}
                      className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                    >
                      {savingPermissions ? "Salvando..." : "Salvar permissões"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {!users.length && (
            <p className="py-8 text-center text-sm text-gray-400">
              Carregando usuários…
            </p>
          )}
        </div>
      </section>
    </section>
  );
}

function Entries({
  entries,
  categories,
  settle,
  edit,
  remove,
}: {
  entries: Entry[];
  categories: Category[];
  settle: (x: Entry) => void;
  edit: (x: Entry) => void;
  remove: (x: Entry) => void;
}) {
  const attachmentLabel = (path: string) =>
    (path.split("/").pop() || path).replace(/^\d+-/, "");
  const openAttachment = async (path: string) => {
    try {
      const url = await signedAttachmentUrl(path);
      window.open(url, "_blank", "noopener");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Não foi possível abrir o arquivo.");
    }
  };
  if (!entries.length)
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-gray-400">
        Nenhum lançamento neste mês.
      </div>
    );
  return (
    <div className="divide-y">
      {[...entries]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((x) => {
          const c = categories.find(
            (v) =>
              v.name === x.category && v.unit === x.unit && v.kind === x.kind,
          );
          return (
            <div key={x.id} className="flex flex-wrap items-center gap-3 py-3">
              <Icon category={c} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-gray-800">
                  {x.description}{" "}
                  {x.installment && (
                    <span className="text-gray-400">({x.installment})</span>
                  )}
                </p>
                <p className="text-[11px] text-gray-400">
                  {x.unit} · {x.category} · {x.account} ·{" "}
                  {new Date(`${x.date}T12:00:00`).toLocaleDateString("pt-BR")}
                </p>
                {x.beneficiary?.trim() && (
                  <p className="mt-1 text-xs font-medium text-slate-600">
                    {x.kind === "despesa" ? "Fornecedor / favorecido" : "Cliente / pagador"}: {x.beneficiary.trim()}
                  </p>
                )}
                {(x.pix || x.notes) && (
                  <div className="mt-1 space-y-0.5 text-xs">
                    {x.pix && (
                      <p className="truncate font-bold text-blue-700">
                        Chave PIX: {x.pix}
                      </p>
                    )}
                    {x.notes && (
                      <p className="truncate text-gray-500">
                        Observações: {x.notes}
                      </p>
                    )}
                  </div>
                )}
                {x.attachments && x.attachments.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {x.attachments.map((path) => (
                      <button
                        key={path}
                        type="button"
                        onClick={() => void openAttachment(path)}
                        className="inline-flex max-w-[180px] items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700 hover:bg-blue-100"
                        title={attachmentLabel(path)}
                      >
                        <Paperclip className="h-3 w-3 shrink-0" />
                        <span className="truncate">{attachmentLabel(path)}</span>
                      </button>
                    ))}
                  </div>
                )}
                {x.kind === "despesa" && ((x.juros ?? 0) > 0 || x.paidDate) && (
                  <div className="mt-1 space-y-0.5 text-[11px]">
                    {(x.juros ?? 0) > 0 && (
                      <p className="text-slate-500">
                        Valor {fmt(x.amount)} · Juros <b className="text-red-600">{fmt(x.juros ?? 0)}</b> · Total <b className="text-slate-700">{fmt(entryValue(x))}</b>
                      </p>
                    )}
                    {x.paidDate && (
                      <p className="text-slate-500">
                        Pago em {new Date(`${x.paidDate}T12:00:00`).toLocaleDateString("pt-BR")}
                        {lateDays(x) > 0 ? (
                          <> · <b className="text-orange-600">{lateDays(x)} dia(s) de atraso</b></>
                        ) : (
                          " · em dia"
                        )}
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div className="text-right">
                <p
                  className={`text-sm font-extrabold ${x.kind === "receita" ? "text-emerald-600" : "text-red-600"}`}
                >
                  {x.kind === "receita" ? "+" : "-"}
                  {fmt(entryValue(x))}
                </p>
                <p className="text-[10px] font-bold uppercase text-gray-400">
                  {entryScheduleLabel(x)}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => edit(x)}
                  className="rounded-lg border px-2 py-1.5 text-[11px] font-bold"
                >
                  Editar
                </button>
                <button
                  onClick={() => remove(x)}
                  className="rounded-lg border border-red-200 px-2 py-1.5 text-[11px] font-bold text-red-600"
                >
                  Excluir
                </button>
                <button
                  onClick={() => settle(x)}
                  className={`rounded-lg px-2 py-1.5 text-[11px] font-bold ${x.status === "realizado" ? "bg-emerald-50 text-emerald-700" : x.kind === "despesa" ? "bg-orange-600 text-white" : "bg-emerald-600 text-white"}`}
                >
                  {x.status === "realizado"
                    ? "Baixado - reverter"
                    : x.kind === "despesa"
                      ? "Dar baixa"
                      : "Receber"}
                </button>
              </div>
            </div>
          );
        })}
    </div>
  );
}
function Breakdown({
  kind,
  entries,
  categories,
}: {
  kind: Kind;
  entries: Entry[];
  categories: Category[];
}) {
  const rows = Object.entries(
    entries
      .filter((x) => x.kind === kind)
      .reduce<Record<string, number>>(
        (r, x) => ({ ...r, [x.category]: (r[x.category] || 0) + entryValue(x) }),
        {},
      ),
  ).sort((a, b) => b[1] - a[1]);
  const max = rows.reduce((s, [, v]) => s + v, 0);
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="mb-4 font-extrabold text-[#14213d]">
        {kind === "receita" ? "Receitas" : "Despesas"} por categoria
      </h2>
      {rows.length ? (
        <div className="space-y-3">
          {rows.map(([name, value]) => {
            const c = categories.find(
              (x) => x.name === name && x.kind === kind,
            );
            return (
              <div key={name} className="flex items-center gap-3">
                <Icon category={c} />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between text-xs font-bold">
                    <span>{name}</span>
                    <span>{fmt(value)}</span>
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${kind === "receita" ? "bg-emerald-500" : "bg-red-500"}`}
                      style={{ width: `${max ? (value / max) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="py-5 text-center text-sm text-gray-400">
          Sem dados neste mês.
        </p>
      )}
    </section>
  );
}
type CounterpartySummary = {
  key: string;
  name: string;
  unit: Unit;
  kind: Kind;
  total: number;
  realized: number;
  pending: number;
  overdue: number;
  count: number;
};

function summarizeCounterparties(
  entries: Entry[],
  contacts: Counterparty[],
  kind: Kind,
  todayKey: string,
) {
  const matchingContacts = contacts.filter((contact) => contact.kind === kind);
  const byId = new Map(matchingContacts.map((contact) => [contact.id, contact]));
  const byName = new Map(
    matchingContacts.map((contact) => [contactIdentity(kind, contact.unit, contact.name), contact]),
  );
  const rows = new Map<string, CounterpartySummary>();
  const rowFor = (contact: Counterparty) => ({
    key: contact.id,
    name: contact.name,
    unit: contact.unit,
    kind,
    total: 0,
    realized: 0,
    pending: 0,
    overdue: 0,
    count: 0,
  });
  matchingContacts.filter((contact) => !contact.archived).forEach((contact) => {
    rows.set(contact.id, rowFor(contact));
  });
  entries.filter((entry) => entry.kind === kind).forEach((entry) => {
    const contact =
      (entry.counterpartyId && byId.get(entry.counterpartyId)) ||
      byName.get(contactIdentity(kind, entry.unit, entry.beneficiary || ""));
    const name = contact?.name || entry.beneficiary?.trim();
    if (!name) return;
    const key = contact?.id ?? contactIdentity(kind, entry.unit, name);
    const row = rows.get(key) ?? (contact ? rowFor(contact) : {
      key, name, unit: entry.unit, kind, total: 0, realized: 0,
      pending: 0, overdue: 0, count: 0,
    });
    row.total += entryValue(entry);
    row.count += 1;
    if (entry.status === "realizado") row.realized += entryValue(entry);
    else {
      row.pending += entry.amount;
      if (entry.date < todayKey) row.overdue += entry.amount;
    }
    rows.set(key, row);
  });
  return [...rows.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "pt-BR"));
}

function CounterpartyOverview({
  kind, entries, contacts, todayKey,
}: {
  kind: Kind; entries: Entry[]; contacts: Counterparty[]; todayKey: string;
}) {
  const rows = summarizeCounterparties(entries, contacts, kind, todayKey);
  const activeCount = contacts.filter((contact) => contact.kind === kind && !contact.archived).length;
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const pending = rows.reduce((sum, row) => sum + row.pending, 0);
  const unidentified = entries.filter((entry) => entry.kind === kind).reduce((sum, entry) => sum + entryValue(entry), 0) - total;
  const expense = kind === "despesa";
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-extrabold text-[#14213d]">{expense ? "Fornecedores" : "Clientes / pagadores"}</h2>
          <p className="mt-1 text-xs text-gray-400">Movimentação identificada no mês selecionado.</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{activeCount} cadastrados</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3">
        <div><p className="text-[11px] text-slate-500">{expense ? "Despesas identificadas" : "Receitas identificadas"}</p><b className={expense ? "text-red-600" : "text-emerald-600"}>{fmt(total)}</b></div>
        <div><p className="text-[11px] text-slate-500">{expense ? "A pagar" : "A receber"}</p><b className="text-orange-600">{fmt(pending)}</b></div>
      </div>
      <div className="mt-3 divide-y divide-slate-100">
        {rows.filter((row) => row.total > 0).slice(0, 4).map((row) => (
          <div key={row.key} className="flex items-center justify-between gap-3 py-2.5 text-xs">
            <span className="min-w-0 truncate font-bold text-slate-700" title={`${row.name} · ${row.unit}`}>{row.name} <span className="font-normal text-slate-400">· {row.unit}</span></span>
            <b className="shrink-0 text-slate-900">{fmt(row.total)}</b>
          </div>
        ))}
        {!rows.some((row) => row.total > 0) && <p className="py-5 text-center text-xs text-slate-400">Sem movimentação identificada neste mês.</p>}
      </div>
      {unidentified > 0.001 && <p className="mt-2 text-[11px] text-slate-500">Sem {expense ? "fornecedor" : "cliente"} informado: {fmt(unidentified)}</p>}
    </section>
  );
}

function CounterpartyReportPanel({
  kind, entries, contacts, todayKey, onDrill,
}: {
  kind: Kind; entries: Entry[]; contacts: Counterparty[]; todayKey: string;
  onDrill?: (title: string, items: Entry[]) => void;
}) {
  const rows = summarizeCounterparties(entries, contacts, kind, todayKey);
  const moved = rows.filter((row) => row.count > 0);
  const total = moved.reduce((sum, row) => sum + row.total, 0);
  const unidentified = entries.filter((entry) => entry.kind === kind).reduce((sum, entry) => sum + entryValue(entry), 0) - total;
  const expense = kind === "despesa";
  // Resolve a qual fornecedor/cliente cada lançamento pertence, igual ao
  // agrupamento de summarizeCounterparties, para abrir os lançamentos reais.
  const matchingContacts = contacts.filter((contact) => contact.kind === kind);
  const byId = new Map(matchingContacts.map((contact) => [contact.id, contact]));
  const byName = new Map(matchingContacts.map((contact) => [contactIdentity(kind, contact.unit, contact.name), contact]));
  const keyForEntry = (entry: Entry) => {
    const contact = (entry.counterpartyId && byId.get(entry.counterpartyId)) || byName.get(contactIdentity(kind, entry.unit, entry.beneficiary || ""));
    const name = contact?.name || entry.beneficiary?.trim();
    if (!name) return null;
    return contact?.id ?? contactIdentity(kind, entry.unit, name);
  };
  const entriesFor = (rowKey: string) => entries.filter((entry) => entry.kind === kind && keyForEntry(entry) === rowKey);
  const unidentifiedEntries = entries.filter((entry) => entry.kind === kind && keyForEntry(entry) === null);
  const drill = (title: string, items: Entry[]) => { if (onDrill) onDrill(title, items); };
  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm">
      <h2 className="font-extrabold text-[#14213d]">{expense ? "Relatório por fornecedor" : "Relatório por cliente / pagador"}</h2>
      <p className="mt-1 text-xs text-slate-400">Valores dos lançamentos no período e filtros selecionados.</p>
      <div className="mt-4 flex flex-wrap gap-3 text-xs">
        <span className="rounded-lg bg-slate-50 px-3 py-2">{moved.length} com movimentação</span>
        <span className="rounded-lg bg-slate-50 px-3 py-2">Total identificado: <b>{fmt(total)}</b></span>
        {unidentified > 0.001 && (
          <button
            type="button"
            onClick={() => drill(`Sem ${expense ? "fornecedor" : "cliente"} informado`, unidentifiedEntries)}
            className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800 hover:bg-amber-100"
          >
            Sem {expense ? "fornecedor" : "cliente"}: {fmt(unidentified)}
          </button>
        )}
      </div>
      {moved.length > 0 && (
        <div className="mt-5 h-64 overflow-x-auto">
          <div className="h-full" style={{ minWidth: 380 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={moved.slice(0, 8).map((row) => ({ ...row, label: `${row.name} · ${row.unit}` })).reverse()} layout="vertical" margin={{ left: 8, right: 12 }}>
                <CartesianGrid horizontal={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(value: number) => new Intl.NumberFormat("pt-BR", { notation: "compact" }).format(value)} />
                <YAxis type="category" dataKey="label" width={145} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(value, name) => [fmt(Number(value)), name === "realized" ? (expense ? "Pago" : "Recebido") : (expense ? "A pagar" : "A receber")]} contentStyle={{ borderRadius: 12, borderColor: "#e2e8f0" }} />
                <Legend formatter={(value) => value === "realized" ? (expense ? "Pago" : "Recebido") : (expense ? "A pagar" : "A receber")} wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="realized" stackId="total" fill={expense ? "#dc2626" : "#059669"} cursor="pointer" onClick={(data: any) => { const r = data?.payload ?? data; drill(`${r.name} · ${r.unit}`, entriesFor(r.key)); }} />
                <Bar dataKey="pending" stackId="total" fill={expense ? "#fdba74" : "#93c5fd"} cursor="pointer" onClick={(data: any) => { const r = data?.payload ?? data; drill(`${r.name} · ${r.unit}`, entriesFor(r.key)); }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[650px] text-left text-xs">
          <thead className="border-b bg-slate-50 text-slate-500">
            <tr><th className="p-3">{expense ? "Fornecedor" : "Cliente / pagador"}</th><th className="p-3">Centro</th><th className="p-3 text-right">{expense ? "Pago" : "Recebido"}</th><th className="p-3 text-right">Em aberto</th><th className="p-3 text-right">Vencido</th><th className="p-3 text-right">Total</th><th className="p-3 text-right">Lanç.</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr
                key={row.key}
                onClick={() => drill(`${row.name} · ${row.unit}`, entriesFor(row.key))}
                className={`${row.count > 0 ? "cursor-pointer" : ""} hover:bg-slate-50`}
              >
                <td className="p-3 font-bold text-slate-800">{row.name}</td><td className="p-3 text-slate-600">{row.unit}</td><td className="p-3 text-right">{fmt(row.realized)}</td><td className="p-3 text-right">{fmt(row.pending)}</td><td className="p-3 text-right text-red-600">{fmt(row.overdue)}</td><td className="p-3 text-right font-extrabold">{fmt(row.total)}</td><td className="p-3 text-right">{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="py-8 text-center text-sm text-slate-400">Nenhum cadastro ou lançamento identificado para este filtro.</p>}
      </div>
    </section>
  );
}

function Reports({
  entries,
  accounts,
  allowedUnits,
  categories,
  contacts,
}: {
  entries: Entry[];
  accounts: Account[];
  allowedUnits: typeof units;
  categories: Category[];
  contacts: Counterparty[];
}) {
  const today = new Date();
  const currentMonthStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
  const currentMonthEnd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()).padStart(2, "0")}`;
  const [from, setFrom] = useState(currentMonthStart);
  const [to, setTo] = useState(currentMonthEnd);
  const [unit, setUnit] = useState<Unit | "Todos">("Todos");
  const [account, setAccount] = useState("Todos");
  const [category, setCategory] = useState("Todos");
  const [kind, setKind] = useState<Kind | "todos">("todos");
  const [counterparty, setCounterparty] = useState("Todos");
  const [drill, setDrill] = useState<{ title: string; items: Entry[] } | null>(null);
  const openDrill = (title: string, items: Entry[]) => {
    if (!items.length) return;
    setDrill({ title, items: [...items].sort((a, b) => b.date.localeCompare(a.date)) });
  };
  const counterpartyOptions = contacts
    .filter((contact) =>
      (unit === "Todos" || contact.unit === unit) &&
      (kind === "todos" || contact.kind === kind),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const filtered = entries.filter(
    (entry) =>
      entry.date >= from &&
      entry.date <= to &&
      (unit === "Todos" || entry.unit === unit) &&
      (account === "Todos" || entry.account === account) &&
      (category === "Todos" || entry.category === category) &&
      (kind === "todos" || entry.kind === kind) &&
      (counterparty === "Todos" ||
        contactIdentity(entry.kind, entry.unit, entry.beneficiary || "") === counterparty),
  );
  const total = (entryKind: Kind, status?: Entry["status"]) =>
    filtered
      .filter(
        (entry) =>
          entry.kind === entryKind && (!status || entry.status === status),
      )
      .reduce((sum, entry) => sum + entryValue(entry), 0);
  const income = total("receita");
  const expense = total("despesa");
  const pendingPay = total("despesa", "previsto");
  const pendingReceive = total("receita", "previsto");
  const pick = (test: (entry: Entry) => boolean) => filtered.filter(test);
  const entriesByCategory = (item: { kind: Kind; unit: Unit; name: string }) =>
    pick(
      (entry) =>
        entry.kind === item.kind &&
        entry.unit === item.unit &&
        (entry.category || "Sem categoria") === item.name,
    );
  const dateLabel = (value: string) =>
    new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const realizedIncome = total("receita", "realizado");
  const realizedExpense = total("despesa", "realizado");
  const overduePay = filtered
    .filter((entry) => entry.kind === "despesa" && entry.status === "previsto" && entry.date < todayKey)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const overdueReceive = filtered
    .filter((entry) => entry.kind === "receita" && entry.status === "previsto" && entry.date < todayKey)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const categoryDetails = Array.from(
    filtered.reduce((map, entry) => {
      const key = `${entry.kind}|${entry.unit}|${entry.category}`;
      const existing = map.get(key) ?? {
        key,
        name: entry.category || "Sem categoria",
        unit: entry.unit,
        kind: entry.kind,
        total: 0,
        realized: 0,
        pending: 0,
        overdue: 0,
        count: 0,
        color: categories.find((item) => item.kind === entry.kind && item.unit === entry.unit && item.name === entry.category)?.color
          ?? (entry.kind === "receita" ? "#10b981" : "#ef4444"),
      };
      existing.total += entryValue(entry);
      existing.count += 1;
      if (entry.status === "realizado") existing.realized += entryValue(entry);
      else {
        existing.pending += entry.amount;
        if (entry.date < todayKey) existing.overdue += entry.amount;
      }
      map.set(key, existing);
      return map;
    }, new Map<string, {
      key: string; name: string; unit: Unit; kind: Kind; total: number;
      realized: number; pending: number; overdue: number; count: number; color: string;
    }>() ).values(),
  ).sort((a, b) => b.total - a.total);
  const expenseDetails = categoryDetails.filter((item) => item.kind === "despesa");
  const incomeDetails = categoryDetails.filter((item) => item.kind === "receita");
  const largestExpenses = filtered
    .filter((entry) => entry.kind === "despesa")
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);
  // Juros e atraso: só despesas já pagas.
  const paidExpenses = filtered.filter((entry) => entry.kind === "despesa" && entry.status === "realizado");
  const jurosEntries = paidExpenses.filter((entry) => (entry.juros || 0) > 0);
  const totalJuros = jurosEntries.reduce((sum, entry) => sum + (entry.juros || 0), 0);
  const lateExpenses = paidExpenses.filter((entry) => lateDays(entry) > 0);
  const totalLateDays = lateExpenses.reduce((sum, entry) => sum + lateDays(entry), 0);
  const avgLateDays = lateExpenses.length ? Math.round(totalLateDays / lateExpenses.length) : 0;
  const validPeriod = Boolean(from && to && from <= to);
  const periodStart = new Date(`${from}T12:00:00`);
  const periodEnd = new Date(`${to}T12:00:00`);
  const shortPeriod = validPeriod && (periodEnd.getTime() - periodStart.getTime()) / 86400000 <= 62;
  const longPeriod = validPeriod && (periodEnd.getTime() - periodStart.getTime()) / 86400000 > 3650;
  const periodBuckets: {
    label: string; start: string; end: string;
    "Receitas recebidas": number; "Receitas previstas": number;
    "Despesas pagas": number; "Despesas previstas": number;
  }[] = [];
  if (validPeriod) {
    const cursor = new Date(periodStart);
    while (cursor <= periodEnd) {
      const bucketStart = new Date(cursor);
      const next = shortPeriod
        ? new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7, 12)
        : longPeriod
          ? new Date(cursor.getFullYear() + 1, 0, 1, 12)
          : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1, 12);
      const bucketEnd = new Date(Math.min(periodEnd.getTime(), next.getTime() - 86400000));
      const startKey = `${bucketStart.getFullYear()}-${String(bucketStart.getMonth() + 1).padStart(2, "0")}-${String(bucketStart.getDate()).padStart(2, "0")}`;
      const endKey = `${bucketEnd.getFullYear()}-${String(bucketEnd.getMonth() + 1).padStart(2, "0")}-${String(bucketEnd.getDate()).padStart(2, "0")}`;
      periodBuckets.push({
        label: shortPeriod ? `${dateLabel(startKey).slice(0, 5)}–${dateLabel(endKey).slice(0, 5)}` : longPeriod ? String(bucketStart.getFullYear()) : bucketStart.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }),
        start: startKey, end: endKey,
        "Receitas recebidas": 0, "Receitas previstas": 0,
        "Despesas pagas": 0, "Despesas previstas": 0,
      });
      cursor.setTime(next.getTime());
    }
    filtered.forEach((entry) => {
      const bucket = periodBuckets.find((item) => entry.date >= item.start && entry.date <= item.end);
      if (!bucket) return;
      const key = entry.kind === "receita"
        ? (entry.status === "realizado" ? "Receitas recebidas" : "Receitas previstas")
        : (entry.status === "realizado" ? "Despesas pagas" : "Despesas previstas");
      bucket[key] += entryValue(entry);
    });
  }
  const reportContacts = contacts.filter((contact) =>
    unit === "Todos" || contact.unit === unit,
  );
  const accountRows = accounts
    .filter((item) => unit === "Todos" || item.unit === unit)
    .map((item) => ({
      name: item.name,
      unit: item.unit,
      balance: filtered
        .filter(
          (entry) =>
            entry.account === item.name && entry.unit === item.unit && entry.status === "realizado",
        )
        .reduce(
          (sum, entry) =>
            sum + (entry.kind === "receita" ? entryValue(entry) : -entryValue(entry)),
          0,
        ),
    }));
  return (
    <section className="space-y-5">
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-bold">
            De
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="mt-1.5 block rounded-xl border bg-gray-50 p-2.5 text-sm font-normal"
            />
          </label>
          <label className="text-xs font-bold">
            Até
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="mt-1.5 block rounded-xl border bg-gray-50 p-2.5 text-sm font-normal"
            />
          </label>
          <label className="text-xs font-bold">
            Centro
            <select
              value={unit}
              onChange={(event) => {
                setUnit(event.target.value as Unit | "Todos");
                setAccount("Todos");
                setCategory("Todos");
                setCounterparty("Todos");
              }}
              className="mt-1.5 block rounded-xl border bg-gray-50 p-2.5 text-sm font-normal"
            >
              <option>Todos</option>
              {allowedUnits.map((item) => (
                <option key={item.name}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold">
            Conta
            <select
              value={account}
              onChange={(event) => setAccount(event.target.value)}
              className="mt-1.5 block rounded-xl border bg-gray-50 p-2.5 text-sm font-normal"
            >
              <option>Todos</option>
              {accounts
                .filter((item) => unit === "Todos" || item.unit === unit)
                .map((item) => (
                  <option key={item.id}>{item.name}</option>
                ))}
            </select>
          </label>
          <label className="text-xs font-bold">
            Categoria
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="mt-1.5 block rounded-xl border bg-gray-50 p-2.5 text-sm font-normal"
            >
              <option>Todos</option>
              {[
                ...new Set(
                  entries
                    .filter((item) => unit === "Todos" || item.unit === unit)
                    .map((item) => item.category),
                ),
              ]
                .sort()
                .map((item) => (
                  <option key={item}>{item}</option>
                ))}
            </select>
          </label>
          <label className="text-xs font-bold">
            Tipo
            <select
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as Kind | "todos");
                setCounterparty("Todos");
              }}
              className="mt-1.5 block rounded-xl border bg-gray-50 p-2.5 text-sm font-normal"
            >
              <option value="todos">Todos</option>
              <option value="receita">Receitas</option>
              <option value="despesa">Despesas</option>
            </select>
          </label>
          <label className="text-xs font-bold">
            Fornecedor / cliente
            <select
              value={counterparty}
              onChange={(event) => setCounterparty(event.target.value)}
              className="mt-1.5 block max-w-56 rounded-xl border bg-gray-50 p-2.5 text-sm font-normal"
            >
              <option value="Todos">Todos</option>
              {counterpartyOptions.map((contact) => (
                <option key={contact.id} value={contactIdentity(contact.kind, contact.unit, contact.name)}>
                  {contact.name} · {contact.unit} · {contact.kind === "despesa" ? "Fornecedor" : "Cliente"}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {([
          ["Receitas no período", income, "text-emerald-600", pick((e) => e.kind === "receita")],
          ["Despesas no período", expense, "text-red-600", pick((e) => e.kind === "despesa")],
          [
            "Resultado projetado",
            income - expense,
            income - expense >= 0 ? "text-blue-700" : "text-red-600",
            filtered,
          ],
          ["Resultado realizado", realizedIncome - realizedExpense, realizedIncome >= realizedExpense ? "text-blue-700" : "text-red-600", pick((e) => e.status === "realizado")],
          ["A pagar", pendingPay, "text-orange-600", pick((e) => e.kind === "despesa" && e.status === "previsto")],
          ["A receber", pendingReceive, "text-blue-700", pick((e) => e.kind === "receita" && e.status === "previsto")],
          ["Pagar vencido", overduePay, "text-red-600", pick((e) => e.kind === "despesa" && e.status === "previsto" && e.date < todayKey)],
          ["Receber vencido", overdueReceive, "text-orange-600", pick((e) => e.kind === "receita" && e.status === "previsto" && e.date < todayKey)],
        ] as [string, number, string, Entry[]][]).map(([label, value, color, items]) => (
          <button
            key={label}
            type="button"
            onClick={() => openDrill(label, items)}
            className="rounded-2xl bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            <p className="text-xs font-bold text-gray-400">{label}</p>
            <p className={`mt-2 text-2xl font-extrabold ${color}`}>
              {fmt(value)}
            </p>
            <p className="mt-1 text-[11px] font-semibold text-blue-700">{items.length} lançamento(s) →</p>
          </button>
        ))}
      </div>
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-extrabold text-[#14213d]">Fluxo financeiro no período</h2>
            <p className="mt-1 text-xs text-slate-400">
              {shortPeriod ? "Visão semanal" : "Visão mensal"} · Passe o mouse nas barras para ver os valores.
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
            {filtered.length} lançamentos
          </span>
        </div>
        {filtered.length && periodBuckets.length ? (
          <div className="mt-5 overflow-x-auto">
            <div style={{ minWidth: Math.max(600, periodBuckets.length * 105) }}>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={periodBuckets} margin={{ top: 8, right: 8, left: 8, bottom: 4 }} barGap={2}>
                  <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(value: number) => new Intl.NumberFormat("pt-BR", { notation: "compact" }).format(value)} />
                  <Tooltip formatter={(value, name) => [fmt(Number(value)), String(name)]} contentStyle={{ borderRadius: 12, borderColor: "#e2e8f0" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Receitas recebidas" stackId="receita" fill="#059669" radius={[0, 0, 0, 0]} cursor="pointer" onClick={(data: any) => { const b = data?.payload ?? data; openDrill(`Receitas recebidas · ${b.label}`, pick((e) => e.kind === "receita" && e.status === "realizado" && e.date >= b.start && e.date <= b.end)); }} />
                  <Bar dataKey="Receitas previstas" stackId="receita" fill="#6ee7b7" radius={[3, 3, 0, 0]} cursor="pointer" onClick={(data: any) => { const b = data?.payload ?? data; openDrill(`Receitas previstas · ${b.label}`, pick((e) => e.kind === "receita" && e.status === "previsto" && e.date >= b.start && e.date <= b.end)); }} />
                  <Bar dataKey="Despesas pagas" stackId="despesa" fill="#dc2626" radius={[0, 0, 0, 0]} cursor="pointer" onClick={(data: any) => { const b = data?.payload ?? data; openDrill(`Despesas pagas · ${b.label}`, pick((e) => e.kind === "despesa" && e.status === "realizado" && e.date >= b.start && e.date <= b.end)); }} />
                  <Bar dataKey="Despesas previstas" stackId="despesa" fill="#fca5a5" radius={[3, 3, 0, 0]} cursor="pointer" onClick={(data: any) => { const b = data?.payload ?? data; openDrill(`Despesas previstas · ${b.label}`, pick((e) => e.kind === "despesa" && e.status === "previsto" && e.date >= b.start && e.date <= b.end)); }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : <p className="py-12 text-center text-sm text-slate-400">Sem lançamentos no período selecionado.</p>}
      </section>
      <div className="grid gap-5 xl:grid-cols-2">
        {([
          ["Despesas por categoria", expenseDetails, expense],
          ["Receitas por categoria", incomeDetails, income],
        ] as const).map(([title, rows, totalValue]) => (
          <section key={title} className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="font-extrabold text-[#14213d]">{title}</h2>
            <p className="mt-1 text-xs text-slate-400">Cor do plano de contas · Centro e percentual na legenda.</p>
            {rows.length ? (
              <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-center">
                <div className="h-56 w-full shrink-0 sm:w-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={rows} dataKey="total" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2} stroke="none" cursor="pointer" onClick={(data: any) => { const it = data?.payload ?? data; openDrill(`${it.name} · ${it.unit}`, entriesByCategory(it)); }}>
                        {rows.map((item) => <Cell key={item.key} fill={item.color} />)}
                      </Pie>
                      <Tooltip formatter={(value, _name, item) => [fmt(Number(value)), `${item.payload.name} · ${item.payload.unit}`]} contentStyle={{ borderRadius: 12, borderColor: "#e2e8f0" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  {rows.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => openDrill(`${item.name} · ${item.unit}`, entriesByCategory(item))}
                      className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left text-xs hover:bg-slate-50"
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="min-w-0 flex-1 truncate text-slate-700" title={`${item.name} · ${item.unit}`}>{item.name} <span className="text-slate-400">· {item.unit}</span></span>
                      <b className="text-slate-800">{totalValue ? Math.round(item.total / totalValue * 100) : 0}%</b>
                      <span className="w-24 text-right font-bold text-slate-700">{fmt(item.total)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : <p className="py-12 text-center text-sm text-slate-400">Sem dados no período selecionado.</p>}
          </section>
        ))}
      </div>
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="font-extrabold text-[#14213d]">Detalhamento por categoria</h2>
        <p className="mt-1 text-xs text-slate-400">Total, situação, vencidos e quantidade de lançamentos no período.</p>
        {categoryDetails.length ? (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="border-b bg-slate-50 text-slate-500">
                <tr><th className="p-3">Categoria</th><th className="p-3">Centro</th><th className="p-3">Tipo</th><th className="p-3 text-right">Realizado</th><th className="p-3 text-right">Em aberto</th><th className="p-3 text-right">Vencido</th><th className="p-3 text-right">Total</th><th className="p-3 text-right">Lançamentos</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categoryDetails.map((item) => (
                  <tr
                    key={item.key}
                    onClick={() => openDrill(`${item.name} · ${item.unit}`, entriesByCategory(item))}
                    className="cursor-pointer hover:bg-slate-50"
                  >
                    <td className="p-3 font-bold text-slate-800"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />{item.name}</td>
                    <td className="p-3 text-slate-600">{item.unit}</td>
                    <td className="p-3 text-slate-600">{item.kind === "despesa" ? "Despesa" : "Receita"}</td>
                    <td className="p-3 text-right">{fmt(item.realized)}</td>
                    <td className="p-3 text-right">{fmt(item.pending)}</td>
                    <td className="p-3 text-right font-bold text-red-600">{fmt(item.overdue)}</td>
                    <td className="p-3 text-right font-extrabold text-slate-900">{fmt(item.total)}</td>
                    <td className="p-3 text-right">{item.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="py-8 text-center text-sm text-slate-400">Sem categorias com movimento no período.</p>}
      </section>
      <div className="grid gap-5 xl:grid-cols-2">
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-extrabold text-[#14213d]">Maiores categorias de despesa</h2>
          <p className="mt-1 text-xs text-slate-400">Comparação das categorias com maior peso no período.</p>
          {expenseDetails.length ? (
            <>
              <div className="mt-4 overflow-x-auto">
                <div style={{ minWidth: 400 }}>
                  <ResponsiveContainer width="100%" height={Math.max(240, Math.min(expenseDetails.length, 8) * 42 + 45)}>
                    <BarChart data={expenseDetails.slice(0, 8).reverse().map((item) => ({ ...item, label: `${item.name} · ${item.unit}` }))} layout="vertical" margin={{ left: 6, right: 20 }}>
                      <CartesianGrid horizontal={false} stroke="#e2e8f0" strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(value: number) => new Intl.NumberFormat("pt-BR", { notation: "compact" }).format(value)} />
                      <YAxis type="category" dataKey="label" width={155} tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(value) => fmt(Number(value))} contentStyle={{ borderRadius: 12, borderColor: "#e2e8f0" }} />
                      <Bar dataKey="total" name="Despesa" radius={[0, 5, 5, 0]} cursor="pointer" onClick={(data: any) => { const it = data?.payload ?? data; openDrill(`${it.name} · ${it.unit}`, entriesByCategory(it)); }}>
                        {expenseDetails.slice(0, 8).reverse().map((item) => <Cell key={item.key} fill={item.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="mt-5 divide-y divide-slate-100 border-t border-slate-100">
                {expenseDetails.slice(0, 8).map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => openDrill(`${item.name} · ${item.unit}`, entriesByCategory(item))}
                    className="flex w-full flex-wrap items-center justify-between gap-2 py-3 text-left text-xs hover:bg-slate-50"
                  >
                    <span className="font-bold text-slate-800"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />{item.name} <span className="font-normal text-slate-400">· {item.unit}</span></span>
                    <span className="text-slate-500">{item.count} lançamentos · Pago {fmt(item.realized)} · A pagar {fmt(item.pending)}</span>
                  </button>
                ))}
              </div>
            </>
          ) : <p className="py-10 text-center text-sm text-slate-400">Sem despesas no período.</p>}
        </section>
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-extrabold text-[#14213d]">Maiores despesas individuais</h2>
          <p className="mt-1 text-xs text-slate-400">Lançamentos de maior valor, inclusive parcelas e recorrências.</p>
          <div className="mt-4 divide-y divide-slate-100">
            {largestExpenses.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => openDrill(entry.description || "Lançamento", [entry])}
                className="flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800" title={entry.description}>{entry.description}</p>
                  <p className="truncate text-xs text-slate-400">{entry.category} · {entry.unit} · {dateLabel(entry.date)}</p>
                  <p className="text-[11px] text-slate-400">{entry.status === "realizado" ? "Pago" : entry.date < todayKey ? "Vencido" : "A pagar"}{entry.installment ? ` · Parcela ${entry.installment}` : entry.recurrence === "mensal" ? " · Recorrente" : ""}</p>
                </div>
                <b className="shrink-0 text-sm text-red-600">{fmt(entry.amount)}</b>
              </button>
            ))}
            {!largestExpenses.length && <p className="py-5 text-sm text-slate-400">Sem despesas no período.</p>}
          </div>
        </section>
      </div>
      <div className={`grid gap-5 ${kind === "todos" ? "xl:grid-cols-2" : ""}`}>
        {kind !== "receita" && <CounterpartyReportPanel kind="despesa" entries={filtered} contacts={reportContacts} todayKey={todayKey} onDrill={openDrill} />}
        {kind !== "despesa" && <CounterpartyReportPanel kind="receita" entries={filtered} contacts={reportContacts} todayKey={todayKey} onDrill={openDrill} />}
      </div>
      {kind !== "receita" && (
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-extrabold text-[#14213d]">Juros e atraso</h2>
          <p className="mt-1 text-xs text-slate-400">Despesas já pagas no período. Clique nos cards para ver o detalhamento.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <button
              type="button"
              onClick={() => openDrill("Despesas com juros", jurosEntries)}
              className="rounded-xl border p-4 text-left transition hover:border-red-300 hover:shadow-sm"
            >
              <p className="text-xs font-bold text-gray-500">Juros pagos</p>
              <p className="mt-2 text-2xl font-extrabold text-red-600">{fmt(totalJuros)}</p>
              <p className="mt-1 text-[11px] font-semibold text-blue-700">{jurosEntries.length} despesa(s) · Ver →</p>
            </button>
            <button
              type="button"
              onClick={() => openDrill("Despesas pagas em atraso", lateExpenses)}
              className="rounded-xl border p-4 text-left transition hover:border-orange-300 hover:shadow-sm"
            >
              <p className="text-xs font-bold text-gray-500">Pagas em atraso</p>
              <p className="mt-2 text-2xl font-extrabold text-orange-600">{lateExpenses.length}</p>
              <p className="mt-1 text-[11px] font-semibold text-blue-700">Ver lançamentos →</p>
            </button>
            <div className="rounded-xl border p-4">
              <p className="text-xs font-bold text-gray-500">Atraso médio</p>
              <p className="mt-2 text-2xl font-extrabold text-[#14213d]">{avgLateDays} dia(s)</p>
              <p className="mt-1 text-[11px] text-slate-400">{totalLateDays} dia(s) no total</p>
            </div>
          </div>
        </section>
      )}
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="font-extrabold text-[#14213d]">
          Movimento realizado por conta no período
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {accountRows.map((item) => (
            <button
              key={`${item.unit}:${item.name}`}
              type="button"
              onClick={() => openDrill(`${item.name} · ${item.unit}`, pick((e) => e.account === item.name && e.unit === item.unit && e.status === "realizado"))}
              className="rounded-xl border p-4 text-left transition hover:border-blue-300 hover:shadow-sm"
            >
              <p className="font-bold text-slate-800">{item.name}</p>
              <p className="text-xs text-gray-400">{item.unit}</p>
              <p
                className={`mt-3 text-lg font-extrabold ${item.balance >= 0 ? "text-blue-700" : "text-red-600"}`}
              >
                {fmt(item.balance)}
              </p>
            </button>
          ))}
        </div>
      </section>
      {drill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4" role="presentation" onClick={() => setDrill(null)}>
          <section
            role="dialog"
            aria-modal="true"
            className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex items-start justify-between border-b px-6 py-4">
              <div className="min-w-0">
                <h2 className="truncate font-extrabold text-[#14213d]">{drill.title}</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {drill.items.length} lançamento(s) · {dateLabel(from)} a {dateLabel(to)}
                </p>
              </div>
              <button type="button" onClick={() => setDrill(null)} aria-label="Fechar"><X className="h-5 w-5" /></button>
            </header>
            <div className="divide-y divide-slate-100 overflow-y-auto px-6">
              {drill.items.map((entry) => (
                <div key={entry.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-800">
                      {entry.description}
                      {entry.installment && <span className="font-normal text-slate-400"> ({entry.installment})</span>}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">
                      {entry.unit} · {entry.category} · {dateLabel(entry.date)}
                    </p>
                    {entry.beneficiary?.trim() && (
                      <p className="truncate text-[11px] text-slate-500">
                        {entry.kind === "despesa" ? "Fornecedor" : "Cliente"}: {entry.beneficiary.trim()}
                      </p>
                    )}
                    {entry.kind === "despesa" && ((entry.juros || 0) > 0 || entry.paidDate) && (
                      <p className="text-[11px] text-slate-500">
                        {(entry.juros || 0) > 0 && <>Juros <b className="text-red-600">{fmt(entry.juros || 0)}</b> · </>}
                        {entry.paidDate && (lateDays(entry) > 0
                          ? <>Pago em {new Date(`${entry.paidDate}T12:00:00`).toLocaleDateString("pt-BR")} · <b className="text-orange-600">{lateDays(entry)} dia(s) de atraso</b></>
                          : <>Pago em dia</>)}
                      </p>
                    )}
                    {entry.attachments && entry.attachments.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {entry.attachments.map((path) => (
                          <button
                            key={path}
                            type="button"
                            onClick={async () => {
                              try {
                                const url = await signedAttachmentUrl(path);
                                window.open(url, "_blank", "noopener");
                              } catch (error) {
                                window.alert(error instanceof Error ? error.message : "Não foi possível abrir o arquivo.");
                              }
                            }}
                            className="inline-flex max-w-[160px] items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700 hover:bg-blue-100"
                          >
                            <Paperclip className="h-3 w-3 shrink-0" />
                            <span className="truncate">{(path.split("/").pop() || path).replace(/^\d+-/, "")}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-sm font-extrabold ${entry.kind === "receita" ? "text-emerald-600" : "text-red-600"}`}>
                      {entry.kind === "receita" ? "+" : "-"}{fmt(entryValue(entry))}
                    </p>
                    <p className="text-[10px] font-bold uppercase text-slate-400">
                      {entry.status === "realizado" ? (entry.kind === "despesa" ? "Pago" : "Recebido") : entry.date < todayKey ? "Vencido" : entry.kind === "despesa" ? "A pagar" : "A receber"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <footer className="flex items-center justify-between border-t bg-gray-50 px-6 py-3 text-sm font-bold text-slate-700">
              <span>Total</span>
              <span>{fmt(drill.items.reduce((sum, entry) => sum + entryValue(entry), 0))}</span>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
function App() {
  const [screen, setScreen] = useState("dashboard"),
    // The cached profile is only a convenience for the next paint. It can never
    // be the source of truth: a different Supabase session may be active in this
    // browser after a logout/login. Start empty and bootstrap from Supabase.
    [currentUser, setCurrentUser] = useState<User | null>(null),
    [authReady, setAuthReady] = useState(false),
    [modal, setModal] = useState<Kind | null>(null),
    [categoryModal, setCategoryModal] = useState(false),
    [centerModal, setCenterModal] = useState(false),
    [editingCenter, setEditingCenter] = useState<CostCenter | null>(null),
    [deletingCenter, setDeletingCenter] = useState<CostCenter | null>(null),
    [editingCategory, setEditingCategory] = useState<Category | null>(null),
    [deletingCategory, setDeletingCategory] = useState<Category | null>(null),
    [editing, setEditing] = useState<Entry | null>(null),
    [scopeDialog, setScopeDialog] = useState<{
      entry: Entry;
      action: "editar" | "excluir";
    } | null>(null),
    [editScope, setEditScope] = useState<"one" | "series">("one"),
    [entries, setEntries] = useState<Entry[]>([]),
    [savedContacts, setSavedContacts] = useState<Counterparty[]>([]),
    [contactsTableReady, setContactsTableReady] = useState(false),
    [categories, setCategories] = useState<Category[]>([]),
    [centers, setCenters] = useState<CostCenter[]>(units),
    [centerTableReady, setCenterTableReady] = useState(false),
    [accounts, setAccounts] = useState<Account[]>(() =>
      units.map((unit) => ({
        id: unit.name,
        name: unit.name,
        unit: unit.name,
      })),
    ),
    [filter, setFilter] = useState<Unit | "Todos">("Todos"),
    [entryFilter, setEntryFilter] = useState<
      "todos" | "pagar" | "receber" | "pagas" | "recebidas" | "atrasadas"
    >("todos"),
    [periodMode, setPeriodMode] = useState<"mes" | "hoje" | "semana" | "custom">("mes"),
    [periodFrom, setPeriodFrom] = useState(""),
    [periodTo, setPeriodTo] = useState(""),
    [counterpartyFilter, setCounterpartyFilter] = useState("todos"),
    [overdueKind, setOverdueKind] = useState<Kind | "todos">("todos"),
    [notificationsOpen, setNotificationsOpen] = useState(false),
    [menu, setMenu] = useState(false),
    [users, setUsers] = useState<User[]>([]),
    [dataReady, setDataReady] = useState(false),
    [dataError, setDataError] = useState(""),
    [month, setMonth] = useState(
      () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    );
  const contacts = useMemo(
    () => contactsWithLegacyEntries(savedContacts, entries),
    [savedContacts, entries],
  );
  useEffect(() => {
    if (currentUser)
      localStorage.setItem("fincore.user", JSON.stringify(currentUser));
    else localStorage.removeItem("fincore.user");
  }, [currentUser]);
  useEffect(() => {
    let active = true;
    void (async () => {
      const {
        data: { user: authUser },
        error: authError,
      } = await supabase.auth.getUser();
      if (!active) return;
      if (authError || !authUser) {
        setCurrentUser(null);
        setAuthReady(true);
        return;
      }
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("full_name, email, role, allowed_units, hidden_screens")
        .eq("id", authUser.id)
        .single();
      if (!active) return;
      if (profileError || !profile) {
        await supabase.auth.signOut();
        setCurrentUser(null);
        setAuthReady(true);
        return;
      }
      const access = profileAccess(profile.allowed_units);
      setCurrentUser({
        id: authUser.id,
        name: profile.full_name,
        email: profile.email || authUser.email || "",
        role: profile.role as User["role"],
        units: access.units,
        canViewReports: access.canViewReports,
        canViewTeamNotes: access.canViewTeamNotes,
        hiddenScreens: profile.hidden_screens ?? [],
      });
      setAuthReady(true);
    })();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (!currentUser) {
      setDataReady(false);
      setSavedContacts([]);
      setContactsTableReady(false);
      setCenters(units);
      setCenterTableReady(false);
      return () => {
        active = false;
      };
    }
    setDataReady(false);
    setDataError("");
    void (async () => {
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();
      if (!active) return;
      if (authError || !user) {
        setCurrentUser(null);
        return;
      }
      try {
        // A restored browser tab can retain an old access token after another
        // user has signed in. Refresh it before every initial financial read so
        // the RLS rules use the current account and its permitted units.
        const {
          data: { session },
          error: refreshError,
        } = await supabase.auth.refreshSession();
        if (refreshError || !session)
          throw refreshError || new Error("Sessão expirada.");
        const [entryRows, categoryRows, accountRows] = await Promise.all([
          readAuthenticatedRows<any>("entries", "date.desc"),
          readAuthenticatedRows<Category>("categories"),
          readAuthenticatedRows<any>("accounts"),
        ]);
        if (!active) return;
        const loadedEntries = entryRows.map((row: any) => ({
          ...row,
          seriesId: row.series_id || undefined,
          counterpartyId: row.counterparty_id ?? undefined,
          amount: Number(row.amount),
          juros: row.juros != null ? Number(row.juros) : 0,
          paidDate: row.paid_date || undefined,
        })) as Entry[];
        // The new registry has its own migration. Until it is applied, the
        // old production database and existing launches must remain readable.
        let contactRows: Counterparty[] = [];
        let contactTableAvailable = false;
        try {
          contactRows = await readAuthenticatedRows<Counterparty>("counterparties");
          contactTableAvailable = true;
        } catch (contactError) {
          console.info("Fincore: cadastro de contatos ainda indisponível", contactError);
        }
        let centerRows: CostCenterRow[] = [];
        let centerTableAvailable = false;
        try {
          centerRows = await readAuthenticatedRows<CostCenterRow>("cost_centers");
          centerTableAvailable = true;
        } catch (centerError) {
          console.info("Fincore: cadastro de centros ainda indisponível", centerError);
        }
        // Keep recurring series alive without pre-creating decades of records.
        // Only missing months inside the rolling three-year window are written.
        const projectedEntries = nextRecurringEntries(loadedEntries);
        let entriesToShow = loadedEntries;
        if (projectedEntries.length) {
          try {
            await saveRemoteEntries(projectedEntries);
            entriesToShow = [...projectedEntries, ...loadedEntries];
          } catch (projectionError) {
            // Existing financial data remains available even if extending the
            // forecast fails; it will be retried the next time the app opens.
            console.error(
              "Fincore: falha ao estender recorrências",
              projectionError,
            );
          }
        }
        if (!active) return;
        setEntries(entriesToShow);
        setSavedContacts(contactRows);
        setContactsTableReady(contactTableAvailable);
        setCenters(centerTableAvailable ? centerRows.map(costCenterVisual) : units);
        setCenterTableReady(centerTableAvailable);
        setCategories(categoryRows);
        setAccounts(
          accountRows.map((row: any) => ({
            id: row.id,
            name: row.name,
            unit: row.unit as Unit,
          })),
        );
        setDataReady(true);
      } catch (error) {
        if (!active) return;
        console.error("Fincore: falha ao carregar dados", error);
        setDataError(
          "Não foi possível carregar os dados do banco. Tente novamente.",
        );
        setDataReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [currentUser?.id]);
  useEffect(() => {
    if (!currentUser || !dataReady || dataError) return;
    let cancelled = false;
    let busy = false;
    const refreshEntries = async () => {
      if (busy || document.visibilityState === "hidden") return;
      busy = true;
      try {
        const rows = await readAuthenticatedRows<any>("entries", "date.desc");
        if (!cancelled) {
          setEntries(rows.map((row: any) => ({
            ...row,
            seriesId: row.series_id || undefined,
            counterpartyId: row.counterparty_id ?? undefined,
            amount: Number(row.amount),
            juros: row.juros != null ? Number(row.juros) : 0,
            paidDate: row.paid_date || undefined,
          })) as Entry[]);
        }
      } catch (error) {
        console.error("Fincore: falha ao atualizar lançamentos", error);
      } finally {
        busy = false;
      }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void refreshEntries(); };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(() => void refreshEntries(), 60_000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    };
  }, [currentUser?.id, dataReady, dataError]);
  const screenAllowed = (id: string) => {
    if (!currentUser) return true;
    if (currentUser.role === "master") return true;
    if (id === "usuarios") return false;
    if (id === "relatorios" && !currentUser.canViewReports) return false;
    // Aba opcional: só aparece para quem foi liberado (além do Master).
    if (id === "notas") return currentUser.canViewTeamNotes;
    return !(currentUser.hiddenScreens ?? []).includes(id);
  };
  // Se o usuário estiver numa aba que foi removida dele, leva para a
  // primeira aba liberada.
  useEffect(() => {
    if (!currentUser || currentUser.role === "master") return;
    if (screenAllowed(screen)) return;
    const fallback = ["dashboard", "lancamentos", "contas", "categorias", "contatos", "relatorios"].find(screenAllowed);
    if (fallback && fallback !== screen) setScreen(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentUser?.hiddenScreens, currentUser?.canViewReports, screen]);
  const loadUsers = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, allowed_units, hidden_screens")
      .order("created_at");
    if (!data) return;
    setUsers(
      data.map((profile) => {
        const access = profileAccess(profile.allowed_units);
        return {
          id: profile.id,
          name: profile.full_name,
          email:
            profile.email ||
            (profile.id === currentUser?.id ? currentUser?.email ?? "" : ""),
          role: profile.role as User["role"],
          units: access.units,
          canViewReports: access.canViewReports,
          canViewTeamNotes: access.canViewTeamNotes,
          hiddenScreens: profile.hidden_screens ?? [],
        };
      }),
    );
  };
  const removeCategory = async (category: Category) => {
    await deleteRemoteCategory(category.id);
    setCategories((old) => old.filter((item) => item.id !== category.id));
    setDeletingCategory(null);
  };
  const createCenter = async (name: string, initials: string, color: string) => {
    if (currentUser?.role !== "master") throw new Error("Apenas o Master pode criar planos de contas.");
    if (!centerTableReady) throw new Error("A configuração do banco para novos centros ainda não está disponível.");
    if (name.length < 2 || name.length > 80 || name === "Todos" || name === reportsAccessFlag || name === teamNotesAccessFlag)
      throw new Error("Informe um nome válido entre 2 e 80 caracteres.");
    if (centers.some((center) => center.name.toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR")))
      throw new Error("Já existe um centro de custo com esse nome.");
    const saved = await createRemoteCostCenter(name, initials || name.slice(0, 2).toLocaleUpperCase("pt-BR"), color);
    const center = costCenterVisual(saved as CostCenterRow);
    setCenters((old) => [...old, center]);
    try {
      const accountRows = await readAuthenticatedRows<Account>("accounts");
      setAccounts(accountRows);
    } catch (error) {
      console.error("Fincore: centro criado, mas falhou a atualização das contas", error);
      setAccounts((old) => [...old, { id: center.name, name: center.name, unit: center.name }]);
    }
  };
  const updateCenter = async (name: string, initials: string, color: string) => {
    if (currentUser?.role !== "master") throw new Error("Apenas o Master pode editar planos de contas.");
    const saved = await updateRemoteCostCenter(name, {
      initials: initials || name.slice(0, 2).toLocaleUpperCase("pt-BR"),
      color,
    });
    const center = costCenterVisual(saved as CostCenterRow);
    setCenters((old) => old.map((item) => (item.name === name ? center : item)));
  };
  const deleteCenter = async (name: string) => {
    if (currentUser?.role !== "master") throw new Error("Apenas o Master pode excluir planos de contas.");
    // withFreshSession já lança o erro se a exclusão falhar.
    await deleteRemoteCostCenter(name);
    // O banco apaga em cascata; aqui só mantemos a tela em sincronia.
    setCenters((old) => old.filter((item) => item.name !== name));
    setCategories((old) => old.filter((item) => item.unit !== name));
    setEntries((old) => old.filter((item) => item.unit !== name));
    setAccounts((old) => old.filter((item) => item.unit !== name));
    setSavedContacts((old) => old.filter((item) => item.unit !== name));
    setFilter((current) => (current === name ? "Todos" : current));
  };
  useEffect(() => {
    if (currentUser?.role === "master") void loadUsers();
  }, [currentUser?.id, currentUser?.role]);
  const createManagedUser = async ({
    name,
    email,
    password,
    units: allowedUnits,
    canViewReports,
  }: {
    name: string;
    email: string;
    password: string;
    units: Unit[];
    canViewReports: boolean;
  }) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const masterSession = sessionData.session;
    if (!masterSession)
      throw new Error(
        "Sua sessão expirou. Entre novamente para criar usuários.",
      );
    const settingsResponse = await fetch(`${supabaseUrl}/auth/v1/settings`, {
      headers: { apikey: supabasePublishableKey },
    });
    const settings = settingsResponse.ok ? await settingsResponse.json() : null;
    if (settings?.mailer_autoconfirm === false) {
      throw new Error(
        "A criação de acessos está bloqueada: o Supabase exige confirmação por e-mail. Desative “Confirm email” em Authentication > Providers > Email para que as senhas criadas pelo Master funcionem imediatamente.",
      );
    }
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: name.trim() } },
    });
    if (error || !data.user)
      throw error || new Error("Não foi possível criar o usuário.");
    const { error: restoreError } = await supabase.auth.setSession({
      access_token: masterSession.access_token,
      refresh_token: masterSession.refresh_token,
    });
    if (restoreError)
      throw new Error(
        "Usuário criado, mas sua sessão Master precisa ser renovada.",
      );
    const { data: updatedProfile, error: profileError } = await supabase
      .from("profiles")
      .update({
        full_name: name.trim(),
        email: email.trim().toLowerCase(),
        role: "operador",
        allowed_units: [
          ...allowedUnits,
          ...(canViewReports ? [reportsAccessFlag] : []),
        ],
      })
      .eq("id", data.user.id)
      .select("id")
      .maybeSingle();
    if (profileError || !updatedProfile)
      throw (
        profileError ||
        new Error(
          "Perfil do usuário ainda não foi criado. Tente novamente em alguns segundos.",
        )
      );
  };
  const resetManagedUserPassword = async (user: User) => {
    const password = window.prompt(
      `Nova senha para ${user.name} (mínimo de 6 caracteres):`,
    );
    if (password === null) return;
    const { error } = await supabase.rpc("master_reset_user_password", {
      target_user: user.id,
      new_password: password,
    });
    if (error) throw error;
  };
  const toggleManagedUserReports = async (user: User) => {
    const allowedUnits = [
      ...user.units,
      ...(user.canViewReports ? [] : [reportsAccessFlag]),
      ...(user.canViewTeamNotes ? [teamNotesAccessFlag] : []),
    ];
    const { error } = await supabase
      .from("profiles")
      .update({ allowed_units: allowedUnits })
      .eq("id", user.id);
    if (error) throw error;
    await loadUsers();
  };
  const updateManagedUserPermissions = async (
    user: User,
    allowedUnits: Unit[],
    canViewReports: boolean,
    hiddenScreens: string[],
    canViewTeamNotes: boolean,
  ) => {
    const { error } = await supabase
      .from("profiles")
      .update({
        allowed_units: [
          ...allowedUnits,
          ...(canViewReports ? [reportsAccessFlag] : []),
          ...(canViewTeamNotes ? [teamNotesAccessFlag] : []),
        ],
        hidden_screens: hiddenScreens,
      })
      .eq("id", user.id);
    if (error) throw error;
    await loadUsers();
  };
  const logout = () => {
    // The interface must release the current operation immediately. The remote
    // sign-out can finish in the background and must not leave the user stuck
    // on a protected screen when the network is slow.
    setCurrentUser(null);
    setDataReady(false);
    void supabase.auth
      .signOut()
      .catch((error) =>
        console.error("Fincore: falha ao encerrar sessão", error),
      );
  };
  if (!authReady)
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f2f4f8] p-6 text-center">
        <div className="rounded-2xl bg-white px-8 py-7 shadow-sm">
          <img
            src="/sistema-financeiro/fincore-logo-transparent.png"
            alt="Fincore"
            className="mx-auto w-36"
          />
          <div
            className="mx-auto mt-6 h-7 w-7 animate-spin rounded-full border-[3px] border-blue-100 border-t-blue-700"
            aria-label="Carregando"
          />
        </div>
      </main>
    );
  if (!currentUser) return <Login onLogin={setCurrentUser} />;
  if (!dataReady || dataError)
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f2f4f8] p-6 text-center">
        <div className="rounded-2xl bg-white px-8 py-7 shadow-sm">
          <img
            src="/sistema-financeiro/fincore-logo-transparent.png"
            alt="Fincore"
            className="mx-auto w-36"
          />
          {dataError ? (
            <p className="mt-5 text-sm font-bold text-red-600">
              Não foi possível carregar. Atualize a página.
            </p>
          ) : (
            <div
              className="mx-auto mt-6 h-7 w-7 animate-spin rounded-full border-[3px] border-blue-100 border-t-blue-700"
              aria-label="Carregando"
            />
          )}
        </div>
      </main>
    );
  const allowedUnits =
    currentUser.role === "master"
      ? centers
      : centers.filter((unit) => currentUser.units.includes(unit.name));
  const balance = (name: string) =>
      entries
        .filter((x) => x.account === name && x.status === "realizado")
        .reduce((s, x) => s + (x.kind === "receita" ? entryValue(x) : -entryValue(x)), 0),
    addAccount = async () => {
      if (currentUser.role !== "master") return;
      const name = window.prompt("Nome da nova conta:");
      if (!name?.trim()) return;
      const unit = window.prompt(
        `Centro de custo (${centers.map((item) => item.name).join(", ")}):`,
        centers[0]?.name ?? "",
      ) as Unit | null;
      if (!unit || !centers.some((item) => item.name === unit)) return;
      const account = { id: id(), name: name.trim(), unit };
      const { error } = await supabase.from("accounts").insert(account);
      if (error) throw error;
      setAccounts((old) => [...old, account]);
    },
    adjust = async (account: Account) => {
      if (currentUser.role !== "master") return;
      const wanted = window.prompt(
        `Novo saldo de :`,
        String(balance(account.name)),
      );
      if (wanted === null) return;
      const target = Number(wanted.replace(",", "."));
      if (Number.isNaN(target)) return;
      const difference = target - balance(account.name);
      if (!difference) return;
      const adjustment: Entry = {
        id: id(),
        kind: difference > 0 ? "receita" : "despesa",
        unit: account.unit,
        account: account.name,
        category: "Ajuste de saldo",
        description: "Ajuste de saldo",
        beneficiary: "",
        pix: "",
        amount: Math.abs(difference),
        date: new Date().toISOString().slice(0, 10),
        status: "realizado",
        recurrence: "nenhuma",
        installments: 1,
      };
      await saveRemoteEntries([adjustment]);
      setEntries((old) => [adjustment, ...old]);
    };
  const key = month.toISOString().slice(0, 7),
    today = new Date().toISOString().slice(0, 10),
    visible = entries.filter(
      (x) =>
        currentUser.role === "master" || currentUser.units.includes(x.unit),
    ),
    pending = visible.filter(
      (x) => x.status === "previsto" && x.date <= today,
    ),
    overdue = visible.filter(
      (x) => x.status === "previsto" && x.date < today,
    ),
    overduePay = overdue.filter((x) => x.kind === "despesa"),
    overdueReceive = overdue.filter((x) => x.kind === "receita"),
    current = visible.filter((x) => x.date.startsWith(key)),
    localDate = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    todayStr = localDate(new Date()),
    // Intervalo de datas da lista de Lançamentos conforme o período escolhido.
    period = (() => {
      if (periodMode === "hoje") return { start: todayStr, end: todayStr, label: "Hoje" };
      if (periodMode === "semana") {
        const now = new Date();
        const offset = (now.getDay() + 6) % 7; // 0 = segunda … 6 = domingo
        const monday = new Date(now);
        monday.setDate(now.getDate() - offset);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        return { start: localDate(monday), end: localDate(sunday), label: "Esta semana" };
      }
      if (periodMode === "custom") {
        const start = periodFrom || todayStr;
        const end = periodTo || todayStr;
        return { start, end, label: "Período personalizado" };
      }
      const first = new Date(month.getFullYear(), month.getMonth(), 1);
      const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
      return { start: localDate(first), end: localDate(last), label: labelMonth(month) };
    })(),
    listCurrent = visible.filter((x) => x.date >= period.start && x.date <= period.end),
    payToday = visible.filter(
      (x) => x.kind === "despesa" && x.status === "previsto" && x.date === todayStr,
    ),
    payTodayTotal = payToday.reduce((s, x) => s + x.amount, 0),
    sum = (k: Kind, status?: Entry["status"]) =>
      current
        .filter((x) => x.kind === k && (!status || x.status === status))
        .reduce((s, x) => s + entryValue(x), 0),
    totals = {
      income: sum("receita", "realizado"),
      expense: sum("despesa", "realizado"),
      pay: sum("despesa", "previsto"),
      receive: sum("receita", "previsto"),
    },
    move = (n: number) =>
      setMonth((v) => new Date(v.getFullYear(), v.getMonth() + n, 1)),
    openOverdue = (kind: Kind | "todos" = "todos") => {
      setFilter("Todos");
      setCounterpartyFilter("todos");
      setOverdueKind(kind);
      setEntryFilter("atrasadas");
      setNotificationsOpen(false);
      setScreen("lancamentos");
    },
    openPayToday = () => {
      setFilter("Todos");
      setCounterpartyFilter("todos");
      setOverdueKind("todos");
      setPeriodMode("hoje");
      setEntryFilter("pagar");
      setScreen("lancamentos");
    },
    openNotification = (entry: Entry) => {
      if (entry.date < today) {
        openOverdue(entry.kind);
        return;
      }
      setFilter("Todos");
      setCounterpartyFilter("todos");
      setEntryFilter(entry.kind === "despesa" ? "pagar" : "receber");
      setPeriodMode("mes");
      setMonth(new Date(`${entry.date}T12:00:00`));
      setNotificationsOpen(false);
      setScreen("lancamentos");
    };
  const refreshContacts = async () => {
    if (!contactsTableReady) return;
    try {
      setSavedContacts(await readAuthenticatedRows<Counterparty>("counterparties"));
    } catch (error) {
      // A successful entry remains saved even if refreshing the separate
      // contact list fails; its name is still visible through the entry.
      console.error("Fincore: falha ao atualizar contatos", error);
    }
  };
  const save = async (
      data: Omit<Entry, "id">,
      scope: "one" | "series",
      monthParts?: SameMonthPart[],
    ) => {
      if (editing) {
        const isWholeSeries = scope === "series" && Boolean(editing.seriesId);
        const occurrences = isWholeSeries
          ? entries.filter((entry) => entry.seriesId === editing.seriesId)
          : [];
        // A series may contain paid and pending months, or two installments
        // with different amounts. Only propagate fields actually changed in
        // the form; otherwise a due-date correction would overwrite them.
        const seriesChanges = changedSeriesFields<Entry>(editing, data, [
          "date",
          "installment",
        ]);
        const updated = entries.map((x) =>
          (
            isWholeSeries
              ? x.seriesId === editing.seriesId
              : x.id === editing.id
          )
            ? {
                ...x,
                ...(isWholeSeries ? seriesChanges : data),
                id: x.id,
                seriesId: x.seriesId,
                date: isWholeSeries
                  ? seriesDueDate(occurrences, editing, x, data.date)
                  : data.date,
                installment: x.installment,
              }
            : x,
        );
        const changed = updated.filter((x) =>
          isWholeSeries ? x.seriesId === editing.seriesId : x.id === editing.id,
        );
        await saveRemoteEntries(changed);
        setEntries(updated);
        void refreshContacts();
        setEditing(null);
        return;
      }
      if (monthParts?.length) {
        const seriesId = id();
        const start = new Date(`${data.date}T12:00:00`);
        // A recurring split is a single monthly series with multiple fixed
        // occurrences (for example, vale on the 15th and salary on the 30th).
        // Create the full rolling forecast immediately so September, October
        // and later months appear without needing a reload.
        const created = Array.from(
          { length: data.recurrence === "mensal" ? 36 : 1 },
          (_, monthIndex) => {
            const dueMonth = new Date(
              start.getFullYear(),
              start.getMonth() + monthIndex,
              1,
            );
            const lastDay = new Date(
              dueMonth.getFullYear(),
              dueMonth.getMonth() + 1,
              0,
            ).getDate();
            return monthParts.map((part, index) => {
              const sourceDate = new Date(`${part.date}T12:00:00`);
              const dueDate = new Date(
                dueMonth.getFullYear(),
                dueMonth.getMonth(),
                Math.min(sourceDate.getDate(), lastDay),
              )
                .toISOString()
                .slice(0, 10);
              return {
                ...data,
                id: id(),
                seriesId,
                amount: parseMoney(part.amount),
                date: dueDate,
                status: monthIndex === 0 ? data.status : "previsto",
                installments: 1,
                installment: `${index + 1}/${monthParts.length}`,
              };
            });
          },
        ).flat();
        await saveRemoteEntries(created);
        setEntries((old) => [...created, ...old]);
        void refreshContacts();
        return;
      }
      const seriesId =
          data.recurrence === "mensal" || data.installments > 1
            ? id()
            : undefined,
        count = data.recurrence === "mensal" ? 36 : data.installments;
      const created = Array.from({ length: count }, (_, i) => {
        return {
          ...data,
          id: id(),
          seriesId,
          amount:
            data.recurrence === "mensal"
              ? data.amount
              : data.amount / data.installments,
          // Limita ao último dia do mês: 31/07 + 2 meses = 30/09 (não 01/10).
          date: addMonthsClamped(data.date, i),
          status: i === 0 ? data.status : "previsto",
          installments: 1,
          installment:
            data.installments > 1 ? `${i + 1}/${data.installments}` : undefined,
        };
      });
      await saveRemoteEntries(created);
      setEntries((old) => [...created, ...old]);
      void refreshContacts();
    },
    settle = async (x: Entry) => {
      const becomingPaid = x.status !== "realizado";
      const updated = {
        ...x,
        status: becomingPaid ? "realizado" : "previsto",
        // Em despesas, registra a data do pagamento ao dar baixa (se vazia)
        // para medir o atraso; ao reverter, limpa a data.
        ...(x.kind === "despesa"
          ? { paidDate: becomingPaid ? x.paidDate || todayStr : undefined }
          : {}),
      } as Entry;
      await saveRemoteEntries([updated]);
      setEntries((old) => old.map((v) => (v.id === x.id ? updated : v)));
    },
    remove = async (x: Entry, scope: "one" | "series" = "one") => {
      const removed = entries.filter((v) =>
        scope === "series" && x.seriesId
          ? v.seriesId === x.seriesId
          : v.id === x.id,
      );
      if (scope === "series" && x.seriesId)
        await deleteRemoteEntrySeries(x.seriesId);
      else await deleteRemoteEntries(removed.map((entry) => entry.id));
      setEntries((old) =>
        old.filter((v) => !removed.some((entry) => entry.id === v.id)),
      );
    },
    open = (kind: Kind) => {
      setFilter("Todos");
      setCounterpartyFilter("todos");
      setEditing(null);
      setModal(kind);
      setScreen("lancamentos");
    },
    list = (entryFilter === "atrasadas" ? overdue : listCurrent)
      .filter((x) => filter === "Todos" || x.unit === filter)
      .filter(
        (x) =>
          entryFilter === "todos" ||
          (entryFilter === "pagar" &&
            x.kind === "despesa" &&
            x.status === "previsto") ||
          (entryFilter === "receber" &&
            x.kind === "receita" &&
            x.status === "previsto") ||
          (entryFilter === "pagas" &&
            x.kind === "despesa" &&
            x.status === "realizado") ||
          (entryFilter === "recebidas" &&
            x.kind === "receita" &&
            x.status === "realizado") ||
          (entryFilter === "atrasadas" &&
            (overdueKind === "todos" || x.kind === overdueKind)),
      )
      .filter(
        (x) =>
          counterpartyFilter === "todos" ||
          counterpartyKey(x.kind, x.beneficiary || "") === counterpartyFilter,
      ),
    counterparties = Array.from(
      new Map<string, { key: string; kind: Kind; name: string }>(
        contacts
          .filter((contact) => allowedUnits.some((unit) => unit.name === contact.unit))
          .map((contact): [string, { key: string; kind: Kind; name: string }] => [
            counterpartyKey(contact.kind, contact.name),
            {
              key: counterpartyKey(contact.kind, contact.name),
              kind: contact.kind,
              name: contact.name,
            },
          ]),
      ).values(),
    ).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    listTotals = list.reduce(
      (totals, entry) => {
        totals[entry.kind] += entryValue(entry);
        return totals;
      },
      { receita: 0, despesa: 0 },
    ),
    byUnit = allowedUnits.map((u) => ({
      ...u,
      categories: categories.filter((c) => c.unit === u.name),
    })),
    nav = [
      { id: "dashboard", text: "Dashboard", Icon: LayoutDashboard },
      { id: "lancamentos", text: "Lançamentos", Icon: ReceiptText },
      { id: "contas", text: "Contas", Icon: Wallet },
      { id: "categorias", text: "Plano de contas", Icon: Tag },
      { id: "contatos", text: "Fornecedores/clientes", Icon: Building2 },
      { id: "notas", text: "Notas da equipe", Icon: FileText },
      { id: "relatorios", text: "Relatórios", Icon: BarChart3 },
      { id: "usuarios", text: "Usuários", Icon: Menu },
    ];
  return (
    <div className="flex h-screen overflow-hidden bg-[#f2f4f8]">
      <aside
        className={`fixed z-30 flex h-full w-64 shrink-0 flex-col bg-[#14213d] text-white transition-transform lg:relative ${menu ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-6">
          <div className="min-w-0 flex-1 text-center">
            <img
              src="/sistema-financeiro/fincore-logo-transparent.png"
              alt="Fincore"
              className="mx-auto h-14 w-40 object-contain brightness-0 invert"
            />
            <p className="mt-1.5 text-xs font-medium text-blue-200/70">
              Gestão financeira
            </p>
          </div>
          <button className="lg:hidden" onClick={() => setMenu(false)}>
            <X />
          </button>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {nav
            .filter((x) => screenAllowed(x.id))
            .map((x) => (
              <button
                key={x.id}
                onClick={() => {
                  setScreen(x.id);
                  if (x.id === "lancamentos") {
                    setFilter("Todos");
                    setCounterpartyFilter("todos");
                    setEntryFilter("todos");
                    setOverdueKind("todos");
                    setPeriodMode("mes");
                  }
                  setMenu(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold ${screen === x.id ? "bg-blue-600" : "text-white/60"}`}
              >
                <x.Icon className="h-4 w-4 shrink-0" />
                <span className="truncate whitespace-nowrap text-left">{x.text}</span>
              </button>
            ))}
        </nav>
        <div className="border-t border-white/10 p-4">
          <p className="truncate text-sm font-bold text-white">
            {currentUser.name}
          </p>
          <p className="mb-3 truncate text-[11px] text-blue-200/70">
            {currentUser.email}
          </p>
          <button
            onClick={logout}
            className="w-full rounded-lg border border-white/15 px-2.5 py-2 text-xs font-bold text-blue-100 hover:bg-white/10"
          >
            Sair da conta
          </button>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b bg-white px-5 py-3.5">
          <div className="flex gap-3">
            <button className="lg:hidden" onClick={() => setMenu(true)}>
              <Menu />
            </button>
            <div>
              <h1 className="font-extrabold text-[#14213d]">
                {screen === "dashboard"
                  ? "Dashboard Financeiro"
                  : screen === "contas"
                    ? "Contas"
                    : screen === "categorias"
                      ? "Plano de contas"
                      : screen === "contatos"
                        ? "Fornecedores/clientes"
                      : screen === "notas"
                        ? "Notas da equipe"
                      : screen === "usuarios"
                        ? "Usuários e acessos"
                        : screen === "relatorios"
                          ? "Relatórios financeiros"
                          : "Lançamentos"}
              </h1>
              <p className="text-xs text-gray-400">
                {allowedUnits.map((unit) => unit.name).join(", ") || "Centros de custo"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {screen !== "lancamentos" && (
              <div className="hidden items-center gap-2 sm:flex">
                <button
                  onClick={() => open("despesa")}
                  className="rounded-lg bg-red-50 px-3 py-2 text-xs font-extrabold text-red-600 hover:bg-red-100"
                >
                  − Despesa
                </button>
                <button
                  onClick={() => open("receita")}
                  className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-emerald-700"
                >
                  + Receita
                </button>
              </div>
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotificationsOpen((open) => !open)}
                aria-label={`Notificações${pending.length ? `: ${pending.length} pendências` : ""}`}
                aria-expanded={notificationsOpen}
                className="relative rounded-lg p-2 text-gray-400 transition hover:bg-slate-100 hover:text-[#14213d]"
              >
                <Bell className="h-5 w-5" />
              </button>
              {pending.length > 0 && (
                <span className="pointer-events-none absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
                  {pending.length}
                </span>
              )}
              {notificationsOpen && (
                <section className="absolute right-0 z-40 mt-2 w-[min(24rem,calc(100vw-2.5rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-xl">
                  <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                    <div>
                      <h2 className="text-sm font-extrabold text-[#14213d]">
                        Pendências financeiras
                      </h2>
                      <p className="text-[11px] text-slate-400">
                        Vencidas e com vencimento hoje
                      </p>
                    </div>
                    {overdue.length > 0 && (
                      <button
                        type="button"
                        onClick={() => openOverdue("todos")}
                        className="text-xs font-bold text-blue-700 hover:text-blue-900"
                      >
                        Ver atrasadas
                      </button>
                    )}
                  </div>
                  {pending.length ? (
                    <div className="max-h-80 overflow-y-auto p-2">
                      {pending
                        .slice()
                        .sort((a, b) => a.date.localeCompare(b.date))
                        .slice(0, 8)
                        .map((entry) => {
                          const isOverdue = entry.date < today;
                          return (
                            <button
                              key={entry.id}
                              type="button"
                              onClick={() => openNotification(entry)}
                              className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-slate-50"
                            >
                              <span
                                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isOverdue ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"}`}
                              >
                                <AlertTriangle className="h-4 w-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <b className="block truncate text-xs text-slate-800">
                                  {entry.description}
                                </b>
                                <span className="text-[11px] text-slate-400">
                                  {isOverdue
                                    ? `Vencida em ${new Date(`${entry.date}T12:00:00`).toLocaleDateString("pt-BR")}`
                                    : "Vence hoje"}
                                  {" · "}
                                  {entry.kind === "despesa"
                                    ? "Conta a pagar"
                                    : "Conta a receber"}
                                </span>
                              </span>
                              <b
                                className={`text-xs ${entry.kind === "despesa" ? "text-red-600" : "text-emerald-600"}`}
                              >
                                {fmt(entry.amount)}
                              </b>
                            </button>
                          );
                        })}
                    </div>
                  ) : (
                    <p className="p-5 text-center text-xs font-medium text-slate-400">
                      Nenhuma pendência para hoje.
                    </p>
                  )}
                </section>
              )}
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-5">
          {screen === "dashboard" ? (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-extrabold text-[#14213d]">
                    Visão mensal
                  </h2>
                  <p className="text-xs text-gray-400">
                    Receitas, despesas e categorias do mês selecionado.
                  </p>
                </div>
                <Month value={month} move={move} />
              </div>
              {pending.length > 0 && (
                <section className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <b>⚠ Pendências de vencimento: {pending.length}</b>
                  <span className="ml-2">
                    {pending
                      .slice(0, 3)
                      .map((x) => x.description)
                      .join(", ")}
                    {pending.length > 3 ? "…" : ""}
                  </span>
                </section>
              )}
              <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {([
                  { title: "A pagar hoje", value: payTodayTotal, Icon: CalendarClock, style: "text-orange-600 bg-orange-50", filter: "pagar", today: true },
                  { title: "Receitas recebidas", value: totals.income, Icon: TrendingUp, style: "text-emerald-600 bg-emerald-50", filter: "recebidas", today: false },
                  { title: "Despesas pagas", value: totals.expense, Icon: TrendingDown, style: "text-red-600 bg-red-50", filter: "pagas", today: false },
                  { title: "A pagar", value: totals.pay, Icon: CreditCard, style: "text-orange-600 bg-orange-50", filter: "pagar", today: false },
                  { title: "A receber", value: totals.receive, Icon: Wallet, style: "text-blue-600 bg-blue-50", filter: "receber", today: false },
                ] as const).map(({ title, value, Icon: CardIcon, style, filter: targetFilter, today: isToday }) => {
                  return (
                    <button
                      key={title}
                      type="button"
                      onClick={() => {
                        if (isToday) {
                          openPayToday();
                          return;
                        }
                        setFilter("Todos");
                        setCounterpartyFilter("todos");
                        setOverdueKind("todos");
                        setPeriodMode("mes");
                        setEntryFilter(targetFilter);
                        setScreen("lancamentos");
                      }}
                      aria-label={`${title}: ${fmt(value)}. Ver lançamentos`}
                      className="rounded-2xl bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
                    >
                      <div
                        className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl ${style}`}
                      >
                        <CardIcon className="h-5 w-5" />
                      </div>
                      <p className="text-xs font-bold text-gray-400">
                        {title}
                      </p>
                      <p className="mt-1 text-2xl font-extrabold text-[#14213d]">
                        {fmt(value)}
                      </p>
                      <p className="mt-2 text-[11px] font-semibold text-blue-700">
                        {isToday
                          ? payToday.length > 0
                            ? `${payToday.length} conta(s) · Ver →`
                            : "Nada hoje ✓"
                          : "Ver lançamentos →"}
                      </p>
                    </button>
                  );
                })}
              </section>
              <section className="mt-5 rounded-2xl border border-red-100 bg-white p-5 shadow-sm">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-extrabold text-[#14213d]">
                      Contas em atraso
                    </h2>
                    <p className="text-xs text-gray-400">
                      Lançamentos previstos cujo vencimento já passou.
                    </p>
                  </div>
                  <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-extrabold text-red-600">
                    {overdue.length} {overdue.length === 1 ? "pendência" : "pendências"}
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => openOverdue("despesa")}
                    className="rounded-xl border border-red-100 bg-red-50 p-4 text-left transition hover:border-red-200 hover:bg-red-100"
                  >
                    <span className="text-xs font-bold text-red-600">
                      Contas a pagar atrasadas
                    </span>
                    <b className="mt-1 block text-xl font-extrabold text-[#14213d]">
                      {fmt(overduePay.reduce((sum, entry) => sum + entry.amount, 0))}
                    </b>
                    <span className="mt-1 block text-[11px] font-medium text-red-700">
                      {overduePay.length} {overduePay.length === 1 ? "lançamento vencido" : "lançamentos vencidos"} · Ver lançamentos
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openOverdue("receita")}
                    className="rounded-xl border border-orange-100 bg-orange-50 p-4 text-left transition hover:border-orange-200 hover:bg-orange-100"
                  >
                    <span className="text-xs font-bold text-orange-600">
                      Contas a receber atrasadas
                    </span>
                    <b className="mt-1 block text-xl font-extrabold text-[#14213d]">
                      {fmt(overdueReceive.reduce((sum, entry) => sum + entry.amount, 0))}
                    </b>
                    <span className="mt-1 block text-[11px] font-medium text-orange-700">
                      {overdueReceive.length} {overdueReceive.length === 1 ? "lançamento vencido" : "lançamentos vencidos"} · Ver lançamentos
                    </span>
                  </button>
                </div>
              </section>
              <section className="mt-5 rounded-2xl bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="font-extrabold text-slate-900">
                      Minhas contas
                    </h2>
                    <p className="text-xs text-gray-400">
                      Saldo calculado pelos lancamentos realizados.
                    </p>
                  </div>
                  <span className="text-xs font-bold text-gray-400">
                    Uma conta por centro de custo
                  </span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {accounts
                    .filter(
                      (account) =>
                        currentUser.role === "master" ||
                        currentUser.units.includes(account.unit),
                    )
                    .map((account) => (
                      <div key={account.id} className="rounded-xl border p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-bold text-slate-900">
                              {account.name}
                            </p>
                            <p className="text-xs text-gray-400">
                              Conta manual
                            </p>
                          </div>
                          <p className="font-extrabold text-blue-600">
                            {fmt(balance(account.name))}
                          </p>
                        </div>
                        {currentUser.role === "master" && (
                          <button
                            onClick={() => adjust(account)}
                            className="mt-3 rounded-lg border px-2.5 py-1.5 text-xs font-bold text-gray-600"
                          >
                            Ajustar saldo
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              </section>
              <section className="mt-5 grid gap-4 lg:grid-cols-4">
                {allowedUnits.map((u) => {
                  const d = current.filter((x) => x.unit === u.name),
                    income = d
                      .filter(
                        (x) => x.kind === "receita" && x.status === "realizado",
                      )
                      .reduce((s, x) => s + entryValue(x), 0),
                    expense = d
                      .filter(
                        (x) => x.kind === "despesa" && x.status === "realizado",
                      )
                      .reduce((s, x) => s + entryValue(x), 0);
                  return (
                    <article
                      key={u.name}
                      className={`rounded-2xl border p-4 ${u.tint}`}
                    >
                      <div className="flex gap-3">
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-xl text-xs font-bold text-white ${u.color}`}
                        >
                          {u.initials}
                        </div>
                        <div>
                          <h3 className="font-extrabold text-[#14213d]">
                            {u.name}
                          </h3>
                          <p className="text-[11px] text-gray-500">
                            Plano de contas próprio
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                        <p>
                          Receitas recebidas
                          <b className="block text-emerald-600">
                            {fmt(income)}
                          </b>
                        </p>
                        <p>
                          Despesas pagas
                          <b className="block text-red-600">{fmt(expense)}</b>
                        </p>
                        <p>
                          A pagar
                          <b className="block text-orange-600">
                            {fmt(
                              d
                                .filter(
                                  (x) =>
                                    x.kind === "despesa" &&
                                    x.status === "previsto",
                                )
                                .reduce((s, x) => s + x.amount, 0),
                            )}
                          </b>
                        </p>
                        <p>
                          A receber
                          <b className="block text-blue-600">
                            {fmt(
                              d
                                .filter(
                                  (x) =>
                                    x.kind === "receita" &&
                                    x.status === "previsto",
                                )
                                .reduce((s, x) => s + x.amount, 0),
                            )}
                          </b>
                        </p>
                      </div>
                    </article>
                  );
                })}
              </section>
              <section className="mt-5 grid gap-4 lg:grid-cols-2">
                <Breakdown
                  kind="receita"
                  entries={current}
                  categories={categories}
                />
                <Breakdown
                  kind="despesa"
                  entries={current}
                  categories={categories}
                />
              </section>
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <CounterpartyOverview kind="despesa" entries={current} contacts={contacts.filter((contact) => allowedUnits.some((allowed) => allowed.name === contact.unit))} todayKey={today} />
                <CounterpartyOverview kind="receita" entries={current} contacts={contacts.filter((contact) => allowedUnits.some((allowed) => allowed.name === contact.unit))} todayKey={today} />
              </div>
              <section className="mt-5 rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="font-extrabold text-[#14213d]">
                  Lançamentos de {labelMonth(month)}
                </h2>
                <p className="mb-4 text-xs text-gray-400">
                  Atualizados automaticamente conforme os lançamentos.
                </p>
                <Entries
                  entries={current.slice(0, 5)}
                  categories={categories}
                  settle={settle}
                  edit={(x) =>
                    x.seriesId
                      ? setScopeDialog({ entry: x, action: "editar" })
                      : (setEditScope("one"), setEditing(x), setModal(x.kind))
                  }
                  remove={(x) =>
                    x.seriesId
                      ? setScopeDialog({ entry: x, action: "excluir" })
                      : remove(x, "one")
                  }
                />
              </section>
            </>
          ) : screen === "contas" ? (
            <section className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h2 className="font-extrabold text-slate-900">
                    Contas dos centros de custo
                  </h2>
                  <p className="text-xs text-gray-400">
                    Cada conta representa um centro. Ajustes viram lancamentos
                    automaticamente.
                  </p>
                </div>
                {currentUser.role === "master" && (
                  <button
                    onClick={addAccount}
                    className="rounded-xl bg-blue-700 px-3 py-2 text-xs font-bold text-white"
                  >
                    + Nova conta
                  </button>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {accounts
                  .filter(
                    (account) =>
                      currentUser.role === "master" ||
                      currentUser.units.includes(account.unit),
                  )
                  .map((account) => (
                    <article
                      key={account.id}
                      className="rounded-2xl border p-5"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-extrabold text-slate-900">
                            {account.name}
                          </p>
                          <p className="text-xs text-gray-400">
                            Centro de custo
                          </p>
                        </div>
                        <p className="text-lg font-extrabold text-blue-600">
                          {fmt(balance(account.name))}
                        </p>
                      </div>
                      {currentUser.role === "master" && (
                        <button
                          onClick={() => adjust(account)}
                          className="mt-4 rounded-xl border px-3 py-2 text-xs font-bold text-gray-700"
                        >
                          Ajustar saldo
                        </button>
                      )}
                    </article>
                  ))}
              </div>
            </section>
          ) : screen === "contatos" ? (
            <ContactsScreen
              contacts={contacts}
              allowedUnits={allowedUnits}
              tableReady={contactsTableReady}
              save={async (contact) => {
                if (!allowedUnits.some((unit) => unit.name === contact.unit))
                  throw new Error("Este centro de custo não está disponível para seu acesso.");
                const saved = await saveRemoteCounterparty(contact);
                const savedContact = saved as Counterparty;
                setSavedContacts((old) => [
                  ...old.filter((item) => item.id !== savedContact.id),
                  savedContact,
                ]);
                setEntries((old) => old.map((entry) =>
                  entry.counterpartyId === savedContact.id
                    ? { ...entry, beneficiary: savedContact.name }
                    : entry,
                ));
              }}
              archive={async (contact, archived) => {
                if (!allowedUnits.some((unit) => unit.name === contact.unit))
                  throw new Error("Este centro de custo não está disponível para seu acesso.");
                const updated = await setRemoteCounterpartyArchived(contact.id, archived);
                setSavedContacts((old) =>
                  old.map((item) => item.id === contact.id ? updated as Counterparty : item),
                );
              }}
            />
          ) : screen === "notas" ? (
            <TeamNotesScreen />
          ) : screen === "relatorios" ? (
            <Reports
              entries={entries.filter(
                (entry) =>
                  currentUser.role === "master" ||
                  currentUser.units.includes(entry.unit),
              )}
              accounts={accounts}
              allowedUnits={allowedUnits}
              categories={categories}
              contacts={contacts.filter((contact) => allowedUnits.some((allowed) => allowed.name === contact.unit))}
            />
          ) : screen === "usuarios" ? (
            <UsersAdmin
              users={users}
              centers={centers}
              reload={loadUsers}
              createUser={createManagedUser}
              resetPassword={resetManagedUserPassword}
              toggleReports={toggleManagedUserReports}
              updatePermissions={updateManagedUserPermissions}
            />
          ) : screen === "categorias" ? (
            <section className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="mb-5 flex flex-wrap justify-between gap-3">
                <div>
                  <h2 className="font-extrabold text-[#14213d]">
                    Plano de contas por centro de custo
                  </h2>
                  <p className="text-xs text-gray-400">
                    Cada categoria pertence a uma receita/despesa e a um único
                    centro.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {currentUser.role === "master" && (
                    <button
                      onClick={() => setCenterModal(true)}
                      disabled={!centerTableReady}
                      title={!centerTableReady ? "Aplique a migração de centros de custo no banco" : undefined}
                      className="flex items-center gap-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 disabled:opacity-50"
                    >
                      <Plus className="h-4 w-4" />
                      Novo plano / centro
                    </button>
                  )}
                  <button
                    onClick={() => setCategoryModal(true)}
                    className="flex items-center gap-1 rounded-xl bg-blue-700 px-3 py-2 text-xs font-bold text-white"
                  >
                    <Plus className="h-4 w-4" />
                    Nova categoria
                  </button>
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {byUnit.map((u) => (
                  <article
                    key={u.name}
                    className={`rounded-2xl border p-4 ${u.tint}`}
                  >
                    <div className="mb-4 flex items-start gap-3">
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold text-white ${u.color}`}
                      >
                        {u.initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-extrabold text-[#14213d]">
                          {u.name}
                        </h3>
                        <p className="text-[11px] text-gray-500">
                          Categorias exclusivas
                        </p>
                      </div>
                      {currentUser.role === "master" && (
                        <div className="flex shrink-0 gap-1 text-xs font-bold">
                          <button
                            onClick={() => setEditingCenter(u)}
                            className="rounded px-1.5 py-1 text-blue-600 hover:bg-blue-50"
                            aria-label={`Editar plano ${u.name}`}
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => setDeletingCenter(u)}
                            className="rounded px-1.5 py-1 text-red-600 hover:bg-red-50"
                            aria-label={`Excluir plano ${u.name}`}
                          >
                            Excluir
                          </button>
                        </div>
                      )}
                    </div>
                    {(["receita", "despesa"] as Kind[]).map((k) => (
                      <div key={k} className="mb-3">
                        <p
                          className={`mb-2 text-[11px] font-extrabold uppercase ${k === "receita" ? "text-emerald-700" : "text-red-700"}`}
                        >
                          {k}s
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {u.categories
                            .filter((c) => c.kind === k)
                            .map((c) => (
                              <div
                                key={c.id}
                                className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 text-xs font-bold shadow-sm"
                              >
                                <Icon category={c} small />
                                <span>{c.name}</span>
                                <button
                                  onClick={() => setEditingCategory(c)}
                                  className="text-blue-600"
                                >
                                  Editar
                                </button>
                                <button
                                  onClick={() => setDeletingCategory(c)}
                                  className="rounded px-1.5 py-1 text-red-600 hover:bg-red-50"
                                  aria-label={`Excluir categoria ${c.name}`}
                                >
                                  Excluir
                                </button>
                              </div>
                            ))}
                          {!u.categories.some((c) => c.kind === k) && (
                            <span className="text-xs text-gray-400">
                              Nenhuma categoria
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </article>
                ))}
              </div>
            </section>
          ) : (
            <section className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="mb-5 flex flex-wrap justify-between gap-3">
                <div>
                  <h2 className="font-extrabold text-[#14213d]">
                    {entryFilter === "pagar"
                      ? "Contas a pagar"
                      : entryFilter === "receber"
                        ? "Contas a receber"
                        : entryFilter === "pagas"
                          ? "Despesas pagas"
                          : entryFilter === "recebidas"
                            ? "Receitas recebidas"
                        : entryFilter === "atrasadas"
                          ? overdueKind === "despesa"
                            ? "Contas a pagar atrasadas"
                            : overdueKind === "receita"
                              ? "Contas a receber atrasadas"
                              : "Contas atrasadas"
                        : "Todos os lançamentos"}
                  </h2>
                  <p className="text-xs text-gray-400">
                    {entryFilter === "atrasadas"
                      ? "Pendências vencidas de todos os meses."
                      : "Consulte, filtre e dê baixa nos lançamentos do mês."}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => open("despesa")}
                    className="flex items-center gap-1 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-100"
                  >
                    <Plus className="h-4 w-4" />
                    Nova despesa
                  </button>
                  <button
                    onClick={() => open("receita")}
                    className="flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-700"
                  >
                    <Plus className="h-4 w-4" />
                    Nova receita
                  </button>
                </div>
              </div>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {[
                      ["todos", "Todos"],
                      ["pagar", "Contas a pagar"],
                      ["receber", "Contas a receber"],
                      ["pagas", "Despesas pagas"],
                      ["recebidas", "Receitas recebidas"],
                      ["atrasadas", "Atrasadas"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => {
                          setEntryFilter(
                            value as "todos" | "pagar" | "receber" | "pagas" | "recebidas" | "atrasadas",
                          );
                          if (value !== "atrasadas") setOverdueKind("todos");
                        }}
                        className={`rounded-full px-3 py-2 text-xs font-bold ${entryFilter === value ? "bg-[#14213d] text-white" : "border bg-white text-gray-600 hover:bg-gray-50"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {entryFilter !== "atrasadas" && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                        Período:
                      </span>
                      {([
                        ["hoje", "Hoje"],
                        ["semana", "Semana"],
                        ["mes", "Mês"],
                        ["custom", "Personalizado"],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => {
                            if (value === "custom" && !periodFrom && !periodTo) {
                              const now = new Date();
                              setPeriodFrom(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`);
                              setPeriodTo(todayStr);
                            }
                            setPeriodMode(value);
                          }}
                          className={`rounded-full px-2.5 py-1.5 text-[11px] font-bold ${periodMode === value ? "bg-indigo-600 text-white" : "border bg-white text-gray-600"}`}
                        >
                          {label}
                        </button>
                      ))}
                      {periodMode === "custom" && (
                        <span className="flex items-center gap-1">
                          <input type="date" value={periodFrom} onChange={(event) => setPeriodFrom(event.target.value)} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold text-gray-700" />
                          <span className="text-gray-400">até</span>
                          <input type="date" value={periodTo} onChange={(event) => setPeriodTo(event.target.value)} className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold text-gray-700" />
                        </span>
                      )}
                    </div>
                  )}
                  {entryFilter === "atrasadas" && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                        Tipo:
                      </span>
                      {[
                        ["todos", "Todas"],
                        ["despesa", "A pagar"],
                        ["receita", "A receber"],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          onClick={() => setOverdueKind(value as Kind | "todos")}
                          className={`rounded-full px-2.5 py-1.5 text-[11px] font-bold ${overdueKind === value ? "bg-red-600 text-white" : "border bg-white text-gray-600"}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-gray-400">
                      Centro de custo:
                    </span>
                    <button
                      onClick={() => setFilter("Todos")}
                      className={`rounded-full px-2.5 py-1.5 text-[11px] font-bold ${filter === "Todos" ? "bg-blue-700 text-white" : "border bg-white text-gray-600"}`}
                    >
                      Todos
                    </button>
                    {allowedUnits.map((unit) => (
                      <button
                        key={unit.name}
                        onClick={() => setFilter(unit.name)}
                        className={`rounded-full px-2.5 py-1.5 text-[11px] font-bold ${filter === unit.name ? "bg-blue-700 text-white" : "border bg-white text-gray-600"}`}
                      >
                        {unit.name}
                      </button>
                    ))}
                  </div>
                  <label className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                    Fornecedor / favorecido ou cliente / pagador:
                    <select
                      value={counterpartyFilter}
                      onChange={(event) => setCounterpartyFilter(event.target.value)}
                      className="max-w-full min-w-52 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold normal-case tracking-normal text-gray-700"
                    >
                      <option value="todos">Todos</option>
                      {(["despesa", "receita"] as Kind[]).map((kind) => (
                        <optgroup
                          key={kind}
                          label={kind === "despesa" ? "Fornecedores / favorecidos" : "Clientes / pagadores"}
                        >
                          {counterparties
                            .filter((person) => person.kind === kind)
                            .map((person) => (
                              <option key={person.key} value={person.key}>
                                {person.name}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                </div>
                {entryFilter === "atrasadas" ? (
                  <span className="rounded-full bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600">Todos os meses</span>
                ) : periodMode === "mes" ? (
                  <Month value={month} move={move} />
                ) : (
                  <span className="rounded-full bg-indigo-50 px-3 py-2 text-xs font-bold text-indigo-700">
                    {new Date(`${period.start}T12:00:00`).toLocaleDateString("pt-BR")} – {new Date(`${period.end}T12:00:00`).toLocaleDateString("pt-BR")}
                  </span>
                )}
              </div>
              <div className="mb-5 grid gap-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-bold text-gray-500">Receitas exibidas</p>
                  <p className="text-lg font-extrabold text-emerald-700">{fmt(listTotals.receita)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-500">Despesas exibidas</p>
                  <p className="text-lg font-extrabold text-red-600">{fmt(listTotals.despesa)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-gray-500">Total dos lançamentos exibidos</p>
                  <p className="text-lg font-extrabold text-[#14213d]">
                    {fmt(listTotals.receita + listTotals.despesa)}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    {list.length} {list.length === 1 ? "lançamento" : "lançamentos"} · previstos e realizados
                  </p>
                </div>
              </div>
              <Entries
                entries={list}
                categories={categories}
                settle={settle}
                edit={(x) =>
                  x.seriesId
                    ? setScopeDialog({ entry: x, action: "editar" })
                    : (setEditScope("one"), setEditing(x), setModal(x.kind))
                }
                remove={(x) =>
                  x.seriesId
                    ? setScopeDialog({ entry: x, action: "excluir" })
                    : remove(x, "one")
                }
              />
            </section>
          )}
        </div>
      </main>
      {centerModal && <CostCenterForm close={() => setCenterModal(false)} save={createCenter} />}
      {editingCenter && (
        <CostCenterForm
          editing={editingCenter}
          close={() => setEditingCenter(null)}
          save={(_name, initials, color) => updateCenter(editingCenter.name, initials, color)}
        />
      )}
      {deletingCenter && (
        <DeleteCostCenter
          center={deletingCenter}
          categoryCount={categories.filter((item) => item.unit === deletingCenter.name).length}
          entryCount={entries.filter((item) => item.unit === deletingCenter.name).length}
          close={() => setDeletingCenter(null)}
          confirm={() => deleteCenter(deletingCenter.name)}
        />
      )}
      {modal && (
        <EntryForm
          kind={modal}
          categories={categories}
          contacts={contacts}
          contactsTableReady={contactsTableReady}
          allowedUnits={allowedUnits}
          editing={editing}
          scope={editScope}
          close={() => {
            setModal(null);
            setEditing(null);
          }}
          save={save}
        />
      )}{" "}
      {scopeDialog && (
        <ScopeDialog
          action={scopeDialog.action}
          close={() => setScopeDialog(null)}
          one={() => {
            const d = scopeDialog;
            if (d.action === "excluir") remove(d.entry, "one");
            else {
              setEditScope("one");
              setEditing(d.entry);
              setModal(d.entry.kind);
            }
            setScopeDialog(null);
          }}
          series={() => {
            const d = scopeDialog;
            if (d.action === "excluir") remove(d.entry, "series");
            else {
              setEditScope("series");
              setEditing(d.entry);
              setModal(d.entry.kind);
            }
            setScopeDialog(null);
          }}
        />
      )}{" "}
      {categoryModal && (
        <NewCategory
          close={() => setCategoryModal(false)}
          allowedUnits={allowedUnits}
          save={async (c) => {
            await saveRemoteCategory(c);
            setCategories((x) => [...x, c]);
          }}
        />
      )}{" "}
      {editingCategory && (
        <NewCategory
          category={editingCategory}
          allowedUnits={allowedUnits}
          close={() => setEditingCategory(null)}
          save={async (c) => {
            await saveRemoteCategory(c);
            setCategories((old) => old.map((x) => (x.id === c.id ? c : x)));
          }}
        />
      )}
      {deletingCategory && (
        <DeleteCategoryDialog
          category={deletingCategory}
          close={() => setDeletingCategory(null)}
          remove={() => removeCategory(deletingCategory)}
        />
      )}
    </div>
  );
}
export default App;
