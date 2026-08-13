import { useState } from "react";
import {
  LayoutDashboard,
  TrendingDown,
  TrendingUp,
  CreditCard,
  Wallet,
  ArrowLeftRight,
  BarChart2,
  Tag,
  Settings,
  Bell,
  Search,
  Download,
  RefreshCw,
  ChevronDown,
  Menu,
  X,
  DollarSign,
  Clock,
  AlertCircle,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type ModalType = "despesa" | "receita" | "transferencia" | null;

// ─── Static data ─────────────────────────────────────────────────────────────

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

const MONTHLY_DATA = [
  { month: "Janeiro", orders: 842, percent: 60, growth: "+12,5%", value: "R$ 72K" },
  { month: "Fevereiro", orders: 1024, percent: 73, growth: "+22,2%", value: "R$ 88K" },
  { month: "Março", orders: 1156, percent: 80, growth: "+8,1%", value: "R$ 95K" },
];

const RECENT_ACTIVITY = [
  { name: "Carlos Silva", action: "efetuou um pagamento de", amount: "R$ 1.850", time: "2 minutos atrás", initials: "CS", color: "bg-blue-500", sign: "-" },
  { name: "Maria Santos", action: "registrou uma receita de", amount: "R$ 3.200", time: "15 minutos atrás", initials: "MS", color: "bg-green-500", sign: "+" },
  { name: "Pedro Costa", action: "realizou uma transferência de", amount: "R$ 560", time: "32 minutos atrás", initials: "PC", color: "bg-purple-500", sign: "-" },
  { name: "Ana Oliveira", action: "pagou uma fatura de", amount: "R$ 420", time: "1 hora atrás", initials: "AO", color: "bg-orange-500", sign: "-" },
];

const TOP_CONTAS = [
  { rank: 1, name: "Folha de Pagamento", initials: "FP", color: "bg-blue-600", amount: "R$ 28.400", detail: "1.024 lançamentos • +8,2%" },
  { rank: 2, name: "Aluguel & Instalações", initials: "AI", color: "bg-indigo-500", amount: "R$ 12.800", detail: "876 lançamentos • +4,5%" },
  { rank: 3, name: "Fornecedores", initials: "FN", color: "bg-cyan-500", amount: "R$ 9.600", detail: "654 lançamentos • +7,1%" },
];

// ─── Modal ────────────────────────────────────────────────────────────────────

function Modal({ type, onClose }: { type: ModalType; onClose: () => void }) {
  if (!type) return null;

  const configs = {
    despesa: {
      title: "Nova Despesa",
      color: "text-red-600",
      btnClass: "bg-red-600 hover:bg-red-700",
      showTransfer: false,
    },
    receita: {
      title: "Nova Receita",
      color: "text-green-600",
      btnClass: "bg-green-600 hover:bg-green-700",
      showTransfer: false,
    },
    transferencia: {
      title: "Nova Transferência",
      color: "text-blue-700",
      btnClass: "bg-blue-700 hover:bg-blue-800",
      showTransfer: true,
    },
  };

  const cfg = configs[type];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className={`text-lg font-bold ${cfg.color}`}>{cfg.title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Descrição</label>
            <input
              type="text"
              placeholder={type === "transferencia" ? "Ex: Transferência entre contas" : "Ex: Pagamento de fornecedor"}
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Valor (R$)</label>
              <input
                type="number"
                placeholder="0,00"
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Data</label>
              <input
                type="date"
                className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
              />
            </div>
          </div>

          {!cfg.showTransfer && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Categoria</label>
              <select className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition">
                <option value="">Selecione uma categoria</option>
                <option>Salários</option>
                <option>Fornecedores</option>
                <option>Aluguel</option>
                <option>Serviços</option>
                <option>Impostos</option>
                <option>Outros</option>
              </select>
            </div>
          )}

          {!cfg.showTransfer && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Conta</label>
              <select className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition">
                <option>Conta Corrente Principal</option>
                <option>Conta Poupança</option>
                <option>Cartão Empresarial</option>
              </select>
            </div>
          )}

          {cfg.showTransfer && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Conta Origem</label>
                <select className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition">
                  <option>Conta Corrente Principal</option>
                  <option>Conta Poupança</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Conta Destino</label>
                <select className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 transition">
                  <option>Conta Poupança</option>
                  <option>Conta Corrente Principal</option>
                </select>
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5 uppercase tracking-wide">Observações</label>
            <textarea
              rows={2}
              placeholder="Observações opcionais..."
              className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition resize-none"
            />
          </div>
        </div>

        <div className="flex gap-3 px-6 py-4 bg-gray-50 border-t border-gray-100">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-100 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={onClose}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors ${cfg.btnClass}`}
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [activeNav, setActiveNav] = useState("dashboard");
  const [activePeriod, setActivePeriod] = useState<"mes" | "ano">("mes");
  const [modal, setModal] = useState<ModalType>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const todayCapitalized = today.charAt(0).toUpperCase() + today.slice(1);

  const handleNavClick = (id: string) => {
    setActiveNav(id);
    setSidebarOpen(false);
    if (id === "nova-despesa") setModal("despesa");
    else if (id === "nova-receita") setModal("receita");
    else if (id === "transferencias") setModal("transferencia");
  };

  return (
    <div
      className="flex h-screen overflow-hidden bg-[#f0f2f5]"
      style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}
    >
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Sidebar ── */}
      <aside
        className={`fixed lg:relative z-30 flex flex-col w-[210px] h-full bg-[#14213d] text-white shrink-0 transition-transform duration-300
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        {/* Brand */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
          <div>
            <p className="font-extrabold text-[15px] tracking-tight">FinancePro</p>
            <p className="text-[11px] text-blue-300/70 mt-0.5 font-medium">Painel Financeiro</p>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/10 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(({ icon: Icon, label, id }) => {
            const active = activeNav === id;
            return (
              <button
                key={id}
                onClick={() => handleNavClick(id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-all
                  ${active
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-900/40"
                    : "text-white/60 hover:bg-white/10 hover:text-white"
                  }`}
              >
                <Icon className="w-[18px] h-[18px] shrink-0" />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>

        {/* User */}
        <div className="px-4 py-4 border-t border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-sm font-bold shrink-0">
              A
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold truncate">Admin User</p>
              <p className="text-[11px] text-blue-300/60 truncate">admin@financepro.com</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Header */}
        <header className="flex items-center justify-between px-6 py-3.5 bg-white border-b border-black/[0.07] shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 transition"
            >
              <Menu className="w-5 h-5 text-gray-600" />
            </button>
            <div>
              <h1 className="text-[17px] font-extrabold text-[#14213d]">Dashboard</h1>
              <p className="text-[12px] text-gray-400 font-medium hidden sm:block">Gerencie suas finanças aqui</p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="hidden md:flex items-center gap-2 px-3.5 py-2 bg-gray-100 rounded-xl w-52">
              <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <input
                type="text"
                placeholder="Pesquisar..."
                className="bg-transparent text-sm text-gray-600 placeholder-gray-400 outline-none w-full"
              />
            </div>

            <button className="relative w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-100 transition-colors">
              <Bell className="w-[18px] h-[18px] text-gray-600" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white" />
            </button>

            <button className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-gray-100 transition-colors">
              <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                A
              </div>
              <span className="text-[13px] font-semibold text-gray-700 hidden sm:block">Seu Nome</span>
              <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
            </button>
          </div>
        </header>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* ── Hero Banner ── */}
          <div className="rounded-2xl bg-gradient-to-br from-[#0d47a1] via-[#1565c0] to-[#1e88e5] p-6 text-white shadow-xl">
            <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
              <div>
                <h2 className="text-[22px] font-extrabold mb-1">Bem-vindo de volta, Admin</h2>
                <p className="text-blue-200 text-[13px] font-medium">Aqui está o resumo financeiro do seu negócio</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-semibold bg-white/20 px-3 py-1.5 rounded-full hidden sm:inline-flex">
                  {todayCapitalized}
                </span>
                <button className="flex items-center gap-1.5 bg-white/20 hover:bg-white/30 transition text-[12px] font-semibold px-3 py-1.5 rounded-xl">
                  <Download className="w-3.5 h-3.5" />
                  Exportar
                </button>
                <button className="w-8 h-8 flex items-center justify-center bg-white/20 hover:bg-white/30 transition rounded-xl">
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: "Pedidos de Hoje", value: "47", icon: "🛒", change: "+12% de ontem" },
                { label: "Novos Clientes", value: "23", icon: "👥", change: "+8% de ontem" },
                { label: "Receita Hoje", value: "R$ 84K", icon: "💰", change: "+18% de ontem" },
                { label: "Taxa de Conversão", value: "3,24%", icon: "📈", change: "+0,4% de ontem" },
              ].map((s) => (
                <div key={s.label} className="bg-white/15 backdrop-blur-sm rounded-2xl px-4 py-3.5">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-base">{s.icon}</span>
                    <span className="text-[11px] text-blue-200 font-semibold">{s.label}</span>
                  </div>
                  <p className="text-[20px] font-extrabold">{s.value}</p>
                  <p className="text-[11px] text-blue-300 mt-0.5 font-medium">{s.change}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── KPI Cards ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              {
                label: "Usuários Totais",
                value: "12.543",
                sub: "Usuários ativos",
                change: "+12,5%",
                progress: 75,
                vsLabel: "vs. mês anterior",
                vsValue: "11.156",
                color: "text-blue-500",
                barColor: "bg-blue-500",
                Icon: TrendingUp,
                iconBg: "bg-blue-50",
              },
              {
                label: "Total de Produtos",
                value: "3.842",
                sub: "Itens cadastrados",
                change: "+8,2%",
                progress: 62,
                vsLabel: "vs. mês anterior",
                vsValue: "3.551",
                color: "text-green-500",
                barColor: "bg-green-500",
                Icon: Tag,
                iconBg: "bg-green-50",
              },
              {
                label: "Total de Pedidos",
                value: "9.238",
                sub: "Neste mês",
                change: "+15,3%",
                progress: 85,
                vsLabel: "vs. mês anterior",
                vsValue: "8.012",
                color: "text-orange-500",
                barColor: "bg-orange-500",
                Icon: CreditCard,
                iconBg: "bg-orange-50",
              },
              {
                label: "Receita Total",
                value: "R$ 2,4M",
                sub: "Resultado líquido",
                change: "+23,1%",
                progress: 90,
                vsLabel: "vs. mês anterior",
                vsValue: "R$ 1.95M",
                color: "text-purple-500",
                barColor: "bg-purple-500",
                Icon: DollarSign,
                iconBg: "bg-purple-50",
              },
            ].map((card) => (
              <div key={card.label} className="bg-white rounded-2xl p-4 shadow-sm border border-black/[0.06] hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-3">
                  <div className={`w-9 h-9 ${card.iconBg} rounded-xl flex items-center justify-center`}>
                    <card.Icon className={`w-[18px] h-[18px] ${card.color}`} />
                  </div>
                  <span className={`text-[12px] font-bold ${card.color} bg-opacity-10`}>{card.change}</span>
                </div>
                <p className="text-[22px] font-extrabold text-[#14213d] leading-tight mb-0.5">{card.value}</p>
                <p className="text-[11px] text-gray-400 font-medium mb-3">{card.sub}</p>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[11px] text-gray-400 font-medium">
                    <span>Progresso</span>
                    <span>{card.progress}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${card.barColor} rounded-full`}
                      style={{ width: `${card.progress}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-gray-400 font-medium">
                    <span>{card.vsLabel}</span>
                    <span>{card.vsValue}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* ── Analytics + Live Activity ── */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">

            {/* Analytics */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-black/[0.06]">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h3 className="text-[15px] font-extrabold text-[#14213d]">Análise de Receitas</h3>
                  <p className="text-[12px] text-gray-400 font-medium mt-0.5">Métricas de desempenho de receita</p>
                </div>
                <div className="flex rounded-xl overflow-hidden border border-gray-200 text-[12px] font-bold">
                  <button
                    onClick={() => setActivePeriod("mes")}
                    className={`px-3.5 py-1.5 transition-colors ${activePeriod === "mes" ? "bg-[#1565c0] text-white" : "text-gray-500 hover:bg-gray-50"}`}
                  >
                    Este Mês
                  </button>
                  <button
                    onClick={() => setActivePeriod("ano")}
                    className={`px-3.5 py-1.5 transition-colors ${activePeriod === "ano" ? "bg-[#1565c0] text-white" : "text-gray-500 hover:bg-gray-50"}`}
                  >
                    Este Ano
                  </button>
                </div>
              </div>

              {/* Horizontal bar chart */}
              <div className="space-y-4 mb-5">
                {MONTHLY_DATA.map((row) => (
                  <div key={row.month}>
                    <div className="flex justify-between text-[12px] mb-1.5">
                      <span className="font-semibold text-gray-700">
                        {row.month}{" "}
                        <span className="text-gray-400 font-normal">• {row.orders.toLocaleString("pt-BR")} pedidos</span>
                      </span>
                      <span className="font-bold text-green-500">{row.growth} &nbsp; {row.value}</span>
                    </div>
                    <div className="relative h-8 bg-gray-100 rounded-xl overflow-hidden">
                      <div
                        className="absolute inset-y-0 left-0 bg-gradient-to-r from-[#1565c0] to-[#42a5f5] rounded-xl flex items-center justify-end pr-3"
                        style={{ width: `${row.percent}%` }}
                      >
                        <span className="text-white text-[12px] font-extrabold">{row.percent}%</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Metric chips */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Receita Total", value: "R$ 640K", icon: "💰", bg: "bg-blue-50", text: "text-blue-700" },
                  { label: "Taxa de Crescimento", value: "+18,5%", icon: "📊", bg: "bg-green-50", text: "text-green-700" },
                  { label: "Média/Mês", value: "R$ 213K", icon: "📅", bg: "bg-purple-50", text: "text-purple-700" },
                  { label: "Total de Pedidos", value: "3.022", icon: "🛒", bg: "bg-orange-50", text: "text-orange-700" },
                ].map((chip) => (
                  <div key={chip.label} className={`${chip.bg} rounded-xl p-3`}>
                    <span className="text-lg">{chip.icon}</span>
                    <p className={`text-[15px] font-extrabold ${chip.text} mt-1`}>{chip.value}</p>
                    <p className="text-[11px] text-gray-500 font-medium">{chip.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Live Activity */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-black/[0.06]">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-[15px] font-extrabold text-[#14213d]">Atividade Recente</h3>
                  <p className="text-[12px] text-gray-400 font-medium mt-0.5">Atualizações em tempo real</p>
                </div>
                <span className="flex items-center gap-1.5 text-[11px] font-bold text-green-600">
                  <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  Ao vivo
                </span>
              </div>

              <div className="space-y-3.5">
                {RECENT_ACTIVITY.map((item, i) => (
                  <div key={i} className="flex items-start gap-3 pb-3.5 border-b border-gray-100 last:border-0 last:pb-0">
                    <div className={`w-8 h-8 ${item.color} rounded-full flex items-center justify-center text-white text-[11px] font-extrabold shrink-0`}>
                      {item.initials}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[12px] text-gray-700 leading-snug">
                        <span className="font-bold text-gray-800">{item.name}</span>{" "}
                        {item.action}{" "}
                        <span className={`font-bold ${item.sign === "+" ? "text-green-600" : "text-blue-600"}`}>
                          {item.sign}{item.amount}
                        </span>
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5 font-medium">{item.time}</p>
                    </div>
                  </div>
                ))}
              </div>

              <button className="w-full mt-4 text-center text-[12px] font-bold text-[#1565c0] hover:text-blue-800 transition-colors">
                Ver Todas as Atividades →
              </button>
            </div>
          </div>

          {/* ── Quick Actions + Top Contas ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

            {/* Quick Actions */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-black/[0.06]">
              <div className="mb-4">
                <h3 className="text-[15px] font-extrabold text-[#14213d]">Ações Rápidas</h3>
                <p className="text-[12px] text-gray-400 font-medium mt-0.5">Tarefas financeiras mais utilizadas</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    label: "Nova Despesa",
                    sub: "Registrar saída",
                    Icon: TrendingDown,
                    bg: "from-blue-600 to-blue-700",
                    modal: "despesa" as ModalType,
                  },
                  {
                    label: "Nova Receita",
                    sub: "Registrar entrada",
                    Icon: TrendingUp,
                    bg: "from-green-500 to-green-600",
                    modal: "receita" as ModalType,
                  },
                  {
                    label: "Ver Relatórios",
                    sub: "Dados analíticos",
                    Icon: BarChart2,
                    bg: "from-orange-500 to-orange-600",
                    modal: null,
                  },
                  {
                    label: "Configurações",
                    sub: "Ajustar sistema",
                    Icon: Settings,
                    bg: "from-purple-600 to-purple-700",
                    modal: null,
                  },
                ].map((action) => (
                  <button
                    key={action.label}
                    onClick={() => action.modal && setModal(action.modal)}
                    className={`bg-gradient-to-br ${action.bg} rounded-2xl p-4 text-white text-left hover:opacity-90 active:scale-[0.97] transition-all shadow-sm`}
                  >
                    <action.Icon className="w-6 h-6 mb-2.5 opacity-90" />
                    <p className="text-[13px] font-bold">{action.label}</p>
                    <p className="text-[11px] opacity-70 mt-0.5 font-medium">{action.sub}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Top Contas */}
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-black/[0.06]">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-[15px] font-extrabold text-[#14213d]">Principais Contas</h3>
                  <p className="text-[12px] text-gray-400 font-medium mt-0.5">Maiores valores do mês</p>
                </div>
                <button className="text-[12px] font-bold text-[#1565c0] hover:text-blue-800 transition-colors">
                  Ver Todas →
                </button>
              </div>
              <div className="space-y-1">
                {TOP_CONTAS.map((conta) => (
                  <div
                    key={conta.rank}
                    className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 transition-colors cursor-pointer group"
                  >
                    <span className="text-[12px] font-extrabold text-gray-300 w-4 shrink-0 text-center">{conta.rank}</span>
                    <div className={`w-9 h-9 ${conta.color} rounded-xl flex items-center justify-center text-white text-[11px] font-extrabold shrink-0`}>
                      {conta.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-bold text-gray-800 truncate">{conta.name}</p>
                      <p className="text-[11px] text-gray-400 font-medium">{conta.detail}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[13px] font-extrabold text-gray-800">{conta.amount}</p>
                      <p className="text-[11px] text-gray-400 font-medium">Despesa</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Ações Pendentes ── */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-black/[0.06]">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-[15px] font-extrabold text-[#14213d]">Ações Pendentes</h3>
                <p className="text-[12px] text-gray-400 font-medium mt-0.5">Itens que requerem sua atenção imediata</p>
              </div>
              <span className="flex items-center gap-1.5 text-[12px] font-bold text-red-500">
                <span className="w-2 h-2 bg-red-500 rounded-full" />
                25 Pendentes
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                {
                  title: "Aprovação de Despesas",
                  count: 12,
                  desc: "Despesas aguardando aprovação do gestor",
                  bg: "bg-orange-50",
                  border: "border-orange-100",
                  badge: "bg-orange-500",
                  btn: "bg-orange-500 hover:bg-orange-600",
                  Icon: Clock,
                  iconColor: "text-orange-500",
                  iconBg: "bg-orange-100",
                },
                {
                  title: "Conciliação Bancária",
                  count: 8,
                  desc: "Transações pendentes de conciliação",
                  bg: "bg-blue-50",
                  border: "border-blue-100",
                  badge: "bg-blue-600",
                  btn: "bg-blue-800 hover:bg-blue-900",
                  Icon: CreditCard,
                  iconColor: "text-blue-600",
                  iconBg: "bg-blue-100",
                },
                {
                  title: "Cobranças em Atraso",
                  count: 5,
                  desc: "Contas vencidas que precisam de ação",
                  bg: "bg-red-50",
                  border: "border-red-100",
                  badge: "bg-red-500",
                  btn: "bg-red-500 hover:bg-red-600",
                  Icon: AlertCircle,
                  iconColor: "text-red-500",
                  iconBg: "bg-red-100",
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className={`${item.bg} ${item.border} border rounded-2xl p-4 relative`}
                >
                  <span className={`absolute top-3.5 right-3.5 ${item.badge} text-white text-[11px] font-extrabold w-6 h-6 rounded-full flex items-center justify-center`}>
                    {item.count}
                  </span>
                  <div className={`w-10 h-10 ${item.iconBg} rounded-xl flex items-center justify-center mb-3`}>
                    <item.Icon className={`w-5 h-5 ${item.iconColor}`} />
                  </div>
                  <h4 className="text-[13px] font-extrabold text-gray-800 mb-1">{item.title}</h4>
                  <p className="text-[12px] text-gray-500 font-medium mb-4 leading-snug">{item.desc}</p>
                  <button className={`w-full py-2 rounded-xl text-white text-[12px] font-bold transition-colors ${item.btn}`}>
                    Revisar Agora →
                  </button>
                </div>
              ))}
            </div>
          </div>

        </div>
      </main>

      <Modal type={modal} onClose={() => setModal(null)} />
    </div>
  );
}
