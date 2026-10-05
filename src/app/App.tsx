import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import {
  readAuthenticatedRows,
  supabase,
  supabasePublishableKey,
  supabaseUrl,
} from "../lib/supabase";
import {
  deleteRemoteCategory,
  deleteRemoteEntries,
  deleteRemoteEntrySeries,
  saveRemoteCategory,
  saveRemoteEntries,
} from "../lib/bridge";
import {
  AlertTriangle,
  Bell,
  BarChart3,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  LayoutDashboard,
  Menu,
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
type Unit = "Marketing" | "Sítio" | "Consultoria" | "Pessoa Física";
type Entry = {
  id: string;
  seriesId?: string;
  kind: Kind;
  unit: Unit;
  account: string;
  category: string;
  description: string;
  beneficiary: string;
  pix: string;
  amount: number;
  date: string;
  status: "previsto" | "realizado";
  recurrence: "nenhuma" | "mensal";
  installments: number;
  installment?: string;
  notes?: string;
};
type Category = {
  id: string;
  name: string;
  kind: Kind;
  unit: Unit;
  icon?: string;
  color?: string;
};
type Account = { id: string; name: string; unit: Unit };
type User = {
  id: string;
  name: string;
  email: string;
  role: "master" | "operador";
  units: Unit[];
  canViewReports: boolean;
};
const units: { name: Unit; initials: string; color: string; tint: string }[] = [
  {
    name: "Marketing",
    initials: "MK",
    color: "bg-fuchsia-600",
    tint: "border-fuchsia-100 bg-fuchsia-50",
  },
  {
    name: "Sítio",
    initials: "SI",
    color: "bg-emerald-600",
    tint: "border-emerald-100 bg-emerald-50",
  },
  {
    name: "Consultoria",
    initials: "CO",
    color: "bg-blue-600",
    tint: "border-blue-100 bg-blue-50",
  },
  {
    name: "Pessoa Física",
    initials: "PF",
    color: "bg-amber-500",
    tint: "border-amber-100 bg-amber-50",
  },
];
const reportsAccessFlag = "__reports__";
const allowedUnitValues = units.map((unit) => unit.name);
const profileAccess = (values: string[] | null | undefined) => {
  const raw = values || [];
  return {
    units: raw.filter((value): value is Unit =>
      allowedUnitValues.includes(value as Unit),
    ),
    canViewReports: raw.includes(reportsAccessFlag),
  };
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
const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const parseMoney = (value: string) => {
  const raw = value.replace(/R\$\s?/gi, "").replace(/\s/g, "");
  if (!raw) return NaN;
  if (raw.includes(","))
    return Number(raw.replace(/\./g, "").replace(",", "."));
  const parts = raw.split(".");
  // In Brazilian notation, 1.500 means fifteen hundred. A dot followed by
  // one or two digits is still accepted as a decimal separator for convenience.
  if (parts.length > 1 && (parts.length > 2 || parts.at(-1)!.length === 3))
    return Number(parts.join(""));
  return Number(raw);
};
const moneyInput = (value: number) =>
  value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
function CurrencyInput({
  value,
  onChange,
  className = "",
  placeholder = "0,00",
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const parsed = parseMoney(value);
  const display = value && Number.isFinite(parsed) ? moneyInput(parsed) : "";
  return (
    <div className="relative mt-1.5">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-bold text-gray-400">
        R$
      </span>
      <input
        required
        inputMode="numeric"
        value={display}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "");
          onChange(digits ? String(Number(digits) / 100) : "");
        }}
        className={`w-full rounded-xl border bg-gray-50 p-3 pl-10 text-sm font-normal ${className}`}
        placeholder={placeholder}
      />
    </div>
  );
}
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
const labelMonth = (d: Date) =>
  d
    .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    .replace(/^./, (c) => c.toUpperCase());

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
function Month({ value, move }: { value: Date; move: (n: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-3 rounded-xl border bg-gray-50 px-3 py-2.5">
      <button
        onClick={() => move(-1)}
        className="rounded-lg p-1.5 hover:bg-white"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <span className="min-w-40 text-center text-sm font-extrabold text-[#14213d]">
        {labelMonth(value)}
      </span>
      <button
        onClick={() => move(1)}
        className="rounded-lg p-1.5 hover:bg-white"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
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
      .select("full_name, role, allowed_units")
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
function EntryForm({
  kind: initial,
  categories,
  allowedUnits,
  editing,
  scope: initialScope,
  close,
  save,
}: {
  kind: Kind;
  categories: Category[];
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
    [unit, setUnit] = useState<Unit>(editing?.unit ?? "Consultoria"),
    [category, setCategory] = useState(editing?.category ?? ""),
    [description, setDescription] = useState(editing?.description ?? ""),
    [beneficiary, setBeneficiary] = useState(editing?.beneficiary ?? ""),
    [pix, setPix] = useState(editing?.pix ?? ""),
    [notes, setNotes] = useState(editing?.notes ?? ""),
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
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState("");
  const available = categories.filter(
    (c) => c.unit === unit && c.kind === kind,
  );
  useEffect(() => {
    if (!available.some((c) => c.name === category))
      setCategory(available[0]?.name ?? "");
  }, [kind, unit, categories]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const v = parseMoney(amount);
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
      await save(
        {
          kind,
          unit,
          // Every centre has its own financial account. Keeping this derived
          // prevents the duplicated centre/account selectors from diverging.
          account: unit,
          category,
          description,
          beneficiary,
          pix: kind === "despesa" ? pix : "",
          notes,
          amount: v,
          date,
          status,
          recurrence: recurrence ? "mensal" : "nenhuma",
          installments: sameMonthInstallments ? 1 : installments,
        },
        scope,
        sameMonthInstallments ? sameMonthPartsState : undefined,
      );
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
              onClick={() => setKind("despesa")}
              className={`p-3 ${kind === "despesa" ? "bg-red-600 text-white" : "text-gray-500"}`}
            >
              Despesa
            </button>
            <button
              type="button"
              onClick={() => setKind("receita")}
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
                onChange={(e) => setUnit(e.target.value as Unit)}
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
            <label className="text-xs font-bold">
              {kind === "despesa"
                ? "Fornecedor / favorecido (opcional)"
                : "Cliente / pagador (opcional)"}
              <input
                value={beneficiary}
                onChange={(e) => setBeneficiary(e.target.value)}
                placeholder={
                  kind === "despesa"
                    ? "Quem receberá este pagamento"
                    : "Quem fez este pagamento"
                }
                className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
              />
            </label>
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
  reload,
  createUser,
  resetPassword,
  toggleReports,
  updatePermissions,
}: {
  users: User[];
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
  };
  const toggleEditUnit = (unit: Unit) =>
    setEditUnits((current) =>
      current.includes(unit)
        ? current.filter((item) => item !== unit)
        : [...current, unit],
    );
  const savePermissions = async (user: User) => {
    setSavingPermissions(true);
    setError("");
    try {
      await updatePermissions(user, editUnits, editCanViewReports);
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
              {units.map((unit) => (
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
                    {units.map((unit) => (
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
              </div>
              <div className="text-right">
                <p
                  className={`text-sm font-extrabold ${x.kind === "receita" ? "text-emerald-600" : "text-red-600"}`}
                >
                  {x.kind === "receita" ? "+" : "-"}
                  {fmt(x.amount)}
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
        (r, x) => ({ ...r, [x.category]: (r[x.category] || 0) + x.amount }),
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
function Reports({
  entries,
  accounts,
  allowedUnits,
  categories,
}: {
  entries: Entry[];
  accounts: Account[];
  allowedUnits: typeof units;
  categories: Category[];
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
  const filtered = entries.filter(
    (entry) =>
      entry.date >= from &&
      entry.date <= to &&
      (unit === "Todos" || entry.unit === unit) &&
      (account === "Todos" || entry.account === account) &&
      (category === "Todos" || entry.category === category) &&
      (kind === "todos" || entry.kind === kind),
  );
  const total = (entryKind: Kind, status?: Entry["status"]) =>
    filtered
      .filter(
        (entry) =>
          entry.kind === entryKind && (!status || entry.status === status),
      )
      .reduce((sum, entry) => sum + entry.amount, 0);
  const income = total("receita");
  const expense = total("despesa");
  const pendingPay = total("despesa", "previsto");
  const pendingReceive = total("receita", "previsto");
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
      existing.total += entry.amount;
      existing.count += 1;
      if (entry.status === "realizado") existing.realized += entry.amount;
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
      bucket[key] += entry.amount;
    });
  }
  const beneficiaries = Object.entries(
    filtered
      .filter((entry) => entry.beneficiary.trim())
      .reduce<Record<string, number>>((result, entry) => {
        const label = entry.beneficiary.trim();
        result[label] = (result[label] || 0) + entry.amount;
        return result;
      }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const counterpartyTitle =
    kind === "despesa"
      ? "Fornecedores / favorecidos"
      : kind === "receita"
        ? "Clientes / pagadores"
        : "Contrapartes informadas";
  const counterpartyEmpty =
    kind === "despesa"
      ? "Nenhum fornecedor ou favorecido informado."
      : kind === "receita"
        ? "Nenhum cliente ou pagador informado."
        : "Nenhuma contraparte informada.";
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
            sum + (entry.kind === "receita" ? entry.amount : -entry.amount),
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
              onChange={(event) =>
                setKind(event.target.value as Kind | "todos")
              }
              className="mt-1.5 block rounded-xl border bg-gray-50 p-2.5 text-sm font-normal"
            >
              <option value="todos">Todos</option>
              <option value="receita">Receitas</option>
              <option value="despesa">Despesas</option>
            </select>
          </label>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Receitas no período", income, "text-emerald-600"],
          ["Despesas no período", expense, "text-red-600"],
          [
            "Resultado projetado",
            income - expense,
            income - expense >= 0 ? "text-blue-700" : "text-red-600",
          ],
          ["Resultado realizado", realizedIncome - realizedExpense, realizedIncome >= realizedExpense ? "text-blue-700" : "text-red-600"],
          ["A pagar", pendingPay, "text-orange-600"],
          ["A receber", pendingReceive, "text-blue-700"],
          ["Pagar vencido", overduePay, "text-red-600"],
          ["Receber vencido", overdueReceive, "text-orange-600"],
        ].map(([label, value, color]) => (
          <article
            key={label as string}
            className="rounded-2xl bg-white p-5 shadow-sm"
          >
            <p className="text-xs font-bold text-gray-400">{label}</p>
            <p className={`mt-2 text-2xl font-extrabold ${color}`}>
              {fmt(value as number)}
            </p>
          </article>
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
                  <Bar dataKey="Receitas recebidas" stackId="receita" fill="#059669" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Receitas previstas" stackId="receita" fill="#6ee7b7" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Despesas pagas" stackId="despesa" fill="#dc2626" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Despesas previstas" stackId="despesa" fill="#fca5a5" radius={[3, 3, 0, 0]} />
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
                      <Pie data={rows} dataKey="total" nameKey="name" innerRadius={58} outerRadius={92} paddingAngle={2} stroke="none">
                        {rows.map((item) => <Cell key={item.key} fill={item.color} />)}
                      </Pie>
                      <Tooltip formatter={(value, _name, item) => [fmt(Number(value)), `${item.payload.name} · ${item.payload.unit}`]} contentStyle={{ borderRadius: 12, borderColor: "#e2e8f0" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  {rows.map((item) => (
                    <div key={item.key} className="flex items-center gap-2 text-xs">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="min-w-0 flex-1 truncate text-slate-700" title={`${item.name} · ${item.unit}`}>{item.name} <span className="text-slate-400">· {item.unit}</span></span>
                      <b className="text-slate-800">{totalValue ? Math.round(item.total / totalValue * 100) : 0}%</b>
                      <span className="w-24 text-right font-bold text-slate-700">{fmt(item.total)}</span>
                    </div>
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
                  <tr key={item.key} className="hover:bg-slate-50">
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
                      <Bar dataKey="total" name="Despesa" radius={[0, 5, 5, 0]}>
                        {expenseDetails.slice(0, 8).reverse().map((item) => <Cell key={item.key} fill={item.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              <div className="mt-5 divide-y divide-slate-100 border-t border-slate-100">
                {expenseDetails.slice(0, 8).map((item) => (
                  <div key={item.key} className="flex flex-wrap items-center justify-between gap-2 py-3 text-xs">
                    <span className="font-bold text-slate-800"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />{item.name} <span className="font-normal text-slate-400">· {item.unit}</span></span>
                    <span className="text-slate-500">{item.count} lançamentos · Pago {fmt(item.realized)} · A pagar {fmt(item.pending)}</span>
                  </div>
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
              <div key={entry.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800" title={entry.description}>{entry.description}</p>
                  <p className="truncate text-xs text-slate-400">{entry.category} · {entry.unit} · {dateLabel(entry.date)}</p>
                  <p className="text-[11px] text-slate-400">{entry.status === "realizado" ? "Pago" : entry.date < todayKey ? "Vencido" : "A pagar"}{entry.installment ? ` · Parcela ${entry.installment}` : entry.recurrence === "mensal" ? " · Recorrente" : ""}</p>
                </div>
                <b className="shrink-0 text-sm text-red-600">{fmt(entry.amount)}</b>
              </div>
            ))}
            {!largestExpenses.length && <p className="py-5 text-sm text-slate-400">Sem despesas no período.</p>}
          </div>
        </section>
      </div>
      <div>
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="font-extrabold text-[#14213d]">{counterpartyTitle}</h2>
          <p className="mt-1 text-xs text-gray-400">
            Campo opcional nos lançamentos.
          </p>
          <div className="mt-4 divide-y">
            {beneficiaries.map(([label, value]) => (
              <div
                key={label}
                className="flex justify-between gap-4 py-3 text-sm"
              >
                <span className="font-bold text-gray-700">{label}</span>
                <span className="font-extrabold text-slate-900">
                  {fmt(value)}
                </span>
              </div>
            ))}
            {!beneficiaries.length && (
              <p className="py-5 text-sm text-gray-400">{counterpartyEmpty}</p>
            )}
          </div>
        </section>
      </div>
      <section className="rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="font-extrabold text-[#14213d]">
          Movimento realizado por conta no período
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {accountRows.map((item) => (
            <div key={`${item.unit}:${item.name}`} className="rounded-xl border p-4">
              <p className="font-bold text-slate-800">{item.name}</p>
              <p className="text-xs text-gray-400">{item.unit}</p>
              <p
                className={`mt-3 text-lg font-extrabold ${item.balance >= 0 ? "text-blue-700" : "text-red-600"}`}
              >
                {fmt(item.balance)}
              </p>
            </div>
          ))}
        </div>
      </section>
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
    [editingCategory, setEditingCategory] = useState<Category | null>(null),
    [deletingCategory, setDeletingCategory] = useState<Category | null>(null),
    [editing, setEditing] = useState<Entry | null>(null),
    [scopeDialog, setScopeDialog] = useState<{
      entry: Entry;
      action: "editar" | "excluir";
    } | null>(null),
    [editScope, setEditScope] = useState<"one" | "series">("one"),
    [entries, setEntries] = useState<Entry[]>([]),
    [categories, setCategories] = useState<Category[]>([]),
    [accounts, setAccounts] = useState<Account[]>(() =>
      units.map((unit) => ({
        id: unit.name,
        name: unit.name,
        unit: unit.name,
      })),
    ),
    [filter, setFilter] = useState<Unit | "Todos">("Todos"),
    [entryFilter, setEntryFilter] = useState<
      "todos" | "pagar" | "receber" | "atrasadas"
    >("todos"),
    [overdueKind, setOverdueKind] = useState<Kind | "todos">("todos"),
    [notificationsOpen, setNotificationsOpen] = useState(false),
    [menu, setMenu] = useState(false),
    [users, setUsers] = useState<User[]>([]),
    [dataReady, setDataReady] = useState(false),
    [dataError, setDataError] = useState(""),
    [month, setMonth] = useState(
      () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
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
        .select("full_name, email, role, allowed_units")
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
          amount: Number(row.amount),
        })) as Entry[];
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
  const loadUsers = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, allowed_units")
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
            (profile.id === currentUser?.id ? currentUser.email : ""),
          role: profile.role as User["role"],
          units: access.units,
          canViewReports: access.canViewReports,
        };
      }),
    );
  };
  const removeCategory = async (category: Category) => {
    await deleteRemoteCategory(category.id);
    setCategories((old) => old.filter((item) => item.id !== category.id));
    setDeletingCategory(null);
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
  ) => {
    const { error } = await supabase
      .from("profiles")
      .update({
        allowed_units: [
          ...allowedUnits,
          ...(canViewReports ? [reportsAccessFlag] : []),
        ],
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
      ? units
      : units.filter((unit) => currentUser.units.includes(unit.name));
  const balance = (name: string) =>
      entries
        .filter((x) => x.account === name && x.status === "realizado")
        .reduce((s, x) => s + (x.kind === "receita" ? x.amount : -x.amount), 0),
    addAccount = async () => {
      if (currentUser.role !== "master") return;
      const name = window.prompt("Nome da nova conta:");
      if (!name?.trim()) return;
      const unit = window.prompt(
        "Centro de custo (Marketing, Sítio, Consultoria ou Pessoa Física):",
        "Consultoria",
      ) as Unit | null;
      if (!unit || !units.some((item) => item.name === unit)) return;
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
    sum = (k: Kind, status?: Entry["status"]) =>
      current
        .filter((x) => x.kind === k && (!status || x.status === status))
        .reduce((s, x) => s + x.amount, 0),
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
      setOverdueKind(kind);
      setEntryFilter("atrasadas");
      setNotificationsOpen(false);
      setScreen("lancamentos");
    },
    openNotification = (entry: Entry) => {
      if (entry.date < today) {
        openOverdue(entry.kind);
        return;
      }
      setFilter("Todos");
      setEntryFilter(entry.kind === "despesa" ? "pagar" : "receber");
      setMonth(new Date(`${entry.date}T12:00:00`));
      setNotificationsOpen(false);
      setScreen("lancamentos");
    };
  const save = async (
      data: Omit<Entry, "id">,
      scope: "one" | "series",
      monthParts?: SameMonthPart[],
    ) => {
      if (editing) {
        const isWholeSeries = scope === "series" && Boolean(editing.seriesId);
        const updated = entries.map((x) =>
          (
            isWholeSeries
              ? x.seriesId === editing.seriesId
              : x.id === editing.id
          )
            ? {
                ...x,
                ...data,
                id: x.id,
                seriesId: x.seriesId,
                // The form date belongs to the occurrence being edited. On a
                // whole-series update, every occurrence must retain its own
                // due date; only its shared financial details change.
                date: isWholeSeries ? x.date : data.date,
                installment: x.installment,
              }
            : x,
        );
        const changed = updated.filter((x) =>
          isWholeSeries ? x.seriesId === editing.seriesId : x.id === editing.id,
        );
        await saveRemoteEntries(changed);
        setEntries(updated);
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
        return;
      }
      const base = new Date(`${data.date}T12:00:00`),
        seriesId =
          data.recurrence === "mensal" || data.installments > 1
            ? id()
            : undefined,
        count = data.recurrence === "mensal" ? 36 : data.installments;
      const created = Array.from({ length: count }, (_, i) => {
        const due = new Date(base);
        due.setMonth(base.getMonth() + i);
        return {
          ...data,
          id: id(),
          seriesId,
          amount:
            data.recurrence === "mensal"
              ? data.amount
              : data.amount / data.installments,
          date: due.toISOString().slice(0, 10),
          status: i === 0 ? data.status : "previsto",
          installments: 1,
          installment:
            data.installments > 1 ? `${i + 1}/${data.installments}` : undefined,
        };
      });
      await saveRemoteEntries(created);
      setEntries((old) => [...created, ...old]);
    },
    settle = async (x: Entry) => {
      const updated = {
        ...x,
        status: x.status === "realizado" ? "previsto" : "realizado",
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
      setEditing(null);
      setModal(kind);
      setScreen("lancamentos");
    },
    list = (entryFilter === "atrasadas" ? overdue : current)
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
          (entryFilter === "atrasadas" &&
            (overdueKind === "todos" || x.kind === overdueKind)),
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
      { id: "relatorios", text: "Relatórios", Icon: BarChart3 },
      { id: "usuarios", text: "Usuários", Icon: Menu },
    ];
  return (
    <div className="flex h-screen overflow-hidden bg-[#f2f4f8]">
      <aside
        className={`fixed z-30 flex h-full w-56 flex-col bg-[#14213d] text-white transition-transform lg:relative ${menu ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
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
            .filter(
              (x) =>
                (currentUser.role === "master" || x.id !== "usuarios") &&
                (x.id !== "relatorios" ||
                  currentUser.role === "master" ||
                  currentUser.canViewReports),
            )
            .map((x) => (
              <button
                key={x.id}
                onClick={() => {
                  setScreen(x.id);
                  if (x.id === "lancamentos") {
                    setFilter("Todos");
                    setEntryFilter("todos");
                    setOverdueKind("todos");
                  }
                  setMenu(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold ${screen === x.id ? "bg-blue-600" : "text-white/60"}`}
              >
                <x.Icon className="h-4 w-4" />
                {x.text}
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
                      : screen === "usuarios"
                        ? "Usuários e acessos"
                        : screen === "relatorios"
                          ? "Relatórios financeiros"
                          : "Lançamentos"}
              </h1>
              <p className="text-xs text-gray-400">
                Marketing, Sítio, Consultoria e Pessoa Física
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
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  [
                    "Receitas recebidas",
                    totals.income,
                    TrendingUp,
                    "text-emerald-600 bg-emerald-50",
                  ],
                  [
                    "Despesas pagas",
                    totals.expense,
                    TrendingDown,
                    "text-red-600 bg-red-50",
                  ],
                  [
                    "A pagar",
                    totals.pay,
                    CreditCard,
                    "text-orange-600 bg-orange-50",
                  ],
                  [
                    "A receber",
                    totals.receive,
                    Wallet,
                    "text-blue-600 bg-blue-50",
                  ],
                ].map(([t, v, I, s]) => {
                  const C = I as typeof TrendingUp;
                  return (
                    <article
                      key={t as string}
                      className="rounded-2xl bg-white p-5 shadow-sm"
                    >
                      <div
                        className={`mb-4 flex h-10 w-10 items-center justify-center rounded-xl ${s as string}`}
                      >
                        <C className="h-5 w-5" />
                      </div>
                      <p className="text-xs font-bold text-gray-400">
                        {t as string}
                      </p>
                      <p className="mt-1 text-2xl font-extrabold text-[#14213d]">
                        {fmt(v as number)}
                      </p>
                    </article>
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
                      .reduce((s, x) => s + x.amount, 0),
                    expense = d
                      .filter(
                        (x) => x.kind === "despesa" && x.status === "realizado",
                      )
                      .reduce((s, x) => s + x.amount, 0);
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
            />
          ) : screen === "usuarios" ? (
            <UsersAdmin
              users={users}
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
                <button
                  onClick={() => setCategoryModal(true)}
                  className="flex items-center gap-1 rounded-xl bg-blue-700 px-3 py-2 text-xs font-bold text-white"
                >
                  <Plus className="h-4 w-4" />
                  Nova categoria
                </button>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {byUnit.map((u) => (
                  <article
                    key={u.name}
                    className={`rounded-2xl border p-4 ${u.tint}`}
                  >
                    <div className="mb-4 flex gap-3">
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-xl text-xs font-bold text-white ${u.color}`}
                      >
                        {u.initials}
                      </div>
                      <div>
                        <h3 className="font-extrabold text-[#14213d]">
                          {u.name}
                        </h3>
                        <p className="text-[11px] text-gray-500">
                          Categorias exclusivas
                        </p>
                      </div>
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
                      ["atrasadas", "Atrasadas"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => {
                          setEntryFilter(
                            value as "todos" | "pagar" | "receber" | "atrasadas",
                          );
                          if (value !== "atrasadas") setOverdueKind("todos");
                        }}
                        className={`rounded-full px-3 py-2 text-xs font-bold ${entryFilter === value ? "bg-[#14213d] text-white" : "border bg-white text-gray-600 hover:bg-gray-50"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
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
                </div>
                <Month value={month} move={move} />
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
      {modal && (
        <EntryForm
          kind={modal}
          categories={categories}
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
