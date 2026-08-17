import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import {
  deleteRemoteCategory,
  deleteRemoteEntries,
  saveRemoteCategory,
  saveRemoteEntries,
} from "../lib/bridge";
import {
  Bell,
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
type Account = { id: string; name: string };
type User = {
  id: string;
  name: string;
  email: string;
  role: "master" | "operador";
  units: Unit[];
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
  ].map((name, index) => ({ id: `conta-${index}`, name })),
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
const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const labelMonth = (d: Date) =>
  d
    .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    .replace(/^./, (c) => c.toUpperCase());
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
function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError || !data.user) {
      setError("E-mail ou senha inválidos.");
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
      setError("Seu perfil de acesso não está configurado. Fale com o administrador.");
      setBusy(false);
      return;
    }
    const user = {
      id: data.user.id,
      name: profile.full_name,
      email: data.user.email || email,
      role: profile.role as User["role"],
      units: profile.allowed_units as Unit[],
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
          <p className="relative text-xl font-extrabold tracking-tight">fincore</p>
          <div className="relative max-w-xl py-12">
            <p className="mb-5 text-xs font-extrabold tracking-[.2em] text-blue-200">GESTÃO FINANCEIRA</p>
            <h1 className="text-5xl font-extrabold leading-[1.04] sm:text-6xl">Clareza para decidir. Controle para crescer.</h1>
            <p className="mt-7 max-w-lg text-lg leading-relaxed text-blue-100">Organize receitas, despesas, contas e operações com uma visão financeira construída para o seu dia a dia.</p>
          </div>
          <p className="relative text-sm text-blue-200">fincore · gestão que acompanha suas decisões</p>
        </section>
        <section className="flex items-center justify-center bg-[#f8fafc] p-8 sm:p-14">
          <form onSubmit={submit} className="w-full max-w-md">
            <img src="/sistema-financeiro/fincore-logo-transparent.png" alt="Fincore" className="mb-12 w-64 max-w-full" />
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
            <button disabled={busy} className="mt-6 w-full rounded-xl bg-blue-700 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-700/20 disabled:cursor-wait disabled:opacity-70">
              {busy ? "Entrando..." : "Entrar no Fincore"}
            </button>
            <p className="mt-6 text-center text-xs text-gray-400">Acesso protegido e gerenciado pelo administrador.</p>
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
              setSaveError(error instanceof Error ? error.message : "Não foi possível salvar no banco.");
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
          <button disabled={saving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-60">
            {saving ? "Salvando no banco..." : category ? "Salvar alteracoes" : "Criar categoria"}
          </button>
          {saveError && <p className="absolute -top-5 left-6 text-xs font-bold text-red-600">{saveError}</p>}
        </footer>
      </form>
    </div>
  );
}
function EntryForm({
  kind: initial,
  categories,
  accounts,
  allowedUnits,
  editing,
  scope: initialScope,
  close,
  save,
}: {
  kind: Kind;
  categories: Category[];
  accounts: Account[];
  allowedUnits: typeof units;
  editing: Entry | null;
  scope?: "one" | "series";
  close: () => void;
  save: (x: Omit<Entry, "id">, scope: "one" | "series") => Promise<void>;
}) {
  const [kind, setKind] = useState<Kind>(editing?.kind ?? initial),
    [unit, setUnit] = useState<Unit>(editing?.unit ?? "Consultoria"),
    [category, setCategory] = useState(editing?.category ?? ""),
    [account, setAccount] = useState(
      editing?.account ?? accounts[0]?.name ?? "",
    ),
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
    const v = Number(amount.replace(",", "."));
    if (!description.trim() || !v || !category) return;
    setSaving(true);
    setSaveError("");
    try {
      await save(
        {
          kind,
          unit,
          account,
          category,
          description,
          beneficiary,
          pix,
          notes,
          amount: v,
          date,
          status,
          recurrence: recurrence ? "mensal" : "nenhuma",
          installments,
        },
        scope,
      );
      close();
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Não foi possível salvar no banco.",
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
          <div className="grid gap-4 sm:grid-cols-2">
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
            <label className="text-xs font-bold">
              Conta / cartão
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
              >
                {accounts.map((a) => (
                  <option key={a.id}>{a.name}</option>
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
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-bold">
              Beneficiario / favorecido
              <input
                value={beneficiary}
                onChange={(e) => setBeneficiary(e.target.value)}
                className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
              />
            </label>
            <label className="text-xs font-bold">
              Chave PIX ou dados de pagamento
              <input
                value={pix}
                onChange={(e) => setPix(e.target.value)}
                className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
              />
            </label>
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
              <input
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal"
                placeholder="0,00"
              />
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
            <label className="flex items-center gap-2 text-sm font-bold">
              <CalendarClock className="h-4 w-4 text-blue-600" />
              Parcelas
              <input
                disabled={recurrence}
                min="1"
                max="120"
                type="number"
                value={installments}
                onChange={(e) => setInstallments(Number(e.target.value))}
                className="w-16 rounded-lg border bg-white p-1.5 text-center font-normal"
              />
            </label>
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
            {recurrence && (
              <p className="col-span-full text-xs text-blue-700">
                O valor será repetido mensalmente, sem divisão.
              </p>
            )}
            {!recurrence && installments > 1 && (
              <p className="col-span-full text-xs text-blue-700">
                {installments} parcelas de{" "}
                {fmt((Number(amount.replace(",", ".")) || 0) / installments)}.
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
          <button disabled={saving} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-60">
            {saving ? "Salvando no banco..." : "Salvar"}
          </button>
          {saveError && <p className="absolute -top-5 left-6 text-xs font-bold text-red-600">{saveError}</p>}
        </footer>
      </form>
    </div>
  );
}
function UsersAdmin({ users, reload, createUser, resetPassword }: { users: User[]; reload: () => Promise<void>; createUser: (data: { name: string; email: string; password: string; units: Unit[] }) => Promise<void>; resetPassword: (user: User) => Promise<void> }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [selectedUnits, setSelectedUnits] = useState<Unit[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const toggleUnit = (unit: Unit) => setSelectedUnits((current) => current.includes(unit) ? current.filter((item) => item !== unit) : [...current, unit]);
  const recover = async (user: User) => {
    setError("");
    setMessage("");
    try {
      await resetPassword(user);
      setMessage(`Senha de ${user.name} redefinida com sucesso.`);
    } catch (recoverError) {
      setError(recoverError instanceof Error ? recoverError.message : "Não foi possível enviar o link de redefinição.");
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await createUser({ name, email, password, units: selectedUnits });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Não foi possível criar o usuário.");
      setBusy(false);
      return;
    }
    setName("");
    setEmail("");
    setPassword("");
    setSelectedUnits([]);
    setMessage("Usuário criado. Ele já pode acessar somente os centros definidos.");
    await reload();
    setBusy(false);
  };
  return <section className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]"><form onSubmit={submit} className="rounded-2xl bg-white p-5 shadow-sm"><div className="mb-5"><h2 className="font-extrabold text-slate-900">Novo usuário</h2><p className="text-xs text-gray-400">Crie um acesso e determine os centros de custo visíveis.</p></div><div className="space-y-4"><label className="block text-xs font-bold text-gray-600">Nome<input required value={name} onChange={(event) => setName(event.target.value)} className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal" placeholder="Ex.: Bete Silva" /></label><label className="block text-xs font-bold text-gray-600">E-mail<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal" placeholder="nome@empresa.com" /></label><label className="block text-xs font-bold text-gray-600">Senha inicial<input required minLength={6} type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal" placeholder="Mínimo de 6 caracteres" /></label><fieldset><legend className="text-xs font-bold text-gray-600">Centros de custo permitidos</legend><div className="mt-2 grid grid-cols-2 gap-2">{units.map((unit) => <label key={unit.name} className={`flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-xs font-bold ${selectedUnits.includes(unit.name) ? "border-blue-300 bg-blue-50 text-blue-800" : "bg-white text-gray-600"}`}><input type="checkbox" checked={selectedUnits.includes(unit.name)} onChange={() => toggleUnit(unit.name)} />{unit.name}</label>)}</div></fieldset>{error && <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-600">{error}</p>}{message && <p className="rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-700">{message}</p>}<button disabled={busy} className="w-full rounded-xl bg-blue-700 py-3 text-sm font-bold text-white disabled:opacity-60">{busy ? "Criando..." : "Criar acesso"}</button></div></form><section className="rounded-2xl bg-white p-5 shadow-sm"><div className="mb-5"><h2 className="font-extrabold text-slate-900">Usuários ativos</h2><p className="text-xs text-gray-400">O Master enxerga tudo; operadores enxergam apenas os centros liberados.</p></div><div className="grid gap-3">{users.map((user) => <div key={user.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><p className="font-bold text-slate-900">{user.name}</p><p className="text-xs text-gray-400">{user.email || "E-mail não informado"} · {user.role === "master" ? "Master" : "Operador"}</p></div><div className="flex flex-wrap items-center gap-2">{user.role === "master" ? <span className="rounded-full bg-blue-700 px-2 py-1 text-xs font-bold text-white">Todos os centros</span> : <>{user.units.map((unit) => <span key={unit} className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">{unit}</span>)}<button onClick={() => void recover(user)} className="rounded-lg border border-amber-200 px-2.5 py-1.5 text-xs font-bold text-amber-700">Redefinir senha</button></>}</div></div>)}{!users.length && <p className="py-8 text-center text-sm text-gray-400">Carregando usuários…</p>}</div></section></section>;
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
                {x.pix && (
                  <p className="mt-1 truncate text-xs font-bold text-blue-700">
                    Chave Pix: {x.pix}
                  </p>
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
                  {x.status}
                  {x.recurrence === "mensal" ? " · mensal" : ""}
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
function App() {
  const [screen, setScreen] = useState("dashboard"),
    [currentUser, setCurrentUser] = useState<User | null>(() => {
      try {
        return JSON.parse(localStorage.getItem("fincore.user") || "null");
      } catch {
        return null;
      }
    }),
    [modal, setModal] = useState<Kind | null>(null),
    [categoryModal, setCategoryModal] = useState(false),
    [editingCategory, setEditingCategory] = useState<Category | null>(null),
    [editing, setEditing] = useState<Entry | null>(null),
    [scopeDialog, setScopeDialog] = useState<{
      entry: Entry;
      action: "editar" | "excluir";
    } | null>(null),
    [editScope, setEditScope] = useState<"one" | "series">("one"),
    [entries, setEntries] = useState<Entry[]>(() => {
      try {
        return JSON.parse(localStorage.getItem("financepro.entries") || "[]");
      } catch {
        return [];
      }
    }),
    [categories, setCategories] = useState<Category[]>(() => {
      try {
        const x = JSON.parse(
          localStorage.getItem("financepro.categories") || "null",
        );
        return x?.length ? x : defaults;
      } catch {
        return defaults;
      }
    }),
    [accounts, setAccounts] = useState<Account[]>(() =>
      units.map((unit) => ({ id: unit.name, name: unit.name })),
    ),
    [filter, setFilter] = useState<Unit | "Todos">("Todos"),
    [entryFilter, setEntryFilter] = useState<"todos" | "pagar" | "receber">(
      "todos",
    ),
    [menu, setMenu] = useState(false),
    [users, setUsers] = useState<User[]>([]),
    [dataReady, setDataReady] = useState(false),
    [dataError, setDataError] = useState(""),
    [month, setMonth] = useState(
      () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
    );
  useEffect(
    () => localStorage.setItem("financepro.entries", JSON.stringify(entries)),
    [entries],
  );
  useEffect(() => {
    if (currentUser)
      localStorage.setItem("fincore.user", JSON.stringify(currentUser));
    else localStorage.removeItem("fincore.user");
  }, [currentUser]);
  useEffect(
    () =>
      localStorage.setItem("financepro.categories", JSON.stringify(categories)),
    [categories],
  );
  useEffect(
    () => localStorage.setItem("financepro.accounts", JSON.stringify(accounts)),
    [accounts],
  );
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
      const [entryResult, categoryResult, accountResult] = await Promise.all([
        supabase.from("entries").select("*").order("date", { ascending: false }),
        supabase.from("categories").select("*"),
        supabase.from("accounts").select("*"),
      ]);
      if (!active) return;
      const error = entryResult.error || categoryResult.error || accountResult.error;
      if (error) {
        setDataError("Não foi possível carregar os dados do banco. Tente novamente.");
        setDataReady(true);
        return;
      }
      setEntries((entryResult.data || []).map((row: any) => ({
        ...row,
        seriesId: row.series_id || undefined,
        amount: Number(row.amount),
      })));
      setCategories(categoryResult.data || []);
      setAccounts((accountResult.data || []).map((row: any) => ({
        id: row.id,
        name: row.name,
      })));
      setDataReady(true);
    })();
    return () => {
      active = false;
    };
  }, [currentUser?.id]);
  const loadUsers = async () => {
    const { data } = await supabase.from("profiles").select("id, full_name, email, role, allowed_units").order("created_at");
    if (!data) return;
    setUsers(data.map((profile) => ({
      id: profile.id,
      name: profile.full_name,
      email: profile.email || (profile.id === currentUser?.id ? currentUser.email : ""),
      role: profile.role as User["role"],
      units: profile.allowed_units as Unit[],
    })));
  };
  useEffect(() => {
    if (currentUser?.role === "master") void loadUsers();
  }, [currentUser?.id, currentUser?.role]);
  const createManagedUser = async ({ name, email, password, units: allowedUnits }: { name: string; email: string; password: string; units: Unit[] }) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const masterSession = sessionData.session;
    if (!masterSession) throw new Error("Sua sessão expirou. Entre novamente para criar usuários.");
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: name.trim() } },
    });
    if (error || !data.user) throw error || new Error("Não foi possível criar o usuário.");
    const { error: restoreError } = await supabase.auth.setSession({
      access_token: masterSession.access_token,
      refresh_token: masterSession.refresh_token,
    });
    if (restoreError) throw new Error("Usuário criado, mas sua sessão Master precisa ser renovada.");
    const { data: updatedProfile, error: profileError } = await supabase.from("profiles").update({
      full_name: name.trim(),
      email: email.trim().toLowerCase(),
      role: "operador",
      allowed_units: allowedUnits,
    }).eq("id", data.user.id).select("id").maybeSingle();
    if (profileError || !updatedProfile) throw profileError || new Error("Perfil do usuário ainda não foi criado. Tente novamente em alguns segundos.");
  };
  const resetManagedUserPassword = async (user: User) => {
    const password = window.prompt(`Nova senha para ${user.name} (mínimo de 6 caracteres):`);
    if (password === null) return;
    const { error } = await supabase.rpc("master_reset_user_password", {
      target_user: user.id,
      new_password: password,
    });
    if (error) throw error;
  };
  const logout = async () => {
    await supabase.auth.signOut();
    setCurrentUser(null);
  };
  if (!currentUser) return <Login onLogin={setCurrentUser} />;
  if (!dataReady || dataError)
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f2f4f8] p-6 text-center">
        <div className="rounded-2xl bg-white px-8 py-7 shadow-sm">
          <p className="text-lg font-extrabold text-[#14213d]">Carregando dados financeiros</p>
          <p className="mt-2 text-sm text-gray-500">Sincronizando os lançamentos e categorias do banco...</p>
          {dataError && <p className="mt-4 text-sm font-bold text-red-600">{dataError}</p>}
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
    addAccount = () => {
      if (currentUser.role !== "master") return;
      const name = window.prompt("Nome da nova conta:");
      if (name?.trim())
        setAccounts((old) => [...old, { id: id(), name: name.trim() }]);
    },
    adjust = (account: Account) => {
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
      setEntries((old) => [
        {
          id: id(),
          kind: difference > 0 ? "receita" : "despesa",
          unit: account.name as Unit,
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
        },
        ...old,
      ]);
    };
  const key = month.toISOString().slice(0, 7),
    today = new Date().toISOString().slice(0, 10),
    pending = entries.filter(
      (x) =>
        x.status === "previsto" &&
        x.date <= today &&
        (filter === "Todos" || x.unit === filter),
    ),
    visible = entries
      .filter(
        (x) =>
          currentUser.role === "master" || currentUser.units.includes(x.unit),
      )
      .filter((x) => filter === "Todos" || x.unit === filter),
    current = visible.filter((x) => x.date.startsWith(key)),
    sum = (k: Kind, status?: Entry["status"]) =>
      current
        .filter((x) => x.kind === k && (!status || x.status === status))
        .reduce((s, x) => s + x.amount, 0),
    totals = {
      income: sum("receita"),
      expense: sum("despesa"),
      pay: sum("despesa", "previsto"),
      receive: sum("receita", "previsto"),
    },
    move = (n: number) =>
      setMonth((v) => new Date(v.getFullYear(), v.getMonth() + n, 1));
  const save = async (data: Omit<Entry, "id">, scope: "one" | "series") => {
      if (editing) {
        const updated = entries.map((x) =>
            (
              scope === "series" && editing.seriesId
                ? x.seriesId === editing.seriesId
                : x.id === editing.id
            )
              ? {
                  ...x,
                  ...data,
                  id: x.id,
                  seriesId: x.seriesId,
                  installment: x.installment,
                }
              : x,
        );
        const changed = updated.filter((x) =>
          scope === "series" && editing.seriesId
            ? x.seriesId === editing.seriesId
            : x.id === editing.id,
        );
        await saveRemoteEntries(changed);
        setEntries(updated);
        setEditing(null);
        return;
      }
      const base = new Date(`${data.date}T12:00:00`),
        seriesId =
          data.recurrence === "mensal" || data.installments > 1
            ? id()
            : undefined,
        count = data.recurrence === "mensal" ? 1200 : data.installments;
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
            installments: 1,
            installment:
              data.installments > 1
                ? `${i + 1}/${data.installments}`
                : undefined,
          };
        });
      await saveRemoteEntries(created);
      setEntries((old) => [...created, ...old]);
    },
    settle = (x: Entry) =>
      setEntries((old) =>
        old.map((v) =>
          v.id === x.id
            ? {
                ...v,
                status: v.status === "realizado" ? "previsto" : "realizado",
              }
            : v,
        ),
      ),
    remove = (x: Entry, scope: "one" | "series" = "one") =>
      setEntries((old) => {
        const removed = old.filter((v) =>
          scope === "series" && x.seriesId
            ? v.seriesId === x.seriesId
            : v.id === x.id,
        );
        void deleteRemoteEntries(removed.map((entry) => entry.id)).catch(
          (error) => console.error("Fincore: falha ao excluir lançamento", error),
        );
        return old.filter((v) => !removed.includes(v));
      }),
    open = (kind: Kind) => {
      setEditing(null);
      setModal(kind);
      setScreen("lancamentos");
    },
    list = current.filter(
      (x) =>
        entryFilter === "todos" ||
        (entryFilter === "pagar" &&
          x.kind === "despesa" &&
          x.status === "previsto") ||
        (entryFilter === "receber" &&
          x.kind === "receita" &&
          x.status === "previsto"),
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
      { id: "usuarios", text: "Usuários", Icon: Menu },
    ];
  return (
    <div className="flex h-screen overflow-hidden bg-[#f2f4f8]">
      <aside
        className={`fixed z-30 flex h-full w-56 flex-col bg-[#14213d] text-white transition-transform lg:relative ${menu ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="flex justify-between border-b border-white/10 px-5 py-5">
          <div className="min-w-0">
            <img src="/sistema-financeiro/fincore-logo-transparent.png" alt="Fincore" className="h-10 w-32 object-contain object-left brightness-0 invert" />
            <p className="mt-1 text-[11px] text-blue-200/70">Gestão financeira</p>
          </div>
          <button className="lg:hidden" onClick={() => setMenu(false)}>
            <X />
          </button>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {nav
            .filter((x) => currentUser.role === "master" || x.id !== "usuarios")
            .map((x) => (
              <button
                key={x.id}
                onClick={() => {
                  setScreen(x.id);
                  if (x.id === "lancamentos") setEntryFilter("todos");
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
          <p className="truncate text-sm font-bold text-white">{currentUser.name}</p>
          <p className="mb-3 truncate text-[11px] text-blue-200/70">{currentUser.email}</p>
          <button onClick={logout} className="w-full rounded-lg border border-white/15 px-2.5 py-2 text-xs font-bold text-blue-100 hover:bg-white/10">Sair da conta</button>
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
                      : "Lançamentos"}
              </h1>
              <p className="text-xs text-gray-400">
                Marketing, Sítio, Consultoria e Pessoa Física
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 sm:flex">
              <button onClick={() => open("despesa")} className="rounded-lg bg-red-50 px-3 py-2 text-xs font-extrabold text-red-600 hover:bg-red-100">− Despesa</button>
              <button onClick={() => open("receita")} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-extrabold text-white hover:bg-emerald-700">+ Receita</button>
            </div>
            <div className="relative">
              <Bell className="m-2 h-5 w-5 text-gray-400" />
              {pending.length > 0 && (
                <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
                  {pending.length}
                </span>
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
                    "Receitas",
                    totals.income,
                    TrendingUp,
                    "text-emerald-600 bg-emerald-50",
                  ],
                  [
                    "Despesas",
                    totals.expense,
                    TrendingDown,
                    "text-red-600 bg-red-50",
                  ],
                  [
                    "Contas a pagar",
                    totals.pay,
                    CreditCard,
                    "text-orange-600 bg-orange-50",
                  ],
                  [
                    "Contas a receber",
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
                        currentUser.units.includes(account.name as Unit),
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
                      .filter((x) => x.kind === "receita")
                      .reduce((s, x) => s + x.amount, 0),
                    expense = d
                      .filter((x) => x.kind === "despesa")
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
                          Entrou
                          <b className="block text-emerald-600">
                            {fmt(income)}
                          </b>
                        </p>
                        <p>
                          Saiu
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
                      currentUser.units.includes(account.name as Unit),
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
          ) : screen === "usuarios" ? (
            <UsersAdmin users={users} reload={loadUsers} createUser={createManagedUser} resetPassword={resetManagedUserPassword} />
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
                                  onClick={() => {
                                    if (window.confirm(`Excluir ${c.name}?`)) {
                                      void deleteRemoteCategory(c.id).catch(
                                        (error) =>
                                          console.error(
                                            "Fincore: falha ao excluir categoria",
                                            error,
                                          ),
                                      );
                                      setCategories((old) =>
                                        old.filter((x) => x.id !== c.id),
                                      );
                                    }
                                  }}
                                  className="text-gray-300 hover:text-red-600"
                                >
                                  <X className="h-3 w-3" />
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
                        : "Todos os lançamentos"}
                  </h2>
                  <p className="text-xs text-gray-400">
                    Consulte, filtre e dê baixa nos lançamentos do mês.
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
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() =>
                          setEntryFilter(value as "todos" | "pagar" | "receber")
                        }
                        className={`rounded-full px-3 py-2 text-xs font-bold ${entryFilter === value ? "bg-[#14213d] text-white" : "border bg-white text-gray-600 hover:bg-gray-50"}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
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
          accounts={accounts}
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
    </div>
  );
}
export default App;
