/** Who signs electronically. Mirrors public.signer_role. */
export const SIGNER_ROLES = {
  member: "Member",
  guarantor: "Guarantor",
  staff: "Staff (yourself)",
  witness: "Witness",
} as const;
export type SignerRole = keyof typeof SIGNER_ROLES;

export const SIGNATURE_METHODS = { drawn: "Drawn", typed: "Typed" } as const;
export type SignatureMethod = keyof typeof SIGNATURE_METHODS;

/** The signature image is a PNG of the signature box; the "e-signatures" bucket takes at most 512 KB. */
export const MAX_SIGNATURE_BYTES = 524_288;
/** A base64 data URL is about a third bigger than the image itself. */
export const MAX_SIGNATURE_DATA_URL_LENGTH = 720_000;

export const SIGNATURE_BUCKET = "e-signatures";
