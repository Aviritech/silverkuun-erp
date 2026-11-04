/** Shared by the browser and the server: where staged files live and how a form refers to one. */
export const STAGING_BUCKET = "upload-staging";
export const MAX_STAGED_BYTES = 10 * 1024 * 1024;

/** What a form sends in place of a file it has already uploaded to the staging bucket. */
export type StagedFileRef = { staged: string; name: string; type: string; size: number };

const PREFIX = "staged-file:";

export function encodeStagedRef(ref: StagedFileRef): string {
  return PREFIX + JSON.stringify(ref);
}

export function decodeStagedRef(value: unknown): StagedFileRef | null {
  if (typeof value !== "string" || !value.startsWith(PREFIX)) return null;
  try {
    const ref = JSON.parse(value.slice(PREFIX.length)) as Partial<StagedFileRef>;
    if (typeof ref.staged !== "string" || typeof ref.name !== "string" || typeof ref.type !== "string" || typeof ref.size !== "number") {
      return null;
    }
    return ref as StagedFileRef;
  } catch {
    return null;
  }
}

/** True when a staged path sits in the given user's own folder and nowhere else. */
export function isOwnStagedPath(path: string, userId: string): boolean {
  const parts = path.split("/");
  return parts.length === 3 && parts[0] === userId && !parts.some((p) => p === "" || p === "." || p === "..");
}
