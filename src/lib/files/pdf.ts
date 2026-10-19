import { formatDate, formatDateTime } from "@/lib/format";
import type { Column, ReportResult, Row } from "@/lib/reports/types";

// Helvetica advance widths (1/1000 em) for ASCII 32 to 126, from the standard font metrics.
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Converts text to the Latin-1 subset the standard PDF fonts can draw. */
export function pdfSafe(text: string): string {
  return text
    .replace(/₦/g, "NGN ")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function textWidth(text: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    w += code >= 32 && code <= 126 ? WIDTHS[code - 32] : 556;
  }
  return (w * size * (bold ? 1.06 : 1)) / 1000;
}

function fit(text: string, width: number, size: number, bold: boolean): string {
  if (textWidth(text, size, bold) <= width) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}...`, size, bold) > width) cut = cut.slice(0, -1);
  return `${cut}...`;
}

function escapePdf(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

const money = new Intl.NumberFormat("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function cellText(value: Row[string], column: Column): string {
  if (value === null || value === undefined || value === "") return "";
  switch (column.kind) {
    case "money":
      return money.format(Number(value));
    case "number":
      return Number(value).toLocaleString("en-NG");
    case "date":
      return formatDate(String(value));
    case "datetime":
      return formatDateTime(String(value));
    default:
      return String(value);
  }
}

const PAGE_W = 842; // A4 landscape
const PAGE_H = 595;
const MARGIN = 36;
const SIZE = 8;
const LINE = 13;

/** A PDF of a report: A4 landscape, title and filters at the top, the header repeated on every page, page numbers. */
export function reportToPdf(result: ReportResult, meta: { title: string; scope: string; generated: string }): Buffer {
  const usable = PAGE_W - MARGIN * 2;
  const numeric = (c: Column) => c.kind === "money" || c.kind === "number";
  const texts = result.rows.map((row) => result.columns.map((c) => pdfSafe(cellText(row[c.key], c))));
  const natural = result.columns.map((c, i) =>
    Math.max(textWidth(pdfSafe(c.label), SIZE, true), ...texts.slice(0, 1000).map((t) => textWidth(t[i], SIZE))) + 8,
  );
  const total = natural.reduce((s, w) => s + w, 0);
  let widths = natural;
  if (total > usable) {
    // Shrink text columns first; keep numbers readable.
    const fixed = natural.reduce((s, w, i) => s + (numeric(result.columns[i]) ? w : 0), 0);
    const flexible = total - fixed;
    const room = Math.max(usable - fixed, usable * 0.4);
    widths = natural.map((w, i) => (numeric(result.columns[i]) ? w : (w / flexible) * room));
    const scaled = widths.reduce((s, w) => s + w, 0);
    if (scaled > usable) widths = widths.map((w) => (w / scaled) * usable);
  }

  const pages: string[] = [];
  let ops: string[] = [];
  let y = 0;
  const text = (x: number, yy: number, s: string, bold = false, size = SIZE) =>
    ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${yy.toFixed(2)} Td (${escapePdf(s)}) Tj ET`);
  const rule = (yy: number, weight = 0.5) =>
    ops.push(`${weight} w ${MARGIN} ${yy.toFixed(2)} m ${(PAGE_W - MARGIN).toFixed(2)} ${yy.toFixed(2)} l S`);

  const drawRow = (cells: string[], bold: boolean) => {
    let x = MARGIN;
    result.columns.forEach((c, i) => {
      const s = fit(cells[i], widths[i] - 6, SIZE, bold);
      const tx = numeric(c) ? x + widths[i] - 4 - textWidth(s, SIZE, bold) : x + 2;
      if (s) text(tx, y, s, bold);
      x += widths[i];
    });
  };

  const startPage = (first: boolean) => {
    ops = [];
    y = PAGE_H - MARGIN;
    if (first) {
      text(MARGIN, y - 10, pdfSafe(meta.title), true, 14);
      y -= 28;
      if (meta.scope) {
        text(MARGIN, y, pdfSafe(meta.scope), false, 9);
        y -= LINE;
      }
      y -= 6;
    } else {
      text(MARGIN, y - 4, pdfSafe(meta.title), true, 9);
      y -= 20;
    }
    drawRow(result.columns.map((c) => pdfSafe(c.label)), true);
    rule(y - 4, 0.8);
    y -= LINE + 2;
  };

  const endPage = () => {
    text(MARGIN, MARGIN - 16, pdfSafe(meta.generated), false, 7);
    text(PAGE_W - MARGIN - 40, MARGIN - 16, `Page ${pages.length + 1}`, false, 7);
    pages.push(ops.join("\n"));
  };

  startPage(true);
  if (result.rows.length === 0) text(MARGIN, y, "Nothing in this report for the filters chosen.");
  result.rows.forEach((row, r) => {
    if (y < MARGIN + LINE) {
      endPage();
      startPage(false);
    }
    const strong = row._kind === "heading" || row._kind === "total" || row._kind === "subtotal";
    if (row._kind === "total" || row._kind === "subtotal") rule(y + LINE - 3);
    drawRow(texts[r], strong);
    y -= LINE;
  });
  for (const note of result.notes ?? []) {
    if (y < MARGIN + LINE * 2) {
      endPage();
      startPage(false);
    }
    y -= 4;
    text(MARGIN, y, fit(pdfSafe(note), usable, 7.5, false), false, 7.5);
    y -= LINE;
  }
  endPage();

  // Objects: 1 catalog, 2 page tree, 3 and 4 fonts, then a page and its content stream per page.
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 5 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((content, i) => {
    const pageId = pageIds[i];
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    objects[pageId + 1] = `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`;
  });

  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, "latin1");
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
