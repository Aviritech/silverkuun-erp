import Link from "next/link";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { recordReminder } from "@/modules/credit/actions";
import { fetchAll } from "@/modules/credit/book";
import { ReminderForm } from "@/modules/credit/components/forms";
import { REMINDER_CHANNELS, REMINDER_WINDOW_DAYS, arrearsBucket } from "@/modules/credit/constants";
import { creditModule } from "@/modules/credit/module";
import { officerNames, type Installment, type LoanBookRow, type Reminder } from "@/modules/credit/queries";

type Person = { id: string; first_name: string };

export default async function RemindersPage() {
  const staff = await requireModule(creditModule);
  await requirePermission("credit.read");
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + REMINDER_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

  const [active, upcoming, org, officers] = await Promise.all([
    fetchAll<LoanBookRow>((a, b) => supabase.from("loan_book").select("*").eq("status", "active").order("days_past_due", { ascending: false }).range(a, b)),
    fetchAll<Installment>((a, b) =>
      supabase.from("loan_schedule_status").select("*").gte("due_date", today).lte("due_date", until).gt("outstanding", 0).order("due_date").range(a, b),
    ),
    listOrg(),
    officerNames(),
  ]);
  const overdue = active.filter((l) => l.days_past_due > 0);
  const byId = new Map(active.map((l) => [l.id, l]));
  const due = upcoming.filter((i) => byId.has(i.loan_id) && byId.get(i.loan_id)!.days_past_due === 0);
  const ids = [...new Set([...overdue.map((l) => l.id), ...due.map((i) => i.loan_id)])];

  const [reminders, members] = await Promise.all([
    ids.length ? supabase.from("loan_reminders").select("*").in("loan_id", ids).order("sent_at", { ascending: false }) : Promise.resolve({ data: [], error: null }),
    ids.length
      ? supabase.from("members").select("id, first_name").in("id", [...new Set(ids.map((id) => byId.get(id)!.member_id))])
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (reminders.error) throw dbFailure(reminders.error);
  if (members.error) throw dbFailure(members.error);
  const lastReminder = new Map<string, Reminder>();
  for (const r of reminders.data as Reminder[]) if (!lastReminder.has(r.loan_id)) lastReminder.set(r.loan_id, r);
  const firstName = new Map((members.data as Person[]).map((m) => [m.id, m.first_name]));
  const branchOf = new Map(org.branches.map((b) => [b.id, b]));
  const canRemind = (l: LoanBookRow) => staff.permissions.hasForBranch("credit.manage", branchOf.get(l.branch_id)!);

  function last(loanId: string) {
    const r = lastReminder.get(loanId);
    return r ? (
      <span className="text-xs text-zinc-500">
        Last reminded by {REMINDER_CHANNELS[r.channel]} {formatDateTime(r.sent_at)}
        {r.note && `: ${r.note}`}
      </span>
    ) : (
      <span className="text-xs text-zinc-500">Not reminded yet</span>
    );
  }

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Repayments due"
        description={`Overdue loans and instalments falling due in the next ${REMINDER_WINDOW_DAYS} days. Record each reminder you send so the next person can see it.`}
      />

      <Card title={`Overdue (${overdue.length})`}>
        {overdue.length === 0 ? (
          <EmptyState>No loans are overdue.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {overdue.map((l) => (
              <li key={l.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <span>
                    <Link href={`/credit/loans/${l.id}`} className="font-mono text-xs underline">
                      {l.loan_no}
                    </Link>{" "}
                    <span className="font-medium">{l.member_name}</span>
                    <span className="block text-xs text-zinc-500">
                      {branchOf.get(l.branch_id)?.name} · {officers.get(l.account_officer_id) ?? "—"} · {l.missed_repayments} missed
                    </span>
                    {last(l.id)}
                  </span>
                  <span className="text-right">
                    <span className="font-semibold tabular-nums text-red-700">{formatMoney(l.overdue_amount)}</span>
                    <span className="block text-xs text-zinc-500">
                      {l.days_past_due} days ({arrearsBucket(l.days_past_due).label})
                    </span>
                  </span>
                </div>
                {canRemind(l) && (
                  <ReminderForm
                    action={recordReminder.bind(null, l.id)}
                    kind="overdue"
                    amount={l.overdue_amount}
                    message={`Dear ${firstName.get(l.member_id) ?? "customer"}, your Silverkuun loan ${l.loan_no} has ${formatMoney(l.overdue_amount)} overdue. Please pay today to avoid further charges. Thank you.`}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Due in the next ${REMINDER_WINDOW_DAYS} days (${due.length})`}>
        {due.length === 0 ? (
          <EmptyState>Nothing falls due this week.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {due.map((i) => {
              const l = byId.get(i.loan_id)!;
              return (
                <li key={i.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <span>
                      <Link href={`/credit/loans/${l.id}`} className="font-mono text-xs underline">
                        {l.loan_no}
                      </Link>{" "}
                      <span className="font-medium">{l.member_name}</span>
                      <span className="block text-xs text-zinc-500">
                        {branchOf.get(l.branch_id)?.name} · {officers.get(l.account_officer_id) ?? "—"} · instalment {i.installment_no}
                      </span>
                      {last(l.id)}
                    </span>
                    <span className="text-right">
                      <span className="font-semibold tabular-nums">{formatMoney(i.outstanding)}</span>
                      <span className="block text-xs text-zinc-500">due {formatDate(i.due_date)}</span>
                    </span>
                  </div>
                  {canRemind(l) && (
                    <ReminderForm
                      action={recordReminder.bind(null, l.id)}
                      kind="upcoming"
                      dueDate={i.due_date}
                      amount={i.outstanding}
                      message={`Dear ${firstName.get(l.member_id) ?? "customer"}, a reminder that ${formatMoney(i.outstanding)} on your Silverkuun loan ${l.loan_no} is due on ${formatDate(i.due_date)}. Thank you.`}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <p className="text-xs text-zinc-500">
        Reminders are recorded here and sent by the officer for now; automatic SMS can be added once Kuun chooses an SMS provider.
      </p>
    </div>
  );
}
