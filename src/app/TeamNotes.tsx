import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Eye,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { readAuthenticatedRows } from "../lib/supabase";
import {
  TeamCategory,
  TeamInvoice,
  TeamMember,
  deleteTeamCategory,
  deleteTeamInvoice,
  deleteTeamMember,
  removeTeamNoteFiles,
  saveTeamCategory,
  saveTeamInvoice,
  saveTeamMember,
  teamNoteFileUrl,
  uploadTeamNoteFile,
} from "../lib/bridge";
import { CurrencyInput, Month, fmt, labelMonth, parseMoney } from "./shared";

type Status = "enviada" | "pendente" | "atrasada";

const newId = () => crypto.randomUUID();
const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const competenceLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return labelMonth(new Date(y, m - 1, 1));
};
// O controle de notas começa em março/2026; meses anteriores não importam.
const TEAM_NOTES_START = "2026-03";
const shortMonth = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1)
    .toLocaleDateString("pt-BR", { month: "short", year: "numeric" })
    .replace(".", "");
};
// Inativo naquele mês: a partir do mês de inativação (ou, nos cadastros
// antigos sem mês, quando marcado como inativo).
const isInactiveIn = (member: TeamMember, month: string) =>
  member.inactive_from ? month >= member.inactive_from : !member.active;
const withoutCreatedAt = ({ created_at: _createdAt, ...member }: TeamMember) => member;
const fileLabel = (path: string) => (path.split("/").pop() || path).replace(/^\d+-/, "");
const isPdf = (path: string) => path.toLowerCase().endsWith(".pdf");
const asciiName = (name: string) =>
  name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_");
const toNumber = (value: unknown) =>
  value === null || value === undefined || value === "" ? null : Number(value);
const dateBR = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR");

const statusStyle: Record<Status, string> = {
  enviada: "bg-emerald-50 text-emerald-700",
  pendente: "bg-slate-100 text-slate-600",
  atrasada: "bg-red-50 text-red-700",
};
const statusLabel: Record<Status, string> = {
  enviada: "Enviada",
  pendente: "Pendente",
  atrasada: "Atrasada",
};

export default function TeamNotesScreen() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invoices, setInvoices] = useState<TeamInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [month, setMonth] = useState(() => {
    const now = new Date();
    const current = new Date(now.getFullYear(), now.getMonth(), 1);
    return monthKey(current) < TEAM_NOTES_START ? new Date(2026, 2, 1) : current;
  });
  const [inactivating, setInactivating] = useState<TeamMember | null>(null);
  const [statusFilter, setStatusFilter] = useState<Status | "todos">("todos");
  const [memberForm, setMemberForm] = useState<TeamMember | "new" | null>(null);
  const [invoiceForm, setInvoiceForm] = useState<{ member: TeamMember; invoice: TeamInvoice | null } | null>(null);
  const [viewer, setViewer] = useState<{ member: TeamMember; invoice: TeamInvoice } | null>(null);
  const [deletingMember, setDeletingMember] = useState<TeamMember | null>(null);
  const [tab, setTab] = useState<"notas" | "colaboradores" | "categorias">("notas");
  const [categories, setCategories] = useState<TeamCategory[]>([]);
  const [categoriesReady, setCategoriesReady] = useState(false);

  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [memberRows, invoiceRows] = await Promise.all([
        readAuthenticatedRows<TeamMember>("team_members", "name.asc"),
        readAuthenticatedRows<TeamInvoice>("team_invoices"),
      ]);
      setMembers(memberRows.map((row) => ({ ...row, expected_amount: toNumber(row.expected_amount), due_day: Number(row.due_day) })));
      setInvoices(invoiceRows.map((row) => ({ ...row, reference_month: row.reference_month ?? row.competence, amount: toNumber(row.amount), files: row.files ?? [] })));
      try {
        setCategories(await readAuthenticatedRows<TeamCategory>("team_categories", "name.asc"));
        setCategoriesReady(true);
      } catch (categoryError) {
        console.info("Fincore: categorias da equipe ainda indisponíveis", categoryError);
        setCategoriesReady(false);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      setLoadError(
        /team_|schema cache|does not exist/i.test(message)
          ? "As tabelas de Notas da equipe ainda não existem no banco. Rode `npx supabase db push` e recarregue a página."
          : message || "Não foi possível carregar as notas da equipe.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);

  const categoryName = (id?: string | null) =>
    id ? categories.find((category) => category.id === id)?.name : undefined;
  const key = monthKey(month);
  const todayStr = localDate(new Date());
  // A nota aparece no mês de controle; a competência é só informativa.
  const invoiceFor = (memberId: string, month: string) =>
    invoices.find((item) => item.member_id === memberId && item.reference_month === month) ?? null;
  const statusOf = (member: TeamMember): Status => {
    // A nota é o arquivo: um registro sem arquivo não conta como enviada.
    if (invoiceFor(member.id, key)?.files.length) return "enviada";
    const [y, m] = key.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const due = `${key}-${pad(Math.min(member.due_day, lastDay))}`;
    return todayStr > due ? "atrasada" : "pendente";
  };

  // Todos os colaboradores (ativos e inativos) aparecem em qualquer mês, para
  // permitir lançar notas de meses anteriores e de quem já saiu da equipe. A
  // data de cadastro no sistema não limita mais em quais meses a pessoa aparece.
  const rows = useMemo(
    () =>
      members
        // Inativos deixam de aparecer a partir do mês de inativação, mas uma
        // nota já registrada naquele mês continua visível.
        .filter((member) => key >= TEAM_NOTES_START && (!isInactiveIn(member, key) || Boolean(invoiceFor(member.id, key))))
        .map((member) => ({ member, status: statusOf(member), invoice: invoiceFor(member.id, key) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [members, invoices, key, todayStr],
  );
  const counts = {
    enviada: rows.filter((row) => row.status === "enviada").length,
    pendente: rows.filter((row) => row.status === "pendente").length,
    atrasada: rows.filter((row) => row.status === "atrasada").length,
  };
  const visibleRows = rows.filter((row) => statusFilter === "todos" || row.status === statusFilter);

  const upsertMember = (saved: TeamMember) =>
    setMembers((old) => {
      const normalized = { ...saved, expected_amount: toNumber(saved.expected_amount), due_day: Number(saved.due_day) };
      const exists = old.some((item) => item.id === saved.id);
      const next = exists ? old.map((item) => (item.id === saved.id ? normalized : item)) : [...old, normalized];
      return next.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    });
  const reactivate = async (member: TeamMember) => {
    if (!window.confirm(`Reativar ${member.name}? Ele volta a ser cobrado todo mês.`)) return;
    try {
      upsertMember(await saveTeamMember({ ...withoutCreatedAt(member), inactive_from: null, active: true }));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Não foi possível reativar o colaborador.");
    }
  };
  const inactiveButton = (member: TeamMember) =>
    member.inactive_from || !member.active ? (
      <button
        type="button"
        onClick={() => void reactivate(member)}
        className="flex items-center gap-1 rounded-lg border border-emerald-200 px-2 py-1.5 font-bold text-emerald-700 hover:bg-emerald-50"
      >
        Reativar
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setInactivating(member)}
        className="flex items-center gap-1 rounded-lg border border-amber-200 px-2 py-1.5 font-bold text-amber-700 hover:bg-amber-50"
      >
        Inativar
      </button>
    );
  const inactiveBadge = (member: TeamMember) =>
    member.inactive_from ? (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
        Inativo a partir de {shortMonth(member.inactive_from)}
      </span>
    ) : !member.active ? (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">Inativo</span>
    ) : null;
  const upsertInvoice = (saved: TeamInvoice) =>
    setInvoices((old) => {
      const normalized = { ...saved, reference_month: saved.reference_month ?? saved.competence, amount: toNumber(saved.amount), files: saved.files ?? [] };
      return old.some((item) => item.id === saved.id)
        ? old.map((item) => (item.id === saved.id ? normalized : item))
        : [...old, normalized];
    });

  return (
    <section className="space-y-5">
      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-extrabold text-[#14213d]">Notas da equipe</h2>
            <p className="mt-1 text-xs text-gray-400">
              Controle mensal das notas fiscais dos colaboradores e prestadores de serviço.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {tab === "notas" && (
              <Month
                value={month}
                move={(n) =>
                  setMonth((value) => {
                    const next = new Date(value.getFullYear(), value.getMonth() + n, 1);
                    return monthKey(next) < TEAM_NOTES_START ? value : next;
                  })
                }
              />
            )}
            {tab !== "categorias" && (
              <button
                type="button"
                onClick={() => setMemberForm("new")}
                className="flex items-center gap-1 rounded-xl bg-blue-700 px-3 py-2.5 text-xs font-bold text-white hover:bg-blue-800"
              >
                <Plus className="h-4 w-4" />
                Novo colaborador
              </button>
            )}
          </div>
        </div>

        <div role="tablist" aria-label="Seções de Notas da equipe" className="mt-4 flex flex-wrap gap-1 border-b">
          {([
            ["notas", "Notas do mês"],
            ["colaboradores", `Colaboradores (${members.length})`],
            ["categorias", `Categorias (${categories.length})`],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={tab === value}
              onClick={() => setTab(value)}
              className={`-mb-px border-b-2 px-3 py-2 text-xs font-bold transition ${tab === value ? "border-blue-700 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {loadError && (
          <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{loadError}</p>
        )}

        {tab === "notas" && (
        <>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {(["enviada", "pendente", "atrasada"] as Status[]).map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter((current) => (current === status ? "todos" : status))}
              className={`rounded-xl border p-4 text-left transition hover:shadow-sm ${statusFilter === status ? "border-blue-400 ring-2 ring-blue-100" : ""}`}
            >
              <p className="text-xs font-bold text-gray-500">{statusLabel[status]}s</p>
              <p className={`mt-1 text-2xl font-extrabold ${status === "enviada" ? "text-emerald-600" : status === "atrasada" ? "text-red-600" : "text-slate-700"}`}>
                {counts[status]}
              </p>
              <p className="mt-1 text-[11px] font-semibold text-blue-700">
                {statusFilter === status ? "Mostrando · clique para limpar" : "Filtrar →"}
              </p>
            </button>
          ))}
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="border-b bg-slate-50 text-slate-500">
              <tr>
                <th className="p-3">Colaborador</th>
                <th className="p-3">Serviço</th>
                <th className="p-3">Dia limite</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Valor</th>
                <th className="p-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRows.map(({ member, status, invoice }) => (
                <tr key={member.id} className="hover:bg-slate-50">
                  <td className="p-3">
                    <p className="font-bold text-slate-800">{member.name}</p>
                    {categoryName(member.category_id) && (
                      <p className="text-[11px] font-semibold text-teal-700">{categoryName(member.category_id)}</p>
                    )}
                    {inactiveBadge(member) && <p className="mt-0.5">{inactiveBadge(member)}</p>}
                    {member.document && <p className="text-[11px] text-slate-400">{member.document}</p>}
                  </td>
                  <td className="p-3 text-slate-600">{member.service || "—"}</td>
                  <td className="p-3 text-slate-600">dia {member.due_day}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusStyle[status]}`}>
                      {statusLabel[status]}
                    </span>
                    {invoice && !invoice.files.length && (
                      <p className="mt-1 text-[10px] font-semibold text-amber-700">Registrada sem arquivo</p>
                    )}
                    {invoice && invoice.competence !== invoice.reference_month && (
                      <p className="mt-1 text-[10px] font-semibold text-slate-500">Competência: {competenceLabel(invoice.competence)}</p>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    {invoice?.amount != null ? (
                      <b className="text-slate-800">{fmt(invoice.amount)}</b>
                    ) : member.expected_amount != null ? (
                      <span className="text-slate-400" title="Valor esperado">{fmt(member.expected_amount)}</span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex justify-end gap-1.5">
                      {invoice && invoice.files.length ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setViewer({ member, invoice })}
                            className="flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1.5 font-bold text-blue-700 hover:bg-blue-100"
                          >
                            <Eye className="h-3.5 w-3.5" /> Ver nota
                          </button>
                          <button
                            type="button"
                            onClick={() => setInvoiceForm({ member, invoice })}
                            className="flex items-center gap-1 rounded-lg border px-2 py-1.5 font-bold text-slate-600 hover:bg-white"
                          >
                            <Pencil className="h-3.5 w-3.5" /> Editar nota
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setInvoiceForm({ member, invoice })}
                          className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 font-bold text-white hover:bg-emerald-700"
                        >
                          <Plus className="h-3.5 w-3.5" /> {invoice ? "Anexar nota" : "Registrar nota"}
                        </button>
                      )}
                      <span className="mx-1 w-px self-stretch bg-slate-200" aria-hidden="true" />
                      <button
                        type="button"
                        onClick={() => setMemberForm(member)}
                        title="Editar colaborador"
                        aria-label={`Editar colaborador ${member.name}`}
                        className="flex items-center gap-1 rounded-lg border px-2 py-1.5 font-bold text-blue-700 hover:bg-blue-50"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Colaborador
                      </button>
                      {inactiveButton(member)}
                      <button
                        type="button"
                        onClick={() => setDeletingMember(member)}
                        title="Excluir colaborador"
                        aria-label={`Excluir colaborador ${member.name}`}
                        className="flex items-center rounded-lg border border-red-200 px-2 py-1.5 text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !visibleRows.length && (
            <p className="py-10 text-center text-sm text-slate-400">
              {members.length
                ? "Nenhum colaborador neste filtro para o mês selecionado."
                : "Nenhum colaborador cadastrado ainda. Clique em “Novo colaborador”."}
            </p>
          )}
          {loading && <p className="py-10 text-center text-sm text-slate-400">Carregando…</p>}
        </div>
        </>
        )}

        {tab === "colaboradores" && (
          <div className="mt-4 divide-y divide-slate-100">
            {members.map((member) => (
              <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
                <div className="min-w-0">
                  <p className="font-bold text-slate-800">
                    {member.name}
                    {categoryName(member.category_id) && (
                      <span className="ml-2 rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-bold text-teal-700">{categoryName(member.category_id)}</span>
                    )}
                    {inactiveBadge(member) && <span className="ml-2">{inactiveBadge(member)}</span>}
                  </p>
                  <p className="text-slate-400">
                    {[member.service, member.document, member.email, `dia ${member.due_day}`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setMemberForm(member)} className="rounded-lg border px-2 py-1.5 font-bold text-blue-700 hover:bg-blue-50">Editar</button>
                  {inactiveButton(member)}
                  <button type="button" onClick={() => setDeletingMember(member)} className="rounded-lg border border-red-200 px-2 py-1.5 font-bold text-red-600 hover:bg-red-50">Excluir</button>
                </div>
              </div>
            ))}
            {!members.length && !loading && <p className="py-8 text-center text-sm text-slate-400">Nenhum colaborador cadastrado.</p>}
          </div>
        )}

        {tab === "categorias" && (
          <CategoriesPanel
            categories={categories}
            ready={categoriesReady}
            members={members}
            setCategories={setCategories}
            categoryRemoved={(id) =>
              setMembers((old) => old.map((member) => (member.category_id === id ? { ...member, category_id: null } : member)))
            }
          />
        )}
      </div>

      {memberForm && (
        <MemberForm
          member={memberForm === "new" ? null : memberForm}
          categories={categories}
          categoriesReady={categoriesReady}
          close={() => setMemberForm(null)}
          saved={upsertMember}
        />
      )}
      {invoiceForm && (
        <InvoiceForm
          member={invoiceForm.member}
          invoice={invoiceForm.invoice}
          defaultCompetence={key}
          invoices={invoices}
          close={() => setInvoiceForm(null)}
          saved={upsertInvoice}
          removed={(id) => setInvoices((old) => old.filter((item) => item.id !== id))}
        />
      )}
      {viewer && (
        <InvoiceViewer
          member={viewer.member}
          invoice={viewer.invoice}
          close={() => setViewer(null)}
          edit={() => {
            setInvoiceForm({ member: viewer.member, invoice: viewer.invoice });
            setViewer(null);
          }}
        />
      )}
      {inactivating && (
        <InactivateDialog
          member={inactivating}
          defaultMonth={key}
          close={() => setInactivating(null)}
          saved={upsertMember}
        />
      )}
      {deletingMember && (
        <ConfirmDeleteMember
          member={deletingMember}
          invoiceCount={invoices.filter((item) => item.member_id === deletingMember.id).length}
          close={() => setDeletingMember(null)}
          confirm={async () => {
            const files = invoices.filter((item) => item.member_id === deletingMember.id).flatMap((item) => item.files);
            await deleteTeamMember(deletingMember.id);
            try {
              await removeTeamNoteFiles(files);
            } catch (error) {
              console.error("Fincore: falha ao remover arquivos de notas", error);
            }
            setMembers((old) => old.filter((item) => item.id !== deletingMember.id));
            setInvoices((old) => old.filter((item) => item.member_id !== deletingMember.id));
          }}
        />
      )}
    </section>
  );
}

function Modal({ title, subtitle, close, children }: { title: string; subtitle?: string; close: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <div className="flex max-h-[94vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-extrabold text-[#14213d]">{title}</h2>
            {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button type="button" onClick={close} aria-label="Fechar"><X className="h-5 w-5" /></button>
        </header>
        {children}
      </div>
    </div>
  );
}

const inputClass = "mt-1.5 w-full rounded-xl border bg-gray-50 p-3 text-sm font-normal";

function MemberForm({
  member,
  categories,
  categoriesReady,
  close,
  saved,
}: {
  member: TeamMember | null;
  categories: TeamCategory[];
  categoriesReady: boolean;
  close: () => void;
  saved: (member: TeamMember) => void;
}) {
  const [categoryId, setCategoryId] = useState(member?.category_id ?? "");
  const [name, setName] = useState(member?.name ?? "");
  const [service, setService] = useState(member?.service ?? "");
  const [document, setDocument] = useState(member?.document ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [expected, setExpected] = useState(member?.expected_amount != null ? String(member.expected_amount) : "");
  const [dueDay, setDueDay] = useState(String(member?.due_day ?? 5));
  const [inactiveFrom, setInactiveFrom] = useState(member?.inactive_from ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const day = Number(dueDay);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      setError("O dia limite precisa ser entre 1 e 31.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const expectedValue = parseMoney(expected);
      const result = await saveTeamMember({
        id: member?.id ?? newId(),
        name: name.trim().replace(/\s+/g, " "),
        service: service.trim(),
        document: document.trim(),
        email: email.trim(),
        expected_amount: Number.isFinite(expectedValue) ? expectedValue : null,
        due_day: day,
        inactive_from: inactiveFrom || null,
        active: !inactiveFrom || inactiveFrom > monthKey(new Date()),
        // Só envia a categoria quando a tabela de categorias já existe no banco.
        ...(categoriesReady ? { category_id: categoryId || null } : {}),
      });
      saved(result);
      close();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o colaborador.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={member ? "Editar colaborador" : "Novo colaborador"} subtitle="Quem precisa enviar nota fiscal todo mês." close={close}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="space-y-4 overflow-y-auto p-6">
          <label className="block text-xs font-bold text-slate-700">Nome
            <input required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="Ex.: Igor Ourciolo" />
          </label>
          {categoriesReady && (
            <label className="block text-xs font-bold text-slate-700">Categoria
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
                <option value="">Sem categoria</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>{category.name}</option>
                ))}
              </select>
              {!categories.length && (
                <span className="mt-1 block font-normal text-slate-400">Cadastre as categorias na aba “Categorias”.</span>
              )}
            </label>
          )}
          <label className="block text-xs font-bold text-slate-700">Serviço prestado
            <input value={service} onChange={(e) => setService(e.target.value)} className={inputClass} placeholder="Ex.: Consultoria contábil" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-bold text-slate-700">CPF / CNPJ (opcional)
              <input value={document} onChange={(e) => setDocument(e.target.value)} className={inputClass} />
            </label>
            <label className="block text-xs font-bold text-slate-700">E-mail (opcional)
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-bold text-slate-700">Valor esperado (opcional)
              <CurrencyInput value={expected} onChange={setExpected} required={false} />
            </label>
            <label className="block text-xs font-bold text-slate-700">Dia limite de envio
              <input required type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} className={inputClass} />
            </label>
          </div>
          <label className="block text-xs font-bold text-slate-700">Inativo a partir de (opcional)
            <input type="month" min={TEAM_NOTES_START} value={inactiveFrom} onChange={(e) => setInactiveFrom(e.target.value)} className={inputClass} />
            <span className="mt-1 block font-normal text-slate-400">
              Vazio = ativo, espera nota todo mês. Com um mês, deixa de ser cobrado a partir dele (as notas antigas ficam guardadas).
            </span>
          </label>
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p>}
        </div>
        <footer className="flex gap-3 border-t bg-gray-50 px-6 py-4">
          <button type="button" onClick={close} className="flex-1 rounded-xl border py-2.5 text-sm font-bold">Cancelar</button>
          <button disabled={busy} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? "Salvando…" : "Salvar"}</button>
        </footer>
      </form>
    </Modal>
  );
}

function InvoiceForm({
  member,
  invoice,
  defaultCompetence,
  invoices,
  close,
  saved,
  removed,
}: {
  member: TeamMember;
  invoice: TeamInvoice | null;
  defaultCompetence: string;
  invoices: TeamInvoice[];
  close: () => void;
  saved: (invoice: TeamInvoice) => void;
  removed: (id: string) => void;
}) {
  const [referenceMonth, setReferenceMonth] = useState(invoice?.reference_month ?? defaultCompetence);
  const [competence, setCompetence] = useState(invoice?.competence ?? defaultCompetence);
  const [number, setNumber] = useState(invoice?.invoice_number ?? "");
  const [amount, setAmount] = useState(
    invoice?.amount != null ? String(invoice.amount) : member.expected_amount != null ? String(member.expected_amount) : "",
  );
  const [issueDate, setIssueDate] = useState(invoice?.issue_date ?? "");
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [existing, setExisting] = useState<string[]>(invoice?.files ?? []);
  const [removedFiles, setRemovedFiles] = useState<string[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const addFiles = (picked: File[]) => {
    if (!picked.length) return;
    const invalid = picked.find(
      (file) =>
        !["application/pdf", "image/png", "image/jpeg"].includes(file.type) &&
        !/\.(pdf|png|jpe?g)$/i.test(file.name),
    );
    if (invalid) {
      setError(`"${invalid.name}" não é aceito. Envie PDF, PNG ou JPG.`);
      return;
    }
    const tooBig = picked.find((file) => file.size > 10 * 1024 * 1024);
    if (tooBig) {
      setError(`O arquivo "${tooBig.name}" passa de 10 MB.`);
      return;
    }
    setNewFiles((old) => [...old, ...picked]);
    setError("");
  };
  // Soltar o arquivo em qualquer lugar da tela (com o formulário aberto) anexa,
  // em vez de o navegador sair da página para abrir o PDF.
  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;
  useEffect(() => {
    const over = (event: DragEvent) => event.preventDefault();
    const drop = (event: DragEvent) => {
      if (event.defaultPrevented) return; // já tratado pela área de anexo
      event.preventDefault();
      setDragging(false);
      addFilesRef.current(Array.from(event.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{4}-\d{2}$/.test(referenceMonth)) {
      setError("Informe o mês de controle (em que mês a nota conta).");
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(competence)) {
      setError("Informe o mês de competência.");
      return;
    }
    const duplicate = invoices.find(
      (item) => item.member_id === member.id && item.reference_month === referenceMonth && item.id !== invoice?.id,
    );
    if (duplicate) {
      setError(`Já existe uma nota de ${member.name} no controle de ${competenceLabel(referenceMonth)}. Edite a nota existente.`);
      return;
    }
    // Sem arquivo e sem nenhum dado, a nota deixa de existir: excluímos o
    // registro em vez de manter um "registro fantasma" marcado como enviado.
    const isEmpty = !existing.length && !newFiles.length && !number.trim() && !issueDate && !notes.trim();
    if (isEmpty && !invoice) {
      setError("Anexe o arquivo da nota para registrar.");
      return;
    }
    setBusy(true);
    setError("");
    if (isEmpty && invoice) {
      try {
        await deleteTeamInvoice(invoice.id);
        try {
          await removeTeamNoteFiles([...invoice.files, ...removedFiles]);
        } catch (cleanupError) {
          console.error("Fincore: falha ao remover arquivos da nota", cleanupError);
        }
        removed(invoice.id);
        close();
      } catch (deleteError) {
        setError(deleteError instanceof Error ? deleteError.message : "Não foi possível remover a nota.");
        setBusy(false);
      }
      return;
    }
    try {
      const invoiceId = invoice?.id ?? newId();
      const uploaded: string[] = [];
      for (const file of newFiles) {
        const path = `${invoiceId}/${Date.now()}-${asciiName(file.name)}`;
        await uploadTeamNoteFile(path, file);
        uploaded.push(path);
      }
      const amountValue = parseMoney(amount);
      const result = await saveTeamInvoice({
        id: invoiceId,
        member_id: member.id,
        reference_month: referenceMonth,
        competence,
        invoice_number: number.trim(),
        amount: Number.isFinite(amountValue) ? amountValue : null,
        issue_date: issueDate || null,
        files: [...existing, ...uploaded],
        notes: notes.trim(),
      });
      if (removedFiles.length) {
        try {
          await removeTeamNoteFiles(removedFiles);
        } catch (cleanupError) {
          console.error("Fincore: falha ao remover arquivos antigos da nota", cleanupError);
        }
      }
      saved(result);
      close();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar a nota.");
    } finally {
      setBusy(false);
    }
  };

  const deleteInvoice = async () => {
    if (!invoice) return;
    if (!window.confirm(`Excluir a nota de ${member.name} (${competenceLabel(invoice.reference_month)})? O arquivo também será apagado.`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteTeamInvoice(invoice.id);
      try {
        await removeTeamNoteFiles(invoice.files);
      } catch (cleanupError) {
        console.error("Fincore: falha ao remover arquivos da nota", cleanupError);
      }
      removed(invoice.id);
      close();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Não foi possível excluir a nota.");
      setBusy(false);
    }
  };

  return (
    <Modal title={invoice ? "Editar nota" : "Registrar nota"} subtitle={member.name} close={close}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="space-y-4 overflow-y-auto p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-bold text-slate-700">Mês de controle
              <input required type="month" value={referenceMonth} onChange={(e) => setReferenceMonth(e.target.value)} className={inputClass} />
              <span className="mt-1 block font-normal text-slate-400">Mês em que a nota aparece e conta como enviada.</span>
            </label>
            <label className="block text-xs font-bold text-slate-700">Competência (mês do serviço)
              <input required type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} className={inputClass} />
              <span className="mt-1 block font-normal text-slate-400">Só informativo: pode ser de outro mês.</span>
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-bold text-slate-700">Nº da nota
              <input value={number} onChange={(e) => setNumber(e.target.value)} className={inputClass} placeholder="Ex.: 1234" />
            </label>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs font-bold text-slate-700">Valor da nota
              <CurrencyInput value={amount} onChange={setAmount} required={false} />
            </label>
            <label className="block text-xs font-bold text-slate-700">Data de emissão
              <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={inputClass} />
            </label>
          </div>
          <label className="block text-xs font-bold text-slate-700">Observações
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} rows={2} />
          </label>
          <div className="text-xs font-bold text-slate-700">
            Arquivo da nota (PDF, PNG ou JPG)
            <div className="mt-1.5 space-y-2">
              {existing.map((path) => (
                <div key={path} className="flex items-center gap-2 rounded-xl border bg-gray-50 p-2 font-normal">
                  <Paperclip className="h-4 w-4 shrink-0 text-slate-500" />
                  <span className="flex-1 truncate">{fileLabel(path)}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setExisting((old) => old.filter((item) => item !== path));
                      setRemovedFiles((old) => [...old, path]);
                    }}
                    className="rounded px-1.5 py-0.5 font-bold text-red-600 hover:bg-red-50"
                  >
                    Remover
                  </button>
                </div>
              ))}
              {newFiles.map((file, index) => (
                <div key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2 font-normal">
                  <Paperclip className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span className="flex-1 truncate">{file.name} <span className="text-emerald-700">(novo)</span></span>
                  <button
                    type="button"
                    onClick={() => setNewFiles((old) => old.filter((_, i) => i !== index))}
                    className="rounded px-1.5 py-0.5 font-bold text-red-600 hover:bg-red-50"
                  >
                    Remover
                  </button>
                </div>
              ))}
              <label
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  addFiles(Array.from(event.dataTransfer.files));
                }}
                className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed p-5 transition ${dragging ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-300 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700"}`}
              >
                <Plus className="h-5 w-5" />
                {dragging ? "Solte o arquivo para anexar" : "Arraste a nota aqui ou clique para escolher"}
                <span className="font-normal text-slate-400">PDF, PNG ou JPG · até 10 MB</span>
                <input
                  type="file"
                  accept="image/png,image/jpeg,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    addFiles(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
          </div>
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p>}
        </div>
        <footer className="flex flex-wrap gap-3 border-t bg-gray-50 px-6 py-4">
          {invoice && (
            <button type="button" disabled={busy} onClick={() => void deleteInvoice()} className="flex items-center gap-1 rounded-xl border border-red-200 px-3 py-2.5 text-sm font-bold text-red-600 disabled:opacity-50">
              <Trash2 className="h-4 w-4" /> Excluir
            </button>
          )}
          <button type="button" onClick={close} className="flex-1 rounded-xl border py-2.5 text-sm font-bold">Cancelar</button>
          <button disabled={busy} className="flex-1 rounded-xl bg-blue-700 py-2.5 text-sm font-bold text-white disabled:opacity-50">{busy ? "Salvando…" : "Salvar nota"}</button>
        </footer>
      </form>
    </Modal>
  );
}

function InvoiceViewer({ member, invoice, close, edit }: { member: TeamMember; invoice: TeamInvoice; close: () => void; edit: () => void }) {
  const [selected, setSelected] = useState(invoice.files[0] ?? "");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!selected) return;
    let active = true;
    setUrl("");
    setError("");
    teamNoteFileUrl(selected)
      .then((signed) => active && setUrl(signed))
      .catch((loadError) => active && setError(loadError instanceof Error ? loadError.message : "Não foi possível abrir o arquivo."));
    return () => {
      active = false;
    };
  }, [selected]);
  const download = async () => {
    try {
      const signed = await teamNoteFileUrl(selected, fileLabel(selected));
      const link = document.createElement("a");
      link.href = signed;
      link.download = fileLabel(selected);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : "Não foi possível baixar o arquivo.");
    }
  };
  const details = [
    `Controle: ${competenceLabel(invoice.reference_month)}`,
    invoice.competence !== invoice.reference_month && `Competência: ${competenceLabel(invoice.competence)}`,
    invoice.invoice_number && `Nº ${invoice.invoice_number}`,
    invoice.amount != null && fmt(invoice.amount),
    invoice.issue_date && `Emitida em ${dateBR(invoice.issue_date)}`,
  ].filter(Boolean).join(" · ");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="presentation" onClick={close}>
      <section
        role="dialog"
        aria-modal="true"
        className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex flex-wrap items-start justify-between gap-3 border-b px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-extrabold text-[#14213d]">Nota de {member.name}</h2>
            <p className="mt-0.5 text-xs text-slate-500">{details}</p>
            {invoice.notes && <p className="mt-0.5 text-xs text-slate-400">{invoice.notes}</p>}
          </div>
          <div className="flex items-center gap-2">
            {selected && (
              <button type="button" onClick={() => void download()} className="flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-bold text-slate-700 hover:bg-gray-50">
                <Download className="h-4 w-4" /> Baixar
              </button>
            )}
            <button type="button" onClick={edit} className="flex items-center gap-1 rounded-xl bg-blue-700 px-3 py-2 text-xs font-bold text-white hover:bg-blue-800">
              <Pencil className="h-4 w-4" /> Editar
            </button>
            <button type="button" onClick={close} aria-label="Fechar" className="rounded-lg p-1.5 hover:bg-gray-100"><X className="h-5 w-5" /></button>
          </div>
        </header>
        {invoice.files.length > 1 && (
          <div className="flex flex-wrap gap-1.5 border-b bg-gray-50 px-6 py-2">
            {invoice.files.map((path) => (
              <button
                key={path}
                type="button"
                onClick={() => setSelected(path)}
                className={`flex max-w-[220px] items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${selected === path ? "bg-[#14213d] text-white" : "border bg-white text-slate-600"}`}
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{fileLabel(path)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex min-h-0 flex-1 items-center justify-center bg-slate-100">
          {!selected ? (
            <div className="text-center text-sm text-slate-500">
              <p>Esta nota não tem arquivo anexado.</p>
              <button type="button" onClick={edit} className="mt-3 rounded-xl bg-blue-700 px-4 py-2 text-xs font-bold text-white">Anexar arquivo</button>
            </div>
          ) : error ? (
            <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p>
          ) : !url ? (
            <p className="text-sm text-slate-500">Carregando arquivo…</p>
          ) : isPdf(selected) ? (
            <iframe title={fileLabel(selected)} src={url} className="h-full w-full border-0 bg-white" />
          ) : (
            <img src={url} alt={fileLabel(selected)} className="max-h-full max-w-full object-contain" />
          )}
        </div>
      </section>
    </div>
  );
}

function ConfirmDeleteMember({
  member,
  invoiceCount,
  close,
  confirm,
}: {
  member: TeamMember;
  invoiceCount: number;
  close: () => void;
  confirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal title={`Excluir ${member.name}?`} subtitle="Esta ação não pode ser desfeita." close={close}>
      <div className="space-y-3 p-6 text-sm text-slate-600">
        <p>
          O colaborador será removido junto com <b>{invoiceCount} nota(s)</b> registrada(s) e os arquivos anexados.
        </p>
        <p className="text-xs text-slate-400">Se ele só parou de prestar serviço, use o botão “Inativar” para manter o histórico das notas.</p>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p>}
      </div>
      <footer className="flex gap-3 border-t bg-gray-50 px-6 py-4">
        <button type="button" onClick={close} className="flex-1 rounded-xl border py-2.5 text-sm font-bold">Cancelar</button>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await confirm();
              close();
            } catch (deleteError) {
              setError(deleteError instanceof Error ? deleteError.message : "Não foi possível excluir.");
              setBusy(false);
            }
          }}
          className="flex-1 rounded-xl bg-red-600 py-2.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? "Excluindo…" : "Excluir"}
        </button>
      </footer>
    </Modal>
  );
}

function CategoriesPanel({
  categories,
  ready,
  members,
  setCategories,
  categoryRemoved,
}: {
  categories: TeamCategory[];
  ready: boolean;
  members: TeamMember[];
  setCategories: (update: (old: TeamCategory[]) => TeamCategory[]) => void;
  categoryRemoved: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const clean = (value: string) => value.trim().replace(/\s+/g, " ");
  const sorted = (list: TeamCategory[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const countFor = (id: string) => members.filter((member) => member.category_id === id).length;
  const validate = (value: string, ignoreId?: string) => {
    const text = clean(value);
    if (text.length < 2 || text.length > 80) return "Informe um nome entre 2 e 80 caracteres.";
    if (categories.some((item) => item.id !== ignoreId && item.name.toLocaleLowerCase("pt-BR") === text.toLocaleLowerCase("pt-BR")))
      return "Já existe uma categoria com esse nome.";
    return "";
  };
  const add = async (event: FormEvent) => {
    event.preventDefault();
    const problem = validate(name);
    if (problem) return setError(problem);
    setBusy(true);
    setError("");
    try {
      const saved = await saveTeamCategory({ id: newId(), name: clean(name) });
      setCategories((old) => sorted([...old, saved]));
      setName("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível cadastrar a categoria.");
    } finally {
      setBusy(false);
    }
  };
  const rename = async (category: TeamCategory) => {
    const problem = validate(editName, category.id);
    if (problem) return setError(problem);
    setBusy(true);
    setError("");
    try {
      const saved = await saveTeamCategory({ id: category.id, name: clean(editName) });
      setCategories((old) => sorted(old.map((item) => (item.id === category.id ? saved : item))));
      setEditingId(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível renomear a categoria.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (category: TeamCategory) => {
    const count = countFor(category.id);
    const warning = count ? `\n\n${count} colaborador(es) vão ficar sem categoria (nenhum é apagado).` : "";
    if (!window.confirm(`Excluir a categoria "${category.name}"?${warning}`)) return;
    setBusy(true);
    setError("");
    try {
      await deleteTeamCategory(category.id);
      setCategories((old) => old.filter((item) => item.id !== category.id));
      categoryRemoved(category.id);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Não foi possível excluir a categoria.");
    } finally {
      setBusy(false);
    }
  };
  if (!ready)
    return (
      <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs font-bold text-amber-800">
        As categorias ainda não estão disponíveis no banco de dados. Rode `npx supabase db push` e recarregue a página.
      </p>
    );
  return (
    <div className="mt-4 space-y-4">
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ex.: Marketing, Analista de Sistemas, Financeiro, Comercial"
          maxLength={80}
          className="w-full max-w-sm rounded-xl border bg-gray-50 px-3 py-2 text-sm"
        />
        <button disabled={busy} className="flex items-center gap-1 rounded-xl bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
          <Plus className="h-4 w-4" /> Cadastrar categoria
        </button>
      </form>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {categories.map((category) => (
          <article key={category.id} className="flex items-center gap-3 rounded-xl border p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <Tag className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              {editingId === category.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={(event) => setEditName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void rename(category);
                    if (event.key === "Escape") setEditingId(null);
                  }}
                  maxLength={80}
                  className="w-full rounded-lg border bg-gray-50 px-2 py-1 text-sm"
                />
              ) : (
                <p className="truncate font-bold text-slate-800">{category.name}</p>
              )}
              <p className="text-[11px] text-slate-400">{countFor(category.id)} colaborador(es)</p>
            </div>
            <div className="flex shrink-0 gap-1 text-xs font-bold">
              {editingId === category.id ? (
                <>
                  <button type="button" disabled={busy} onClick={() => void rename(category)} className="rounded px-1.5 py-1 text-blue-700 hover:bg-blue-50">Salvar</button>
                  <button type="button" onClick={() => setEditingId(null)} className="rounded px-1.5 py-1 text-slate-500 hover:bg-slate-50">Cancelar</button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(category.id);
                      setEditName(category.name);
                      setError("");
                    }}
                    className="rounded px-1.5 py-1 text-blue-700 hover:bg-blue-50"
                  >
                    Editar
                  </button>
                  <button type="button" disabled={busy} onClick={() => void remove(category)} className="rounded px-1.5 py-1 text-red-600 hover:bg-red-50">Excluir</button>
                </>
              )}
            </div>
          </article>
        ))}
        {!categories.length && <p className="text-sm text-slate-400">Nenhuma categoria cadastrada ainda.</p>}
      </div>
    </div>
  );
}

function InactivateDialog({
  member,
  defaultMonth,
  close,
  saved,
}: {
  member: TeamMember;
  defaultMonth: string;
  close: () => void;
  saved: (member: TeamMember) => void;
}) {
  const [from, setFrom] = useState(member.inactive_from ?? defaultMonth);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{4}-\d{2}$/.test(from)) {
      setError("Escolha o mês a partir do qual ele fica inativo.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await saveTeamMember({
        ...withoutCreatedAt(member),
        inactive_from: from,
        active: from > monthKey(new Date()),
      });
      saved(result);
      close();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível inativar o colaborador.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={`Inativar ${member.name}`} subtitle="As notas já registradas continuam guardadas." close={close}>
      <form onSubmit={submit}>
        <div className="space-y-4 p-6">
          <label className="block text-xs font-bold text-slate-700">Inativo a partir de
            <input required type="month" min={TEAM_NOTES_START} value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </label>
          {/^\d{4}-\d{2}$/.test(from) && (
            <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
              A partir de <b>{competenceLabel(from)}</b>, {member.name} deixa de ser cobrado e não aparece mais como
              pendente ou atrasado. Os meses anteriores e as notas já registradas continuam normalmente.
            </p>
          )}
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{error}</p>}
        </div>
        <footer className="flex gap-3 border-t bg-gray-50 px-6 py-4">
          <button type="button" onClick={close} className="flex-1 rounded-xl border py-2.5 text-sm font-bold">Cancelar</button>
          <button disabled={busy} className="flex-1 rounded-xl bg-amber-600 py-2.5 text-sm font-bold text-white disabled:opacity-50">
            {busy ? "Salvando…" : "Inativar"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
