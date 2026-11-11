/** A row from top_up_list(): a member top up Accounts sent to a branch, with the names both sides need. */
export type TopUpRow = {
  id: string;
  top_up_no: string;
  branch_id: string;
  branch_name: string;
  amount: string;
  paid_on: string;
  payment_method: string;
  reference: string | null;
  bank_account_id: string | null;
  bank_account_name: string | null;
  paid_by: string;
  note: string | null;
  status: TopUpStatus;
  requested_by: string;
  requested_by_name: string;
  requested_at: string;
  member_id: string | null;
  member_name: string | null;
  membership_no: string | null;
  member_plan_id: string | null;
  plan_name: string | null;
  contribution_id: string | null;
  contribution_verified: boolean | null;
  /** Status of the receipt Accounts raised from it, once there is one. */
  contribution_status: string | null;
  logged_by_name: string | null;
  logged_at: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
};

export type TopUpStatus = "with_branch" | "logged" | "returned" | "cancelled";

export const TOP_UP_STATUSES: Record<TopUpStatus, { label: string; tone: "amber" | "green" | "red" | "gray" }> = {
  with_branch: { label: "With the branch", tone: "amber" },
  logged: { label: "Logged for the member", tone: "green" },
  returned: { label: "Sent back by the branch", tone: "red" },
  cancelled: { label: "Cancelled", tone: "gray" },
};

/** Where a logged top up is now: Branch Manager verification, ready for Accounts to post, raised, or posted. */
export function loggedStage(r: Pick<TopUpRow, "contribution_verified" | "contribution_status">): string {
  if (r.contribution_status === "posted") return "Posted to the member's savings";
  if (r.contribution_status) return "Receipt raised in Accounts, waiting for approval";
  return r.contribution_verified ? "Verified: ready to post in Savings pay-ins" : "Waiting for the Branch Manager to verify";
}
