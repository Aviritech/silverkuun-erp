/** What every form action returns. Row level security and the database functions make the final decision. */
export type ActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: boolean;
  message?: string;
  /** Shown once and never stored, such as a temporary password. */
  secret?: string;
};
