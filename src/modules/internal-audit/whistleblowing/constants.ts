/** What a concern is about. Mirrors whistleblowing_reports.category. */
export const SPEAK_UP_CATEGORIES = {
  fraud: "Fraud",
  corruption: "Bribery or corruption",
  harassment: "Harassment or bullying",
  discrimination: "Discrimination",
  safety: "Health and safety",
  theft: "Theft",
  misconduct: "Misconduct or breaking policy",
  other: "Something else",
} as const;
export type SpeakUpCategory = keyof typeof SPEAK_UP_CATEGORIES;

export const CASE_STATUSES = {
  received: { label: "Received", tone: "amber", reporterLabel: "Received, not yet picked up" },
  investigating: { label: "Investigating", tone: "blue", reporterLabel: "Being looked into" },
  resolved: { label: "Resolved", tone: "green", reporterLabel: "Closed: resolved" },
  dismissed: { label: "Dismissed", tone: "gray", reporterLabel: "Closed: no further action" },
} as const;
export type CaseStatus = keyof typeof CASE_STATUSES;

export const CLOSED_STATUSES: readonly CaseStatus[] = ["resolved", "dismissed"];

export type CaseMessage = { from_reporter: boolean; body: string; sent_on: string };

/** What a reporter sees about their own case. */
export type ReporterCase = {
  reference: string;
  title: string;
  status: CaseStatus;
  received_on: string;
  closed_on: string | null;
  outcome: string | null;
  messages: CaseMessage[];
};
