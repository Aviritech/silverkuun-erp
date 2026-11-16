import Link from "next/link";
import { PrintButton } from "@/components/print-button";
import { OFFICES, SOCIETY } from "@/lib/letters/letterhead";
import { letterDateParts } from "@/lib/letters/words";

/** The Society's mark from the letterhead: a tap with drops, in a yellow ring. */
function TapMark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className="h-[18mm] w-[18mm] shrink-0">
      <circle cx="32" cy="32" r="28" fill="none" stroke="#f2b705" strokeWidth="5" />
      <path d="M20 22h20a6 6 0 0 1 6 6v6h-6v-5H20z" fill="#f2b705" />
      <rect x="27" y="17" width="6" height="5" rx="1" fill="#f2b705" />
      <circle cx="43" cy="40" r="1.6" fill="#f2b705" />
      <circle cx="39.5" cy="44" r="1.6" fill="#f2b705" />
      <circle cx="46.5" cy="44" r="1.6" fill="#f2b705" />
      <circle cx="43" cy="48" r="1.6" fill="#f2b705" />
    </svg>
  );
}

/** "24TH MARCH, 2026" with the suffix raised, as the samples print it. */
export function LetterDate({ date }: { date: string }) {
  const p = letterDateParts(date);
  return (
    <>
      {p.day}
      <sup>{p.suffix}</sup> {p.month}, {p.year}
    </>
  );
}

/** The rubber stamp box the Branch Manager signs and dates. */
export function StampBox() {
  return (
    <div className="mt-2 inline-block border-2 border-double border-neutral-500 px-2 py-1 text-[8.5pt] leading-snug text-neutral-600">
      <p className="font-semibold tracking-tight">SILVERKUUN COOPERATIVE SOCIETY</p>
      <p className="text-center">RC: {SOCIETY.rcNumber}</p>
      <p>Sign:..........................................</p>
      <p>Date:..........................................</p>
    </div>
  );
}

/** "Yours Faithfully, For: SILVER KUUN LTD, BRANCH MANAGER, <name>", with the stamp box beside it as on the samples. */
export function SignOff({ manager, closing = "Thank you for your partnership." }: { manager: string | null; closing?: string }) {
  return (
    <div className="mt-4 flex flex-wrap items-end justify-between gap-4 break-inside-avoid">
      <div>
        <p>{closing}</p>
        <p>Yours Faithfully,</p>
        <p className="mt-2 font-semibold">For: {SOCIETY.signOff}</p>
        <p className="font-semibold">BRANCH MANAGER</p>
        <p className="mt-2 font-semibold uppercase">{manager ?? "...................................."}</p>
      </div>
      <div className="mr-[20mm]">
        <StampBox />
      </div>
    </div>
  );
}

/** Things the letter needs that aren't on file yet. Shown on screen only, never printed. */
export type LetterGap = string;

/**
 * An A4 letter on the Society's letterhead, with a screen-only toolbar to print it or save it as a PDF.
 * The body follows the matching sample in the project library.
 */
export function Letter({
  title,
  date,
  backHref,
  backLabel,
  gaps = [],
  notes,
  children,
}: {
  title: string;
  date: string;
  backHref: string;
  backLabel: string;
  gaps?: LetterGap[];
  notes?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-neutral-200 print:bg-white">
      <style>{`@page { size: A4; margin: 0; } @media print { html, body { background: white; } }`}</style>
      <div className="no-print sticky top-0 z-10 border-b border-neutral-300 bg-white">
        <div className="mx-auto flex max-w-[210mm] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <Link href={backHref} className="text-sm text-neutral-600 hover:underline">
              ← {backLabel}
            </Link>
            <h1 className="text-base font-semibold">{title}</h1>
          </div>
          <PrintButton label="Print or save as PDF" />
        </div>
        {(gaps.length > 0 || notes) && (
          <div className="mx-auto max-w-[210mm] space-y-2 px-4 pb-3 text-sm">
            {gaps.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                <p className="font-medium">Not on file yet, so the letter shows dotted lines:</p>
                <ul className="list-disc pl-5">
                  {gaps.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
              </div>
            )}
            {notes && <div className="text-neutral-600">{notes}</div>}
          </div>
        )}
      </div>

      <article className="relative mx-auto my-6 flex min-h-[297mm] w-[210mm] max-w-full flex-col overflow-hidden bg-white px-[16mm] pt-[10mm] pb-[6mm] font-sans text-[10pt] leading-[1.38] text-black shadow-lg print:my-0 print:shadow-none">
        {/* The faint yellow arcs of the letterhead. */}
        <div aria-hidden="true" className="pointer-events-none absolute -top-[30mm] -right-[30mm] h-[90mm] w-[90mm] rounded-full border-[7mm] border-amber-200/60" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-[40mm] -left-[40mm] h-[110mm] w-[110mm] rounded-full border-[9mm] border-amber-100/70" />

        <div className="relative flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <TapMark />
            <div className="bg-[#f2b705] px-3 pt-1 pb-1.5 leading-none">
              <p className="text-right text-[9pt] font-bold text-black">RC: {SOCIETY.rcNumber}</p>
              <p className="text-[26pt] font-extrabold tracking-tight text-white [text-shadow:0_1px_0_rgba(0,0,0,0.15)]">
                {SOCIETY.name}
              </p>
              <p className="mt-0.5 text-[12pt] font-extrabold uppercase tracking-wide text-black">{SOCIETY.legalName}</p>
            </div>
          </div>
          <p className="mt-[13mm] shrink-0 font-semibold">
            <LetterDate date={date} />
          </p>
        </div>

        <div className="relative mt-3 flex-1">{children}</div>

        <div className="relative mt-4 grid grid-cols-2 gap-x-6 border-t-2 border-[#f2b705] pt-2 text-[7.5pt] leading-snug break-inside-avoid">
          <div>
            {OFFICES.filter((o) => o.title === "Abuja Office").map((o) => (
              <div key={o.title}>
                <p className="mb-0.5 inline-block bg-[#f2b705] px-1.5 font-bold uppercase">{o.title}</p>
                {o.lines.map((l) => (
                  <p key={l}>• {l}</p>
                ))}
              </div>
            ))}
            <p className="mt-1 text-[10pt] font-medium">{SOCIETY.phones.join(", ")}</p>
            <p className="text-[9pt]">
              {SOCIETY.email} · {SOCIETY.social}
            </p>
            <p className="text-[9pt]">{SOCIETY.website}</p>
          </div>
          <div className="space-y-1">
            {OFFICES.filter((o) => o.title !== "Abuja Office").map((o) => (
              <div key={o.title}>
                <p className="mb-0.5 inline-block bg-[#f2b705] px-1.5 font-bold uppercase">{o.title}</p>
                {o.lines.map((l) => (
                  <p key={l}>• {l}</p>
                ))}
              </div>
            ))}
          </div>
        </div>
      </article>
    </div>
  );
}

/** Splits an address into lines of about 30 characters at its commas, so it reads like the samples' address block. */
export function addressLines(address: string): string[] {
  const parts = address
    .split(/\n|,/)
    .map((l) => l.trim())
    .filter(Boolean);
  const lines: string[] = [];
  for (const part of parts) {
    const last = lines.at(-1);
    if (last && `${last}, ${part}`.length <= 30) lines[lines.length - 1] = `${last}, ${part}`;
    else lines.push(part);
  }
  return lines;
}

/** The member's address in capitals, a comma at the end of each line and a full stop at the end. */
export function AddressBlock({ address }: { address: string }) {
  const lines = addressLines(address);
  return (
    <div className="font-semibold uppercase">
      {lines.map((l, i) => (
        <p key={i}>
          {l}
          {i < lines.length - 1 ? "," : "."}
        </p>
      ))}
    </div>
  );
}

/** A value from the file, or dotted lines to fill in by hand when it isn't on file. */
export function Blank({ children, width = "w-40" }: { children?: React.ReactNode; width?: string }) {
  if (children !== null && children !== undefined && children !== "") return <>{children}</>;
  return <span className={`inline-block ${width} border-b border-dotted border-black align-baseline`}>&nbsp;</span>;
}
