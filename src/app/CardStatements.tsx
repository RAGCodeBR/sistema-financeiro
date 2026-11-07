import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowDownLeft, ArrowRight, Building2, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, CreditCard, Download, FileCheck2, FileText, FolderOpen, History, Landmark, LoaderCircle, LockKeyhole, ReceiptText, Search, ShieldQuestion, Trash2, Upload, UserRound, X } from "lucide-react";
import { currentTransactions, emptyDecision, normalizeStatementText, reconcileStatement, reviewIsComplete, type CardStatement, type ComparisonEntry, type Reconciliation, type ReviewDecision, type StatementTransaction } from "../lib/cardStatement";
import { readStatementPdf } from "../lib/readStatementPdf";
import { readComparisonExcel } from "../lib/readComparison";
import { buildStatementImportPlan, createLocalStatementEntries, identifyStatement, importPayload, statementCardKey, type AppliedStatementItem, type ConfirmStatementPayload, type ConfirmStatementResult, type StatementReviewState } from "../lib/cardImport";
import { cacheStatementFile, cachedStatementFile, readCardWorkspace, removeStatementFile, writeCardWorkspace, type CardWorkspace } from "../lib/cardWorkspace";
import GeneratedCardEntries from "./GeneratedCardEntries";
import "../styles/card-statements.css";

type Category = { name: string; unit: string; kind?: string };
type Props = { entries?: ComparisonEntry[]; centers?: string[]; categories?: Category[]; comparisonReady?: boolean; standalone?: boolean; storageScope?: string;
  loadApplied?: (cardKey: string, dueDate: string) => Promise<StatementReviewState>;
  onConfirm?: (payload: ConfirmStatementPayload) => Promise<ConfirmStatementResult> };
const previewCenters = ["Marketing", "Sítio", "Consultoria", "Pessoa Física"];
const genericCategories = ["Alimentação", "Viagens e transporte", "Software e assinaturas", "Compras e materiais", "Tarifas e impostos", "Outras despesas"];
const money = (cents: number) => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateLabel = (iso: string) => iso ? iso.split("-").reverse().join("/") : "Não identificada";
const kindLabel = { purchase: "Compra", fee: "Encargo", credit: "Crédito / ajuste", future: "Parcela futura", payment: "Pagamento" };
type Filter = "all" | "pending" | "new" | "matches" | "unrecognized" | "reviewed" | "future" | "payments";
function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Não foi possível ler o arquivo. Tente novamente."; }
function suggestedCategory(t: StatementTransaction): string {
  const text = normalizeStatementText(`${t.description} ${t.detail}`);
  if (t.kind === "fee" || t.kind === "credit") return "Tarifas e impostos";
  if (/restaurante|mc donald/.test(text)) return "Alimentação";
  if (/viagem|azul|passagem/.test(text)) return "Viagens e transporte";
  if (/apple|google|anthropic/.test(text)) return "Software e assinaturas";
  if (/supermercado/.test(text)) return "Compras e materiais";
  return "";
}
function stateLabel(t: StatementTransaction, decision: ReviewDecision | undefined, comparison: Reconciliation | undefined, applied?: AppliedStatementItem) {
  if (t.kind === "payment") return { label: "Pagamento separado", tone: "neutral" };
  if (t.kind === "future") return { label: "Próximas faturas", tone: "neutral" };
  if (applied) return { label: applied.status === "offset" ? "Compensada por créditos" : !applied.entryId ? "Lançamento removido" : applied.status === "linked" ? "Vínculo confirmado" : "Lançada", tone: applied.status !== "offset" && !applied.entryId ? "warning" : "success" };
  if (decision?.status === "unrecognized") return { label: "Não reconhecida", tone: "danger" };
  if (reviewIsComplete(t, decision)) return { label: decision?.status === "linked" ? "Vínculo confirmado" : "Classificada", tone: "success" };
  if (t.kind === "credit") return { label: "Validar crédito", tone: "warning" };
  if (comparison?.status === "ambiguous") return { label: "Conferir duplicidade", tone: "warning" };
  if (comparison?.status === "matched") return { label: "Provável lançamento", tone: "info" };
  if (comparison?.status === "possible") return { label: "Possível lançamento", tone: "warning" };
  if (comparison?.status === "new") return { label: "Sem correspondência", tone: "warning" };
  return { label: "A conferir", tone: "neutral" };
}
function restoreDecisions(key: string, statement: CardStatement): Record<string, ReviewDecision> {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if (saved?.version !== 1 || saved.fingerprint !== statement.fingerprint) return {};
    const result: Record<string, ReviewDecision> = {};
    for (const t of statement.transactions) {
      const d = saved.decisions?.[t.id];
      if (d && ["pending", "classified", "linked", "unrecognized"].includes(d.status) && ["", "PF", "PJ"].includes(d.nature) && [d.costCenter, d.category, d.note].every(v => typeof v === "string")) result[t.id] = d;
    }
    return result;
  } catch { return {}; }
}
export default function CardStatements({ entries, centers = previewCenters, categories, comparisonReady = false, standalone = false, storageScope = "preview", loadApplied, onConfirm }: Props) {
  const [workspace, setWorkspace] = useState(() => readCardWorkspace(storageScope));
  const workspaceRef = useRef(workspace);
  const [workspaceView, setWorkspaceView] = useState<"review" | "entries">("review");
  const [remoteApplied, setRemoteApplied] = useState<AppliedStatementItem[]>([]);
  const [registryReady, setRegistryReady] = useState(standalone), [integrationError, setIntegrationError] = useState("");
  const [applying, setApplying] = useState(false);
  const applyingRef = useRef(false);
  const [statement, setStatement] = useState<CardStatement | null>(null);
  const [decisions, setDecisions] = useState<Record<string, ReviewDecision>>({});
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<ReviewDecision>(emptyDecision);
  const [filter, setFilter] = useState<Filter>("all"), [search, setSearch] = useState("");
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [baseline, setBaseline] = useState<ComparisonEntry[] | null>(null), [baselineName, setBaselineName] = useState("");
  const [summaryOpen, setSummaryOpen] = useState(false), [pdfUrl, setPdfUrl] = useState("");
  const [removeOpen, setRemoveOpen] = useState(false);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null), comparisonInput = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false), started = useRef(false), pdfUrlRef = useRef("");
  const activationRequest = useRef(0);
  const sourceEntries = useMemo(() => standalone ? [...workspace.entries, ...(baseline || [])] : entries && comparisonReady ? entries : null, [standalone, workspace.entries, baseline, entries, comparisonReady]);
  const appliedRecords = standalone ? workspace.applied : remoteApplied;
  const appliedByKey = useMemo(() => new Map(appliedRecords.map(item => [item.sourceKey, item])), [appliedRecords]);
  const plan = useMemo(() => statement ? buildStatementImportPlan(statement, decisions, sourceEntries, appliedRecords) : null, [statement, decisions, sourceEntries, appliedRecords]);
  const cardOptions = [...new Map(workspace.statements.map(s => [statementCardKey(s), { key: statementCardKey(s), last4: s.cardLast4 }])).values()];
  const activeCard = statement ? statementCardKey(statement) : "";
  const invoiceOptions = workspace.statements.filter(s => statementCardKey(s) === activeCard).sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  const generatedEntries = (sourceEntries || []).flatMap(entry => {
    const record = appliedRecords.find(item => item.cardKey === activeCard && item.entryId === entry.id);
    return entry.cardKey === activeCard || record ? [{ ...entry, ...(record ? { nature: record.nature, cardLast4: statement?.cardLast4 } : {}) }] : [];
  });
  const effectiveCenters = useMemo(() => [...new Set([...centers, ...(sourceEntries || []).map(e => e.unit).filter((u): u is string => Boolean(u))])], [centers, sourceEntries]);
  const matches = useMemo(() => reconcileStatement(statement?.transactions || [], sourceEntries ?? null), [statement, sourceEntries]);
  const current = statement ? currentTransactions(statement) : [];
  const selected = statement?.transactions.find(t => t.id === selectedId);
  const selectedApplied = selected ? appliedByKey.get(selected.sourceKey!) : undefined;
  const reviewed = current.filter(t => reviewIsComplete(t, decisions[t.id]));
  const unrecognized = current.filter(t => decisions[t.id]?.status === "unrecognized");
  const pending = current.length - reviewed.length;
  const classificationTotals = { PJ: 0, PF: 0, pending: 0 };
  for (const t of current) {
    const d = decisions[t.id];
    classificationTotals[reviewIsComplete(t, d) && d?.nature ? d.nature : "pending"] += t.amountCents;
  }
  const filtered = (statement?.transactions || []).filter(t => {
    if (filter === "future") { if (t.kind !== "future") return false; }
    else if (filter === "payments") { if (t.kind !== "payment") return false; }
    else {
      if (t.kind === "future" || t.kind === "payment") return false;
      const d = decisions[t.id], m = matches[t.id];
      if (filter === "pending" && reviewIsComplete(t, d)) return false;
      if (filter === "new" && m?.status !== "new") return false;
      if (filter === "matches" && !m?.matches.length) return false;
      if (filter === "unrecognized" && d?.status !== "unrecognized") return false;
      if (filter === "reviewed" && !reviewIsComplete(t, d)) return false;
    }
    return normalizeStatementText(`${t.description} ${t.detail} ${decisions[t.id]?.costCenter || ""}`).includes(normalizeStatementText(search));
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageItems = filtered.slice(pageStart, pageStart + pageSize);
  useEffect(() => { setPage(1); }, [filter, search, pageSize, statement?.fingerprint]);
  useEffect(() => { setPage(previous => Math.min(previous, pageCount)); }, [pageCount]);
  const draftCategories = categories ? categories.filter(c => c.unit === draft.costCenter && (!c.kind || c.kind === "despesa")).map(c => c.name) : genericCategories;
  const draftCenters = effectiveCenters.filter(c => draft.nature === "PF" ? normalizeStatementText(c) === "pessoa fisica" : draft.nature === "PJ" ? normalizeStatementText(c) !== "pessoa fisica" : true);
  const storageKey = (s: CardStatement) => `fincore.statement.v1.${storageScope}.${s.fingerprint}`;
  useEffect(() => {
    if (selected) setDraft(decisions[selected.id] || emptyDecision());
  }, [selectedId, decisions]);
  useEffect(() => () => { cancelled.current = true; if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current); }, []);
  function persistWorkspace(next: CardWorkspace) {
    writeCardWorkspace(storageScope, next); workspaceRef.current = next; setWorkspace(next);
  }
  function restoredWithApplied(s: CardStatement, records: AppliedStatementItem[], remoteDrafts: StatementReviewState["drafts"] = {}) {
    const restored = restoreDecisions(storageKey(s), s), byKey = new Map(records.map(item => [item.sourceKey, item]));
    for (const t of s.transactions) {
      if (!restored[t.id] && remoteDrafts[t.sourceKey!]) restored[t.id] = remoteDrafts[t.sourceKey!];
      const saved = byKey.get(t.sourceKey!);
      if (saved) restored[t.id] = { status: saved.status === "linked" ? "linked" : "classified", nature: saved.nature, costCenter: saved.costCenter, category: saved.category, note: restored[t.id]?.note || saved.note || "", linkedEntryId: saved.entryId || undefined };
    }
    return restored;
  }
  async function activateStatement(input: CardStatement, original?: File, request = ++activationRequest.current) {
    const parsed = identifyStatement(input);
    setBusy(true); setSelectedId(""); setSummaryOpen(false); setFilter("all"); setSearch(""); setWorkspaceView("review"); setIntegrationError("");
    setStatement(parsed); setDecisions(restoredWithApplied(parsed, standalone ? workspaceRef.current.applied : [])); setRemoteApplied([]); setRegistryReady(standalone);
    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    pdfUrlRef.current = ""; setPdfUrl("");
    try {
      persistWorkspace({ ...workspaceRef.current, statements: [...workspaceRef.current.statements.filter(s => s.fingerprint !== parsed.fingerprint), parsed], activeFingerprint: parsed.fingerprint });
      if (original) { try { await cacheStatementFile(storageScope, parsed.fingerprint, original); } catch { setNotice("A fatura foi lida, mas o navegador não permitiu guardar o PDF original para reabrir depois."); } }
      let file = original;
      if (!file) { try { file = await cachedStatementFile(storageScope, parsed.fingerprint) || undefined; } catch { /* Metadata and decisions remain usable without the original PDF. */ } }
      if (request !== activationRequest.current || cancelled.current) return;
      if (file && !cancelled.current) { const url = URL.createObjectURL(file); pdfUrlRef.current = url; setPdfUrl(url); }
      if (!standalone && loadApplied) {
        try { const records = await loadApplied(statementCardKey(parsed), parsed.dueDate); if (!cancelled.current && request === activationRequest.current) { setRemoteApplied(records.applied); setDecisions(restoredWithApplied(parsed, records.applied, records.drafts)); setRegistryReady(true); } }
        catch (e) { if (request === activationRequest.current) setIntegrationError(errorMessage(e)); }
      }
    } finally { if (!cancelled.current && request === activationRequest.current) setBusy(false); }
  }
  useEffect(() => {
    if (!selectedId && !summaryOpen && !removeOpen) return;
    const dialog = document.querySelector<HTMLElement>(".cs-review-dialog");
    if (!dialog) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary')];
    focusable()[0]?.focus();
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !applying && !(removeOpen && busy)) { setSelectedId(""); setSummaryOpen(false); setRemoveOpen(false); }
      if (event.key !== "Tab") return;
      const items = focusable(), first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", trapFocus);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", trapFocus); if (previousFocus?.isConnected) previousFocus.focus(); };
  }, [selectedId, summaryOpen, removeOpen, applying, busy]);
  async function loadFile(file: File) {
    const request = ++activationRequest.current;
    setBusy(true); setError(""); setNotice("");
    try {
      const parsed = await readStatementPdf(file);
      if (cancelled.current || request !== activationRequest.current) return;
      const restored = restoreDecisions(storageKey(parsed), parsed);
      await activateStatement(parsed, file, request);
      if (Object.keys(restored).length) setNotice("Fatura já conferida neste navegador. Seu rascunho foi recuperado; os itens não foram duplicados.");
    } catch (e) { if (request === activationRequest.current) setError(errorMessage(e)); }
    finally { if (!cancelled.current && request === activationRequest.current) setBusy(false); }
  }
  async function loadExample() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/__local/itau-statement.pdf", { cache: "no-store" });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/pdf")) throw new Error("Selecione o PDF do Itaú no seu computador para começar.");
      await loadFile(new File([await response.blob()], "Fatura Itaú de exemplo.pdf", { type: "application/pdf" }));
    } catch (e) { if (!cancelled.current) { setError(errorMessage(e)); setBusy(false); } }
  }
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      const cached = workspaceRef.current.statements.find(s => s.fingerprint === workspaceRef.current.activeFingerprint);
      if (cached) void activateStatement(cached).catch(e => setError(errorMessage(e)));
      else if (standalone && !workspaceRef.current.exampleDismissed) void loadExample();
    }
  }, [standalone]);
  async function removeStatement() {
    if (!statement || busy || applyingRef.current || exporting) return;
    const removed = statement;
    const remaining = workspaceRef.current.statements.filter(s => s.fingerprint !== removed.fingerprint);
    const nextStatement = remaining.filter(s => statementCardKey(s) === statementCardKey(removed)).sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0] || remaining[0];
    setBusy(true); setError(""); setNotice("");
    try {
      // Keep the financial entries and source ledger: removing a PDF must not
      // erase expenses or allow reimporting it to create duplicate entries.
      persistWorkspace({ ...workspaceRef.current, statements: remaining, activeFingerprint: nextStatement?.fingerprint || "", exampleDismissed: true });
    } catch (e) { setError(errorMessage(e)); setBusy(false); return; }
    ++activationRequest.current;
    setRemoveOpen(false); setStatement(null); setDecisions({}); setSelectedId(""); setSummaryOpen(false); setRemoteApplied([]); setRegistryReady(standalone); setIntegrationError(""); setWorkspaceView("review"); setFilter("all"); setSearch("");
    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    pdfUrlRef.current = ""; setPdfUrl("");
    let cleanupFailed = false;
    try { localStorage.removeItem(storageKey(removed)); } catch { cleanupFailed = true; }
    try { await removeStatementFile(storageScope, removed.fingerprint); } catch { cleanupFailed = true; }
    try {
      if (nextStatement && !cancelled.current) await activateStatement(nextStatement);
      if (!cancelled.current) setNotice(`Fatura removida da lista deste navegador. Lançamentos e histórico de importação foram preservados.${cleanupFailed ? " O navegador não permitiu apagar parte dos arquivos ou rascunhos locais." : ""}`);
    } catch (e) { if (!cancelled.current) setError(errorMessage(e)); }
    finally { if (!cancelled.current) setBusy(false); }
  }
  function saveDecision(decision: ReviewDecision) {
    if (!statement || !selected) return;
    if (appliedByKey.has(selected.sourceKey!)) { setError("Este item já foi processado. Consulte o lançamento gerado para alterar os dados financeiros."); return; }
    if (decision.status === "classified" && (!decision.nature || !decision.costCenter || !decision.category)) { setError("Escolha PJ ou PF, centro de custo e categoria para validar."); return; }
    if (decision.status === "classified" && (!draftCenters.includes(decision.costCenter) || !draftCategories.includes(decision.category))) { setError("Confira o centro de custo e a categoria selecionados."); return; }
    if (decision.status === "classified" && matches[selected.id]?.matches.length && !decision.confirmedNew) { setError("Confirme o vínculo sugerido ou marque que esta é uma nova despesa."); return; }
    if (decision.status === "linked" && current.some(t => t.id !== selected.id && decisions[t.id]?.linkedEntryId === decision.linkedEntryId)) { setError("Este lançamento já foi vinculado a outra compra. Confira a possível duplicidade."); return; }
    if (decision.status === "linked" && decision.costCenter && effectiveCenters.includes(decision.costCenter)) {
      decision = { ...decision, nature: normalizeStatementText(decision.costCenter) === "pessoa fisica" ? "PF" : "PJ" };
    }
    const next = { ...decisions, [selected.id]: decision };
    setDecisions(next); setError("");
    try { localStorage.setItem(storageKey(statement), JSON.stringify({ version: 1, fingerprint: statement.fingerprint, decisions: next })); setNotice("Conferência salva neste navegador. Nenhuma despesa foi criada no sistema."); }
    catch { setNotice("A conferência está nesta sessão; o navegador não permitiu salvar o rascunho."); }
    setSelectedId("");
  }
  async function confirmImport() {
    if (!plan || busy || applyingRef.current || !registryReady || (!standalone && !onConfirm)) return;
    if (plan.blockers.length) { setError(plan.blockers[0]); return; }
    applyingRef.current = true; setApplying(true); setError("");
    try {
      const result = standalone ? createLocalStatementEntries(plan, workspaceRef.current.entries, workspaceRef.current.applied) : await onConfirm!(importPayload(plan));
      const mergedApplied = [...new Map([...appliedRecords, ...result.applied].map(item => [item.sourceKey, item])).values()];
      if (standalone) persistWorkspace({ ...workspaceRef.current, entries: [...workspaceRef.current.entries.filter(entry => !result.existingEntries?.some(updated => updated.id === entry.id)), ...(result.existingEntries || []), ...result.createdEntries], applied: mergedApplied });
      else setRemoteApplied(mergedApplied);
      setDecisions(restoredWithApplied(plan.statement, mergedApplied));
      setNotice(`${result.createdEntries.length ? `${result.createdEntries.length} despesa(s) criada(s)${standalone ? " localmente" : " em Lançamentos"}.` : result.settledCount ? "Quitação da fatura confirmada." : plan.links.length ? `${plan.links.length} vínculo(s) confirmado(s), sem duplicar despesas.` : `${plan.offsets.length} item(ns) compensado(s) por créditos, sem novas despesas.`}${result.settledCount ? ` ${result.settledCount} pagamento(s) atualizado(s).` : ""} Itens pendentes e não reconhecidos continuam fora da criação.`);
      setSummaryOpen(false); setWorkspaceView(result.createdEntries.length || plan.links.length || result.settledCount ? "entries" : "review");
    } catch (e) { setError(errorMessage(e)); }
    finally { applyingRef.current = false; setApplying(false); }
  }
  async function downloadReview(format: "xlsx" | "pdf") {
    if (!statement || exporting) return;
    setExporting(format); setError("");
    try {
      const options = { statement, decisions, applied: appliedRecords, comparison: { available: sourceEntries !== null && sourceEntries !== undefined, count: sourceEntries?.length || 0, source: baselineName || (standalone ? "Lançamentos locais do navegador" : entries && comparisonReady ? "Lançamentos acessíveis na sessão" : "Não carregada") } };
      const { exportCardReviewExcel, exportCardReviewPdf } = await import("../lib/cardReviewExport");
      if (format === "xlsx") await exportCardReviewExcel(options);
      else await exportCardReviewPdf(options);
    } catch (e) { setError(errorMessage(e)); }
    finally { setExporting(null); }
  }
  const card = <CreditCard size={21} />;
  const content = <div className="cs-workspace">
    <div className="cs-heading"><div><div className="cs-eyebrow"><span /> CONTROLE DO CARTÃO</div><h1>Clareza em cada compra.</h1><p>Confira sua fatura e dê um destino a cada despesa.</p></div><div className="cs-heading-actions">{standalone && <button className="cs-button cs-secondary" disabled={busy} onClick={() => comparisonInput.current?.click()}><FolderOpen size={16} /> Carregar lançamentos</button>}<button className="cs-button cs-primary" disabled={busy} onClick={() => fileInput.current?.click()}>{busy ? <LoaderCircle size={16} className="cs-spin" /> : <Upload size={16} />} {busy ? "Lendo fatura…" : "Importar fatura"}</button></div></div>
    <div className="cs-preview-note"><LockKeyhole size={15} /><span><strong>{standalone ? "Ambiente local." : "Conferência de faturas."}</strong> {standalone ? "A leitura e os lançamentos gerados ficam neste navegador, sem alterar produção." : "A leitura ocorre no navegador. Somente a confirmação cria novas despesas no sistema."}</span></div>
    <input ref={fileInput} hidden type="file" accept="application/pdf,.pdf" aria-label="Importar PDF da fatura" onChange={e => { const f = e.target.files?.[0]; if (f) void loadFile(f); e.target.value = ""; }} />
    <input ref={comparisonInput} hidden type="file" accept=".xlsx" aria-label="Carregar Excel de lançamentos" onChange={async e => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; setBusy(true); setError(""); try { const rows = await readComparisonExcel(f); setBaseline(rows); setBaselineName(f.name); setNotice(`${rows.length} lançamentos carregados para comparação local. A cobertura depende do período e dos filtros da exportação.`); } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); } }} />
    {error && <div className="cs-message cs-message-error" role="alert"><AlertCircle size={17} /><span>{error}</span><button aria-label="Fechar aviso" onClick={() => setError("")}><X size={15} /></button></div>}
    {notice && <div className="cs-message" role="status"><CheckCircle2 size={17} /><span>{notice}</span><button aria-label="Fechar mensagem" onClick={() => setNotice("")}><X size={15} /></button></div>}
    {!statement ? <div className="cs-empty-import"><div className="cs-import-icon"><FileText size={32} /></div><h2>{busy ? "Lendo as páginas da fatura…" : "Sua conferência começa pela fatura"}</h2><p>Selecione o PDF do Itaú. Vamos separar compras, créditos,<br /> pagamentos e parcelas de próximas faturas.</p><button className="cs-button cs-primary" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={17} /> Selecionar PDF</button><small>Modelo Itaú com texto selecionável · até 25 MB</small></div> : <>
      <div className="cs-card-selectors">
        <label>Cartão<select aria-label="Selecionar cartão" disabled={busy || applying} value={activeCard} onChange={e => { const next = [...workspace.statements].filter(s => statementCardKey(s) === e.target.value).sort((a, b) => b.dueDate.localeCompare(a.dueDate))[0]; if (next) void activateStatement(next).catch(error => setError(errorMessage(error))); }}>{cardOptions.map(c => <option key={c.key} value={c.key}>Itaú · final {c.last4}</option>)}</select></label>
        <label>Fatura<select aria-label="Selecionar fatura" disabled={busy || applying} value={statement.fingerprint} onChange={e => { const next = workspace.statements.find(s => s.fingerprint === e.target.value); if (next) void activateStatement(next).catch(error => setError(errorMessage(error))); }}>{invoiceOptions.map(s => <option key={s.fingerprint} value={s.fingerprint}>Venc. {dateLabel(s.dueDate)} · {s.fileName}</option>)}</select></label>
        <small>Cartão e vencimento identificados pelo PDF. Importe outra fatura para adicionar um cartão. Leitor validado para o modelo Itaú enviado.</small>
      </div>
      <div className="cs-statement-actions"><button className="cs-button cs-danger-button" disabled={busy || applying || Boolean(exporting)} onClick={() => { setError(""); setRemoveOpen(true); }}><Trash2 size={15} /> Remover fatura</button></div>
      <section className="cs-overview">
        <div className="cs-bank-card"><div className="cs-bank-card-top"><span className="cs-itau">itaú</span><span className="cs-card-caption">FATURA DO CARTÃO</span>{card}</div><div className="cs-card-number">•••• <span>{statement.cardLast4 || "Não identificado"}</span></div><div className="cs-card-bottom"><div><small>VENCIMENTO</small><strong>{dateLabel(statement.dueDate)}</strong></div><span className="cs-card-status"><Check size={12} /> PDF lido</span></div></div>
        <div className="cs-stat"><span>Movimentação da fatura <CircleHelp size={14} /></span><strong>{money(statement.computedCurrentCents)}</strong><small>{statement.transactions.filter(t => t.kind === "purchase").length} compras + encargos e créditos</small><div className="cs-stat-line"><FileCheck2 size={14} /> {statement.warnings.length ? "Leitura com pendências" : "Soma dos itens conferida"}</div></div>
        <div className="cs-stat"><span>Pendente de validação <History size={14} /></span><strong>{pending}<em> / {current.length}</em></strong><small>{reviewed.length} {reviewed.length === 1 ? "item validado" : "itens validados"} nesta conferência</small><div className="cs-progress"><span style={{ width: `${current.length ? reviewed.length / current.length * 100 : 0}%` }} /></div></div>
        <button className={`cs-stat cs-alert-stat ${unrecognized.length ? "cs-has-alert" : ""}`} onClick={() => setFilter("unrecognized")}><span>Compras não reconhecidas <ShieldQuestion size={15} /></span><strong>{unrecognized.length.toString().padStart(2, "0")}</strong><small>{unrecognized.length ? "Sinalizadas para apuração" : "Nenhuma sinalizada por você"}</small><div className="cs-stat-line">Acompanhar ocorrências <ArrowRight size={14} /></div></button>
      </section>
      <div className="cs-summary-strip"><FileText size={16} /><span>Total a pagar: <strong>{statement.invoiceTotalCents === null ? "Não identificado" : money(statement.invoiceTotalCents)}</strong></span><i /> <span>Saldo anterior: <strong>{statement.previousBalanceCents === null ? "—" : money(statement.previousBalanceCents)}</strong></span><i /><span>Pagamentos: <strong>{statement.paymentsTotalCents === null ? "—" : money(statement.paymentsTotalCents)}</strong></span>{pdfUrl ? <a href={pdfUrl} target="_blank" rel="noreferrer">Ver PDF original <ArrowRight size={13} /></a> : <span>Reimporte o PDF para consultar o original.</span>}</div>
      <div className="cs-workspace-tabs"><button className={workspaceView === "review" ? "cs-workspace-tab-active" : ""} onClick={() => setWorkspaceView("review")}>Conferência da fatura</button><button className={workspaceView === "entries" ? "cs-workspace-tab-active" : ""} onClick={() => setWorkspaceView("entries")}>Lançamentos gerados <span>{generatedEntries.length}</span></button></div>
      {statement.warnings.map((w, i) => <div className="cs-message cs-message-warning" role="alert" key={i}><AlertCircle size={17} /><span>{w}</span></div>)}
      {workspaceView === "entries" ? <GeneratedCardEntries entries={generatedEntries} standalone={standalone} onBack={() => setWorkspaceView("review")} /> : <div className="cs-main-grid"><section className="cs-panel cs-transactions"><header className="cs-panel-heading"><div><h2>Conferência da fatura <span>{current.length}</span></h2><p>Valide os itens e confira possíveis lançamentos existentes.</p></div><span className="cs-file-chip"><FileText size={13} /> {statement.pageCount} páginas</span></header>
        <div className={`cs-comparison-note ${sourceEntries ? "cs-comparison-ready" : ""}`}><Landmark size={17} /><div><strong>{sourceEntries ? `${sourceEntries.filter(e => !e.kind || e.kind.toLowerCase() === "despesa").length} despesas ${standalone ? "na base local de comparação" : "consultadas automaticamente no sistema"}` : "Aguardando os lançamentos do sistema"}</strong><p>{standalone ? "Esta comparação usa lançamentos locais e o Excel opcional. Os dados de produção não são consultados." : "A comparação considera as despesas acessíveis nesta sessão. Confirme os vínculos sugeridos para evitar duplicação."}</p></div></div>
        <div className="cs-filter-row"><div className="cs-tabs" role="tablist" aria-label="Filtrar movimentações">{([["all", "Todos", current.length], ["pending", "A validar", pending], ["matches", "Correspondências", current.filter(t => matches[t.id]?.matches.length).length], ["reviewed", "Validados", reviewed.length], ["unrecognized", "Não reconhecidas", unrecognized.length]] as const).map(([value, label, count]) => <button key={value} role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={filter === value ? "cs-tab-active" : ""}>{label}<span>{count}</span></button>)}</div><label className="cs-search"><Search size={15} /><input aria-label="Buscar compra" placeholder="Buscar compra…" value={search} onChange={e => setSearch(e.target.value)} /></label></div>
        <div className="cs-extra-filters"><select aria-label="Tipo de visualização" value={filter} onChange={e => setFilter(e.target.value as Filter)}><option value="all">Movimentações atuais</option><option value="pending">Pendentes de validação</option><option value="new" disabled={!sourceEntries}>Sem correspondência na base</option><option value="matches">Possíveis correspondências</option><option value="reviewed">Validados</option><option value="unrecognized">Não reconhecidos</option><option value="future">Parcelas de próximas faturas</option><option value="payments">Pagamentos da fatura</option></select><small>{filter === "future" || filter === "payments" ? "Exibidos separadamente; não entram nas despesas atuais." : `${filtered.length} ${filtered.length === 1 ? "item" : "itens"} nesta visualização`}</small></div>
        <div className="cs-table-scroll"><table className="cs-table"><thead><tr><th>DATA</th><th>ESTABELECIMENTO / DESCRIÇÃO</th><th>VALOR</th><th>SITUAÇÃO</th><th><span className="cs-sr-only">Ação</span></th></tr></thead><tbody>{pageItems.map(t => {
          const d = decisions[t.id], status = stateLabel(t, d, matches[t.id], appliedByKey.get(t.sourceKey!));
          return <tr key={t.id} className="cs-clickable-row" onClick={() => { if (busy) return; setSelectedId(t.id); setError(""); }}>
            <td className="cs-date">{dateLabel(t.date).slice(0, 5)}<small>{t.date.slice(0, 4)}</small></td>
            <td><button className="cs-merchant"><span className={`cs-merchant-icon ${t.kind === "credit" || t.kind === "payment" ? "cs-credit-icon" : ""}`}>{t.kind === "credit" || t.kind === "payment" ? <ArrowDownLeft size={17} /> : t.kind === "fee" ? <Landmark size={17} /> : <ReceiptText size={17} />}</span><span><strong>{t.description}</strong><small>{d?.costCenter ? `${d.nature || "Sem natureza"} · ${d.costCenter} · ${d.category}` : `${kindLabel[t.kind]}${t.installment ? ` · parcela ${t.installment}` : ""}${t.detail ? ` · ${t.detail}` : ""}`}</small></span></button></td>
            <td className={`cs-value ${t.amountCents < 0 ? "cs-credit-value" : ""}`}>{money(t.amountCents)}</td>
            <td><div className="cs-status-group">
              <span className={`cs-status cs-status-${status.tone}`}>{status.tone === "success" ? <Check size={11} /> : <span className="cs-status-dot" />}{status.label}</span>
              {reviewIsComplete(t, d) && d?.nature && <span className={`cs-status cs-nature-tag-${d.nature.toLowerCase()}`}>
                {d.nature === "PF" ? <UserRound size={12} /> : <Building2 size={12} />}
                {d.nature === "PF" ? "Pessoa física" : "Pessoa jurídica"}
              </span>}
            </div></td>
            <td><button className="cs-row-action" aria-label={`Conferir ${t.description}`}><ChevronRight size={17} /></button></td>
          </tr>;
        })}</tbody></table>{!filtered.length && <div className="cs-no-results"><Search size={24} /><strong>Nenhum item nesta visualização</strong><span>Altere o filtro ou a busca para continuar.</span></div>}</div>
        <div className="cs-pagination">
          <label>Itens por página<select aria-label="Itens por página" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}>
            <option value={10}>10</option><option value={20}>20</option><option value={50}>50</option>
          </select></label>
          <span className="cs-page-range" role="status">{filtered.length ? `${pageStart + 1}–${pageStart + pageItems.length} de ${filtered.length} itens` : "0 itens"}</span>
          <nav aria-label="Paginação das despesas">
            <button aria-label="Página anterior" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={14} /> Anterior</button>
            <span>Página <strong>{currentPage}</strong> de <strong>{pageCount}</strong></span>
            <button aria-label="Próxima página" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Próxima <ChevronRight size={14} /></button>
          </nav>
        </div>
        <footer className="cs-table-footer"><span><LockKeyhole size={13} /> Rascunho salvo somente neste navegador</span><span>Total atual <strong>{money(statement.computedCurrentCents)}</strong></span></footer>
      </section>
      <aside className="cs-side-panels"><section className="cs-panel cs-distribution"><div className="cs-section-kicker">DESTINO DOS RECURSOS</div><h2>Para onde vai o dinheiro?</h2><p>A distribuição aparece conforme você valida os itens.</p><div className="cs-distribution-total"><span>Total da movimentação</span><strong>{money(statement.computedCurrentCents)}</strong></div>{([{ key: "PJ", label: "Pessoa jurídica", caption: "Despesas da empresa", Icon: Building2, tone: "blue" }, { key: "PF", label: "Pessoa física", caption: "Despesas pessoais", Icon: UserRound, tone: "purple" }, { key: "pending", label: "A distribuir", caption: "Aguardando validação", Icon: History, tone: "gray" }] as const).map(({ key, label, caption, Icon, tone }) => <div className="cs-distribution-row" key={key}><span className={`cs-distribution-icon cs-icon-${tone}`}><Icon size={17} /></span><div><strong>{label}</strong><small>{caption}</small></div><b>{money(classificationTotals[key])}</b></div>)}<div className="cs-distribution-bar">{(["PJ", "PF", "pending"] as const).map(k => <span key={k} className={`cs-bar-${k}`} style={{ flex: Math.max(0, classificationTotals[k]), minWidth: classificationTotals[k] > 0 ? 3 : 0 }} />)}</div><p className="cs-distribution-note">Créditos e ajustes reduzem os valores do grupo em que forem classificados.</p><button className="cs-button cs-primary cs-full" disabled={busy || applying} onClick={() => setSummaryOpen(true)}>Revisar distribuição <ArrowRight size={15} /></button></section>
      <section className="cs-guide"><span className="cs-guide-icon"><ShieldQuestion size={21} /></span><h3>Uma compra chamou atenção?</h3><p>Abra o item e marque <strong>“Não reconheço”</strong> para deixá-lo em apuração.</p><small>Uma pendência de lançamento, sozinha, não comprova fraude.</small></section>
      <section className="cs-next-statement"><CalendarIcon /><div><strong>Parcelas futuras separadas</strong><p>{statement.transactions.filter(t => t.kind === "future").length} itens previstos, sem somar às despesas desta fatura.</p><button onClick={() => setFilter("future")}>Consultar parcelas <ArrowRight size={13} /></button></div></section>
      </aside></div>}
    </>}
    {selected && <div className="cs-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setSelectedId(""); }}><section role="dialog" aria-modal="true" aria-labelledby="cs-review-title" className="cs-review-dialog" onKeyDown={e => { if (e.key === "Escape") setSelectedId(""); }}><header><div><div className="cs-eyebrow">CONFERÊNCIA DO ITEM</div><h2 id="cs-review-title">Validar movimentação</h2></div><button aria-label="Fechar conferência" onClick={() => setSelectedId("")}><X size={20} /></button></header><div className="cs-dialog-body"><div className="cs-selected-purchase"><span>{kindLabel[selected.kind]} · {dateLabel(selected.date)}{selected.installment ? ` · parcela ${selected.installment}` : ""}</span><h3>{selected.description}</h3><strong>{money(selected.amountCents)}</strong>{selected.detail && <p>{selected.detail}</p>}<small>Origem: página {selected.page} do PDF</small></div>
      {selectedApplied ? <div className="cs-message"><CheckCircle2 size={18} /><span>{selectedApplied.status === "offset" ? "Este item foi compensado pelos créditos da mesma classificação e não gerou uma despesa adicional." : !selectedApplied.entryId ? "O lançamento associado foi removido. Revise o histórico; a reimportação não recria essa despesa automaticamente." : "Este item já está vinculado a um lançamento. Para alterar dados financeiros, consulte o lançamento gerado."}</span></div> : selected.kind === "future" || selected.kind === "payment" ? <div className="cs-message"><FileText size={18} /><span>{selected.kind === "future" ? "Esta parcela pertence a uma próxima fatura. A data exibida é a data original da compra; o vencimento futuro ainda precisa ser confirmado." : "Este é um pagamento da fatura. Ele não cria uma segunda despesa para as compras já relacionadas."}</span></div> : <>
      {sourceEntries === null || sourceEntries === undefined ? <div className="cs-inline-note"><CircleHelp size={16} /> Sem base de comparação. A classificação abaixo é um rascunho; ainda não sabemos se esta despesa já foi lançada.</div> : !matches[selected.id]?.matches.length && <div className="cs-inline-note"><Search size={16} /> Não encontramos correspondência na base carregada. Confira o período e os filtros antes de criar uma despesa.</div>}
      {!!matches[selected.id]?.matches.length && <div className="cs-match-section"><h3>{matches[selected.id].status === "ambiguous" ? "Possível duplicidade: confira os candidatos" : "Lançamentos possivelmente correspondentes"}</h3>{matches[selected.id].matches.slice(0, 8).map(m => <div key={m.entry.id} className="cs-match-card"><strong>{m.entry.description}</strong><span>{dateLabel(m.entry.date)} · {money(Math.round(m.entry.amount * 100))} · {m.entry.unit || "Sem centro"}</span><small>{m.reason}</small><button onClick={() => saveDecision({ ...emptyDecision(), status: "linked", linkedEntryId: m.entry.id, costCenter: m.entry.unit || "", category: m.entry.category || "", nature: normalizeStatementText(m.entry.unit || "") === "pessoa fisica" ? "PF" : "", note: draft.note })}>Confirmar vínculo existente <Check size={13} /></button></div>)}</div>}
      {!!matches[selected.id]?.matches.length && <label className="cs-confirm-new"><input type="checkbox" checked={Boolean(draft.confirmedNew)} onChange={e => setDraft({ ...draft, confirmedNew: e.target.checked })} />Esta é uma nova despesa, diferente dos lançamentos sugeridos.</label>}
      <h3 className="cs-form-heading">Como distribuir esta despesa?</h3><div className="cs-nature-options">{([{ value: "PJ", label: "Pessoa jurídica", caption: "Despesa da empresa", Icon: Building2 }, { value: "PF", label: "Pessoa física", caption: "Despesa pessoal", Icon: UserRound }] as const).map(({ value, label, caption, Icon }) => <button key={value} aria-pressed={draft.nature === value} onClick={() => setDraft({ ...draft, nature: value, costCenter: "", category: "", status: "pending", linkedEntryId: undefined })} className={draft.nature === value ? "cs-nature-selected" : ""}><Icon size={20} /><strong>{label}</strong><small>{caption}</small>{draft.nature === value && <CheckCircle2 size={15} />}</button>)}</div>
      <label className="cs-form-label">Centro de custo<select aria-label="Centro de custo da despesa" disabled={!draft.nature} value={draft.costCenter} onChange={e => setDraft({ ...draft, costCenter: e.target.value, category: "" })}><option value="">{draft.nature ? "Selecione o centro de custo" : "Escolha PJ ou PF primeiro"}</option>{draftCenters.map(c => <option key={c}>{c}</option>)}</select></label>
      <label className="cs-form-label">Categoria<select aria-label="Categoria da despesa" disabled={!draft.costCenter} value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}><option value="">Selecione a categoria</option>{[...new Set(draftCategories)].map(c => <option key={c}>{c}</option>)}</select></label>
      {suggestedCategory(selected) && !draft.category && draftCategories.includes(suggestedCategory(selected)) && <button className="cs-suggestion" disabled={!draft.costCenter} onClick={() => setDraft({ ...draft, category: suggestedCategory(selected) })}>Sugestão pela descrição: {suggestedCategory(selected)} <Check size={13} /></button>}
      <label className="cs-form-label">Observação <span>(opcional)</span><textarea aria-label="Observação da conferência" value={draft.note} maxLength={1000} placeholder="Contexto da compra ou motivo da sinalização…" onChange={e => setDraft({ ...draft, note: e.target.value })} /></label>
      {error && <div role="alert" className="cs-message cs-message-error">{error}</div>}
      </>}
      <details className="cs-source"><summary>Conferir linha extraída do PDF</summary><p>{selected.sourceLine}</p>{pdfUrl && <a href={`${pdfUrl}#page=${selected.page}`} target="_blank" rel="noreferrer">Abrir página original <ArrowRight size={12} /></a>}</details></div><footer>{selectedApplied || selected.kind === "future" || selected.kind === "payment" ? <button className="cs-button cs-primary" onClick={() => setSelectedId("")}>Entendi</button> : <><button className="cs-button cs-danger-button" onClick={() => saveDecision({ ...emptyDecision(), status: "unrecognized", note: draft.note })}><ShieldQuestion size={16} /> Não reconheço</button><button className="cs-button cs-primary" disabled={!draft.nature || !draft.costCenter || !draft.category || Boolean(matches[selected.id]?.matches.length && !draft.confirmedNew)} onClick={() => saveDecision({ ...draft, status: "classified", linkedEntryId: undefined })}><Check size={16} /> Validar classificação</button></>}</footer></section></div>}
    {removeOpen && statement && <div className="cs-modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !busy) setRemoveOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="cs-remove-title" aria-describedby="cs-remove-description" className="cs-review-dialog cs-remove-dialog">
        <header><div><div className="cs-eyebrow">FATURA IMPORTADA</div><h2 id="cs-remove-title">Remover esta fatura?</h2></div><button aria-label="Cancelar remoção" disabled={busy} onClick={() => setRemoveOpen(false)}><X size={20} /></button></header>
        <div className="cs-dialog-body">
          <div className="cs-remove-file"><FileText size={22} /><div><strong>{statement.fileName}</strong><span>Itaú · final {statement.cardLast4} · venc. {dateLabel(statement.dueDate)}</span></div></div>
          <div id="cs-remove-description"><p>O PDF e o rascunho desta fatura serão removidos da lista deste navegador. Você poderá importar o arquivo novamente.</p><p><strong>As despesas já criadas e o histórico de importação serão preservados.</strong> Para corrigir ou excluir uma despesa, acesse Lançamentos. Ao reimportar, os dados já confirmados poderão ser recuperados, evitando duplicações.</p></div>
          {error && <div className="cs-message cs-message-error" role="alert">{error}</div>}
        </div>
        <footer><button className="cs-button cs-secondary" disabled={busy} onClick={() => setRemoveOpen(false)}>Cancelar</button><button className="cs-button cs-danger-button" disabled={busy} onClick={() => void removeStatement()}>{busy ? <LoaderCircle size={16} className="cs-spin" /> : <Trash2 size={16} />}{busy ? "Removendo…" : "Confirmar remoção"}</button></footer>
      </section>
    </div>}
    {summaryOpen && statement && <div className="cs-modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !applying) setSummaryOpen(false); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="cs-summary-title" className="cs-review-dialog" onKeyDown={e => { if (e.key === "Escape" && !applying) setSummaryOpen(false); }}>
        <header><div><div className="cs-eyebrow">RESUMO DA CONFERÊNCIA</div><h2 id="cs-summary-title">Distribuição da fatura</h2></div><button aria-label="Fechar resumo" disabled={applying} onClick={() => setSummaryOpen(false)}><X size={20} /></button></header>
        <div className="cs-dialog-body">
          <div className="cs-summary-counts"><span><strong>{reviewed.length}</strong> validados</span><span><strong>{pending}</strong> pendentes</span><span><strong>{unrecognized.length}</strong> não reconhecidos</span></div>
          <div className="cs-summary-groups">{effectiveCenters.map(center => {
            const items = current.filter(t => reviewIsComplete(t, decisions[t.id]) && decisions[t.id]?.costCenter === center);
            return items.length ? <div key={center}><span><strong>{center}</strong><small>{items.length} itens</small></span><b>{money(items.reduce((s, t) => s + t.amountCents, 0))}</b></div> : null;
          })}{!reviewed.length && <p>Nenhum item validado. Abra uma movimentação para escolher PJ ou PF e o centro de custo.</p>}</div>
          <div className="cs-summary-next">
            <strong>{pending === 0 && !statement.warnings.length ? "Distribuição concluída" : "Conferência em andamento"}</strong>
            <p>{standalone ? "A confirmação cria despesas na lista de lançamentos locais, sem alterar produção." : "A confirmação cria somente despesas novas e validadas em Lançamentos. Vínculos existentes são preservados."}</p>
            <p>Baixe o Excel ou PDF para conferir e compartilhar a distribuição. O relatório inclui todos os itens, inclusive pendências e compras não reconhecidas.</p>
          </div>
          {plan && <div className="cs-import-plan">
            <h3>Criação dos lançamentos</h3>
            <div className="cs-payment-detection"><span>Vencimento identificado <strong>{dateLabel(statement.dueDate)}</strong></span><span>Pagamento <strong>{plan.payment.state === "paid" ? `Pago em ${dateLabel(plan.payment.paidDate)}` : plan.payment.state === "open" ? "A pagar" : "Não comprovado · previsto"}</strong></span><p>{plan.payment.explanation}</p></div>
            <dl className="cs-entry-details"><dt>Novas despesas</dt><dd>{plan.newEntries.length} · {money(plan.newEntries.reduce((sum, item) => sum + item.netCents, 0))}</dd><dt>Vínculos existentes</dt><dd>{plan.links.length}</dd><dt>Pagamentos a atualizar</dt><dd>{plan.settlements.length}</dd><dt>Créditos e compensações</dt><dd>{plan.offsets.length} itens · {money(plan.items.reduce((sum, item) => sum + item.creditCents, 0))} abatidos</dd><dt>Já processados</dt><dd>{plan.alreadyApplied.length}</dd><dt>Continuam pendentes</dt><dd>{plan.heldCount}</dd></dl>
            {!!plan.newEntries.length && <details className="cs-source"><summary>Ver despesas que serão criadas</summary>{plan.newEntries.map(item => <div className="cs-plan-item" key={item.sourceKey}><span>{item.transaction.description}<small>{item.decision.nature} · {item.decision.costCenter} · {item.decision.category}</small></span><strong>{money(item.netCents)}</strong></div>)}</details>}
            {plan.blockers.map(blocker => <div key={blocker} className="cs-message cs-message-warning"><AlertCircle size={15} /><span>{blocker}</span></div>)}
            {integrationError && <div className="cs-message cs-message-warning"><AlertCircle size={15} /><span>{integrationError}</span></div>}
            <button className="cs-button cs-primary cs-full" disabled={busy || applying || !registryReady || (!standalone && !onConfirm) || Boolean(plan.blockers.length) || (plan.items.length === 0 && plan.settlements.length === 0)} onClick={() => void confirmImport()}>{applying ? <LoaderCircle size={16} className="cs-spin" /> : <CheckCircle2 size={16} />}{applying ? "Confirmando lançamentos…" : !plan.items.length && plan.settlements.length ? `Confirmar pagamento de ${plan.settlements.length} despesa(s)` : plan.items.length === 0 && plan.alreadyApplied.length ? "Itens validados já processados" : standalone ? "Confirmar e gerar lançamentos locais" : "Confirmar e gerar lançamentos"}</button>
          </div>}
          <div className="cs-inline-note"><LockKeyhole size={17} /><span>Exportar o relatório não cria despesas nem altera o banco de dados.</span></div>
          {statement.warnings.length > 0 && <div className="cs-message cs-message-warning">A leitura apresenta divergências. Revise o PDF antes de usar esta conferência.</div>}
          {error && <div className="cs-message cs-message-error" role="alert">{error}</div>}
        </div>
        <footer className="cs-export-actions">
          <button className="cs-button cs-secondary cs-export-back" disabled={applying} onClick={() => setSummaryOpen(false)}>Continuar conferindo</button>
          <button className="cs-button cs-secondary cs-export-download" disabled={exporting !== null} onClick={() => void downloadReview("xlsx")}>{exporting === "xlsx" ? <LoaderCircle size={16} className="cs-spin" /> : <Download size={16} />}{exporting === "xlsx" ? "Gerando Excel…" : "Baixar Excel"}</button>
          <button className="cs-button cs-primary cs-export-download" disabled={exporting !== null} onClick={() => void downloadReview("pdf")}>{exporting === "pdf" ? <LoaderCircle size={16} className="cs-spin" /> : <FileText size={16} />}{exporting === "pdf" ? "Gerando PDF…" : "Baixar PDF"}</button>
        </footer>
      </section>
    </div>}
  </div>;
  if (!standalone) return <div className="cs-app cs-embedded">{content}</div>;
  return <div className="cs-app cs-shell">
    <aside className="cs-sidebar">
      <a className="cs-logo" href="/?preview=faturas"><span><Landmark size={24} /></span>fincore<span className="cs-logo-dot">.</span></a>
      <div className="cs-sidebar-section">GESTÃO FINANCEIRA</div>
      <nav>
        <a href="/"><Landmark size={17} /> Visão geral</a>
        <a href="#lancamentos" className={workspaceView === "entries" ? "cs-sidebar-active" : ""} aria-current={workspaceView === "entries" ? "page" : undefined} onClick={event => { event.preventDefault(); setWorkspaceView("entries"); }}><ReceiptText size={17} /> Lançamentos</a>
        <a href="/"><Building2 size={17} /> Centros de custo</a>
        <a href="#faturas" className={workspaceView === "review" ? "cs-sidebar-active" : ""} aria-current={workspaceView === "review" ? "page" : undefined} onClick={event => { event.preventDefault(); setWorkspaceView("review"); }}><CreditCard size={17} /> Cartões e faturas <span>NOVO</span></a>
      </nav>
      <div className="cs-sidebar-bottom"><span className="cs-local-indicator" /> Ambiente local<p>Conferência em desenvolvimento</p><div><LockKeyhole size={15} /> Sem gravação em produção</div></div>
    </aside>
    <main className="cs-main"><header className="cs-topbar"><span>Financeiro <ChevronRight size={13} /> <strong>Cartões e faturas</strong></span><span className="cs-local-pill"><span /> PRÉVIA LOCAL</span></header>{content}<footer className="cs-app-footer">FinCore · Gestão financeira <span>Leitura e validação de faturas · Itaú</span></footer></main>
  </div>;
}
function CalendarIcon() { return <span className="cs-calendar-icon"><History size={20} /></span>; }
