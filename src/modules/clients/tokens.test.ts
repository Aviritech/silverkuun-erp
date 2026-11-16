import { describe, expect, it } from "vitest";
import { looksLike } from "./constants";
import { hashSignupToken, isSignupToken, newSignupToken } from "./tokens";

describe("sign-up tokens", () => {
  it("are 43 URL-safe characters, different every time, stored only as a SHA-256 hash", () => {
    const a = newSignupToken();
    const b = newSignupToken();
    expect(isSignupToken(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(hashSignupToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSignupToken(a)).toBe(hashSignupToken(a));
  });

  it("rejects anything else in the address", () => {
    expect(isSignupToken("short")).toBe(false);
    expect(isSignupToken(`${"a".repeat(42)}/`)).toBe(false);
    expect(isSignupToken(undefined)).toBe(false);
  });
});

describe("uploaded file check", () => {
  it("accepts files whose first bytes match their type, and nothing renamed", () => {
    expect(looksLike("application/pdf", new TextEncoder().encode("%PDF-1.7"))).toBe(true);
    expect(looksLike("image/jpeg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(looksLike("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(looksLike("application/pdf", new TextEncoder().encode("<html>"))).toBe(false);
    expect(looksLike("image/gif", new TextEncoder().encode("GIF89a"))).toBe(false);
  });
});
