import { z } from "zod";
import { MAX_SIGNATURE_DATA_URL_LENGTH, SIGNATURE_METHODS, SIGNER_ROLES } from "./constants";

export const eSignatureSchema = z
  .object({
    signer_role: z.enum(Object.keys(SIGNER_ROLES) as [keyof typeof SIGNER_ROLES], "Choose who is signing"),
    signer_name: z.string().trim().max(120, "Use at most 120 characters"),
    method: z.enum(Object.keys(SIGNATURE_METHODS) as [keyof typeof SIGNATURE_METHODS], "Draw or type the signature"),
    typed_text: z.string().trim().max(120, "Use at most 120 characters"),
    signature: z
      .string()
      .max(MAX_SIGNATURE_DATA_URL_LENGTH, "The signature is too large; clear it and sign again")
      .regex(/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/, "Sign in the box first"),
    consent: z.literal("on", "The signer must agree to sign electronically"),
  })
  .superRefine((v, ctx) => {
    // A staff member signs under the name on their login, so their name isn't asked for.
    if (v.signer_role !== "staff" && v.signer_name.length < 2) {
      ctx.addIssue({ code: "custom", path: ["signer_name"], message: "Enter the signer's full name" });
    }
    if (v.method === "typed" && v.typed_text.length < 2) {
      ctx.addIssue({ code: "custom", path: ["signature"], message: "Type the signature" });
    }
  });
