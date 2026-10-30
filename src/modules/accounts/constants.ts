export const FINANCE_STATUSES = {
  draft: { label: "Draft", tone: "gray" },
  submitted: { label: "Awaiting approval", tone: "amber" },
  returned: { label: "Returned", tone: "red" },
  rejected: { label: "Rejected", tone: "red" },
  approved: { label: "Approved, awaiting payment", tone: "blue" },
  posted: { label: "Posted", tone: "green" },
  reversed: { label: "Reversed", tone: "gray" },
} as const;
export type FinanceStatus = keyof typeof FINANCE_STATUSES;

export const DIRECTIONS = { receipt: "Receipt", payment: "Payment" } as const;
export type Direction = keyof typeof DIRECTIONS;

export const ACCOUNT_TYPES = {
  asset: "Asset",
  liability: "Liability",
  equity: "Accumulated funds / equity",
  income: "Income",
  expense: "Expense",
} as const;

export const CASH_FLOW_CLASSES = {
  cash: "Cash or bank",
  operating: "Operating",
  investing: "Investing",
  financing: "Financing",
} as const;

export const STATEMENT_LINE_STATUSES = {
  unmatched: { label: "Unmatched", tone: "amber" },
  matched: { label: "Matched", tone: "green" },
  excluded: { label: "Set aside", tone: "gray" },
} as const;

export const ATTACHMENT_KINDS = { supporting: "Supporting evidence", payment_proof: "Proof of payment" } as const;

export const ALLOWED_EVIDENCE_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
export const MAX_STATEMENT_BYTES = 5 * 1024 * 1024;

export const BILL_STATUSES = {
  draft: { label: "Draft", tone: "gray" },
  submitted: { label: "Awaiting approval", tone: "amber" },
  returned: { label: "Returned", tone: "red" },
  rejected: { label: "Rejected", tone: "red" },
  posted: { label: "Approved and posted", tone: "green" },
} as const;
export type BillStatus = keyof typeof BILL_STATUSES;

export const SUGGESTION_CONFIDENCE = {
  high: { label: "High confidence", tone: "green" },
  medium: { label: "Medium confidence", tone: "amber" },
  low: { label: "Low confidence", tone: "gray" },
} as const;

/** Supplier payables control account; approved bills credit it and supplier payments debit it. */
export const SUPPLIER_PAYABLES_ACCOUNT = "2210";
export const INTEREST_EXPENSE_ACCOUNT = "5100";
export const ROI_PAYABLE_ACCOUNT = "2140";

export const COMMON_CURRENCIES = ["NGN", "USD", "GBP", "EUR"] as const;
