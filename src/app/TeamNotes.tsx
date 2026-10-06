import { FormEvent, ReactNode, useEffect, useMemo, useState } from "react";
import {
  Download,
  Eye,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { readAuthenticatedRows } from "../lib/supabase";
import {
  TeamInvoice,
  TeamMember,
  deleteTeamInvoice,
  deleteTeamMember,
  removeTeamNoteFiles,
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
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [statusFilter, setStatusFilter] = useState<Status | "todos">("todos");
  const [memberForm, setMemberForm] = useState<TeamMember | "new" | null>(null);
  const [invoiceForm, setInvoiceForm] = useState<{ member: TeamMember; invoice: TeamInvoice | null } | null>(null);
  const [viewer, setViewer] = useState<{ member: TeamMember; invoice: TeamInvoice } | null>(null);
  const [deletingMember, setDeletingMember] = useState<TeamMember | null>(null);
  const [showMembers, setShowMembers] = useState(false);

  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [memberRows, invoiceRows] = await Promise.all([
        readAuthenticatedRows<TeamMember>("team_members", "name.asc"),
        readAuthenticatedRows<TeamInvoice>("team_invoices"),
      ]);
      setMembers(memberRows.map((row) => ({ ...row, expected_amount: toNumber(row.expected_amount), due_day: Number(row.due_day) })));
      setInvoices(invoiceRows.map((row) => ({ ...row, amount: toNumber(row.amount), files: row.files ?? [] })));
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

  const key = monthKey(month);
  const todayStr = localDate(new Date());
  const invoiceFor = (memberId: string, competence: string) =>
    invoices.find((item) => item.member_id === memberId && item.competence === competence) ?? null;
  const statusOf = (member: TeamMember): Status => {
    if (invoiceFor(member.id, key)) return "enviada";
    const [y, m] = key.split("-").map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const due = `${key}-${pad(Math.min(member.due_day, lastDay))}`;
    return todayStr > due ? "atrasada" : "pendente";
  };

  // Colaboradores do mês: ativos já cadastrados até o mês + quem tem nota nele.
  const rows = useMemo(
    () =>
      members
        .filter((member) => {
          const createdMonth = member.created_at?.slice(0, 7) ?? "0000-00";
          return (member.active && createdMonth <= key) || Boolean(invoiceFor(member.id, key));
        })
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
  const upsertInvoice = (saved: TeamInvoice) =>
    setInvoices((old) => {
      const normalized = { ...saved, amount: toNumber(saved.amount), files: saved.files ?? [] };
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
            <Month
              value={month}
              move={(n) => setMonth((value) => new Date(value.getFullYear(), value.getMonth() + n, 1))}
            />
            <button
              type="button"
              onClick={() => setMemberForm("new")}
              className="flex items-center gap-1 rounded-xl bg-blue-700 px-3 py-2.5 text-xs font-bold text-white hover:bg-blue-800"
            >
              <Plus className="h-4 w-4" />
              Novo colaborador
            </button>
          </div>
        </div>

        {loadError && (
          <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">{loadError}</p>
        )}

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
                    {member.document && <p className="text-[11px] text-slate-400">{member.document}</p>}
                  </td>
                  <td className="p-3 text-slate-600">{member.service || "—"}</td>
                  <td className="p-3 text-slate-600">dia {member.due_day}</td>
                  <td className="p-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${statusStyle[status]}`}>
                      {statusLabel[status]}
                    </span>
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
                      {invoice ? (
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
                          onClick={() => setInvoiceForm({ member, invoice: null })}
                          className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 font-bold text-white hover:bg-emerald-700"
                        >
                          <Plus className="h-3.5 w-3.5" /> Registrar nota
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
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <button
          type="button"
          onClick={() => setShowMembers((value) => !value)}
          className="flex w-full items-center justify-between text-left"
        >
          <div>
            <h2 className="font-extrabold text-[#14213d]">Colaboradores cadastrados</h2>
            <p className="mt-1 text-xs text-gray-400">{members.length} cadastrado(s) · editar, ativar/inativar ou excluir.</p>
          </div>
          <span className="text-xs font-bold text-blue-700">{showMembers ? "Ocultar" : "Mostrar"}</span>
        </button>
        {showMembers && (
          <div className="mt-4 divide-y divide-slate-100">
            {members.map((member) => (
              <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
                <div className="min-w-0">
                  <p className="font-bold text-slate-800">
                    {member.name}
                    {!member.active && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">Inativo</span>}
                  </p>
                  <p className="text-slate-400">
                    {[member.service, member.document, member.email, `dia ${member.due_day}`].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => setMemberForm(member)} className="rounded-lg border px-2 py-1.5 font-bold text-blue-700 hover:bg-blue-50">Editar</button>
                  <button type="button" onClick={() => setDeletingMember(member)} className="rounded-lg border border-red-200 px-2 py-1.5 font-bold text-red-600 hover:bg-red-50">Excluir</button>
                </div>
              </div>
            ))}
            {!members.length && <p className="py-5 text-center text-sm text-slate-400">Nenhum colaborador cadastrado.</p>}
          </div>
        )}
      </div>

      {memberForm && (
        <MemberForm
          member={memberForm === "new" ? null : memberForm}
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

function MemberForm({ member, close, saved }: { member: TeamMember | null; close: () => void; saved: (member: TeamMember) => void }) {
  const [name, setName] = useState(member?.name ?? "");
  const [service, setService] = useState(member?.service ?? "");
  const [document, setDocument] = useState(member?.document ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [expected, setExpected] = useState(member?.expected_amount != null ? String(member.expected_amount) : "");
  const [dueDay, setDueDay] = useState(String(member?.due_day ?? 5));
  const [active, setActive] = useState(member?.active ?? true);
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
        active,
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
          <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-700">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Ativo (espera nota todo mês)
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{4}-\d{2}$/.test(competence)) {
      setError("Informe o mês de competência.");
      return;
    }
    const duplicate = invoices.find(
      (item) => item.member_id === member.id && item.competence === competence && item.id !== invoice?.id,
    );
    if (duplicate) {
      setError(`Já existe uma nota de ${member.name} para ${competenceLabel(competence)}. Edite a nota existente.`);
      return;
    }
    setBusy(true);
    setError("");
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
    if (!window.confirm(`Excluir a nota de ${member.name} (${competenceLabel(invoice.competence)})? O arquivo também será apagado.`)) return;
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
            <label className="block text-xs font-bold text-slate-700">Competência (mês)
              <input required type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} className={inputClass} />
            </label>
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
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white p-3 text-slate-600 hover:border-blue-300 hover:text-blue-700">
                <Plus className="h-4 w-4" />
                Anexar arquivo
                <input
                  type="file"
                  accept="image/png,image/jpeg,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const picked = Array.from(event.target.files ?? []);
                    const tooBig = picked.find((file) => file.size > 10 * 1024 * 1024);
                    if (tooBig) setError(`O arquivo "${tooBig.name}" passa de 10 MB.`);
                    else {
                      setNewFiles((old) => [...old, ...picked]);
                      setError("");
                    }
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
    competenceLabel(invoice.competence),
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
        <p className="text-xs text-slate-400">Se ele só parou de prestar serviço, prefira editar e desmarcar “Ativo” para manter o histórico.</p>
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
