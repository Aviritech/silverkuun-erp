import "server-only";
import { createClient } from "@/lib/supabase/server";
import { decodeStagedRef, isOwnStagedPath, STAGING_BUCKET } from "./staging";

/**
 * The file a form sent under `key`: either uploaded with the request, or (from forms wrapped in `withStagedUploads`)
 * staged in Storage by the browser. A staged file is read back and its staged copy removed. Returns null when there
 * is no file, or when a staged copy isn't the user's own or can't be read.
 */
export async function formFile(formData: FormData, key = "file"): Promise<File | null> {
  const value = formData.get(key);
  if (value instanceof File) return value.size > 0 ? value : null;
  const ref = decodeStagedRef(value);
  if (!ref) return null;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user || !isOwnStagedPath(ref.staged, auth.user.id)) return null;

  const bucket = supabase.storage.from(STAGING_BUCKET);
  const { data: blob, error } = await bucket.download(ref.staged);
  if (error || !blob) return null;
  await bucket.remove([ref.staged]);
  // The type the browser declared, as it was for files sent with the request; callers check it against their list.
  return new File([blob], ref.name, { type: ref.type });
}
