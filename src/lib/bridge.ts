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
async function withFreshSession<T>(write: () => PromiseLike<{ data: T; error: any }>) {
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
    // Do not send the new column to an older database before its migration is
    // applied. An explicit null is still sent when a contact is unlinked.
    ...(entry.counterpartyId !== undefined
      ? { counterparty_id: uuid(entry.counterpartyId) ? entry.counterpartyId : null }
      : {}),
    pix: entry.pix || "",
    amount: entry.amount,
    date: entry.date,
    status: entry.status,
    recurrence: entry.recurrence,
    installments: entry.installments || 1,
    installment: entry.installment || null,
    notes: entry.notes || "",
    // Only sent when present, so entry saving keeps working on a database
    // whose attachments migration has not been applied yet.
    ...(entry.attachments !== undefined ? { attachments: entry.attachments } : {}),
    ...(entry.juros !== undefined ? { juros: entry.juros } : {}),
    ...(entry.paidDate !== undefined ? { paid_date: entry.paidDate || null } : {}),
    ...(entry.discount !== undefined ? { discount: entry.discount } : {}),
    ...(entry.bankId !== undefined ? { bank_id: uuid(entry.bankId) ? entry.bankId : null } : {}),
  };
}

const attachmentsBucket = "attachments";

export async function uploadEntryAttachment(path: string, file: File) {
  const { error } = await supabase.storage
    .from(attachmentsBucket)
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) throw new Error(error.message || "Não foi possível enviar o arquivo.");
  return path;
}

export async function signedAttachmentUrl(path: string) {
  const { data, error } = await supabase.storage
    .from(attachmentsBucket)
    .createSignedUrl(path, 600);
  if (error || !data?.signedUrl)
    throw new Error(error?.message || "Não foi possível abrir o arquivo.");
  return data.signedUrl;
}

export async function removeEntryAttachments(paths: string[]) {
  if (!paths.length) return;
  await supabase.storage.from(attachmentsBucket).remove(paths);
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

export async function createRemoteCostCenter(name: string, initials: string, color: string) {
  return withFreshSession(() =>
    supabase.from("cost_centers")
      .insert({ name, initials, color })
      .select("name, initials, color")
      .single(),
  );
}

export async function updateRemoteCostCenter(
  name: string,
  patch: { initials: string; color: string },
) {
  return withFreshSession(() =>
    supabase.from("cost_centers")
      .update(patch)
      .eq("name", name)
      .select("name, initials, color")
      .single(),
  );
}

export async function deleteRemoteCostCenter(name: string) {
  return withFreshSession(() =>
    supabase.from("cost_centers").delete().eq("name", name),
  );
}

export async function saveRemoteCounterparty(counterparty: any) {
  if (!uuid(counterparty.id)) throw new Error("Cadastro inválido.");
  return withFreshSession(() =>
    supabase.from("counterparties").upsert({
      id: counterparty.id,
      kind: counterparty.kind,
      unit: counterparty.unit,
      name: counterparty.name,
      provides: counterparty.provides || "",
      archived: counterparty.archived || false,
    }).select("id, kind, unit, name, provides, archived").single(),
  );
}

export async function setRemoteCounterpartyArchived(id: string, archived: boolean) {
  if (!uuid(id)) throw new Error("Cadastro inválido.");
  return withFreshSession(() =>
    supabase.from("counterparties")
      .update({ archived })
      .eq("id", id)
      .select("id, kind, unit, name, provides, archived")
      .single(),
  );
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

// ---------- Notas da equipe ----------

export type TeamMember = {
  id: string;
  name: string;
  service: string;
  document: string;
  email: string;
  expected_amount: number | null;
  due_day: number;
  active: boolean;
  category_id?: string | null;
  created_at?: string;
};

export type TeamInvoice = {
  id: string;
  member_id: string;
  competence: string;
  invoice_number: string;
  amount: number | null;
  issue_date: string | null;
  files: string[];
  notes: string;
  created_at?: string;
};

export async function saveTeamMember(member: Omit<TeamMember, "created_at">) {
  if (!uuid(member.id)) throw new Error("Cadastro inválido.");
  return withFreshSession(() =>
    supabase.from("team_members").upsert(member).select("*").single(),
  ) as Promise<TeamMember>;
}

export async function deleteTeamMember(id: string) {
  await withFreshSession(() => supabase.from("team_members").delete().eq("id", id));
}

export async function saveTeamInvoice(invoice: Omit<TeamInvoice, "created_at">) {
  if (!uuid(invoice.id)) throw new Error("Nota inválida.");
  return withFreshSession(() =>
    supabase.from("team_invoices").upsert(invoice).select("*").single(),
  ) as Promise<TeamInvoice>;
}

export async function deleteTeamInvoice(id: string) {
  await withFreshSession(() => supabase.from("team_invoices").delete().eq("id", id));
}

export type TeamCategory = { id: string; name: string; created_at?: string };

export async function saveTeamCategory(category: { id: string; name: string }) {
  if (!uuid(category.id)) throw new Error("Categoria inválida.");
  return withFreshSession(() =>
    supabase.from("team_categories").upsert(category).select("*").single(),
  ) as Promise<TeamCategory>;
}

export async function deleteTeamCategory(id: string) {
  await withFreshSession(() => supabase.from("team_categories").delete().eq("id", id));
}

const teamNotesBucket = "team-notes";

export async function uploadTeamNoteFile(path: string, file: File) {
  const { error } = await supabase.storage
    .from(teamNotesBucket)
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) throw new Error(error.message || "Não foi possível enviar o arquivo.");
  return path;
}

export async function teamNoteFileUrl(path: string, downloadName?: string) {
  const { data, error } = await supabase.storage
    .from(teamNotesBucket)
    .createSignedUrl(path, 600, downloadName ? { download: downloadName } : undefined);
  if (error || !data?.signedUrl)
    throw new Error(error?.message || "Não foi possível abrir o arquivo.");
  return data.signedUrl;
}

export async function removeTeamNoteFiles(paths: string[]) {
  if (!paths.length) return;
  await supabase.storage.from(teamNotesBucket).remove(paths);
}

// ---------- Bancos ----------

export type Bank = { id: string; name: string; created_at?: string };

export async function saveBank(bank: { id: string; name: string }) {
  if (!uuid(bank.id)) throw new Error("Banco inválido.");
  return withFreshSession(() =>
    supabase.from("banks").upsert(bank).select("*").single(),
  ) as Promise<Bank>;
}

export async function deleteBank(id: string) {
  await withFreshSession(() => supabase.from("banks").delete().eq("id", id));
}
