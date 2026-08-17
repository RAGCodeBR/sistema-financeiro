import { supabase } from "./supabase";

const hydratedKey = "fincore.supabase.hydrated";
const nativeSetItem = Storage.prototype.setItem;
const syncedKeys = new Set(["financepro.entries", "financepro.categories"]);

const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const readRows = (value: string | null) => {
  try { return JSON.parse(value || "[]"); } catch { return []; }
};

function entryRow(entry: any) {
  return {
    id: entry.id,
    series_id: uuid(entry.seriesId) ? entry.seriesId : null,
    kind: entry.kind,
    unit: entry.unit,
    account: entry.account,
    category: entry.category,
    description: entry.description,
    beneficiary: entry.beneficiary || "",
    pix: entry.pix || "",
    amount: entry.amount,
    date: entry.date,
    status: entry.status,
    recurrence: entry.recurrence,
    installments: entry.installments || 1,
    installment: entry.installment || null,
    notes: entry.notes || "",
  };
}

async function reconcile(key: string, previousValue: string | null, nextValue: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const previous = readRows(previousValue);
  const current = readRows(nextValue);
  if (!Array.isArray(current)) return;

  if (key === "financepro.entries") {
    const currentIds = new Set(current.map((row: any) => row.id));
    const deleted = previous.map((row: any) => row.id).filter((id: unknown) => uuid(id) && !currentIds.has(id));
    if (deleted.length) {
      const { error } = await supabase.from("entries").delete().in("id", deleted);
      if (error) console.error("Fincore: falha ao excluir lançamento", error);
    }
    const valid = current.filter((row: any) => uuid(row.id));
    if (valid.length) {
      const { error } = await supabase.from("entries").upsert(valid.map(entryRow));
      if (error) console.error("Fincore: falha ao salvar lançamento", error);
    }
    return;
  }

  const currentIds = new Set(current.map((row: any) => row.id));
  const deleted = previous.map((row: any) => row.id).filter((id: unknown) => uuid(id) && !currentIds.has(id));
  if (deleted.length) {
    const { error } = await supabase.from("categories").delete().in("id", deleted);
    if (error) console.error("Fincore: falha ao excluir categoria", error);
  }
  const valid = current.filter((row: any) => uuid(row.id));
  if (valid.length) {
    const { error } = await supabase.from("categories").upsert(valid);
    if (error) console.error("Fincore: falha ao salvar categoria", error);
  }
}

Storage.prototype.setItem = function setItem(key: string, value: string) {
  const previous = this.getItem(key);
  nativeSetItem.call(this, key, value);
  if (syncedKeys.has(key)) void reconcile(key, previous, value);
};

async function hydrate() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    if (localStorage.getItem("fincore.user")) {
      localStorage.removeItem("fincore.user");
      location.reload();
    }
    return;
  }
  if (sessionStorage.getItem(hydratedKey)) return;

  const [entries, categories, accounts] = await Promise.all([
    supabase.from("entries").select("*").order("date", { ascending: false }),
    supabase.from("categories").select("*"),
    supabase.from("accounts").select("*"),
  ]);
  if (entries.data) nativeSetItem.call(localStorage, "financepro.entries", JSON.stringify(entries.data.map((row: any) => ({ ...row, seriesId: row.series_id, amount: Number(row.amount) }))));
  if (categories.data) nativeSetItem.call(localStorage, "financepro.categories", JSON.stringify(categories.data));
  if (accounts.data) nativeSetItem.call(localStorage, "financepro.accounts", JSON.stringify(accounts.data.map((row: any) => ({ id: row.id, name: row.name }))));
  sessionStorage.setItem(hydratedKey, "1");
  location.reload();
}

void hydrate();
