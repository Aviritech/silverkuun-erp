export const REVIEW_STATUSES = {
  draft: { label: "Draft", tone: "gray" },
  submitted: { label: "Waiting for the employee", tone: "amber" },
  acknowledged: { label: "Acknowledged", tone: "green" },
} as const;
export type ReviewStatus = keyof typeof REVIEW_STATUSES;

/** Offered when adding a score; reviewers can type their own instead. */
export const SUGGESTED_CRITERIA = ["Productivity", "Quality of work", "Teamwork", "Communication", "Problem solving", "Punctuality"];

export const SCORE_LABELS: Record<number, string> = {
  1: "1 – Poor",
  2: "2 – Below expectations",
  3: "3 – Meets expectations",
  4: "4 – Above expectations",
  5: "5 – Outstanding",
};

/** What an overall score (the average of 1–5 scores) means. */
export function scoreBand(score: number | string | null | undefined): { label: string; tone: "green" | "blue" | "amber" | "red" } | null {
  if (score === null || score === undefined || score === "") return null;
  const s = Number(score);
  if (s >= 4.5) return { label: "Excellent", tone: "green" };
  if (s >= 4) return { label: "Very good", tone: "green" };
  if (s >= 3.5) return { label: "Good", tone: "blue" };
  if (s >= 3) return { label: "Satisfactory", tone: "blue" };
  if (s >= 2.5) return { label: "Needs improvement", tone: "amber" };
  return { label: "Poor", tone: "red" };
}

export const GOAL_TYPES = {
  performance: "Performance",
  development: "Personal development",
  project: "Project",
  sales: "Sales",
  customer_satisfaction: "Customer satisfaction",
  innovation: "Innovation",
} as const;
export type GoalType = keyof typeof GOAL_TYPES;

export const GOAL_STATUSES = {
  open: { label: "Open", tone: "blue" },
  completed: { label: "Completed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "gray" },
} as const;
export type GoalStatus = keyof typeof GOAL_STATUSES;
