// Wording helpers for the Society's letters, written the way the library samples write them:
// "THIRTY-FIVE MILLION NAIRA ONLY (N35,000,000)", "24TH MARCH, 2026", "1 YEAR", "3 MONTHS".

const ONES = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", "thousand", "million", "billion", "trillion"];

function underThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} hundred`);
  if (rest) {
    const words = rest < 20 ? ONES[rest] : TENS[Math.floor(rest / 10)] + (rest % 10 ? `-${ONES[rest % 10]}` : "");
    parts.push(hundreds ? `and ${words}` : words);
  }
  return parts.join(" ");
}

/** A whole number in words: 17500000 -> "seventeen million, five hundred thousand". */
export function numberToWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "zero";
  const groups: string[] = [];
  let scale = 0;
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) groups.unshift(`${underThousand(chunk)}${SCALES[scale] ? ` ${SCALES[scale]}` : ""}`);
    n = Math.floor(n / 1000);
    scale++;
  }
  // "one million and fifty" reads better than "one million, fifty" for a trailing amount under a hundred.
  return groups.reduce((text, group, i) => {
    if (i === 0) return group;
    const last = i === groups.length - 1 && !/hundred|thousand|million|billion|trillion/.test(group);
    return `${text}${last ? " and " : ", "}${group}`;
  }, "");
}

/** Naira in words, with kobo when there are any: "THIRTY-FIVE MILLION NAIRA ONLY". */
export function nairaInWords(amount: number | string): string {
  const value = Math.round(Number(amount) * 100) / 100;
  const naira = Math.floor(value);
  const kobo = Math.round((value - naira) * 100);
  const words = kobo
    ? `${numberToWords(naira)} naira, ${numberToWords(kobo)} kobo only`
    : `${numberToWords(naira)} naira only`;
  return words.toUpperCase();
}

const whole = new Intl.NumberFormat("en-NG", { maximumFractionDigits: 0 });
const withKobo = new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "N35,000,000", the way the letters print amounts (kobo only when there are any). */
export function naira(amount: number | string): string {
  const value = Math.round(Number(amount) * 100) / 100;
  return `N${(Number.isInteger(value) ? whole : withKobo).format(value)}`;
}

const MONTHS = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
];

/** 1 -> "1ST", 22 -> "22ND", 13 -> "13TH". */
export function ordinal(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? "TH" : (["TH", "ST", "ND", "RD"][day % 10] ?? "TH");
  return `${day}${suffix}`;
}

/** A calendar date (YYYY-MM-DD) as the letters write it, split so the suffix can be superscript: 24, TH, MARCH, 2026. */
export function letterDateParts(iso: string): { day: number; suffix: string; month: string; year: number } {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { day: d, suffix: ordinal(d).slice(String(d).length), month: MONTHS[m - 1], year: y };
}

/** "24TH MARCH, 2026". */
export function letterDate(iso: string): string {
  const p = letterDateParts(iso);
  return `${p.day}${p.suffix} ${p.month}, ${p.year}`;
}

/** Whole months between two calendar dates, counting a month when the day of the month is reached. */
export function monthsBetween(start: string, end: string): number {
  const [y1, m1, d1] = start.slice(0, 10).split("-").map(Number);
  const [y2, m2, d2] = end.slice(0, 10).split("-").map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1);
  // A month counts when the day is reached, or the end date is the last day of a shorter month.
  const lastDay = new Date(Date.UTC(y2, m2, 0)).getUTCDate();
  if (d2 < d1 && d2 !== lastDay) months--;
  return Math.max(0, months);
}

/** A plan's length the way the letters write it: "1 YEAR", "18 MONTHS", "3 MONTHS", "45 DAYS". */
export function tenureWords(start: string, end: string): string {
  const months = monthsBetween(start, end);
  if (months === 0) {
    const days = Math.round((Date.parse(`${end.slice(0, 10)}T00:00:00Z`) - Date.parse(`${start.slice(0, 10)}T00:00:00Z`)) / 86400000);
    return `${days} ${days === 1 ? "DAY" : "DAYS"}`;
  }
  if (months % 12 === 0) return `${months / 12} ${months === 12 ? "YEAR" : "YEARS"}`;
  return `${months} ${months === 1 ? "MONTH" : "MONTHS"}`;
}

/** Adds whole months to a calendar date, keeping to the last day of shorter months. */
export function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/**
 * The first interest pay day after a date: the member's pay day in the next month it falls after `from`.
 * Days past the end of a shorter month fall on its last day, as the interest payment schedule pays them.
 */
export function nextPayDay(from: string, payDay: number): string {
  const [y, m, d] = from.slice(0, 10).split("-").map(Number);
  const onDay = (year: number, month: number) => {
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return new Date(Date.UTC(year, month - 1, Math.min(payDay, last))).toISOString().slice(0, 10);
  };
  const thisMonth = onDay(y, m);
  if (Number(thisMonth.slice(8, 10)) > d) return thisMonth;
  return onDay(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1);
}

/** "6.5%" without trailing zeros. */
export function percent(value: number | string): string {
  return `${Number(Number(value).toFixed(4))}%`;
}

/** A plan's stored annual rate as the monthly rate the letters quote: 48 -> 4. */
export function monthlyRate(annual: number | string): number {
  return Math.round((Number(annual) / 12) * 10000) / 10000;
}
