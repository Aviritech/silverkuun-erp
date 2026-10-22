import { describe, expect, it } from "vitest";
import { temporaryPassword } from "./temporary-password";

describe("temporaryPassword", () => {
  it("makes three groups of three letters and a digit, without look-alike characters", () => {
    for (let i = 0; i < 200; i++) {
      const password = temporaryPassword();
      expect(password).toMatch(/^([A-Za-z2-9]{4}-){2}[A-Za-z2-9]{4}$/);
      expect(password).not.toMatch(/[01OIl]/);
      for (const group of password.split("-")) expect(group.replace(/\D/g, "")).toHaveLength(1);
    }
  });

  it("doesn't repeat itself", () => {
    expect(new Set(Array.from({ length: 100 }, temporaryPassword)).size).toBe(100);
  });
});
