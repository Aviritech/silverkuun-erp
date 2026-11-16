import { describe, expect, it } from "vitest";
import { addMonths, contributionSchema, fieldErrors, memberSchema, planSchema } from "./schemas";

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
  address: "1 Marina",
  address_city: "Lagos Island",
  address_lga: "Lagos Island",
  address_state: "Lagos",
  address_landmark: "",
  nin: "12345678901",
  id_type: "national_id",
  id_number: "A123",
  next_of_kin_name: "",
  next_of_kin_phone: "",
  next_of_kin_relationship: "",
  bank_code: "",
  bank_name: "",
  bank_account_no: "",
};

describe("memberSchema", () => {
  it("trims text and turns blank optional fields into nulls", () => {
    const parsed = memberSchema.parse(validMember);
    expect(parsed.first_name).toBe("Ada");
    expect(parsed.email).toBeNull();
    expect(parsed.date_of_birth).toBeNull();
  });

  it("checks the bank account number", () => {
    const result = memberSchema.safeParse({ ...validMember, bank_code: "058", bank_account_no: "12345" });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error).bank_account_no).toBe("An account number is 10 digits");
  });

  it("asks for the state and LGA, and keeps town and landmark optional", () => {
    const result = memberSchema.safeParse({ ...validMember, address_state: "", address_lga: " " });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(fieldErrors(result.error).address_state).toBe("Choose the state");
      expect(fieldErrors(result.error).address_lga).toBe("Enter the LGA");
    }
    expect(memberSchema.safeParse({ ...validMember, address_state: "Lagoss" }).success).toBe(false);
    const ok = memberSchema.parse({ ...validMember, address_city: "", address_landmark: " Opposite First Bank " });
    expect(ok.address_city).toBeNull();
    expect(ok.address_landmark).toBe("Opposite First Bank");
    expect(ok.address_state).toBe("Lagos");
  });

  it("explains an invalid NIN", () => {
    const result = memberSchema.safeParse({ ...validMember, nin: "123" });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error).nin).toBe("A NIN is 11 digits");
  });
});

describe("planSchema", () => {
  it("checks the interest pay day chosen with the plan", () => {
    const plan = {
      plan_type: "gold",
      contribution_amount: "50000",
      contribution_frequency: "monthly",
      start_date: "2026-05-01",
      maturity_date: "2027-05-01",
    };
    const result = planSchema.safeParse({ ...plan, interest_pay_day: "32" });
    expect(result.success).toBe(false);
    if (!result.success) expect(fieldErrors(result.error).interest_pay_day).toBe("Choose a day from 1 to 31");
    expect(planSchema.parse({ ...plan, interest_pay_day: "15" }).interest_pay_day).toBe(15);
    // Left out for plans paid at maturity; the action decides whether the plan type needs one.
    expect(planSchema.parse({ ...plan, interest_pay_day: "" }).interest_pay_day).toBeNull();
  });

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

describe("plans with a fixed tenure", () => {
  it("take a tenure instead of a maturity date", () => {
    const result = planSchema.safeParse({
      plan_type: "target",
      contribution_amount: "50000",
      contribution_frequency: "monthly",
      start_date: "2026-05-01",
      maturity_date: "",
      tenure_months: "6",
    });
    expect(result.success && result.data).toMatchObject({ tenure_months: 6, maturity_date: undefined });
  });

  it("need a maturity date or a tenure", () => {
    const result = planSchema.safeParse({
      plan_type: "gold",
      contribution_amount: "50000",
      contribution_frequency: "monthly",
      start_date: "2026-05-01",
      maturity_date: "",
      tenure_months: "",
    });
    expect(result.success).toBe(false);
  });

  it("mature that many months on, kept to the end of a shorter month", () => {
    expect(addMonths("2026-05-01", 3)).toBe("2026-08-01");
    expect(addMonths("2026-11-30", 3)).toBe("2027-02-28");
    expect(addMonths("2026-10-15", 12)).toBe("2027-10-15");
  });
});

describe("contributionSchema", () => {
  it("rejects future payment dates and non-positive amounts", () => {
    const result = contributionSchema.safeParse({
      member_plan_id: "20000000-0000-4000-8000-000000000001",
      kind: "scheduled",
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
