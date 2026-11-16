import { NextResponse, type NextRequest } from "next/server";
import { deviceOf } from "@/lib/activity/device";
import { getCurrentStaff } from "@/lib/auth/session";
import { reportToXlsx } from "@/lib/files/xlsx";
import { formatDate } from "@/lib/format";
import { toCsv } from "@/lib/reports/csv";
import type { ReportResult } from "@/lib/reports/types";
import { createClient } from "@/lib/supabase/server";
import { MODULE_NAMES, USAGE_KINDS, USAGE_PERMISSION, describeEvent, loadUsageEvents, parseUsageFilters, type UsageKind } from "@/modules/system/usage";

const FORMATS = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
} as const;

/** Downloads the usage log for the Usage page's filters (up to 5,000 entries). The database decides which rows. */
export async function GET(request: NextRequest) {
  const staff = await getCurrentStaff();
  if (!staff.permissions.has(USAGE_PERMISSION)) return new NextResponse("Not found", { status: 404 });
  const search = Object.fromEntries(request.nextUrl.searchParams);
  const format = (search.format ?? "xlsx") as keyof typeof FORMATS;
  if (!(format in FORMATS)) return new NextResponse("Unknown format", { status: 400 });

  const filters = parseUsageFilters(search);
  const supabase = await createClient();
  const [events, branches] = await Promise.all([
    loadUsageEvents(supabase, filters, { kind: search.kind, limit: 5000 }),
    supabase.from("branches").select("id, name"),
  ]);
  const branchName = new Map((branches.data ?? []).map((b) => [b.id as string, b.name as string]));

  const result: ReportResult = {
    columns: [
      { key: "occurred_at", label: "When", kind: "datetime" },
      { key: "who", label: "Who" },
      { key: "branch", label: "Home branch" },
      { key: "kind", label: "Activity" },
      { key: "what", label: "Detail" },
      { key: "area", label: "Department" },
      { key: "path", label: "Page address" },
      { key: "device", label: "Device" },
      { key: "ip", label: "IP address" },
    ],
    rows: events.map((e) => ({
      occurred_at: e.occurred_at,
      who: e.staff_name ?? "Unknown",
      branch: e.branch_id ? (branchName.get(e.branch_id) ?? "") : "",
      kind: USAGE_KINDS[e.kind as UsageKind] ?? e.kind,
      what: describeEvent(e),
      area: e.module ? (MODULE_NAMES[e.module] ?? e.module) : "",
      path: e.path ?? "",
      device: deviceOf(e.user_agent),
      ip: e.ip ?? "",
    })),
    notes: events.length === 5000 ? ["Only the latest 5,000 entries are included. Narrow the dates to get older ones."] : [],
  };
  const name = `usage-${filters.from}-to-${filters.to}.${format}`;
  const body =
    format === "xlsx" ? new Uint8Array(reportToXlsx(result, { title: "Usage log", scope: `${formatDate(filters.from)} to ${formatDate(filters.to)}` })) : toCsv(result);
  return new NextResponse(body, {
    headers: { "content-type": FORMATS[format], "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
