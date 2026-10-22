export const TRAINING_STATUSES = {
  scheduled: { label: "Scheduled", tone: "blue" },
  completed: { label: "Completed", tone: "green" },
  cancelled: { label: "Cancelled", tone: "gray" },
} as const;
export type TrainingStatus = keyof typeof TRAINING_STATUSES;

export const ENROLMENT_STATUSES = {
  enrolled: { label: "Enrolled", tone: "blue" },
  completed: { label: "Completed", tone: "green" },
  no_show: { label: "Didn't attend", tone: "red" },
  withdrawn: { label: "Withdrew", tone: "gray" },
} as const;
export type EnrolmentStatus = keyof typeof ENROLMENT_STATUSES;

export const RATING_LABELS: Record<number, string> = {
  1: "1 – Poor",
  2: "2 – Fair",
  3: "3 – Good",
  4: "4 – Very good",
  5: "5 – Excellent",
};
