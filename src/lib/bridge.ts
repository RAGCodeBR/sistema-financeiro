import { supabase } from "./supabase";

const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

type RemoteError = {
  code?: string;
  message?: string;
  details?: string;
};

function writeError(error: RemoteError) {
  if (error.code === "23505")
    return new Error(
      "Já existe uma categoria com este nome, tipo e centro de custo.",
    );
  if (error.code === "42501")
    return new Error(
      "Sua sessão não possui permissão para salvar este centro de custo. Saia e entre novamente; se persistir, peça ao Master para conferir seu acesso.",
    );
  if (error.code === "23514")
    return new Error("Os dados informados não são aceitos pelo banco.");
  return new Error(
    error.message || error.details || "Não foi possível salvar no banco.",
  );
}

/**
 * The app can stay open for hours. Refresh immediately before a mutation so
 * RLS always evaluates the active login instead of a token restored by the
 * browser from an older session.
 */
async function withFreshSession<T>(write: () => Promise<{ data: T; error: any }>) {
  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError || !refreshed.session)
    throw new Error("Sua sessão expirou. Entre novamente para salvar os dados.");

  let result = await write();
  // A first denied request can happen when a tab has just changed accounts.
  // Retrying after the explicit refresh is safe: upserts use the same ID.
  if (result.error?.code === "42501") {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data.session) result = await write();
  }
  if (result.error) throw writeError(result.error);
  return result.data;
}

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
  await withFreshSession(() =>
    supabase.from("entries").upsert(valid.map(entryRow)),
  );
}

export async function saveRemoteCategory(category: any) {
  if (!uuid(category.id)) return;
  await withFreshSession(() => supabase.from("categories").upsert(category));
}

export async function deleteRemoteEntries(ids: string[]) {
  const valid = ids.filter(uuid);
  if (!valid.length) return;
  await withFreshSession(() => supabase.from("entries").delete().in("id", valid));
}

export async function deleteRemoteEntrySeries(seriesId: string) {
  if (!uuid(seriesId)) return;
  // A recurring series can contain hundreds of records. Deleting by series_id
  // avoids an oversized URL made from one id per installment.
  await withFreshSession(() =>
    supabase.from("entries").delete().eq("series_id", seriesId),
  );
}

export async function deleteRemoteCategory(categoryId: string) {
  if (!uuid(categoryId)) return;
  await withFreshSession(() =>
    supabase.from("categories").delete().eq("id", categoryId),
  );
}
