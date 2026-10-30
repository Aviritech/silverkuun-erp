export const LOAN_STATUSES = {
  draft: { label: "Draft", tone: "gray" },
  submitted: { label: "Awaiting appraisal", tone: "amber" },
  appraised: { label: "Awaiting Head of Credit", tone: "amber" },
  credit_approved: { label: "Awaiting Head of Business", tone: "amber" },
  returned: { label: "Returned", tone: "red" },
  rejected: { label: "Rejected", tone: "red" },
  approved: { label: "Awaiting disbursement", tone: "blue" },
  active: { label: "Active", tone: "green" },
  closed: { label: "Repaid", tone: "gray" },
  cancelled: { label: "Cancelled", tone: "gray" },
} as const;
export type LoanStatus = keyof typeof LOAN_STATUSES;

export const CUSTOMER_CATEGORIES = {
  salary_earner: "Salary earner",
  business_owner: "Business owner or trader",
  self_employed: "Self-employed professional",
  other: "Other",
} as const;
export type CustomerCategory = keyof typeof CUSTOMER_CATEGORIES;

export const REPAYMENT_FREQUENCIES = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  end_of_term: "Once, at the end",
} as const;
export type RepaymentFrequency = keyof typeof REPAYMENT_FREQUENCIES;

export const INTEREST_METHODS = {
  flat: "Flat (on the full amount)",
  reducing_balance: "Reducing balance",
} as const;
export type InterestMethod = keyof typeof INTEREST_METHODS;

export const RATE_BASES = { per_month: "% a month", per_annum: "% a year" } as const;
export type RateBasis = keyof typeof RATE_BASES;

export const REPAYMENT_MODES = {
  salary_deduction: "Salary deduction",
  direct_debit: "Direct debit",
  bank_transfer: "Bank transfer",
  cash: "Cash",
  cheque: "Post-dated cheques",
} as const;
export type RepaymentMode = keyof typeof REPAYMENT_MODES;

export const LOAN_DOCUMENT_TYPES = {
  application_form: "Signed application form",
  proforma_invoice: "Proforma invoice",
  bank_statement: "Bank statement",
  payslip: "Payslip or income evidence",
  guarantor_form: "Guarantor's form",
  collateral_document: "Collateral document",
  credit_bureau_report: "Credit bureau report",
  offer_letter: "Signed offer letter",
  other: "Other",
} as const;
export type LoanDocumentType = keyof typeof LOAN_DOCUMENT_TYPES;

export const COLLATERAL_TYPES = {
  vehicle: "Vehicle",
  land_property: "Land or property",
  equipment: "Equipment",
  stock: "Stock or inventory",
  savings_lien: "Lien on savings",
  cash_deposit: "Cash deposit",
  other: "Other",
} as const;
export type CollateralType = keyof typeof COLLATERAL_TYPES;

export const BUREAU_RESULTS = {
  clear: "Clear: no adverse records",
  adverse: "Adverse records found",
  no_record: "No credit history",
  not_checked: "Not checked",
} as const;
export type BureauResult = keyof typeof BUREAU_RESULTS;

export const RISK_RATINGS = {
  low: { label: "Low risk", tone: "green" },
  medium: { label: "Medium risk", tone: "amber" },
  high: { label: "High risk", tone: "red" },
} as const;
export type RiskRating = keyof typeof RISK_RATINGS;

export const REMINDER_CHANNELS = {
  sms: "SMS",
  call: "Phone call",
  whatsapp: "WhatsApp",
  email: "Email",
  visit: "Visit",
} as const;
export type ReminderChannel = keyof typeof REMINDER_CHANNELS;

export const INSTALLMENT_STATUSES = {
  paid: { label: "Paid", tone: "green" },
  part_paid: { label: "Part paid", tone: "blue" },
  due: { label: "Due", tone: "gray" },
  overdue: { label: "Overdue", tone: "red" },
} as const;
export type InstallmentStatus = keyof typeof INSTALLMENT_STATUSES;

/**
 * Arrears buckets for the portfolio at risk, with a suggested provision on the principal outstanding.
 * The rates follow the CBN prudential guidelines for microfinance banks and are a starting point until Kuun confirms
 * its own impairment policy.
 */
export const ARREARS_BUCKETS = [
  { key: "current", label: "Current", minDays: 0, maxDays: 0, provision: 0.01 },
  { key: "d1_30", label: "1–30 days", minDays: 1, maxDays: 30, provision: 0.05 },
  { key: "d31_60", label: "31–60 days", minDays: 31, maxDays: 60, provision: 0.2 },
  { key: "d61_90", label: "61–90 days", minDays: 61, maxDays: 90, provision: 0.5 },
  { key: "d90_plus", label: "Over 90 days", minDays: 91, maxDays: Infinity, provision: 1 },
] as const;

export function arrearsBucket(daysPastDue: number) {
  return ARREARS_BUCKETS.find((b) => daysPastDue >= b.minDays && daysPastDue <= b.maxDays) ?? ARREARS_BUCKETS[0];
}

/** Repayments falling due within this many days show on the reminders list. */
export const REMINDER_WINDOW_DAYS = 7;

export const ALLOWED_LOAN_UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const MAX_LOAN_UPLOAD_BYTES = 10 * 1024 * 1024;
