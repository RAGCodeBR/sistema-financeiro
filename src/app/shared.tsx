import { ChevronLeft, ChevronRight } from "lucide-react";

// Utilitários de dinheiro e mês compartilhados entre as telas.
export const fmt = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const parseMoney = (value: string) => {
  const raw = value.replace(/R\$\s?/gi, "").replace(/\s/g, "");
  if (!raw) return NaN;
  if (raw.includes(","))
    return Number(raw.replace(/\./g, "").replace(",", "."));
  const parts = raw.split(".");
  // In Brazilian notation, 1.500 means fifteen hundred. A dot followed by
  // one or two digits is still accepted as a decimal separator for convenience.
  if (parts.length > 1 && (parts.length > 2 || parts.at(-1)!.length === 3))
    return Number(parts.join(""));
  return Number(raw);
};
export const moneyInput = (value: number) =>
  value.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export function CurrencyInput({
  value,
  onChange,
  className = "",
  placeholder = "0,00",
  required = true,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const parsed = parseMoney(value);
  const display = value && Number.isFinite(parsed) ? moneyInput(parsed) : "";
  return (
    <div className="relative mt-1.5">
      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm font-bold text-gray-400">
        R$
      </span>
      <input
        required={required}
        inputMode="numeric"
        value={display}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "");
          onChange(digits ? String(Number(digits) / 100) : "");
        }}
        className={`w-full rounded-xl border bg-gray-50 p-3 pl-10 text-sm font-normal ${className}`}
        placeholder={placeholder}
      />
    </div>
  );
}
export const labelMonth = (d: Date) =>
  d
    .toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    .replace(/^./, (c) => c.toUpperCase());

export function Month({ value, move }: { value: Date; move: (n: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-3 rounded-xl border bg-gray-50 px-3 py-2.5">
      <button
        onClick={() => move(-1)}
        className="rounded-lg p-1.5 hover:bg-white"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <span className="min-w-40 text-center text-sm font-extrabold text-[#14213d]">
        {labelMonth(value)}
      </span>
      <button
        onClick={() => move(1)}
        className="rounded-lg p-1.5 hover:bg-white"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
    </div>
  );
}
