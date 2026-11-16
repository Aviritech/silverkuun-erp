/** Documents a client can upload themselves on the sign-up page. Mirrors submit_member_signup(). */
export const CLIENT_DOCUMENTS = {
  nin_slip: "NIN slip",
  means_of_id: "Means of identification",
  utility_bill: "Utility bill (not older than 3 months)",
  passport_photo: "Passport photograph",
} as const;
export type ClientDocument = keyof typeof CLIENT_DOCUMENTS;

export const SIGNUP_BUCKET = "signup-uploads";
export const SIGNUP_MAX_BYTES = 10 * 1024 * 1024;
export const SIGNUP_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;

/** How long a link stays open. */
export const LINK_DAYS = [1, 3, 7] as const;

export const LINK_STATES = {
  open: { label: "Waiting for the client", tone: "blue" },
  used: { label: "Filled in", tone: "green" },
  expired: { label: "Expired", tone: "gray" },
  revoked: { label: "Switched off", tone: "gray" },
} as const;
export type LinkState = keyof typeof LINK_STATES;

/** First bytes of each file type we accept, so a renamed file can't pass as a PDF or a photo. */
export function looksLike(type: string, bytes: Uint8Array): boolean {
  const starts = (sig: number[]) => sig.every((b, i) => bytes[i] === b);
  if (type === "application/pdf") return starts([0x25, 0x50, 0x44, 0x46]);
  if (type === "image/jpeg") return starts([0xff, 0xd8, 0xff]);
  if (type === "image/png") return starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return false;
}
