import { useState } from "react";
import {
  AlertCircle,
  ArrowLeftRight,
  BarChart2,
  Bell,
  Building2,
  ChevronDown,
  Clock,
  CreditCard,
  Download,
  LayoutDashboard,
  Menu,
  RefreshCw,
  Search,
  Settings,
  Tag,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";

type ModalType = "despesa" | "receita" | "transferencia" | null;

const NAV_ITEMS = [
  { icon: LayoutDashboard, label: "Dashboard", id: "dashboard" },
  { icon: TrendingDown, label: "Nova Despesa", id: "nova-despesa" },
  { icon: TrendingUp, label: "Nova Receita", id: "nova-receita" },
  { icon: CreditCard, label: "Contas a Pagar", id: "contas-pagar" },
  { icon: Wallet, label: "Contas a Receber", id: "contas-receber" },
  { icon: ArrowLeftRight, label: "Transferências", id: "transferencias" },
  { icon: BarChart2, label: "Relatórios", id: "relatorios" },
  { icon: Tag, label: "Categorias", id: "categorias" },
  { icon: Settings, label: "Configurações", id: "configuracoes" },
];

const UNITS = [
  { name: "Consultoria", plan: "Plano de contas: Consultoria", initials: "CO", color: "bg-blue-600", tint: "border-blue-100 bg-blue-50", accent: "text-blue-700" },
  { name: "Sítio", plan: "Plano de contas: Sítio", initials: "SI", color: "bg-emerald-600", tint: "border-emerald-100 bg-emerald-50", accent: "text-emerald-700" },
  { name: "Indefinido 1", plan: "Plano de contas: a definir", initials: "I1", color: "bg-violet-600", tint: "border-violet-100 bg-violet-50", accent: "text-violet-700" },
  { name: "Indefinido 2", plan: "Plano de contas: a definir", initials: "I2", color: "bg-amber-500", tint: "border-amber-100 bg-amber-50", accent: "text-amber-700" },
];

function Modal({ type, onClose }: { type: ModalType; onClose: () => void }) {
  if (!type) return null;
  const title = type === "despesa" ? "Nova Despesa" : type === "receita" ? "Nova Receita" : "Nova Transferência";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="font-bold text-[#14213d]">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-4 px-6 py-5 text-sm">
          <label className="block font-semibold text-gray-600">Local / empresa<select className="mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 p-2.5 font-normal"><option>Selecione o local</option>{UNITS.map((unit) => <option key={unit.name}>{unit.name}</option>)}</select></label>
          <label className="block font-semibold text-gray-600">Descrição<input className="mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 p-2.5 font-normal" placeholder="Descreva o lançamento" /></label>
          <div className="grid grid-cols-2 gap-3"><label className="font-semibold text-gray-600">Valor<input type="number" className="mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 p-2.5 font-normal" placeholder="R$ 0,00" /></label><label className="font-semibold text-gray-600">Data<input type="date" className="mt-1.5 w-full rounded-xl border border-gray-200 bg-gray-50 p-2.5 font-normal" /></label></div>
        </div>
        <div className="flex gap-3 border-t border-gray-100 bg-gray-50 px-6 py-4"><button onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-2.5 font-semibold text-gray-600">Cancelar</button><button onClick={onClose} className="flex-1 rounded-xl bg-blue-700 py-2.5 font-semibold text-white">Salvar</button></div>
      </div>
    </div>
  );
}

function FinancialDashboard({ onModal }: { onModal: (type: ModalType) => void }) {
  const [period, setPeriod] = useState<"mes" | "ano">("mes");
  const today = new Date().toLocaleDateString("pt-BR", { day: "numeric", month: "long", year: "numeric" });
  const totals = [
    { label: "Receitas", value: "R$ 0,00", sub: "Entradas consolidadas", Icon: TrendingUp, color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "Despesas", value: "R$ 0,00", sub: "Saídas consolidadas", Icon: TrendingDown, color: "text-red-600", bg: "bg-red-50" },
    { label: "Contas a Pagar", value: "R$ 0,00", sub: "0 títulos pendentes", Icon: CreditCard, color: "text-orange-600", bg: "bg-orange-50" },
    { label: "Contas a Receber", value: "R$ 0,00", sub: "0 títulos pendentes", Icon: Wallet, color: "text-blue-600", bg: "bg-blue-50" },
  ];
  return <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
    <section className="rounded-2xl bg-gradient-to-br from-[#0d47a1] via-[#1565c0] to-[#1e88e5] p-6 text-white shadow-xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4"><div><p className="mb-1 text-xs font-bold uppercase tracking-[0.16em] text-blue-200">Visão consolidada</p><h2 className="text-[22px] font-extrabold">Financeiro por empresa e plano de contas</h2><p className="mt-1 text-[13px] font-medium text-blue-200">Acompanhe entradas, saídas e compromissos de cada local.</p></div><div className="flex items-center gap-2"><span className="hidden rounded-full bg-white/20 px-3 py-1.5 text-xs font-semibold sm:inline">{today}</span><button className="flex items-center gap-1.5 rounded-xl bg-white/20 px-3 py-1.5 text-xs font-semibold hover:bg-white/30"><Download className="h-3.5 w-3.5" />Exportar</button><button className="rounded-xl bg-white/20 p-2 hover:bg-white/30"><RefreshCw className="h-3.5 w-3.5" /></button></div></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{totals.map(({ label, value, sub, Icon }) => <div key={label} className="rounded-2xl bg-white/15 px-4 py-3.5"><div className="mb-2 flex items-center gap-2 text-blue-100"><Icon className="h-4 w-4" /><span className="text-[11px] font-semibold">{label}</span></div><p className="text-xl font-extrabold">{value}</p><p className="mt-0.5 text-[11px] font-medium text-blue-200">{sub}</p></div>)}</div>
    </section>

    <section className="grid grid-cols-1 gap-4 lg:grid-cols-4">{UNITS.map((unit) => <article key={unit.name} className={`rounded-2xl border p-4 shadow-sm ${unit.tint}`}><div className="mb-4 flex items-start justify-between"><div className={`flex h-10 w-10 items-center justify-center rounded-xl text-xs font-extrabold text-white ${unit.color}`}>{unit.initials}</div><span className={`rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-bold ${unit.accent}`}>Plano próprio</span></div><h3 className="font-extrabold text-[#14213d]">{unit.name}</h3><p className="mt-0.5 text-[11px] font-medium text-gray-500">{unit.plan}</p><div className="mt-4 grid grid-cols-2 gap-2 border-t border-black/5 pt-3 text-[11px]"><div><p className="text-gray-400">Receitas</p><p className="mt-0.5 font-extrabold text-emerald-600">R$ 0,00</p></div><div><p className="text-gray-400">Despesas</p><p className="mt-0.5 font-extrabold text-red-600">R$ 0,00</p></div><div><p className="text-gray-400">A pagar</p><p className="mt-0.5 font-extrabold text-orange-600">R$ 0,00</p></div><div><p className="text-gray-400">A receber</p><p className="mt-0.5 font-extrabold text-blue-600">R$ 0,00</p></div></div></article>)}</section>

    <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1.45fr_1fr]"><article className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm"><div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-extrabold text-[#14213d]">Resultado por empresa</h3><p className="mt-0.5 text-xs font-medium text-gray-400">Receitas e despesas organizadas pelos respectivos planos de contas.</p></div><div className="flex overflow-hidden rounded-xl border border-gray-200 text-xs font-bold"><button onClick={() => setPeriod("mes")} className={`px-3.5 py-1.5 ${period === "mes" ? "bg-[#1565c0] text-white" : "text-gray-500"}`}>Este mês</button><button onClick={() => setPeriod("ano")} className={`px-3.5 py-1.5 ${period === "ano" ? "bg-[#1565c0] text-white" : "text-gray-500"}`}>Este ano</button></div></div><div className="space-y-4">{UNITS.map((unit) => <div key={unit.name}><div className="mb-1.5 flex justify-between text-xs"><span className="font-bold text-gray-700">{unit.name}<span className="ml-2 font-normal text-gray-400">Receitas R$ 0,00 · Despesas R$ 0,00</span></span><span className="font-extrabold text-gray-500">Resultado R$ 0,00</span></div><div className="h-7 overflow-hidden rounded-xl bg-gray-100"><div className="h-full w-0 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-400" /></div></div>)}</div></article>
      <article className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm"><h3 className="font-extrabold text-[#14213d]">Planos de contas</h3><p className="mt-0.5 text-xs font-medium text-gray-400">Identificação para a leitura correta de cada saldo.</p><div className="mt-4 space-y-2">{UNITS.map((unit) => <div key={unit.name} className="flex items-center gap-3 rounded-xl border border-gray-100 p-3"><div className={`flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-extrabold text-white ${unit.color}`}>{unit.initials}</div><div className="min-w-0"><p className="text-xs font-bold text-gray-800">{unit.name}</p><p className="truncate text-[11px] font-medium text-gray-400">{unit.plan}</p></div></div>)}</div></article></section>

    <section className="grid grid-cols-1 gap-4 lg:grid-cols-2"><article className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-extrabold text-[#14213d]">Contas a pagar por local</h3><p className="mt-0.5 text-xs font-medium text-gray-400">Compromissos de cada empresa.</p></div><span className="text-xs font-bold text-orange-600">R$ 0,00 total</span></div><div className="space-y-2">{UNITS.map((unit) => <div key={unit.name} className="flex items-center justify-between rounded-xl bg-orange-50/60 px-3 py-2.5"><span className="text-xs font-bold text-gray-700">{unit.name}</span><span className="text-xs font-extrabold text-orange-600">R$ 0,00 · 0 títulos</span></div>)}</div></article>
      <article className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-extrabold text-[#14213d]">Contas a receber por local</h3><p className="mt-0.5 text-xs font-medium text-gray-400">Entradas previstas de cada empresa.</p></div><span className="text-xs font-bold text-blue-600">R$ 0,00 total</span></div><div className="space-y-2">{UNITS.map((unit) => <div key={unit.name} className="flex items-center justify-between rounded-xl bg-blue-50/60 px-3 py-2.5"><span className="text-xs font-bold text-gray-700">{unit.name}</span><span className="text-xs font-extrabold text-blue-600">R$ 0,00 · 0 títulos</span></div>)}</div></article></section>

    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[{ label: "Nova Despesa", sub: "Registrar saída", Icon: TrendingDown, className: "from-red-500 to-red-600", type: "despesa" as ModalType }, { label: "Nova Receita", sub: "Registrar entrada", Icon: TrendingUp, className: "from-emerald-500 to-emerald-600", type: "receita" as ModalType }, { label: "Transferência", sub: "Entre contas", Icon: ArrowLeftRight, className: "from-blue-600 to-blue-700", type: "transferencia" as ModalType }, { label: "Configurar planos", sub: "Por empresa", Icon: Settings, className: "from-violet-600 to-violet-700", type: null }].map((action) => <button key={action.label} onClick={() => action.type && onModal(action.type)} className={`rounded-2xl bg-gradient-to-br p-4 text-left text-white shadow-sm transition hover:opacity-90 ${action.className}`}><action.Icon className="mb-2.5 h-6 w-6" /><p className="text-sm font-bold">{action.label}</p><p className="mt-0.5 text-[11px] font-medium opacity-70">{action.sub}</p></button>)}</section>

    <section className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h3 className="font-extrabold text-[#14213d]">Pendências financeiras</h3><p className="mt-0.5 text-xs font-medium text-gray-400">Aprovações, conciliações e cobranças de todas as empresas.</p></div><span className="flex items-center gap-1.5 text-xs font-bold text-gray-400"><AlertCircle className="h-4 w-4" />0 pendências</span></div><div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">{[["Aprovação de despesas", "0 aguardando aprovação", Clock, "text-orange-500 bg-orange-50"], ["Conciliação bancária", "0 transações pendentes", CreditCard, "text-blue-600 bg-blue-50"], ["Cobranças em atraso", "0 contas vencidas", AlertCircle, "text-red-500 bg-red-50"]].map(([title, description, Icon, style]) => { const CardIcon = Icon as typeof Clock; return <div key={title as string} className="rounded-xl border border-gray-100 p-3.5"><div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${style as string}`}><CardIcon className="h-4.5 w-4.5" /></div><p className="text-xs font-extrabold text-gray-800">{title as string}</p><p className="mt-1 text-[11px] font-medium text-gray-400">{description as string}</p></div>})}</div></section>
  </div>;
}

export default function App() {
  const [activeNav, setActiveNav] = useState("dashboard");
  const [modal, setModal] = useState<ModalType>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const handleNavClick = (id: string) => { setActiveNav(id); setSidebarOpen(false); if (id === "nova-despesa") setModal("despesa"); if (id === "nova-receita") setModal("receita"); if (id === "transferencias") setModal("transferencia"); };
  return <div className="flex h-screen overflow-hidden bg-[#f0f2f5]" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>
    {sidebarOpen && <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />}
    <aside className={`fixed z-30 flex h-full w-[210px] shrink-0 flex-col bg-[#14213d] text-white transition-transform duration-300 lg:relative ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}><div className="flex items-center justify-between border-b border-white/10 px-5 py-5"><div><p className="text-[15px] font-extrabold tracking-tight">FinancePro</p><p className="mt-0.5 text-[11px] font-medium text-blue-300/70">Painel Financeiro</p></div><button onClick={() => setSidebarOpen(false)} className="rounded-md p-1.5 hover:bg-white/10 lg:hidden"><X className="h-4 w-4" /></button></div><nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">{NAV_ITEMS.map(({ icon: Icon, label, id }) => <button key={id} onClick={() => handleNavClick(id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-all ${activeNav === id ? "bg-blue-600 text-white shadow-lg shadow-blue-900/40" : "text-white/60 hover:bg-white/10 hover:text-white"}`}><Icon className="h-[18px] w-[18px] shrink-0" />{label}</button>)}</nav><div className="border-t border-white/10 px-4 py-4"><div className="flex items-center gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 text-sm font-bold">A</div><div><p className="text-[13px] font-semibold">Admin User</p><p className="text-[11px] text-blue-300/60">admin@financepro.com</p></div></div></div></aside>
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden"><header className="flex shrink-0 items-center justify-between border-b border-black/[0.07] bg-white px-6 py-3.5"><div className="flex items-center gap-3"><button onClick={() => setSidebarOpen(true)} className="rounded-lg p-1.5 hover:bg-gray-100 lg:hidden"><Menu className="h-5 w-5 text-gray-600" /></button><div><h1 className="text-[17px] font-extrabold text-[#14213d]">Dashboard Financeiro</h1><p className="hidden text-xs font-medium text-gray-400 sm:block">Visão consolidada por empresa</p></div></div><div className="flex items-center gap-2.5"><div className="hidden w-52 items-center gap-2 rounded-xl bg-gray-100 px-3.5 py-2 md:flex"><Search className="h-3.5 w-3.5 text-gray-400" /><input placeholder="Pesquisar..." className="w-full bg-transparent text-sm outline-none" /></div><button className="relative rounded-xl p-2.5 hover:bg-gray-100"><Bell className="h-[18px] w-[18px] text-gray-600" /><span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" /></button><button className="flex items-center gap-2 rounded-xl px-3 py-1.5 hover:bg-gray-100"><div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">A</div><span className="hidden text-[13px] font-semibold text-gray-700 sm:block">Seu Nome</span><ChevronDown className="h-3.5 w-3.5 text-gray-400" /></button></div></header><FinancialDashboard onModal={setModal} /></main><Modal type={modal} onClose={() => setModal(null)} />
  </div>;
}
