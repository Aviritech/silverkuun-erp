import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { Badge, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { listDimensions, listOrg } from "@/lib/org";
import { approveBill, declineBill, submitBill, uploadBillInvoice } from "@/modules/accounts/actions";
import { ReasonForm } from "@/modules/accounts/components/reason-form";
import { UploadForm } from "@/modules/accounts/components/upload-form";
import { BILL_STATUSES, FINANCE_STATUSES, SUPPLIER_PAYABLES_ACCOUNT } from "@/modules/accounts/constants";
import { accountsModule } from "@/modules/accounts/module";
import { getBillBundle } from "@/modules/accounts/queries";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || "—"}</dd>
    </div>
  );
}

export default async function BillPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireModule(accountsModule);
  const { id } = await params;
  const bundle = await getBillBundle(id);
  if (!bundle) notFound();
  const { bill, supplier, paid, outstanding, attachments, payments, accountName, staffName } = bundle;
  const [org, dimensions] = await Promise.all([listOrg(), listDimensions()]);
  const branch = org.branches.find((b) => b.id === bill.branch_id)!;
  const can = (p: string) => staff.permissions.hasForBranch(p, branch);
  const editable = ["draft", "returned"].includes(bill.status);
  const isOwner = bill.created_by === staff.id;
  const canReview = bill.status === "submitted" && can("accounts.transactions.approve") && !isOwner && bill.submitted_by !== staff.id;
  const status = BILL_STATUSES[bill.status];
  const owed = Number(outstanding);

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title={`Bill ${bill.bill_no}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <span>{supplier.name}</span>
            <span>· {branch.name}</span>
          </span>
        }
        actions={
          <>
            {editable && isOwner && (
              <ButtonLink href={`/accounts/bills/${bill.id}/edit`} variant="secondary">
                Edit
              </ButtonLink>
            )}
            {bill.status === "posted" && owed > 0 && can("accounts.payments.request") && (
              <ButtonLink href={`/accounts/transactions/new?bill=${bill.id}`}>Pay this bill</ButtonLink>
            )}
          </>
        }
      />

      {bill.decision_reason && ["returned", "rejected"].includes(bill.status) && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-medium">{bill.status === "returned" ? "Returned for correction" : "Rejected"}</p>
          <p className="mt-1">{bill.decision_reason}</p>
        </div>
      )}

      <Card title="Details">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Detail label="Amount">
            <span className="text-base font-semibold">{formatMoney(bill.amount)}</span>
          </Detail>
          <Detail label="Paid">{bill.status === "posted" ? formatMoney(paid) : null}</Detail>
          <Detail label="Still owed">
            {bill.status === "posted" ? <span className={owed > 0 ? "font-medium" : ""}>{formatMoney(outstanding)}</span> : null}
          </Detail>
          <Detail label="Supplier's invoice">{bill.supplier_reference}</Detail>
          <Detail label="Invoice date">{formatDate(bill.bill_date)}</Detail>
          <Detail label="Due">{formatDate(bill.due_date)}</Detail>
          <Detail label="Charged to">
            {bill.expense_account} {accountName.get(bill.expense_account)}
          </Detail>
          <Detail label="Department">{dimensions.departments.find((d) => d.code === bill.department_code)?.name}</Detail>
          <Detail label="Supplier bank">{[supplier.bank_name, supplier.account_number].filter(Boolean).join(" ")}</Detail>
          <div className="sm:col-span-3">
            <Detail label="Description">{bill.description}</Detail>
          </div>
        </dl>
        {bill.status !== "posted" && (
          <p className="mt-4 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            On approval this posts as: debit {bill.expense_account} {accountName.get(bill.expense_account)}, credit {SUPPLIER_PAYABLES_ACCOUNT}{" "}
            {accountName.get(SUPPLIER_PAYABLES_ACCOUNT)}.
          </p>
        )}
      </Card>

      <Card title="Approval trail">
        <ol className="space-y-1 text-sm">
          <li>Recorded by {staffName(bill.created_by)} on {formatDateTime(bill.created_at)}</li>
          {bill.submitted_at && <li>Submitted by {staffName(bill.submitted_by)} on {formatDateTime(bill.submitted_at)}</li>}
          {bill.approved_at && (
            <li>
              Approved and posted by {staffName(bill.approved_by)} on {formatDateTime(bill.approved_at)}
              {bill.journal_entry_id && (
                <>
                  {" "}
                  ·{" "}
                  <Link href={`/accounts/journals/${bill.journal_entry_id}`} className="underline">
                    journal
                  </Link>
                </>
              )}
            </li>
          )}
        </ol>
        <div className="mt-4 flex flex-wrap items-start gap-3">
          {editable && isOwner &&
            (attachments.length === 0 ? (
              <p className="text-sm text-amber-800">Attach the supplier&apos;s invoice below, then submit for approval.</p>
            ) : (
              <ActionButton action={submitBill.bind(null, bill.id)} label="Submit for approval" pendingLabel="Submitting…" />
            ))}
          {canReview && (
            <>
              <ActionButton
                action={approveBill.bind(null, bill.id)}
                label="Approve and post"
                pendingLabel="Posting…"
                confirm="Approve this bill and post it to supplier payables?"
              />
              <ReasonForm action={declineBill.bind(null, bill.id, "returned")} openLabel="Return for correction" submitLabel="Return" question="What needs correcting?" variant="secondary" />
              <ReasonForm action={declineBill.bind(null, bill.id, "rejected")} openLabel="Reject" submitLabel="Reject" question="Why is this being rejected?" />
            </>
          )}
          {bill.status === "submitted" && (isOwner || bill.submitted_by === staff.id) && (
            <p className="text-sm text-zinc-600">Waiting for someone else to review it.</p>
          )}
        </div>
      </Card>

      <Card title="Supplier's invoice">
        {attachments.length === 0 ? (
          <EmptyState>No invoice attached yet.</EmptyState>
        ) : (
          <ul className="mb-4 divide-y divide-zinc-100 text-sm">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center justify-between py-2">
                <span>
                  {a.file_name}
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
        {editable && isOwner && <UploadForm action={uploadBillInvoice.bind(null, bill.id)} label="Add the invoice (PDF, JPEG or PNG)" />}
      </Card>

      {payments.length > 0 && (
        <Card title="Payments against this bill">
          <ul className="divide-y divide-zinc-100 text-sm">
            {payments.map((p) => (
              <li key={p.id} className="flex justify-between py-2">
                <Link href={`/accounts/transactions/${p.id}`} className="font-mono text-xs hover:underline">
                  {p.txn_no}
                </Link>
                <span>{formatDate(p.txn_date)}</span>
                <span className="tabular-nums">{formatMoney(p.amount)}</span>
                <Badge tone={FINANCE_STATUSES[p.status].tone}>{FINANCE_STATUSES[p.status].label}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
