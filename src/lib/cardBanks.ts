import type { CardStatement } from "./cardStatement.ts";

export const statementBanks = [
  { code: "itau", name: "Itaú" }, { code: "nubank", name: "Nubank" },
  { code: "bradesco", name: "Bradesco" }, { code: "santander", name: "Santander" },
  { code: "bb", name: "Banco do Brasil" }, { code: "caixa", name: "Caixa" },
  { code: "inter", name: "Inter" }, { code: "c6", name: "C6 Bank" },
  { code: "btg", name: "BTG Pactual" }, { code: "mercado-pago", name: "Mercado Pago" },
];
export const statementBankLabel = (s: Pick<CardStatement, "bankCode" | "bankName">) => s.bankName || statementBanks.find(bank => bank.code === (s.bankCode || "itau"))?.name || "Cartão";
export const statementCardLabel = (s: Pick<CardStatement, "bankCode" | "bankName" | "cardLast4" | "cardLabel">) => `${s.cardLabel || statementBankLabel(s)} · final ${s.cardLast4 || "não identificado"}`;
