import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth/session";
import { reportToPdf } from "@/lib/files/pdf";
import { reportToXlsx } from "@/lib/files/xlsx";
import { formatDateTime } from "@/lib/format";
import { listDimensions, listOrg } from "@/lib/org";
import { toCsv } from "@/lib/reports/csv";
import { parseFilters } from "@/lib/reports/filters";
import { findReport, withLoadedOptions } from "@/lib/reports/registry";
import { describeScope } from "@/lib/reports/scope";
import { createClient } from "@/lib/supabase/server";

const FORMATS = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  csv: "text/csv; charset=utf-8",
} as const;

/** Downloads a report as Excel (.xlsx), PDF or CSV. Row level security still decides which rows are included. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  const { report: key } = await params;
  const found = findReport(key);
  const staff = await getCurrentStaff();
  if (!found || !staff.permissions.has(found.permission)) return new NextResponse("Not found", { status: 404 });

  const search = request.nextUrl.searchParams;
  const format = (search.get("format") ?? "csv") as keyof typeof FORMATS;
  if (!(format in FORMATS)) return new NextResponse("Unknown format", { status: 400 });

  const supabase = await createClient();
  const report = await withLoadedOptions(found, supabase);
  const filters = parseFilters(report, Object.fromEntries(search));
  const [result, org, dimensions] = await Promise.all([report.run(supabase, filters), listOrg(), listDimensions()]);
  const scope = describeScope(report, filters, { ...org, ...dimensions });
  const name = `${report.key}-${report.dates === "period" ? `${filters.from}-to-${filters.to}` : filters.to}.${format}`;

  let body: Buffer | string;
  if (format === "xlsx") body = reportToXlsx(result, { title: report.title, scope });
  else if (format === "pdf")
    body = reportToPdf(result, {
      title: report.title,
      scope,
      generated: `Silverkuun ERP · generated ${formatDateTime(new Date().toISOString())} by ${staff.fullName}`,
    });
  else body = toCsv(result);

  return new NextResponse(typeof body === "string" ? body : new Uint8Array(body), {
    headers: {
      "content-type": FORMATS[format],
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
