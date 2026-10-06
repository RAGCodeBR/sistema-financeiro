import assert from "node:assert/strict";
import test from "node:test";
import { changedSeriesFields, seriesDueDate } from "../src/lib/seriesDates.ts";

test("moves a monthly series to the new due day without collapsing months", () => {
  const entries = [
    { id: "aug", date: "2026-08-10" },
    { id: "sep", date: "2026-09-10" },
    { id: "oct", date: "2026-10-10" },
  ];
  assert.deepEqual(
    entries.map((entry) => seriesDueDate(entries, entries[1], entry, "2026-09-25")),
    ["2026-08-25", "2026-09-25", "2026-10-25"],
  );
});

test("shifts every month when the corrected first due date changes month", () => {
  const entries = [
    { id: "oct", date: "2026-10-30" },
    { id: "nov", date: "2026-11-30" },
  ];
  assert.deepEqual(
    entries.map((entry) => seriesDueDate(entries, entries[0], entry, "2026-11-30")),
    ["2026-11-30", "2026-12-30"],
  );
});

test("clamps the due day to each month's last day, including leap years", () => {
  const entries = [
    { id: "jan", date: "2028-01-15" },
    { id: "feb", date: "2028-02-15" },
    { id: "mar", date: "2028-03-15" },
  ];
  assert.deepEqual(
    entries.map((entry) => seriesDueDate(entries, entries[0], entry, "2028-01-31")),
    ["2028-01-31", "2028-02-29", "2028-03-31"],
  );
});

test("moves only the selected slot in a twice-monthly recurring series", () => {
  const entries = [
    { id: "a1", date: "2026-08-15", installment: "1/2" },
    { id: "a2", date: "2026-08-30", installment: "2/2" },
    { id: "b1", date: "2026-09-15", installment: "1/2" },
    { id: "b2", date: "2026-09-30", installment: "2/2" },
  ];
  assert.deepEqual(
    entries.map((entry) => seriesDueDate(entries, entries[0], entry, "2026-08-12")),
    ["2026-08-12", "2026-08-30", "2026-09-12", "2026-09-30"],
  );
});

test("does not touch dates when only other series details change", () => {
  const entries = [
    { id: "jan", date: "2026-01-31" },
    { id: "feb", date: "2026-02-28" },
  ];
  assert.deepEqual(
    entries.map((entry) => seriesDueDate(entries, entries[1], entry, entries[1].date)),
    ["2026-01-31", "2026-02-28"],
  );
});

test("a date-only edit does not overwrite different statuses or split amounts", () => {
  const original = {
    date: "2026-08-15",
    amount: 100,
    status: "realizado",
    attachments: undefined,
  };
  const form = { date: "2026-08-12", amount: 100, status: "realizado", attachments: [] };
  assert.deepEqual(changedSeriesFields(original, form, ["date"]), {});
  assert.deepEqual(
    changedSeriesFields(original, { ...form, amount: 120 }, ["date"]),
    { amount: 120 },
  );
});
