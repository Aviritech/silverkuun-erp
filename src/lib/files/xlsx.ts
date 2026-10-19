import type { Column, ReportResult, Row } from "@/lib/reports/types";
import { createZip, readZip } from "./zip";

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function esc(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Days since 1899-12-30, which is how spreadsheets store dates. */
function serialDate(value: string): number | null {
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  return Number.isNaN(t) ? null : t / 86_400_000 + 25569;
}

// Cell styles, by index into cellXfs below.
const S = { text: 0, bold: 1, money: 2, moneyBold: 3, date: 4, number: 5, numberBold: 6, dateTime: 7, title: 8 };

const STYLES = `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="d mmm yyyy"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="22" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function textCell(ref: string, text: string, style: number): string {
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

function valueCell(ref: string, value: Row[string], column: Column, bold: boolean): string {
  if (value === null || value === undefined || value === "") return "";
  const kind = column.kind ?? "text";
  if ((kind === "money" || kind === "number") && Number.isFinite(Number(value))) {
    const style = kind === "money" ? (bold ? S.moneyBold : S.money) : bold ? S.numberBold : S.number;
    return `<c r="${ref}" s="${style}"><v>${Number(value)}</v></c>`;
  }
  if (kind === "date" || kind === "datetime") {
    const serial = serialDate(String(value));
    if (serial !== null) {
      const v = kind === "date" ? Math.floor(serial) : serial;
      return `<c r="${ref}" s="${kind === "date" ? S.date : S.dateTime}"><v>${v}</v></c>`;
    }
  }
  return textCell(ref, String(value), bold ? S.bold : S.text);
}

/** A real Excel workbook (.xlsx) for a report: title, filters, header row, then the rows with numbers kept as numbers. */
export function reportToXlsx(result: ReportResult, meta: { title: string; scope: string }): Buffer {
  const rows: string[] = [];
  let r = 1;
  rows.push(`<row r="${r}">${textCell(`A${r}`, meta.title, S.title)}</row>`);
  r++;
  if (meta.scope) rows.push(`<row r="${r}">${textCell(`A${r}`, meta.scope, S.text)}</row>`);
  r += 2;
  const headerRow = r;
  rows.push(`<row r="${r}">${result.columns.map((c, i) => textCell(`${columnName(i)}${r}`, c.label, S.bold)).join("")}</row>`);
  for (const row of result.rows) {
    r++;
    const bold = row._kind === "heading" || row._kind === "total" || row._kind === "subtotal";
    rows.push(`<row r="${r}">${result.columns.map((c, i) => valueCell(`${columnName(i)}${r}`, row[c.key], c, bold)).join("")}</row>`);
  }
  for (const note of result.notes ?? []) {
    r += 2;
    rows.push(`<row r="${r}">${textCell(`A${r}`, note, S.text)}</row>`);
  }
  const widths = result.columns
    .map((c, i) => {
      const longest = Math.max(c.label.length, ...result.rows.slice(0, 500).map((row) => String(row[c.key] ?? "").length));
      const w = c.kind === "money" ? Math.max(16, longest + 4) : Math.min(60, Math.max(10, longest + 2));
      return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`;
    })
    .join("");

  const sheet = `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths}</cols><sheetData>${rows.join("")}</sheetData></worksheet>`;

  const sheetName = esc(meta.title.replace(/[\\/?*[\]:]/g, " ").slice(0, 31));
  return createZip([
    {
      name: "[Content_Types].xml",
      data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: "xl/styles.xml", data: STYLES },
    { name: "xl/worksheets/sheet1.xml", data: sheet },
  ]);
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/** The text of every <t> run inside a fragment, joined (rich text cells have several). */
function textRuns(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join("");
}

function columnIndex(ref: string): number {
  const letters = ref.replace(/\d+/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/**
 * Reads the first worksheet of an .xlsx file as rows of text. Dates stored as spreadsheet serial numbers come back as
 * numbers, so callers that expect dates should accept serials too.
 */
export function readXlsxRows(file: Buffer): string[][] {
  const zip = readZip(file);
  const read = (path: string) => zip.get(path)?.toString("utf8");
  const workbook = read("xl/workbook.xml");
  if (!workbook) throw new Error("this isn't an Excel workbook");
  const firstSheetRel = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const rels = read("xl/_rels/workbook.xml.rels") ?? "";
  let target = [...rels.matchAll(/<Relationship\b[^>]*>/g)]
    .map((m) => m[0])
    .find((r) => firstSheetRel && r.includes(`Id="${firstSheetRel}"`))
    ?.match(/Target="([^"]+)"/)?.[1];
  target = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target}`) : "xl/worksheets/sheet1.xml";
  const sheet = read(target);
  if (!sheet) throw new Error("the workbook has no worksheet");

  const shared = [...(read("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textRuns(m[1]));
  const rows: string[][] = [];
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const cell of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1];
      const body = cell[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let text = "";
      if (type === "s" && v !== undefined) text = shared[Number(v)] ?? "";
      else if (type === "inlineStr") text = textRuns(body);
      else if (v !== undefined) text = unescapeXml(v);
      const index = ref ? columnIndex(ref) : row.length;
      while (row.length < index) row.push("");
      row[index] = text;
    }
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  return rows;
}
