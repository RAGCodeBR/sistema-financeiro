import assert from "node:assert/strict";
import test from "node:test";
import { filterEntriesByPeriodAndText } from "../src/lib/entryPeriod.ts";

const entries = [
  { date: "2026-10-27", description: "Aluguel do escritório", beneficiary: "Imobiliária" },
  { date: "2026-10-28", description: "Aluguel da sala" },
  { date: "2029-09-25", description: "ALUGUEL-508" },
];

test("text search respects a custom single-day range", () => {
  assert.deepEqual(
    filterEntriesByPeriodAndText(entries, { start: "2026-10-27", end: "2026-10-27" }, "alug"),
    [entries[0]],
  );
});

test("month range and accent-insensitive search work together", () => {
  assert.deepEqual(
    filterEntriesByPeriodAndText(entries, { start: "2026-10-01", end: "2026-10-31" }, "imobiliaria"),
    [entries[0]],
  );
});

test("invalid range returns nothing, while overdue view may search all months", () => {
  assert.deepEqual(filterEntriesByPeriodAndText(entries, { start: "2026-10-28", end: "2026-10-27" }, "alug"), []);
  assert.deepEqual(filterEntriesByPeriodAndText(entries, null, "alug"), entries);
});
