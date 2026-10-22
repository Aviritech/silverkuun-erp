"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { getCurrentStaff, requirePermission } from "@/lib/auth/session";
import { friendlyDbError } from "@/lib/db-errors";
import { createClient } from "@/lib/supabase/server";
import { fieldErrors } from "@/modules/administration/schemas";
import type { ReporterCase } from "./constants";
import { accessSchema, caseUpdateSchema, messageSchema, reportSchema } from "./schemas";

// ---------------------------------------------------------------------------
// The reporter. Nothing here logs or stores who is asking: the database functions keep anonymous reports
// untraceable, and the reference and access code travel only in the request body, never in a URL.
// ---------------------------------------------------------------------------

const text = (formData: FormData, key: string) => (formData.get(key) as string | null) ?? "";

/** Makes a report. Returns the reference as `message` and the access code as `secret`, shown once. */
export async function submitReport(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await getCurrentStaff();
  const parsed = reportSchema.safeParse({
    category: text(formData, "category"),
    title: text(formData, "title"),
    description: text(formData, "description"),
    incident_date: text(formData, "incident_date"),
    location: text(formData, "location"),
    people_involved: text(formData, "people_involved"),
    anonymous: formData.get("anonymous") === "on",
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  const r = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("submit_whistleblowing_report", {
      p_category: r.category,
      p_title: r.title,
      p_description: r.description,
      p_incident_date: r.incident_date,
      p_location: r.location ?? "",
      p_people_involved: r.people_involved ?? "",
      p_anonymous: r.anonymous,
    })
    .single<{ reference: string; access_code: string }>();
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/internal-audit/whistleblowing");
  return { ok: true, message: data.reference, secret: data.access_code };
}

export type CaseLookup = { error?: string; fieldErrors?: Record<string, string>; case?: ReporterCase };

/** The reporter's view of their case, given the reference and access code. */
export async function lookUpCase(reference: string, code: string): Promise<CaseLookup> {
  await getCurrentStaff();
  const parsed = accessSchema.safeParse({ reference, code });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("whistleblowing_case", { p_reference: parsed.data.reference, p_access_code: parsed.data.code })
    .maybeSingle<ReporterCase>();
  if (error) return { error: friendlyDbError(error) };
  if (!data) return { error: "That reference and access code don't match a report. Check both and try again." };
  return { case: data };
}

export async function replyToCase(reference: string, code: string, body: string): Promise<ActionState> {
  await getCurrentStaff();
  const access = accessSchema.safeParse({ reference, code });
  if (!access.success) return { error: "That reference and access code don't match a report." };
  const message = messageSchema.safeParse({ body });
  if (!message.success) return { fieldErrors: fieldErrors(message.error) };
  const supabase = await createClient();
  const { error } = await supabase.rpc("whistleblowing_reply", {
    p_reference: access.data.reference,
    p_access_code: access.data.code,
    p_body: message.data.body,
  });
  if (error) return { error: friendlyDbError(error) };
  revalidatePath("/internal-audit/whistleblowing", "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Internal Audit
// ---------------------------------------------------------------------------

const casePath = (id: string) => `/internal-audit/whistleblowing/${id}`;

function refreshCase(id: string): ActionState {
  revalidatePath("/internal-audit/whistleblowing");
  revalidatePath(casePath(id));
  return { ok: true };
}

export async function takeCase(reportId: string): Promise<ActionState> {
  const staff = await requirePermission("whistleblowing.manage");
  const supabase = await createClient();
  const { data: current, error: readError } = await supabase.from("whistleblowing_reports").select("status").eq("id", reportId).maybeSingle();
  if (readError) return { error: friendlyDbError(readError) };
  if (!current) return { error: "That case can't be found." };
  const { error } = await supabase
    .from("whistleblowing_reports")
    .update({ assigned_to: staff.id, ...(current.status === "received" ? { status: "investigating" } : {}) })
    .eq("id", reportId);
  if (error) return { error: friendlyDbError(error) };
  return refreshCase(reportId);
}

export async function updateCase(reportId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("whistleblowing.manage");
  const parsed = caseUpdateSchema.safeParse({
    status: text(formData, "status"),
    findings: text(formData, "findings"),
    outcome: text(formData, "outcome"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { data, error } = await supabase.from("whistleblowing_reports").update(parsed.data).eq("id", reportId).select("id");
  if (error) return { error: friendlyDbError(error) };
  if (!data?.length) return { error: "That case can't be found." };
  return { ...refreshCase(reportId), message: "Saved." };
}

export async function messageReporter(reportId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requirePermission("whistleblowing.manage");
  const parsed = messageSchema.safeParse({ body: text(formData, "body") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const supabase = await createClient();
  const { error } = await supabase
    .from("whistleblowing_messages")
    .insert({ report_id: reportId, from_reporter: false, body: parsed.data.body });
  if (error) return { error: friendlyDbError(error) };
  return refreshCase(reportId);
}
