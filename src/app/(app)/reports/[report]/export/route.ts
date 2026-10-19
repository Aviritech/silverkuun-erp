import { NextResponse, type NextRequest } from "next/server";
import { getCurrentStaff } from "@/lib/auth/session";
import { toCsv } from "@/lib/reports/csv";
import { parseFilters } from "@/lib/reports/filters";
import { findReport } from "@/lib/reports/registry";
import { createClient } from "@/lib/supabase/server";

/** Downloads a report as a CSV file that opens in Excel. Row level security still decides which rows are included. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ report: string }> }) {
  const { report: key } = await params;
  const report = findReport(key);
  const staff = await getCurrentStaff();
  if (!report || !staff.permissions.has(report.permission)) return new NextResponse("Not found", { status: 404 });

  const filters = parseFilters(report, Object.fromEntries(request.nextUrl.searchParams));
  const result = await report.run(await createClient(), filters);
  const name = `${report.key}-${report.dates === "none" ? filters.to : report.dates === "asAt" ? filters.to : `${filters.from}-to-${filters.to}`}.csv`;
  return new NextResponse(toCsv(result), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
