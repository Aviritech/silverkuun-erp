import { describe, expect, it } from "vitest";
import { contributionSchema, fieldErrors, memberSchema, planSchema } from "./schemas";

const validMember = {
  branch_id: "20000000-0000-4000-8000-000000000001",
  title: "",
  first_name: " Ada ",
  middle_name: "",
  last_name: "Obi",
  date_of_birth: "",
  gender: "",
  phone: "08030000000",
  email: "",
  address: "1 Marina, Lagos",
  nin: "12345678901",
  id_type: "national_id",
  id_number: "A123",
  next_of_kin_name: "",
  next_of_kin_phone: "",
  next_of_kin_relationship: "",
};

describe("memberSchema", () => {
  it("trims text and turns blank optional fields into nulls", () => {
    const parsed = memberSchema.parse(validMember);
    expect(parsed.first_name).toBe("Ada");
    expect(parsed.email).toBeNull();
    expect(parsed.date_of_birth).toBeNull();
  });

  it("explains an invalid NIN", () => {
    const result = memberSchema.safeParse({ ...validMember, nin: "123" });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error).nin).toBe("A NIN is 11 digits");
  });
});

describe("planSchema", () => {
  it("rejects a maturity date before the start date", () => {
    const result = planSchema.safeParse({
      plan_type: "gold",
      contribution_amount: "50000",
      contribution_frequency: "monthly",
      start_date: "2026-05-01",
      maturity_date: "2026-04-01",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error).maturity_date).toMatch(/after the start/);
  });
});

describe("contributionSchema", () => {
  it("rejects future payment dates and non-positive amounts", () => {
    const result = contributionSchema.safeParse({
      member_plan_id: "20000000-0000-4000-8000-000000000001",
      kind: "top_up",
      amount: "0",
      paid_on: "2999-01-01",
      payment_method: "cash",
      reference: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = fieldErrors(result.error);
      expect(errors.amount).toMatch(/above zero/);
      expect(errors.paid_on).toMatch(/future/);
    }
  });
});
