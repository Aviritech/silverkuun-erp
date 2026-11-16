import { z } from "zod";
import { memberSchema } from "@/modules/administration/schemas";
import { CLIENT_DOCUMENTS, LINK_DAYS, SIGNUP_MAX_BYTES, SIGNUP_TYPES } from "./constants";

export const linkSchema = z.object({
  branch_id: z.guid("Choose the branch the client will join"),
  client_name: z.string().trim().max(120, "Keep the name under 120 characters"),
  days: z.coerce.number().refine((d) => (LINK_DAYS as readonly number[]).includes(d), "Choose how long the link lasts"),
});

/** Sending a returned sign-up back to the client. */
export const fixLinkSchema = linkSchema.pick({ days: true });

/** The client's own form: the member form without the branch (the link sets it), plus their consent. */
export const signupSchema = memberSchema.omit({ branch_id: true }).extend({
  consent: z.literal("yes", "Tick the box to confirm these details are yours and correct"),
});

const documentKey = z.enum(Object.keys(CLIENT_DOCUMENTS) as [keyof typeof CLIENT_DOCUMENTS]);

/** A file the browser is about to upload, before it has a signed upload URL. */
export const uploadRequestSchema = z
  .array(
    z.object({
      document_type: documentKey,
      name: z.string().min(1).max(200),
      type: z.enum(SIGNUP_TYPES, "Upload a PDF, JPEG or PNG"),
      size: z.number().int().positive().max(SIGNUP_MAX_BYTES, "Files can be at most 10 MB"),
    }),
  )
  .max(Object.keys(CLIENT_DOCUMENTS).length);

/** A file the browser has uploaded with its signed URL, sent with the form. */
export const uploadedSchema = z.object({
  path: z.string().min(1).max(400),
  name: z.string().min(1).max(200),
  type: z.enum(SIGNUP_TYPES),
});
