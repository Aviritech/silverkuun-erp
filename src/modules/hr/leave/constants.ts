export const LEAVE_STATUSES = {
  pending: { label: "Waiting for approval", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Turned down", tone: "red" },
  cancelled: { label: "Cancelled", tone: "gray" },
} as const;
export type LeaveStatus = keyof typeof LEAVE_STATUSES;

/** Mirrors leave_request_steps.status. "waiting" is a step the request hasn't reached yet. */
export const STEP_STATUSES = {
  waiting: { label: "Not reached yet", tone: "gray" },
  pending: { label: "Waiting", tone: "amber" },
  approved: { label: "Approved", tone: "green" },
  rejected: { label: "Turned down", tone: "red" },
  skipped: { label: "Skipped", tone: "gray" },
} as const;
export type StepStatus = keyof typeof STEP_STATUSES;

/** Where an approver has to work, relative to the person asking for leave. */
export const APPROVAL_SCOPES = {
  branch: "Same branch",
  region: "Same region",
  organisation: "Anywhere",
} as const;
export type ApprovalScope = keyof typeof APPROVAL_SCOPES;

/** What employees may attach to their own request. The database allows only these two. */
export const EVIDENCE_TYPES = {
  medical_report: "Medical report",
  other: "Other supporting document",
} as const;

export const GENDERS = { female: "Women only", male: "Men only" } as const;

/** How far ahead the leave list looks for leave about to start. */
export const UPCOMING_DAYS = 14;
