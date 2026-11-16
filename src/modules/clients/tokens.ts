import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes, URL-safe: 43 characters. Only its SHA-256 hash is stored. */
export function newSignupToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSignupToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function isSignupToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}
