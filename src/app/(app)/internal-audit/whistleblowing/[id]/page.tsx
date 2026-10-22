import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ActionButton } from "@/components/action-button";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { staffNameLookup } from "@/modules/accounts/queries";
import { internalAuditModule } from "@/modules/internal-audit/module";
import { messageReporter, takeCase, updateCase } from "@/modules/internal-audit/whistleblowing/actions";
import { CaseForm, MessageForm } from "@/modules/internal-audit/whistleblowing/case-forms";
import {
  CASE_STATUSES,
  SPEAK_UP_CATEGORIES,
  type CaseStatus,
  type SpeakUpCategory,
} from "@/modules/internal-audit/whistleblowing/constants";

type Report = {
  id: string;
  reference: string;
  category: SpeakUpCategory;
  title: string;
  description: string;
  incident_date: string | null;
  location: string | null;
  people_involved: string | null;
  is_anonymous: boolean;
  reporter_staff_id: string | null;
  status: CaseStatus;
  assigned_to: string | null;
  findings: string | null;
  outcome: string | null;
  received_on: string;
  closed_on: string | null;
};

type Message = { id: string; from_reporter: boolean; author_id: string | null; body: string; sent_on: string; seq: number };

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-sm">{children || "—"}</dd>
    </div>
  );
}

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  await requireModule(internalAuditModule);
  const staff = await requirePermission("whistleblowing.manage");
  const { id } = await params;
  const supabase = await createClient();
  const [report, messages] = await Promise.all([
    supabase.from("whistleblowing_reports").select("*").eq("id", id).maybeSingle(),
    supabase.from("whistleblowing_messages").select("id, from_reporter, author_id, body, sent_on, seq").eq("report_id", id).order("seq"),
  ]);
  if (report.error) throw dbFailure(report.error);
  if (messages.error) throw dbFailure(messages.error);
  if (!report.data) notFound();
  const r = report.data as Report;
  const thread = messages.data as Message[];
  const staffName = await staffNameLookup([r.reporter_staff_id, r.assigned_to, ...thread.map((m) => m.author_id)]);
  const status = CASE_STATUSES[r.status];
  const closed = r.status === "resolved" || r.status === "dismissed";

  return (
    <div className="max-w-5xl space-y-6">
      <p className="text-sm">
        <Link href="/internal-audit/whistleblowing" className="text-zinc-600 hover:underline">
          ← Whistleblowing
        </Link>
      </p>
      <PageHeader
        title={r.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <span className="font-mono text-xs">{r.reference}</span>
            <span>
              · {SPEAK_UP_CATEGORIES[r.category]} · received {formatDate(r.received_on)}
              {r.closed_on && ` · closed ${formatDate(r.closed_on)}`}
            </span>
          </span>
        }
        actions={
          !closed &&
          r.assigned_to !== staff.id && (
            <ActionButton
              action={takeCase.bind(null, r.id)}
              label="Take this case"
              confirm={r.assigned_to ? `Take this case over from ${staffName(r.assigned_to)}?` : undefined}
            />
          )
        }
      />

      <Card title="What was reported">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Detail label="Reported by">
            {r.is_anonymous ? <span className="italic">Anonymous</span> : staffName(r.reporter_staff_id)}
          </Detail>
          <Detail label="When it happened">{r.incident_date ? formatDate(r.incident_date) : null}</Detail>
          <Detail label="Where">{r.location}</Detail>
          <div className="sm:col-span-3">
            <Detail label="People involved">{r.people_involved}</Detail>
          </div>
          <div className="sm:col-span-3">
            <Detail label="What happened">{r.description}</Detail>
          </div>
        </dl>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Investigation">
          <p className="mb-4 text-sm text-zinc-600">
            Assigned to: <span className="font-medium text-ink">{r.assigned_to ? staffName(r.assigned_to) : "nobody yet"}</span>
          </p>
          <CaseForm action={updateCase.bind(null, r.id)} current={{ status: r.status, findings: r.findings, outcome: r.outcome }} />
        </Card>

        <Card title="Messages with the reporter">
          <div className="space-y-4">
            {thread.length === 0 ? (
              <p className="text-sm text-zinc-500">No messages yet.</p>
            ) : (
              <ul className="space-y-2">
                {thread.map((m) => (
                  <li
                    key={m.id}
                    className={`max-w-md rounded-lg px-3 py-2 text-sm ${m.from_reporter ? "bg-zinc-100 text-zinc-900" : "ml-auto bg-ink text-white"}`}
                  >
                    <p className={`text-xs ${m.from_reporter ? "text-zinc-500" : "text-silver-200"}`}>
                      {m.from_reporter ? "Reporter" : staffName(m.author_id)} · {formatDate(m.sent_on)}
                    </p>
                    <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>
                  </li>
                ))}
              </ul>
            )}
            <MessageForm action={messageReporter.bind(null, r.id)} />
          </div>
        </Card>
      </div>
    </div>
  );
}
