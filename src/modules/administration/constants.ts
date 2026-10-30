export const MEMBER_STATUSES = {
  draft: { label: "Draft", tone: "gray" },
  with_marketer: { label: "With the marketer", tone: "blue" },
  marketer_reviewed: { label: "Back with the officer", tone: "amber" },
  pending_approval: { label: "With the Branch Manager", tone: "amber" },
  returned: { label: "Returned", tone: "red" },
  approved: { label: "Approved", tone: "green" },
} as const;
export type MemberStatus = keyof typeof MEMBER_STATUSES;

export const DOCUMENT_TYPES = {
  kyc_form: "KYC form",
  nin_slip: "NIN slip",
  means_of_id: "Means of identification",
  utility_bill: "Utility bill",
  passport_photo: "Passport photograph",
  signed_agreement_letter: "Signed agreement letter",
  statement_of_account: "Statement of account",
  maturity_letter: "Maturity and liquidation letter",
  other: "Other",
} as const;
export type DocumentType = keyof typeof DOCUMENT_TYPES;

/** Letters and statements sent to the member; each records when and how it was issued. Mirrors record_document_issue(). */
export const ISSUED_DOCUMENT_TYPES: DocumentType[] = ["signed_agreement_letter", "statement_of_account", "maturity_letter"];

export const ISSUE_CHANNELS = {
  in_person: "Handed over in person",
  email: "Email",
  whatsapp: "WhatsApp",
  courier: "Courier",
} as const;
export type IssueChannel = keyof typeof ISSUE_CHANNELS;

/** The signature drawn on approval is stored as a PNG data URL. Mirrors approve_member(). */
export const MAX_SIGNATURE_LENGTH = 200_000;

/** Statuses in which the officer can edit the file and its documents. Mirrors the members update policy. */
export const OFFICER_EDITABLE: MemberStatus[] = ["draft", "returned", "marketer_reviewed"];

/** Must all be uploaded before a file can go to the Branch Manager. Mirrors submit_member() in the database. */
export const REQUIRED_DOCUMENTS: DocumentType[] = ["kyc_form", "nin_slip", "means_of_id", "utility_bill"];

export const ID_TYPES = {
  national_id: "National ID card",
  drivers_licence: "Driver's licence",
  international_passport: "International passport",
  voters_card: "Voter's card",
} as const;

export const FREQUENCIES = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  one_off: "One-off",
} as const;

export const PAYMENT_METHODS = {
  bank_transfer: "Bank transfer",
  cash: "Cash",
  pos: "POS",
  cheque: "Cheque",
} as const;

export const CONTRIBUTION_KINDS = {
  scheduled: "Contribution",
  top_up: "Top-up",
  reversal: "Reversal",
} as const;

export const ALLOWED_UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
