import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, ReceiptText, X } from "lucide-react";
import type { ComparisonEntry } from "../lib/cardStatement";

type Entry = ComparisonEntry & { status?: string; notes?: string };
const money = (value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const date = (value?: string) => value ? value.split("-").reverse().join("/") : "—";
export default function GeneratedCardEntries({ entries, standalone, onBack }: { entries: Entry[]; standalone: boolean; onBack: () => void }) {
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10), [selected, setSelected] = useState<Entry | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const count = Math.max(1, Math.ceil(entries.length / pageSize)), active = Math.min(page, count), start = (active - 1) * pageSize;
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date) || a.description.localeCompare(b.description));
  useEffect(() => { setPage(1); }, [pageSize, entries.length]);
  useEffect(() => { if (selected) dialog.current?.showModal(); else dialog.current?.close(); }, [selected]);
  return <section className="cs-panel cs-generated-entries">
    <header className="cs-panel-heading"><div><h2>Lançamentos deste cartão <span>{entries.length}</span></h2><p>{standalone ? "Despesas criadas neste navegador para testar a integração. Nenhum dado foi enviado à produção." : "Despesas criadas pela conferência e disponíveis no sistema financeiro."}</p></div><button className="cs-button cs-secondary" onClick={onBack}><ArrowLeft size={14} /> Voltar à conferência</button></header>
    <div className="cs-table-scroll"><table className="cs-table"><thead><tr><th>VENCIMENTO</th><th>DESPESA</th><th>VALOR</th><th>PJ / PF</th><th>CENTRO DE CUSTO</th><th>PAGAMENTO</th><th /></tr></thead><tbody>
      {sorted.slice(start, start + pageSize).map(e => <tr key={e.id} className="cs-clickable-row" onClick={() => setSelected(e)}>
        <td className="cs-date">{date(e.date)}<small>Compra: {date(e.purchaseDate)}</small></td>
        <td><button className="cs-merchant"><span><strong>{e.description}</strong><small>{e.category || "Sem categoria"}{e.installment ? ` · parcela ${e.installment}` : ""}</small></span></button></td>
        <td className="cs-value">{money(e.amount)}</td><td><span className={`cs-status ${e.nature === "PF" ? "cs-nature-tag-pf" : "cs-nature-tag-pj"}`}>{e.nature || "—"}</span></td>
        <td>{e.unit}</td><td><span className={`cs-status ${e.status === "realizado" ? "cs-status-success" : "cs-status-warning"}`}>{e.status === "realizado" ? <><Check size={11} /> Pago</> : "A pagar"}</span></td>
        <td><button className="cs-row-action" aria-label={`Abrir lançamento ${e.description}`}><ChevronRight size={17} /></button></td>
      </tr>)}
    </tbody></table>{!entries.length && <div className="cs-no-results"><ReceiptText size={26} /><strong>Nenhum lançamento gerado para este cartão</strong><span>Valide as despesas e confirme a criação no resumo da fatura.</span></div>}</div>
    <div className="cs-pagination"><label>Itens por página<select aria-label="Lançamentos por página" value={pageSize} onChange={e => setPageSize(Number(e.target.value))}><option>10</option><option>20</option><option>50</option></select></label><span>{entries.length ? `${start + 1}–${Math.min(start + pageSize, entries.length)} de ${entries.length}` : "0 itens"}</span><nav aria-label="Paginação dos lançamentos gerados"><button disabled={active === 1} aria-label="Lançamentos anteriores" onClick={() => setPage(active - 1)}><ChevronLeft size={14} /> Anterior</button><span>Página {active} de {count}</span><button disabled={active === count} aria-label="Próximos lançamentos" onClick={() => setPage(active + 1)}>Próxima <ChevronRight size={14} /></button></nav></div>
    <footer className="cs-table-footer"><span>{standalone ? "Ambiente local" : "Lançamentos do sistema"}</span><span>Total deste cartão <strong>{money(entries.reduce((sum, e) => sum + e.amount, 0))}</strong></span></footer>
    <dialog ref={dialog} className="cs-entry-dialog" aria-labelledby="cs-entry-title" onCancel={() => setSelected(null)} onClick={event => { if (event.target === dialog.current) { const rect = dialog.current.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setSelected(null); } }}>
      {selected && <><header><h2 id="cs-entry-title">Lançamento gerado</h2><button aria-label="Fechar lançamento" onClick={() => setSelected(null)}><X size={19} /></button></header><div className="cs-dialog-body"><div className="cs-selected-purchase"><h3>{selected.description}</h3><strong>{money(selected.amount)}</strong><p>{selected.nature} · {selected.unit} · {selected.category}</p></div><dl className="cs-entry-details"><dt>Data da compra</dt><dd>{date(selected.purchaseDate)}</dd><dt>Vencimento</dt><dd>{date(selected.date)}</dd><dt>Situação</dt><dd>{selected.status === "realizado" ? "Pago" : "A pagar"}</dd><dt>Pagamento identificado</dt><dd>{date(selected.paidDate)}</dd><dt>Cartão</dt><dd>Final {selected.cardLast4}</dd></dl>{selected.notes && <p className="cs-entry-notes">{selected.notes}</p>}<div className="cs-inline-note">{standalone ? "Este lançamento foi criado apenas no ambiente local." : "Para editar ou dar baixa, abra esta despesa na aba Lançamentos do sistema."}</div></div></>}
    </dialog>
  </section>;
}
