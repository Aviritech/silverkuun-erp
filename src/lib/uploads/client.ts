"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { ActionState } from "@/lib/action-state";
import { publicEnv } from "@/lib/env";
import { encodeStagedRef, MAX_STAGED_BYTES, STAGING_BUCKET } from "./staging";

type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Wraps a form action so every chosen file goes straight from the browser to Supabase Storage first, and the server
 * action receives only a small reference to it. Vercel caps request bodies at 4.5 MB, so sending the file itself
 * through the server action broke larger PDFs. Read the file on the server with `formFile`.
 */
export function withStagedUploads(action: FormAction): FormAction {
  return async (prev, formData) => {
    const files = [...formData.entries()].filter((entry): entry is [string, File] => entry[1] instanceof File && entry[1].size > 0);
    if (files.length) {
      for (const [key, file] of files) {
        if (file.size > MAX_STAGED_BYTES) return { fieldErrors: { [key]: "Files can be at most 10 MB" } };
      }
      const env = publicEnv();
      const supabase = createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
      const { data } = await supabase.auth.getUser();
      if (!data.user) return { error: "Your session has ended. Sign in again, then retry the upload." };

      for (const [key, file] of files) {
        const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-100) || "file";
        const path = `${data.user.id}/${crypto.randomUUID()}/${safeName}`;
        const type = file.type || "application/octet-stream";
        const { error } = await supabase.storage.from(STAGING_BUCKET).upload(path, file, { contentType: type, upsert: false });
        if (error) return { fieldErrors: { [key]: `The file couldn't be uploaded (${error.message}). Check your connection and try again.` } };
        formData.set(key, encodeStagedRef({ staged: path, name: file.name, type, size: file.size }));
      }
    } else {
      // An empty file input still sends an empty File; drop it so the action sees "no file".
      for (const [key, value] of [...formData.entries()]) if (value instanceof File) formData.delete(key);
    }
    return action(prev, formData);
  };
}
