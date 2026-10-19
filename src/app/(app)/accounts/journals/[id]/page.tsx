import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { Badge, Card, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import { deleteJournal, postJournal, reverseJournal } from "@/modules/accounts/actions";
import { ReasonForm } from "@/modules/accounts/components/reason-form";
import { accountsModule } from "@/modules/accounts/module";
import { getJournalBundle } from "@/modules/accounts/queries";

export default async function JournalPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireModule(accountsModule);
  const { id } = await params;
  const bundle = await getJournalBundle(id);
  if (!bundle) notFound();
  const { entry, lines, accountName, entryNo, staffName, members } = bundle;
  const org = await listOrg();
  const branch = org.branches.find((b) => b.id === entry.branch_id)!;
  const canPost = staff.permissions.hasForBranch("accounts.journals.post", branch);
  const debit = lines.reduce((s, l) => s + Number(l.debit), 0);
  const credit = lines.reduce((s, l) => s + Number(l.credit), 0);

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title={`Journal ${entry.entry_no}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {entry.status === "draft" ? <Badge tone="amber">Draft</Badge> : entry.reversed_by_entry_id ? <Badge tone="gray">Reversed</Badge> : <Badge tone="green">Posted</Badge>}
            <span>{formatDate(entry.entry_date)}</span>
            <span>· {branch.name}</span>
          </span>
        }
      />
      <Card title={entry.description}>
        <table className="w-full text-left text-sm">
          <thead className="text-zinc-500">
            <tr>
              <th className="py-1 font-medium">Account</th>
              <th className="py-1 font-medium">Member</th>
              <th className="py-1 font-medium">Note</th>
              <th className="py-1 text-right font-medium">Debit</th>
              <th className="py-1 text-right font-medium">Credit</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-zinc-100">
                <td className="py-1.5">
                  {l.account_code} {accountName.get(l.account_code)}
                </td>
                <td className="py-1.5">{l.member_id ? (members.get(l.member_id) ?? "A member") : ""}</td>
                <td className="py-1.5">{l.description}</td>
                <td className="py-1.5 text-right tabular-nums">{Number(l.debit) ? formatMoney(l.debit) : ""}</td>
                <td className="py-1.5 text-right tabular-nums">{Number(l.credit) ? formatMoney(l.credit) : ""}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-zinc-300 font-medium">
              <td className="py-1.5" colSpan={3}>
                Total {Math.round(debit * 100) === Math.round(credit * 100) ? "(balanced)" : "(not balanced)"}
              </td>
              <td className="py-1.5 text-right tabular-nums">{formatMoney(debit)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatMoney(credit)}</td>
            </tr>
          </tbody>
        </table>
      </Card>
      <Card title="History">
        <ul className="space-y-1 text-sm">
          <li>Prepared by {staffName(entry.created_by)} on {formatDateTime(entry.created_at)}</li>
          {entry.posted_at && <li>Posted by {staffName(entry.posted_by)} on {formatDateTime(entry.posted_at)}</li>}
          {entry.transaction_id && (
            <li>
              Written by the{" "}
              <Link href={`/accounts/transactions/${entry.transaction_id}`} className="underline">
                receipt or payment
              </Link>{" "}
              it records.
            </li>
          )}
          {entry.reverses_entry_id && (
            <li>
              Reverses{" "}
              <Link href={`/accounts/journals/${entry.reverses_entry_id}`} className="underline">
                {entryNo.get(entry.reverses_entry_id) ?? "the original entry"}
              </Link>
              : {entry.reversal_reason}
            </li>
          )}
          {entry.reversed_by_entry_id && (
            <li>
              Reversed by{" "}
              <Link href={`/accounts/journals/${entry.reversed_by_entry_id}`} className="underline">
                {entryNo.get(entry.reversed_by_entry_id) ?? "a later entry"}
              </Link>
              : {entry.reversal_reason}
            </li>
          )}
        </ul>
        <div className="mt-4 flex flex-wrap gap-3">
          {entry.status === "draft" && canPost && entry.created_by !== staff.id && (
            <ActionButton action={postJournal.bind(null, entry.id)} label="Post to the ledger" pendingLabel="Posting…" confirm="Post this journal? Posted entries are locked." />
          )}
          {entry.status === "draft" && entry.created_by === staff.id && (
            <>
              <p className="text-sm text-zinc-600">Someone else with permission to post journals must post it.</p>
              <ActionButton action={deleteJournal.bind(null, entry.id)} label="Delete draft" variant="danger" confirm="Delete this draft journal?" />
            </>
          )}
          {entry.status === "posted" && canPost && !entry.reversed_by_entry_id && !entry.reverses_entry_id && (
            <ReasonForm action={reverseJournal.bind(null, entry.id)} openLabel="Reverse entry" submitLabel="Post reversal" question="Why is this entry being reversed?" />
          )}
        </div>
      </Card>
    </div>
  );
}
