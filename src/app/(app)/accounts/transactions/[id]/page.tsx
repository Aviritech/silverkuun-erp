import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { listOrg } from "@/lib/org";
import {
  approveTransaction,
  declineTransaction,
  payTransaction,
  submitTransaction,
  uploadEvidence,
} from "@/modules/accounts/actions";
import { ReasonForm } from "@/modules/accounts/components/reason-form";
import { UploadForm } from "@/modules/accounts/components/upload-form";
import { ATTACHMENT_KINDS, DIRECTIONS, FINANCE_STATUSES } from "@/modules/accounts/constants";
import { accountsModule } from "@/modules/accounts/module";
import { getTransactionBundle, listLedgerAccounts } from "@/modules/accounts/queries";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || "—"}</dd>
    </div>
  );
}

export default async function TransactionPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireModule(accountsModule);
  const { id } = await params;
  const bundle = await getTransactionBundle(id);
  if (!bundle) notFound();
  const { txn, rule, bank, attachments, lines, staffName, memberName } = bundle;
  const [org, accounts] = await Promise.all([listOrg(), lines.length ? listLedgerAccounts() : Promise.resolve([])]);
  const branch = org.branches.find((b) => b.id === txn.branch_id)!;
  const accountName = new Map(accounts.map((a) => [a.code, a.name]));
  const can = (p: string) => staff.permissions.hasForBranch(p, branch);

  const recordPermission = txn.direction === "receipt" ? "accounts.receipts.record" : "accounts.payments.request";
  const editable = ["draft", "returned"].includes(txn.status);
  const isOwner = txn.created_by === staff.id;
  const isPreparer = isOwner || txn.submitted_by === staff.id;
  const canReview = txn.status === "submitted" && can("accounts.transactions.approve") && !isPreparer;
  const canPay = txn.direction === "payment" && txn.status === "approved" && can("accounts.payments.pay") && txn.approved_by !== staff.id;
  const status = FINANCE_STATUSES[txn.status];
  const supporting = attachments.filter((a) => a.kind === "supporting");
  const needsEvidence = !txn.contribution_id && !txn.statement_line_id && supporting.length === 0;

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title={`${DIRECTIONS[txn.direction]} ${txn.txn_no}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <span>{rule.name}</span>
            <span>· {branch.name}</span>
          </span>
        }
        actions={
          editable &&
          isOwner && (
            <ButtonLink href={`/accounts/transactions/${txn.id}/edit`} variant="secondary">
              Edit
            </ButtonLink>
          )
        }
      />

      {txn.decision_reason && ["returned", "rejected", "reversed"].includes(txn.status) && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-medium">{txn.status === "returned" ? "Returned for correction" : txn.status === "rejected" ? "Rejected" : "Reversed"}</p>
          <p className="mt-1">{txn.decision_reason}</p>
        </div>
      )}

      <Card title="Details">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Detail label="Amount">
            <span className="text-base font-semibold">{formatMoney(txn.amount)}</span>
            {Number(txn.interest_amount) > 0 && <span className="block text-xs text-zinc-500">of which interest {formatMoney(txn.interest_amount)}</span>}
          </Detail>
          <Detail label="Date">{formatDate(txn.txn_date)}</Detail>
          <Detail label={txn.direction === "receipt" ? "Paid into" : "Paid from"}>
            {bank.name} <span className="text-xs text-zinc-500">({bank.ledger_account_code})</span>
          </Detail>
          <Detail label="Member">{memberName}</Detail>
          <Detail label={txn.direction === "receipt" ? "Received from" : "Beneficiary"}>{txn.counterparty}</Detail>
          <Detail label="Reference">{txn.reference}</Detail>
          <div className="sm:col-span-3">
            <Detail label="Description">{txn.description}</Detail>
          </div>
          {txn.contribution_id && (
            <div className="sm:col-span-3">
              <Detail label="Source">A contribution verified in Administration</Detail>
            </div>
          )}
          {txn.statement_line_id && (
            <div className="sm:col-span-3">
              <Detail label="Source">
                <Link href={`/accounts/bank/${txn.bank_account_id}`} className="underline">
                  A line on the bank statement
                </Link>
              </Detail>
            </div>
          )}
        </dl>
      </Card>

      <Card title="Approval trail">
        <ol className="space-y-1 text-sm">
          <li>Prepared by {staffName(txn.created_by)} on {formatDateTime(txn.created_at)}</li>
          {txn.submitted_at && <li>Submitted by {staffName(txn.submitted_by)} on {formatDateTime(txn.submitted_at)}</li>}
          {txn.approved_at && <li>{txn.direction === "receipt" ? "Confirmed" : "Approved"} by {staffName(txn.approved_by)} on {formatDateTime(txn.approved_at)}</li>}
          {txn.paid_at && <li>Paid by {staffName(txn.paid_by)} on {formatDateTime(txn.paid_at)}</li>}
          {txn.posted_at && <li>Posted to the ledger on {formatDateTime(txn.posted_at)}</li>}
        </ol>
        <div className="mt-4 flex flex-wrap items-start gap-3">
          {editable && can(recordPermission) && (
            needsEvidence ? (
              <p className="text-sm text-amber-800">Attach the supporting evidence below, then submit for approval.</p>
            ) : (
              <ActionButton action={submitTransaction.bind(null, txn.id)} label="Submit for approval" pendingLabel="Submitting…" />
            )
          )}
          {canReview && (
            <>
              <ActionButton
                action={approveTransaction.bind(null, txn.id)}
                label={txn.direction === "receipt" ? "Confirm and post" : "Approve payment"}
                pendingLabel="Approving…"
                confirm={txn.direction === "receipt" ? "Post this receipt to the ledger?" : "Approve this payment?"}
              />
              <ReasonForm action={declineTransaction.bind(null, txn.id, "returned")} openLabel="Return for correction" submitLabel="Return" question="What needs correcting?" variant="secondary" />
              <ReasonForm action={declineTransaction.bind(null, txn.id, "rejected")} openLabel="Reject" submitLabel="Reject" question="Why is this being rejected?" />
            </>
          )}
          {txn.status === "submitted" && isPreparer && <p className="text-sm text-zinc-600">Waiting for someone else to review it.</p>}
          {canPay &&
            (attachments.some((a) => a.kind === "payment_proof") ? (
              <ActionButton action={payTransaction.bind(null, txn.id)} label="Mark as paid and post" pendingLabel="Posting…" confirm="Confirm the money has gone out and post this payment?" />
            ) : (
              <p className="text-sm text-amber-800">Attach the proof of payment below to mark this as paid.</p>
            ))}
          {txn.direction === "payment" && txn.status === "approved" && txn.approved_by === staff.id && (
            <p className="text-sm text-zinc-600">You approved this payment, so someone else must make it.</p>
          )}
        </div>
      </Card>

      <Card title="Evidence">
        {attachments.length === 0 ? (
          <EmptyState>No documents yet.</EmptyState>
        ) : (
          <ul className="mb-4 divide-y divide-zinc-100 text-sm">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2">
                <span>
                  <span className="font-medium">{ATTACHMENT_KINDS[a.kind]}</span> · {a.file_name}
                  <span className="block text-xs text-zinc-500">
                    {staffName(a.uploaded_by)}, {formatDateTime(a.uploaded_at)}
                  </span>
                </span>
                {a.url ? (
                  <a href={a.url} target="_blank" rel="noreferrer" className="underline">
                    View
                  </a>
                ) : (
                  <span className="text-xs text-zinc-500">File not available</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {editable && can(recordPermission) && (
          <UploadForm action={uploadEvidence.bind(null, txn.id, "supporting")} label="Add supporting evidence (PDF, JPEG or PNG)" />
        )}
        {canPay && <UploadForm action={uploadEvidence.bind(null, txn.id, "payment_proof")} label="Add proof of payment (transfer receipt or teller)" />}
      </Card>

      {lines.length > 0 && (
        <Card
          title="Ledger posting"
          actions={
            txn.journal_entry_id && (
              <Link href={`/accounts/journals/${txn.journal_entry_id}`} className="text-sm underline">
                Open journal
              </Link>
            )
          }
        >
          <table className="w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 font-medium">Account</th>
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
                  <td className="py-1.5 text-right tabular-nums">{Number(l.debit) ? formatMoney(l.debit) : ""}</td>
                  <td className="py-1.5 text-right tabular-nums">{Number(l.credit) ? formatMoney(l.credit) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
