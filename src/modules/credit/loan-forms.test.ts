import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHECKLISTS, FORMS, KUUN_FORMS, equityShare, fieldsOf, inputName, parseFormDetails } from "./loan-forms";

const form = (entries: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(inputName(k), v);
  return fd;
};

describe("Kuun loan forms", () => {
  it("keep the same checklist lines as the database", () => {
    const sql = readFileSync(join(__dirname, "../../../supabase/migrations/20261119000010_kuun_loan_forms.sql"), "utf8");
    const rows = [...sql.matchAll(/\('(kuun_asset|payday|property_backed)', '([a-z0-9_]+)', '((?:[^']|'')*)', (null|'[a-z_]+'), (true|false), \d+\)/g)];
    for (const f of KUUN_FORMS) {
      const db = rows
        .filter((r) => r[1] === f)
        .map((r) => ({ item: r[2], label: r[3].replace(/''/g, "'"), documentType: r[4] === "null" ? null : r[4].slice(1, -1), required: r[5] === "true" }));
      expect(CHECKLISTS[f]).toEqual(db);
    }
  });

  it("use each field key once per form", () => {
    for (const f of KUUN_FORMS) {
      for (const part of [FORMS[f].application, FORMS[f].guarantor]) {
        const keys = fieldsOf(part).map((x) => x.key);
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
  });

  it("check answers and leave out empty ones", () => {
    const ok = parseFormDetails(FORMS.payday.application, form({ bvn: "22212345678", marital_status: "married", existing_loans: "150000.50", spouse_name: " " }));
    expect(ok).toEqual({ ok: true, details: { bvn: "22212345678", marital_status: "married", existing_loans: "150000.5" } });

    const bad = parseFormDetails(FORMS.payday.application, form({ bvn: "123", marital_status: "engaged", account_number: "12", existing_loans: "-5" }));
    expect(bad.ok).toBe(false);
    if (!bad.ok)
      expect(bad.fieldErrors).toEqual({
        fd_bvn: "A BVN is 11 digits",
        fd_marital_status: "Choose from the list",
        fd_existing_loans: "Enter an amount in naira, such as 250000",
        fd_account_number: "An account number is 10 digits",
      });

    const missing = parseFormDetails(FORMS.kuun_asset.application, form({}));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(Object.keys(missing.fieldErrors)).toEqual(["fd_bvn", "fd_asset_category", "fd_asset_description", "fd_asset_total_cost"]);
  });

  it("work out the asset loan equity share", () => {
    expect(equityShare({ asset_total_cost: "1000000", equity_contribution: "400000" })).toBe(0.4);
    expect(equityShare({ asset_total_cost: "1000000" })).toBeNull();
  });
});
