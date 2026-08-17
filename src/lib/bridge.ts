import { supabase } from "./supabase";

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

export async function saveRemoteEntries(entries: any[]) {
  const valid = entries.filter((row) => uuid(row.id));
  if (!valid.length) return;
  const { error } = await supabase.from("entries").upsert(valid.map(entryRow));
  if (error) throw error;
}

export async function saveRemoteCategory(category: any) {
  if (!uuid(category.id)) return;
  const { error } = await supabase.from("categories").upsert(category);
  if (error) throw error;
}

async function reconcile(key: string, _previousValue: string | null, nextValue: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  const current = readRows(nextValue);
  if (!Array.isArray(current)) return;

  if (key === "financepro.entries") {
    const valid = current.filter((row: any) => uuid(row.id));
    if (valid.length) {
      try { await saveRemoteEntries(valid); }
      catch (error) { console.error("Fincore: falha ao salvar lançamento", error); }
    }
    return;
  }

  const valid = current.filter((row: any) => uuid(row.id));
  if (valid.length) {
    const { error } = await supabase.from("categories").upsert(valid);
    if (error) console.error("Fincore: falha ao salvar categoria", error);
  }
}

// Exclusions use dedicated calls. A session change replaces the local cache with
// only the permitted records; that must never be interpreted as a database delete.
export async function deleteRemoteEntries(ids: string[]) {
  const valid = ids.filter(uuid);
  if (!valid.length) return;
  const { error } = await supabase.from("entries").delete().in("id", valid);
  if (error) throw error;
}

export async function deleteRemoteCategory(categoryId: string) {
  if (!uuid(categoryId)) return;
  const { error } = await supabase.from("categories").delete().eq("id", categoryId);
  if (error) throw error;
}

Storage.prototype.setItem = function setItem(key: string, value: string) {
  const previous = this.getItem(key);
  nativeSetItem.call(this, key, value);
  if (syncedKeys.has(key)) void reconcile(key, previous, value);
};
