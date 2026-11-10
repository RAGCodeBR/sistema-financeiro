import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, FileText, Plus, Trash2, X } from "lucide-react";
import { brlCents, type CardStatement, type StatementTransaction } from "../lib/cardStatement";
import { statementBanks, statementCardLabel } from "../lib/cardBanks";
import { validateAssistedStatement } from "../lib/genericStatement";
import { statementCardKey } from "../lib/cardImport";
import type { StatementDocument } from "../lib/readStatementDocument";

type EditableItem = Omit<StatementTransaction, "amountCents"> & { amount: string };
type Props = { document: StatementDocument; file: File; existing: CardStatement[]; onCancel: () => void; onConfirm: (statement: CardStatement) => void };
const amount = (value: number | null) => value === null ? "" : (value / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
const kinds = { purchase: "Compra", fee: "Encargo", credit: "Crédito / estorno", payment: "Pagamento da fatura", future: "Parcela futura" };
export default function StatementReadingReview({ document: read, file, existing, onCancel, onConfirm }: Props) {
  const [meta, setMeta] = useState({ ...read.statement, reviewedExtraction: false });
  const [totals, setTotals] = useState({ currentTotalCents: amount(meta.currentTotalCents), invoiceTotalCents: amount(meta.invoiceTotalCents), previousBalanceCents: amount(meta.previousBalanceCents), paymentsTotalCents: amount(meta.paymentsTotalCents) });
  const [items, setItems] = useState<EditableItem[]>(() => meta.transactions.map(t => ({ ...t, amount: amount(t.amountCents) })));
  const [error, setError] = useState(""), [originalUrl, setOriginalUrl] = useState(""), [page, setPage] = useState(1);
  const [sourceVisible, setSourceVisible] = useState(false);
  useEffect(() => { const url = URL.createObjectURL(file); setOriginalUrl(url); return () => URL.revokeObjectURL(url); }, [file]);
  const cards = [...new Map(existing.map(s => [statementCardKey(s), s])).values()];
  const sum = useMemo(() => items.filter(t => !["payment", "future"].includes(t.kind)).reduce((value, t) => { try { return value + brlCents(t.amount); } catch { return value; } }, 0), [items]);
  const pageCount = Math.max(1, Math.ceil(items.length / 10)), currentPage = Math.min(page, pageCount);
  function update(id: string, field: keyof EditableItem, value: string | number) { setItems(old => old.map(t => t.id === id ? { ...t, [field]: value } : t)); setError(""); }
  function confirm() {
    setError("");
    try {
      if (read.blockingReason) throw new Error(read.blockingReason);
      const numbers = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value.trim() ? brlCents(value) : null]));
      const transactions = items.map(t => {
        if (!Number.isInteger(t.page) || t.page < 1 || t.page > read.statement.pageCount) throw new Error("Confira a página de origem de cada movimentação.");
        return { ...t, amountCents: brlCents(t.amount), detail: "Dados conferidos na leitura assistida." };
      });
      const confirmed = validateAssistedStatement({ ...meta, ...numbers, transactions });
      onConfirm(confirmed);
    } catch (e) { setError(e instanceof Error ? e.message : "Confira os dados antes de continuar."); }
  }
  return <div className="cs-modal-backdrop cs-assist-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="cs-reading-title" className="cs-review-dialog cs-assist-dialog">
    <header><div><div className="cs-eyebrow">{read.statement.readingMethod === "ocr" ? "LEITURA DE IMAGEM" : "NOVO MODELO DE FATURA"}</div><h2 id="cs-reading-title">Conferir dados da leitura</h2><p className="cs-reading-file">{file.name} · {meta.pageCount} página(s)</p></div><button aria-label="Cancelar revisão da leitura" onClick={onCancel}><X size={20} /></button></header>
    <div className="cs-dialog-body">
      <div className="cs-message cs-message-warning"><AlertCircle size={18} /><span>Revise a identificação, os totais e todos os itens com o original. Esta etapa não cria lançamentos. A classificação PJ/PF será feita depois, por despesa.</span></div>
      {read.observations.map((text, i) => <p className="cs-reading-observation" key={i}>{text}</p>)}
      {read.blockingReason && <div className="cs-message cs-message-error" role="alert">{read.blockingReason}</div>}
      <div className="cs-reading-actions"><button className="cs-button cs-secondary" onClick={() => setSourceVisible(!sourceVisible)}><FileText size={15} />{sourceVisible ? "Ocultar original e texto" : "Conferir original e texto"}</button>{originalUrl && <a className="cs-button cs-secondary" href={originalUrl} target="_blank" rel="noreferrer">Abrir documento original</a>}</div>
      {sourceVisible && <div className="cs-reading-source">{read.sourceType === "image" ? <img src={originalUrl} alt="Imagem original da fatura" /> : <iframe src={originalUrl} title="Documento original da fatura" />}<pre>{read.extractedText || "Nenhum texto reconhecido. Confira a qualidade e a integridade do arquivo."}</pre></div>}
      {cards.length > 0 && <label className="cs-form-label">Usar um cartão já importado <span>(opcional)</span><select aria-label="Cartão já importado" defaultValue="" onChange={e => { const saved = cards.find(s => statementCardKey(s) === e.target.value); if (saved) setMeta(old => ({ ...old, bankCode: saved.bankCode || "itau", bankName: saved.bankName || statementBanks.find(b => b.code === (saved.bankCode || "itau"))?.name || "", cardLast4: saved.cardLast4, maskedCardNumber: saved.maskedCardNumber, cardLabel: saved.cardLabel || "" })); }}><option value="">Identificar pelo documento</option>{cards.map(s => <option key={statementCardKey(s)} value={statementCardKey(s)}>{statementCardLabel(s)}</option>)}</select></label>}
      <div className="cs-reading-meta">
        <label className="cs-form-label">Banco<select aria-label="Banco da fatura" value={statementBanks.some(b => b.code === meta.bankCode) ? meta.bankCode : meta.bankCode ? "outro" : ""} onChange={e => { const bank = statementBanks.find(b => b.code === e.target.value); setMeta({ ...meta, bankCode: bank?.code || (e.target.value === "outro" ? "outro" : ""), bankName: bank?.name || "" }); }}><option value="">Selecione o banco</option>{statementBanks.map(bank => <option key={bank.code} value={bank.code}>{bank.name}</option>)}<option value="outro">Outro banco</option></select></label>
        {!statementBanks.some(b => b.code === meta.bankCode) && <label className="cs-form-label">Nome do banco<input aria-label="Nome do banco" value={meta.bankName || ""} maxLength={40} onChange={e => { const name = e.target.value; setMeta({ ...meta, bankName: name, bankCode: name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) }); }} /></label>}
        <label className="cs-form-label">Final do cartão<input aria-label="Final do cartão" inputMode="numeric" maxLength={4} value={meta.cardLast4} onChange={e => setMeta({ ...meta, cardLast4: e.target.value.replace(/\D/g, "") })} /></label>
        <label className="cs-form-label">Vencimento<input aria-label="Vencimento da fatura" type="date" value={meta.dueDate} onChange={e => setMeta({ ...meta, dueDate: e.target.value })} /></label>
        <label className="cs-form-label">Nome do cartão <span>(opcional)</span><input aria-label="Nome do cartão" maxLength={60} value={meta.cardLabel || ""} placeholder="Ex.: Nubank da empresa" onChange={e => setMeta({ ...meta, cardLabel: e.target.value })} /></label>
        <label className="cs-form-label">Identificação mascarada <span>(se estiver no documento)</span><input aria-label="Identificação mascarada do cartão" value={meta.maskedCardNumber || ""} placeholder="Ex.: 1234XXXXXXXX5678" maxLength={24} onChange={e => setMeta({ ...meta, maskedCardNumber: e.target.value.replace(/[.\s-]/g, "").replace(/\*/g, "X").toUpperCase() || undefined })} /></label>
      </div>
      <p className="cs-reading-observation">Se o documento mostrar apenas o final e houver cartões com o mesmo banco e final, selecione o cartão existente ou confira a identificação mascarada para diferenciá-los.</p>
      <div className="cs-reading-totals">{([{ key: "currentTotalCents", label: "Total das movimentações atuais", required: true }, { key: "invoiceTotalCents", label: "Total a pagar" }, { key: "previousBalanceCents", label: "Saldo anterior" }, { key: "paymentsTotalCents", label: "Pagamentos (valor negativo)" }] as const).map(({ key, label }) => <label className="cs-form-label" key={key}>{label}<input aria-label={label} inputMode="decimal" placeholder={key === "currentTotalCents" ? "Total de compras, encargos e créditos" : "Deixe vazio se não constar"} value={totals[key]} onChange={e => { setTotals({ ...totals, [key]: e.target.value }); setError(""); }} /></label>)}</div>
      <p className="cs-reading-observation">O total das movimentações exclui pagamentos e parcelas futuras. Deixe campos ausentes vazios; um vencimento passado ou total a pagar zerado, sozinho, não comprova quitação.</p>
      <div className="cs-reading-items-header"><div><h3>Movimentações extraídas · {items.length}</h3><p>Soma atual: <strong>{amount(sum)}</strong> · Confira as linhas, os sinais e as parcelas.</p></div><button className="cs-button cs-secondary" onClick={() => { setItems(old => [...old, { id: crypto.randomUUID(), date: "", description: "", amount: "", kind: "purchase", page: 1, detail: "", sourceLine: "Item incluído durante a conferência da leitura." }]); setPage(Math.ceil((items.length + 1) / 10)); }}><Plus size={15} /> Adicionar item</button></div>
      <div className="cs-table-scroll"><table className="cs-reading-items"><thead><tr><th>Data</th><th>Descrição</th><th>Tipo</th><th>Valor</th><th>Parcela</th><th>Pág.</th><th><span className="cs-sr-only">Remover</span></th></tr></thead><tbody>{items.slice((currentPage - 1) * 10, currentPage * 10).map(t => <tr key={t.id}><td><input aria-label={`Data de ${t.description || "novo item"}`} placeholder="DD/MM/AAAA" value={t.date} onChange={e => update(t.id, "date", e.target.value)} /></td><td><input aria-label={`Descrição do item ${t.id}`} value={t.description} maxLength={300} onChange={e => update(t.id, "description", e.target.value)} /><small>{t.sourceLine}</small></td><td><select aria-label={`Tipo de ${t.description || "novo item"}`} value={t.kind} onChange={e => update(t.id, "kind", e.target.value)}>{Object.entries(kinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></td><td><input aria-label={`Valor de ${t.description || "novo item"}`} inputMode="decimal" value={t.amount} onChange={e => update(t.id, "amount", e.target.value)} /></td><td><input aria-label={`Parcela de ${t.description || "novo item"}`} placeholder="01/03" value={t.installment || ""} onChange={e => update(t.id, "installment", e.target.value)} /></td><td><input aria-label={`Página de ${t.description || "novo item"}`} type="number" min={1} max={meta.pageCount} value={t.page} onChange={e => update(t.id, "page", Number(e.target.value))} /></td><td><button aria-label={`Remover item ${t.description || "novo item"}`} onClick={() => setItems(old => old.filter(i => i.id !== t.id))}><Trash2 size={15} /></button></td></tr>)}</tbody></table></div>
      {!items.length && <div className="cs-inline-note">Não foi possível reconhecer movimentações com segurança. Confira o texto extraído e inclua as linhas, ou cancele e envie um arquivo mais legível.</div>}
      <div className="cs-pagination"><span>{items.length} itens · Página {currentPage} de {pageCount}</span><nav aria-label="Paginação da leitura"><button disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</button><button disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Próxima</button></nav></div>
      <label className="cs-confirm-new"><input type="checkbox" checked={Boolean(meta.reviewedExtraction)} onChange={e => setMeta({ ...meta, reviewedExtraction: e.target.checked })} /> Conferi os dados, todas as páginas e todos os itens com o documento original.</label>
      {error && <div className="cs-message cs-message-error" role="alert">{error}</div>}
    </div><footer><button className="cs-button cs-secondary" onClick={onCancel}>Cancelar este arquivo</button><button className="cs-button cs-primary" disabled={!meta.reviewedExtraction || Boolean(read.blockingReason)} onClick={confirm}><Check size={16} /> Usar dados conferidos</button></footer>
  </section></div>;
}
