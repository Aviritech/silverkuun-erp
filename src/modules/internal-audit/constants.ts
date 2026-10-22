export const EXCEPTION_CATEGORIES = {
  incomplete_kyc: "Incomplete KYC",
  stale_approval: "Member file waiting for approval",
  unverified_payment: "Unverified contribution",
  adjustment: "Adjustment or reversal",
  approved_record_changed: "Approved record changed",
  large_transaction: "Large transaction",
  segregation_breach: "Same person prepared and approved",
  unmatched_bank_line: "Unmatched bank line",
  unidentified_receipt: "Unidentified deposit not cleared",
  stale_finance_approval: "Finance approval overdue",
  unbalanced_journal: "Unbalanced journal",
  deletion: "Record deleted",
  overdue_loan: "Overdue loan",
  stale_loan_application: "Loan application waiting",
  loan_not_disbursed: "Approved loan not paid out",
} as const;
export type ExceptionCategory = keyof typeof EXCEPTION_CATEGORIES;

export const SEVERITIES = {
  high: { label: "High", tone: "red" },
  medium: { label: "Medium", tone: "amber" },
  low: { label: "Low", tone: "gray" },
} as const;
export type Severity = keyof typeof SEVERITIES;

/** Contributions or finance transactions at or above this amount are flagged for review. */
export const LARGE_TRANSACTION_NAIRA = 1_000_000;

/** Where to open a record an exception or audit entry points at. */
export function recordHref(recordType: string, recordId: string | null): string | undefined {
  if (!recordId) return undefined;
  switch (recordType) {
    case "member":
    case "members":
      return `/administration/members/${recordId}`;
    case "finance_transaction":
    case "finance_transactions":
      return `/accounts/transactions/${recordId}`;
    case "loan":
    case "loans":
      return `/credit/loans/${recordId}`;
    case "journal_entry":
    case "journal_entries":
      return `/accounts/journals/${recordId}`;
    case "employees":
      return `/hr/employees/${recordId}`;
    default:
      return `/internal-audit/trace/${recordId}`;
  }
}

export const AUDITED_TABLES: Record<string, string> = {
  members: "Members",
  member_documents: "Member documents",
  member_plans: "Member plans",
  contributions: "Contributions",
  finance_transactions: "Receipts and payments",
  finance_attachments: "Finance evidence",
  journal_entries: "Journal entries",
  journal_lines: "Journal lines",
  bank_accounts: "Bank accounts",
  bank_statement_imports: "Statement imports",
  bank_statement_lines: "Statement lines",
  bank_matches: "Bank matches",
  bank_reconciliations: "Bank reconciliations",
  loans: "Loans",
  loan_guarantors: "Loan guarantors",
  loan_collaterals: "Loan collateral",
  loan_documents: "Loan documents",
  loan_installments: "Loan schedules",
  loan_repayments: "Loan repayments",
  loan_restructures: "Loan restructures",
  loan_reminders: "Loan reminders",
  loan_products: "Loan products",
  ledger_accounts: "Chart of accounts",
  posting_rules: "Posting rules",
  employees: "Employees",
  employee_job_history: "Employee job history",
  employee_contracts: "Employment contracts",
  employee_documents: "Employee documents",
  employee_dependents: "Employee dependents",
  employee_qualifications: "Employee qualifications",
  job_titles: "Job titles",
  staff: "Staff",
  staff_roles: "Staff roles",
  branches: "Branches",
  regions: "Regions",
};
