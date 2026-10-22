export const EMPLOYEE_STATUSES = {
  probation: { label: "On probation", tone: "amber" },
  active: { label: "Active", tone: "green" },
  resigned: { label: "Resigned", tone: "gray" },
  terminated: { label: "Terminated", tone: "red" },
} as const;
export type EmployeeStatus = keyof typeof EMPLOYEE_STATUSES;

export const EMPLOYMENT_TYPES = {
  permanent: "Permanent",
  contract: "Contract",
  intern: "Intern",
  consultant: "Consultant",
} as const;

export const MARITAL_STATUSES = {
  single: "Single",
  married: "Married",
  divorced: "Divorced",
  widowed: "Widowed",
} as const;

export const ID_TYPES = {
  national_id: "National ID card",
  drivers_licence: "Driver's licence",
  international_passport: "International passport",
  voters_card: "Voter's card",
} as const;

/** What happened, as written on the job history. Mirrors employee_job_history.event. */
export const JOB_EVENTS = {
  joined: "Joined",
  confirmed: "Confirmed",
  transfer: "Transfer",
  promotion: "Promotion",
  redeployment: "Redeployment",
  resigned: "Resigned",
  terminated: "Terminated",
  reinstated: "Reinstated",
} as const;
export type JobEvent = keyof typeof JOB_EVENTS;

/** The changes the Head of HR can make with change_employee_job(). */
export const JOB_CHANGES = {
  transfer: "Transfer (another branch or department)",
  promotion: "Promotion",
  redeployment: "Redeployment (new role, same level)",
} as const;

export const EXIT_KINDS = {
  resigned: "Resigned",
  terminated: "Terminated",
} as const;

export const CONTRACT_TYPES = {
  permanent: "Permanent",
  fixed_term: "Fixed term",
  probation: "Probation",
  internship: "Internship",
  consultancy: "Consultancy",
} as const;
export type ContractType = keyof typeof CONTRACT_TYPES;

export const RELATIONSHIPS = {
  spouse: "Spouse",
  child: "Child",
  parent: "Parent",
  sibling: "Sibling",
  other: "Other",
} as const;

export const QUALIFICATION_KINDS = {
  education: "Education",
  professional: "Professional certification",
} as const;

export const DOCUMENT_TYPES = {
  passport_photo: "Passport photograph",
  cv: "CV",
  offer_letter: "Offer letter",
  acceptance_letter: "Acceptance letter",
  employment_contract: "Employment contract",
  id_document: "Means of identification",
  certificate: "Certificate",
  guarantor_form: "Guarantor form",
  reference_letter: "Reference letter",
  medical_report: "Medical report",
  query_letter: "Query letter",
  exit_letter: "Resignation or exit letter",
  other: "Other",
} as const;
export type DocumentType = keyof typeof DOCUMENT_TYPES;

export const ALLOWED_UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** How far ahead the overview looks for probations and contracts coming to an end. */
export const WATCH_DAYS = 30;
