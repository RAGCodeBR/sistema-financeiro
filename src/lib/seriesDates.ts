type SeriesOccurrence = {
  id: string;
  date: string;
  installment?: string;
};

/** Propagate only edited fields, leaving each occurrence's other details intact. */
export function changedSeriesFields<T extends object>(
  original: T,
  edited: Partial<T>,
  excluded: (keyof T)[] = [],
): Partial<T> {
  const changes: Partial<T> = {};
  for (const key of Object.keys(edited) as (keyof T)[]) {
    if (excluded.includes(key)) continue;
    const before = original[key];
    const after = edited[key];
    if (
      key === "attachments" &&
      !(before as unknown[] | undefined)?.length &&
      !(after as unknown[] | undefined)?.length
    ) continue;
    if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null)) {
      changes[key] = after;
    }
  }
  return changes;
}

/** Keep each occurrence in its own month while changing the selected due day. */
export function seriesDueDate(
  occurrences: SeriesOccurrence[],
  edited: SeriesOccurrence,
  occurrence: SeriesOccurrence,
  requestedDate: string,
) {
  if (requestedDate === edited.date) return occurrence.date;

  const editedMonth = edited.date.slice(0, 7);
  const hasMultiplePaymentsInAMonth =
    new Set(occurrences.map((entry) => entry.date.slice(0, 7))).size <
    occurrences.length;
  // In a monthly advance + salary series, changing one payment day must not
  // move the other payment of every month onto that same day.
  if (
    hasMultiplePaymentsInAMonth &&
    occurrence.installment !== edited.installment
  ) {
    return occurrence.date;
  }

  const [editedYear, editedMonthNumber] = editedMonth.split("-").map(Number);
  const [requestedYear, requestedMonthNumber, requestedDay] = requestedDate
    .split("-")
    .map(Number);
  const [year, month] = occurrence.date.split("-").map(Number);
  const monthShift =
    (requestedYear - editedYear) * 12 +
    requestedMonthNumber -
    editedMonthNumber;
  const shiftedMonthIndex = year * 12 + month - 1 + monthShift;
  const targetYear = Math.floor(shiftedMonthIndex / 12);
  const targetMonth = shiftedMonthIndex - targetYear * 12 + 1;
  const lastDay = new Date(targetYear, targetMonth, 0).getDate();
  const targetDay = Math.min(requestedDay, lastDay);
  return `${targetYear}-${String(targetMonth).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
}
