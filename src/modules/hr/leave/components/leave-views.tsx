import { Badge, EmptyState } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { APPROVAL_SCOPES, LEAVE_STATUSES, STEP_STATUSES, type LeaveStatus } from "../constants";
import type { LeaveBalance, LeaveStep } from "../queries";

export function LeaveStatusBadge({ status }: { status: LeaveStatus }) {
  return <Badge tone={LEAVE_STATUSES[status].tone}>{LEAVE_STATUSES[status].label}</Badge>;
}

export function leaveDates(start: string, end: string) {
  return start === end ? formatDate(start) : `${formatDate(start)} to ${formatDate(end)}`;
}

export function BalancesTable({ balances, empty = "No leave available this year." }: { balances: LeaveBalance[]; empty?: string }) {
  if (balances.length === 0) return <EmptyState>{empty}</EmptyState>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="px-3 py-2 font-medium">Leave</th>
            <th className="px-3 py-2 text-right font-medium">Days this year</th>
            <th className="px-3 py-2 text-right font-medium">Taken</th>
            <th className="px-3 py-2 text-right font-medium">Waiting for approval</th>
            <th className="px-3 py-2 text-right font-medium">Left</th>
          </tr>
        </thead>
        <tbody>
          {balances.map((b) => (
            <tr key={b.leave_type_id} className="border-b border-zinc-100 last:border-0">
              <td className="px-3 py-2 font-medium">{b.name}</td>
              <td className="px-3 py-2 text-right tabular-nums">{b.uses_balance ? b.entitlement : "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">{b.taken}</td>
              <td className="px-3 py-2 text-right tabular-nums">{b.pending}</td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {b.available === null ? <span className="font-normal text-zinc-500">No limit</span> : b.available}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The request's steps in order, with who acted, when, and what they said. */
export function StepTimeline({
  steps,
  staffName,
  reliefName,
  jobTitleName,
}: {
  steps: LeaveStep[];
  staffName: (id: string | null) => string;
  reliefName?: string | null;
  jobTitleName?: Map<string, string>;
}) {
  if (steps.length === 0) return <EmptyState>No approval steps.</EmptyState>;
  return (
    <ol className="space-y-3 text-sm">
      {steps.map((s) => {
        const status = STEP_STATUSES[s.status];
        const who =
          s.kind === "relief"
            ? `${reliefName ?? "The relief officer"} agrees to cover the work`
            : s.kind === "hr"
              ? "Head of HR, because nobody in the chain could approve it"
              : [
                  s.job_title_ids?.map((id) => jobTitleName?.get(id)).filter(Boolean).join(" or "),
                  s.scope && APPROVAL_SCOPES[s.scope].toLowerCase(),
                  s.same_department && "same department",
                ]
                  .filter(Boolean)
                  .join(", ");
        return (
          <li key={s.id} className="flex gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-medium text-zinc-600">
              {s.step_order}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{s.name}</span>
                <Badge tone={status.tone}>{status.label}</Badge>
              </p>
              {who && <p className="text-xs text-zinc-500">{who}</p>}
              {s.acted_by && (
                <p className="text-zinc-600">
                  {staffName(s.acted_by)}, {formatDateTime(s.acted_at)}
                </p>
              )}
              {s.comment &&
                (s.acted_by ? (
                  <p className="text-zinc-700">&ldquo;{s.comment}&rdquo;</p>
                ) : (
                  <p className="text-xs text-zinc-500">{s.comment}</p>
                ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
