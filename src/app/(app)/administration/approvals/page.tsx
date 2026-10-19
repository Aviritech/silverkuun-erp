import Link from "next/link";
import { EmptyState, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { administrationModule } from "@/modules/administration/module";
import { fullName, listBranches, type Member } from "@/modules/administration/queries";
import { dbFailure } from "@/lib/db-errors";

export default async function ApprovalsPage() {
  await requireModule(administrationModule);
  const staff = await requirePermission("members.approve");
  const supabase = await createClient();
  const [{ data, error }, branches] = await Promise.all([
    supabase
      .from("members")
      .select("id, branch_id, title, first_name, middle_name, last_name, submitted_at")
      .eq("status", "pending_approval")
      .order("submitted_at"),
    listBranches(),
  ]);
  if (error) throw dbFailure(error);
  const approvable = new Set(branches.filter((b) => staff.permissions.hasForBranch("members.approve", b)).map((b) => b.id));
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const files = (data as Member[]).filter((m) => approvable.has(m.branch_id));

  return (
    <div className="max-w-4xl">
      <PageHeader title="Approvals" description="Member files waiting for your review, oldest first." />
      <div className="rounded-xl border border-zinc-200 bg-white">
        {files.length === 0 ? (
          <EmptyState>Nothing is waiting for approval.</EmptyState>
        ) : (
          <ul>
            {files.map((m) => (
              <li key={m.id} className="flex items-center justify-between border-b border-zinc-100 px-5 py-3 last:border-0">
                <div>
                  <Link href={`/administration/members/${m.id}`} className="font-medium hover:underline">
                    {fullName(m)}
                  </Link>
                  <p className="text-xs text-zinc-500">
                    {branchName.get(m.branch_id)} · submitted {formatDateTime(m.submitted_at)}
                  </p>
                </div>
                <Link href={`/administration/members/${m.id}`} className="text-sm underline-offset-4 hover:underline">
                  Review
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
