import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { administrationModule } from "@/modules/administration/module";
import { fullName, listBranches, type Member } from "@/modules/administration/queries";
import { dbFailure } from "@/lib/db-errors";

type Queued = Pick<
  Member,
  "id" | "branch_id" | "title" | "first_name" | "middle_name" | "last_name" | "created_by" | "submitted_at" | "sent_to_marketer_by" | "sent_to_marketer_at"
>;

export default async function ApprovalsPage() {
  const staff = await requireModule(administrationModule);
  const isManager = staff.permissions.has("members.approve");
  const isMarketer = staff.permissions.has("members.endorse");
  if (!isManager && !isMarketer) notFound();

  const supabase = await createClient();
  const [{ data, error }, branches] = await Promise.all([
    supabase
      .from("members")
      .select("id, branch_id, status, title, first_name, middle_name, last_name, created_by, submitted_at, sent_to_marketer_by, sent_to_marketer_at")
      .in("status", ["with_marketer", "pending_approval"])
      .order("submitted_at")
      .order("sent_to_marketer_at"),
    listBranches(),
  ]);
  if (error) throw dbFailure(error);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const inBranches = (permission: string) => {
    const ids = new Set(branches.filter((b) => staff.permissions.hasForBranch(permission, b)).map((b) => b.id));
    return (m: Queued) => ids.has(m.branch_id);
  };
  const rows = data as (Queued & { status: string })[];

  const sections = [
    isMarketer && {
      title: "Waiting for the marketer",
      hint: "Confirm you know the member and their details are right. The file then goes back to the officer to finish.",
      files: rows
        .filter((m) => m.status === "with_marketer")
        .filter(inBranches("members.endorse"))
        .filter((m) => ![m.created_by, m.sent_to_marketer_by].includes(staff.id)),
      since: (m: Queued) => `sent ${formatDateTime(m.sent_to_marketer_at)}`,
    },
    isManager && {
      title: "Waiting for the Branch Manager",
      hint: "Completed by the officer after the marketer confirmed the member. Approve with your signature or return it.",
      files: rows.filter((m) => m.status === "pending_approval").filter(inBranches("members.approve")),
      since: (m: Queued) => `submitted ${formatDateTime(m.submitted_at)}`,
    },
  ].filter((s) => !!s);

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader title="Approvals" description="Member files waiting for your review, oldest first." />
      {sections.map((s) => (
        <Card key={s.title} title={`${s.title} (${s.files.length})`}>
          <p className="mb-3 text-xs text-zinc-500">{s.hint}</p>
          {s.files.length === 0 ? (
            <EmptyState>Nothing is waiting.</EmptyState>
          ) : (
            <ul>
              {s.files.map((m) => (
                <li key={m.id} className="flex items-center justify-between border-b border-zinc-100 py-3 last:border-0">
                  <div>
                    <Link href={`/administration/members/${m.id}`} className="font-medium hover:underline">
                      {fullName(m)}
                    </Link>
                    <p className="text-xs text-zinc-500">
                      {branchName.get(m.branch_id)} · {s.since(m)}
                    </p>
                  </div>
                  <Link href={`/administration/members/${m.id}`} className="text-sm underline-offset-4 hover:underline">
                    Review
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}
