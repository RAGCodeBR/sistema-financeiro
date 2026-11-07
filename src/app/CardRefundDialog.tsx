import { useState } from "react";
import { ArrowLeft, Check, LoaderCircle, Undo2, X } from "lucide-react";
import { brlCents, type CardRefund, type StatementTransaction } from "../lib/cardStatement";

type CreditOption = { transaction: StatementTransaction; dueDate: string };
type Props = { purchase: StatementTransaction; credits: CreditOption[]; initial?: CardRefund; saving: boolean; ready: boolean; onClose: () => void; onSave: (refund: CardRefund) => Promise<void> };
export default function CardRefundDialog({ purchase, credits, initial, saving, ready, onClose, onSave }: Props) {
  const [amount, setAmount] = useState(((initial?.amountCents ?? purchase.amountCents) / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 }));
  const [date, setDate] = useState(initial?.date || ""), [note, setNote] = useState(initial?.note || "");
  const [credit, setCredit] = useState(initial?.creditSourceKey || ""), [error, setError] = useState("");
  const dateLabel = (iso: string) => iso.split("-").reverse().join("/");
  async function submit() {
    setError("");
    try { await onSave({ sourceKey: purchase.sourceKey!, amountCents: brlCents(amount), date, note: note.trim(), creditSourceKey: credit || undefined }); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível registrar o estorno."); }
  }
  return <div className="cs-modal-backdrop" onClick={e => { if (e.target === e.currentTarget && !saving) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="cs-refund-title" className="cs-review-dialog cs-refund-dialog">
      <header><div><div className="cs-eyebrow">RESOLUÇÃO DA OCORRÊNCIA</div><h2 id="cs-refund-title">{initial ? "Estorno registrado" : "Marcar como estornada"}</h2></div><button aria-label="Voltar à compra" disabled={saving} onClick={onClose}><X size={20} /></button></header>
      <div className="cs-dialog-body">
        <div className="cs-selected-purchase"><span>Compra de {dateLabel(purchase.date)}</span><h3>{purchase.description}</h3><strong>{(purchase.amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong></div>
        <div className="cs-inline-note"><Undo2 size={17} /><span>Registre aqui um cancelamento já confirmado pelo banco. A compra sairá das pendências, sem criar despesa ou receita. A linha original da fatura será mantida.</span></div>
        <label className="cs-form-label">Valor estornado<input aria-label="Valor estornado" inputMode="decimal" value={amount} disabled={saving} onChange={e => setAmount(e.target.value)} /></label>
        <p className="cs-refund-help">O encerramento exige estorno integral. Se o estorno for parcial, mantenha a compra em apuração.</p>
        <label className="cs-form-label">Data do estorno<input aria-label="Data do estorno" type="date" min={purchase.date} value={date} disabled={saving} onChange={e => setDate(e.target.value)} /></label>
        <label className="cs-form-label">Crédito na fatura <span>(opcional)</span><select aria-label="Crédito vinculado ao estorno" value={credit} disabled={saving} onChange={e => setCredit(e.target.value)}><option value="">Sem crédito vinculado — cancelamento confirmado</option>{credits.map(({ transaction: t, dueDate }) => <option key={t.sourceKey} value={t.sourceKey}>Venc. {dateLabel(dueDate)} · {dateLabel(t.date)} · {t.description} · {(t.amountCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</option>)}{credit && !credits.some(c => c.transaction.sourceKey === credit) && <option value={credit}>Crédito já vinculado em outra fatura</option>}</select></label>
        <p className="cs-refund-help">São exibidos créditos ainda não processados, do mesmo cartão e valor, nas faturas importadas. O vínculo evita usar esse crédito para abater outra despesa.</p>
        <label className="cs-form-label">Observação <span>(opcional)</span><textarea aria-label="Observação do estorno" maxLength={1000} placeholder="Ex.: cancelamento confirmado pelo banco, protocolo…" value={note} disabled={saving} onChange={e => setNote(e.target.value)} /></label>
        {!ready && <div className="cs-message cs-message-warning">O registro de estornos ainda precisa ser habilitado no banco deste ambiente. A ocorrência permanece em apuração.</div>}
        {error && <div className="cs-message cs-message-error" role="alert">{error}</div>}
      </div>
      <footer><button className="cs-button cs-secondary" disabled={saving} onClick={onClose}><ArrowLeft size={15} /> Voltar</button><button className="cs-button cs-primary" disabled={saving || !ready || !date} onClick={() => void submit()}>{saving ? <LoaderCircle size={16} className="cs-spin" /> : <Check size={16} />}{saving ? "Salvando…" : "Confirmar estorno"}</button></footer>
    </section>
  </div>;
}
