import { describe, expect, it } from "vitest";
import { decodeStagedRef, encodeStagedRef, isOwnStagedPath } from "./staging";

describe("staged file references", () => {
  it("round-trip through a form value", () => {
    const ref = { staged: "u1/abc/KYC_Form.pdf", name: "KYC Form.pdf", type: "application/pdf", size: 5_000_000 };
    expect(decodeStagedRef(encodeStagedRef(ref))).toEqual(ref);
  });

  it("ignore anything that isn't a reference", () => {
    expect(decodeStagedRef("hello")).toBeNull();
    expect(decodeStagedRef("staged-file:{not json")).toBeNull();
    expect(decodeStagedRef('staged-file:{"staged":1}')).toBeNull();
    expect(decodeStagedRef(null)).toBeNull();
  });

  it("only accept paths in the user's own folder", () => {
    expect(isOwnStagedPath("u1/abc/file.pdf", "u1")).toBe(true);
    expect(isOwnStagedPath("u2/abc/file.pdf", "u1")).toBe(false);
    expect(isOwnStagedPath("u1/../u2/file.pdf", "u1")).toBe(false);
    expect(isOwnStagedPath("u1/file.pdf", "u1")).toBe(false);
    expect(isOwnStagedPath("u1/a/b/file.pdf", "u1")).toBe(false);
  });
});
