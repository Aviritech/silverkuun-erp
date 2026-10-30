import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { ReasonForm } from "@/modules/accounts/components/reason-form";
import { confirmReceipt, returnReceipt } from "@/modules/administration/actions";
import { ConfirmReceiptForm } from "@/modules/administration/components/forms";
import { administrationModule } from "@/modules/administration/module";

type Receipt = {
  id: string;
  txn_no: string;
  txn_date: string;
  amount: string;
  type_name: string;
  reference: string | null;
  counterparty: string | null;
  description: string;
  bank_account_name: string;
  member_id: string;
  member_name: string;
  membership_no: string | null;
  plan_name: string | null;
  recorded_by: string;
  recorded_by_name: string;
  submitted_at: string;
};

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || "—"}</dd>
    </div>
  );
}

export default async function ReceiptsToCheckPage() {
  const staff = await requireModule(administrationModule);
  if (!staff.permissions.has("receipts.confirm")) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receipts_to_confirm");
  if (error) throw dbFailure(error);
  const receipts = data as Receipt[];

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Receipts to check"
        description="Money Accounts recorded for members. Check the amount, member and plan against the member's records, then confirm it or send it back. Accounts can only post it after you confirm."
      />
      {receipts.length === 0 && (
        <Card>
          <EmptyState>Nothing is waiting.</EmptyState>
        </Card>
      )}
      {receipts.map((r) => (
        <Card key={r.id} title={`${r.txn_no} · ${formatMoney(r.amount)}`}>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Detail label="Member">
              <Link href={`/administration/members/${r.member_id}?tab=plans`} className="underline-offset-4 hover:underline">
                {r.member_name}
              </Link>
              {r.membership_no && <span className="block text-xs text-zinc-500">{r.membership_no}</span>}
            </Detail>
            <Detail label="Savings plan">{r.plan_name ?? (r.type_name.includes("capital") ? "Capital contribution" : null)}</Detail>
            <Detail label="What was received">{r.type_name}</Detail>
            <Detail label="Date paid">{formatDate(r.txn_date)}</Detail>
            <Detail label="Paid into">{r.bank_account_name}</Detail>
            <Detail label="Reference">{r.reference}</Detail>
            <Detail label="Received from">{r.counterparty}</Detail>
            <Detail label="Recorded by">
              {r.recorded_by_name}
              <span className="block text-xs text-zinc-500">sent {formatDateTime(r.submitted_at)}</span>
            </Detail>
            <Detail label="Description">{r.description}</Detail>
          </dl>
          {r.recorded_by === staff.id ? (
            <p className="mt-4 text-sm text-zinc-600">You recorded this receipt, so someone else in Operations must check it.</p>
          ) : (
            <div className="mt-4 flex flex-wrap items-start gap-3">
              <ConfirmReceiptForm action={confirmReceipt.bind(null, r.id)} />
              <ReasonForm
                action={returnReceipt.bind(null, r.id)}
                openLabel="Doesn't match"
                submitLabel="Send back to Accounts"
                question="What doesn't match the member's records?"
                variant="secondary"
              />
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
