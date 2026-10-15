type SearchableEntry = {
  date: string;
  description: string;
  beneficiary?: string | null;
};

// Busca sem diferenciar acentos nem maiúsculas ("divida" acha "Dívida").
export const normalizeEntrySearch = (text: string) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();

/** Pesquisa somente no intervalo escolhido; null é reservado à aba Atrasadas. */
export function filterEntriesByPeriodAndText<T extends SearchableEntry>(
  entries: T[],
  period: { start: string; end: string } | null,
  search: string,
): T[] {
  const term = normalizeEntrySearch(search);
  if (period && (!period.start || !period.end || period.start > period.end)) return [];
  return entries.filter((entry) =>
    (!period || (entry.date >= period.start && entry.date <= period.end)) &&
    (!term || normalizeEntrySearch(`${entry.description} ${entry.beneficiary || ""}`).includes(term)),
  );
}
