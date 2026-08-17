import { supabase } from "./supabase";

const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

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
