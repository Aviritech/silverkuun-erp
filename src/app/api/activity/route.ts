import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { logActivity } from "@/lib/activity/log";
import { describePath } from "@/lib/activity/describe";
import { findReport } from "@/lib/reports/registry";

const body = z.object({ path: z.string().startsWith("/").max(300) });

/** A page opened in the browser, sent by the usage tracker. The page name is worked out here, not by the browser. */
export async function POST(request: NextRequest) {
  let parsed;
  try {
    parsed = body.safeParse(JSON.parse(await request.text()));
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (!parsed.success) return new NextResponse(null, { status: 400 });
  const path = parsed.data.path.split(/[?#]/)[0]!;
  const page = describePath(path, (key) => findReport(key)?.title);
  await logActivity("page_view", { path, module: page.module, label: page.label });
  return new NextResponse(null, { status: 204 });
}
