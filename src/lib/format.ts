const naira = new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" });
const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const dateTime = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });

export function formatMoney(value: number | string | null | undefined): string {
  return naira.format(Number(value ?? 0));
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  // Plain dates (YYYY-MM-DD) are calendar days, so don't let the time zone shift them.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d)
    : date.format(d);
}

export function formatDateTime(value: string | null | undefined): string {
  return value ? dateTime.format(new Date(value)) : "—";
}

/** Short naira amounts for dashboard figures: ₦84.6m, ₦320k, ₦950. */
export function formatMoneyShort(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const fixed = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, ""));
  if (abs >= 1e9) return `${sign}₦${fixed(abs / 1e9)}bn`;
  if (abs >= 1e6) return `${sign}₦${fixed(abs / 1e6)}m`;
  if (abs >= 1e3) return `${sign}₦${fixed(abs / 1e3)}k`;
  return `${sign}₦${abs.toFixed(0)}`;
}
