// Kuun's own loan forms: the Kuun Asset Loan application and guarantor forms, and the Payday and Property-backed loan
// forms with their compliance checklists. Each loan product names the form it follows (loan_products.application_form).
//
// The answers a form asks for beyond the standard application are kept in loans.form_details and
// loan_guarantors.form_details. The fields below drive the inputs, the checks and the printed copies, so a field
// added here shows up everywhere. The checklist lines are also in the database (loan_checklist_lines), which
// enforces them; change both together.

import { z } from "zod";

export type ApplicationForm = "standard" | "kuun_asset" | "payday" | "property_backed";
export type KuunForm = Exclude<ApplicationForm, "standard">;
export const KUUN_FORMS: KuunForm[] = ["kuun_asset", "payday", "property_backed"];
export const isKuunForm = (f: string | null | undefined): f is KuunForm => KUUN_FORMS.includes(f as KuunForm);

export type FieldType = "text" | "textarea" | "date" | "money" | "phone" | "email" | "select" | "bvn" | "nin" | "account_no";

export type FormField = {
  key: string;
  label: string;
  type: FieldType;
  options?: Record<string, string>;
  required?: boolean;
  hint?: string;
  /** Takes the whole row. */
  wide?: boolean;
};

export type FormSection = { title: string; fields: FormField[] };

export type FormDetails = Record<string, string>;

const MARITAL = { single: "Single", married: "Married", other: "Others" };
const GENDER = { male: "Male", female: "Female" };
const YES_NO = { yes: "Yes", no: "No" };

export const ASSET_CATEGORIES = {
  real_estate: "Real Estate / Housing",
  household_appliance: "Household Appliance",
  furniture: "Furniture",
  solar_energy: "Solar Energy",
  automobile: "Automobile",
  other: "Other Approved Asset",
};

export const ID_TYPES = {
  national_id: "National ID (NIN slip or card)",
  drivers_licence: "Driver's licence",
  international_passport: "International passport",
  voters_card: "Voter's card",
  work_id: "Work ID",
};

export const VERIFICATION_METHODS = {
  physical_visit: "Physical visit",
  telephone: "Telephone",
  employer_confirmation: "Employer confirmation",
  bank_statement_review: "Bank statement review",
  other: "Other",
} as const;
export type VerificationMethod = keyof typeof VERIFICATION_METHODS;

export const KYC_STATUSES = { satisfactory: "Satisfactory", unsatisfactory: "Unsatisfactory" } as const;
export const KYC_RECOMMENDATIONS = { proceed: "Proceed", deferred: "Deferred", decline: "Decline" } as const;
export const CHECKLIST_ANSWERS = { yes: "Yes", no: "No", not_applicable: "Not applicable" } as const;
export type ChecklistAnswer = keyof typeof CHECKLIST_ANSWERS;

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/** Personal details the payday and property-backed forms ask for that the member file doesn't hold. */
const personal = (reference: FormField): FormSection => ({
  title: "Personal details on the form",
  fields: [
    { key: "bvn", label: "BVN", type: "bvn", required: true },
    { key: "marital_status", label: "Marital status", type: "select", options: MARITAL, required: true },
    { key: "house_rent_expiry", label: "House rent expiration date", type: "date" },
    { key: "place_of_worship", label: "Place of worship & address", type: "text", wide: true },
    { key: "sibling_name", label: "Brother/Sister's name", type: "text" },
    { key: "sibling_phone", label: "Brother/Sister's phone number", type: "phone" },
    { key: "sibling_address", label: "Brother/Sister's residential address", type: "text", wide: true },
    { key: "spouse_name", label: "Spouse's name", type: "text" },
    { key: "spouse_phone", label: "Spouse's phone number", type: "phone" },
    reference,
  ],
});

const REMITA: FormField = { key: "remita_reference", label: "Remita reference number", type: "text" };
const DIRECT_DEBIT: FormField = { key: "direct_debit_reference", label: "Direct debit reference number", type: "text" };

const otherBanks: FormField[] = [
  { key: "existing_loans", label: "Total existing loans with other banks (₦)", type: "money" },
  { key: "other_banks", label: "Bank name(s)", type: "text" },
];

/** The guarantor details the payday and property-backed guarantor forms share. */
const guarantorPersonal: FormField[] = [
  { key: "gender", label: "Gender", type: "select", options: GENDER },
  { key: "marital_status", label: "Marital status", type: "select", options: MARITAL },
  { key: "bvn", label: "BVN", type: "bvn" },
  { key: "date_of_birth", label: "Date of birth", type: "date" },
  { key: "email", label: "Email address", type: "email" },
  { key: "nearest_bus_stop", label: "Nearest bus stop", type: "text" },
  { key: "place_of_worship", label: "Place of worship & address", type: "text", wide: true },
  { key: "sibling_name", label: "Brother/Sister's name", type: "text" },
  { key: "sibling_phone", label: "Brother/Sister's phone number", type: "phone" },
  { key: "sibling_address", label: "Brother/Sister's residential address", type: "text", wide: true },
  { key: "spouse_name", label: "Spouse's name", type: "text" },
  { key: "spouse_phone", label: "Spouse's phone number", type: "phone" },
];

const guarantorWork = (business: string): FormField[] => [
  { key: "employer_address", label: `${business} address`, type: "text", wide: true },
  { key: "employer_bus_stop", label: "Nearest bus stop (work)", type: "text" },
  { key: "nature_of_business", label: "Nature of business", type: "text" },
  { key: "years_in_business", label: "No. of years in business / work place", type: "text" },
  { key: "annual_income", label: "Annual income (₦)", type: "money" },
];

const pledged = [1, 2, 3].flatMap((n) => [
  { key: `pledged_${n}_property`, label: `Pledged property ${n}`, type: "text" as const },
  { key: `pledged_${n}_location`, label: `Location ${n}`, type: "text" as const },
  { key: `pledged_${n}_value`, label: `Value ${n} (₦)`, type: "money" as const },
]);

export type FormDefinition = {
  /** The product family, as the paper form names it. */
  name: string;
  applicationTitle: string;
  guarantorTitle: string;
  checklistTitle: string;
  /** Extra application questions, after the standard ones. */
  application: FormSection[];
  /** Extra guarantor questions, after name, phone, address, relationship, occupation, employer and income. */
  guarantor: FormSection[];
};

export const FORMS: Record<KuunForm, FormDefinition> = {
  payday: {
    name: "Payday loan",
    applicationTitle: "SILVERKUUN PAYDAY LOAN · LOAN APPLICATION FORM",
    guarantorTitle: "SILVERKUUN PAYDAY LOAN · GUARANTOR'S FORM",
    checklistTitle: "PAYDAY LOAN COMPLIANCE CHECKLIST",
    application: [
      personal(REMITA),
      {
        title: "Employment on the form",
        fields: [
          { key: "employer_bus_stop", label: "Nearest bus stop (work)", type: "text" },
          { key: "nature_of_work", label: "Nature of work", type: "text" },
          { key: "years_in_organisation", label: "No. of years/months in organisation", type: "text" },
          ...otherBanks,
        ],
      },
      {
        title: "Account details (salary account)",
        fields: [
          { key: "account_name", label: "Account name", type: "text" },
          { key: "account_number", label: "Account number", type: "account_no" },
          { key: "account_bank", label: "Bank name", type: "text" },
        ],
      },
    ],
    guarantor: [
      {
        title: "Guarantor's form",
        fields: [
          ...guarantorPersonal,
          ...guarantorWork("Business/Employer's"),
          { key: "amount_guaranteed", label: "Loan amount guaranteed (₦)", type: "money" },
          REMITA,
        ],
      },
    ],
  },
  property_backed: {
    name: "Property-backed loan",
    applicationTitle: "SILVERKUUN PROPERTY-BACKED LOAN · LOAN APPLICATION FORM",
    guarantorTitle: "SILVERKUUN PROPERTY-BACKED LOAN · GUARANTOR FORM",
    checklistTitle: "PROPERTY-BACKED LOAN COMPLIANCE CHECKLIST",
    application: [
      personal(DIRECT_DEBIT),
      {
        title: "Business on the form",
        fields: [
          { key: "business_rent_expiry", label: "When will your (business) rent expire?", type: "date" },
          { key: "business_bus_stop", label: "Nearest bus stop (business)", type: "text" },
          { key: "nature_of_business", label: "Nature of business", type: "text" },
          { key: "years_in_business", label: "No. of years in business", type: "text" },
          ...otherBanks,
        ],
      },
    ],
    guarantor: [
      {
        title: "Guarantor form",
        fields: [
          ...guarantorPersonal,
          ...guarantorWork("Business"),
          { key: "amount_guaranteed", label: "Loan amount guaranteed (₦)", type: "money" },
          DIRECT_DEBIT,
        ],
      },
      { title: "Assets and property pledged as collateral", fields: pledged },
    ],
  },
  kuun_asset: {
    name: "Kuun Asset Loan",
    applicationTitle: "KUUN ASSET LOAN · APPLICATION FORM",
    guarantorTitle: "KUUN ASSET LOAN · GUARANTOR FORM",
    checklistTitle: "KUUN ASSET LOAN · REQUIRED ATTACHMENTS",
    application: [
      {
        title: "Applicant details on the form",
        fields: [
          { key: "bvn", label: "BVN", type: "bvn", required: true },
          { key: "other_income", label: "Other income (₦)", type: "money" },
          { key: "years_in_employment", label: "Years in employment / business", type: "text" },
        ],
      },
      {
        title: "Asset financing request",
        fields: [
          { key: "asset_category", label: "Asset category", type: "select", options: ASSET_CATEGORIES, required: true },
          { key: "asset_category_other", label: "Other approved asset (if Other)", type: "text" },
          { key: "asset_description", label: "Description of asset", type: "textarea", required: true, wide: true },
          { key: "vendor", label: "Vendor / supplier", type: "text" },
          { key: "proforma_invoice_no", label: "Proforma invoice no.", type: "text" },
          { key: "invoice_date", label: "Invoice date", type: "date" },
          { key: "asset_total_cost", label: "Total asset cost (₦)", type: "money", required: true },
          { key: "equity_contribution", label: "Applicant equity contribution (₦)", type: "money" },
          { key: "equity_applicable", label: "Minimum 40% equity applicable", type: "select", options: YES_NO },
        ],
      },
      {
        title: "Repayment information",
        fields: [
          {
            key: "repayment_source",
            label: "Source of repayment",
            type: "select",
            options: { salary: "Salary", business_income: "Business income", other: "Other" },
          },
          { key: "repayment_source_other", label: "Other source (if Other)", type: "text" },
        ],
      },
    ],
    guarantor: [
      {
        title: "Guarantor information",
        fields: [
          { key: "email", label: "Email", type: "email" },
          { key: "id_type", label: "Means of identification", type: "select", options: ID_TYPES },
          { key: "id_number", label: "ID no.", type: "text" },
          { key: "bvn", label: "BVN", type: "bvn" },
          { key: "nin", label: "NIN no.", type: "nin" },
          { key: "position", label: "Position", type: "text" },
          { key: "years_in_business", label: "Years in employment / business", type: "text" },
        ],
      },
      {
        title: "Financial information",
        fields: [
          { key: "bank_name", label: "Bank name", type: "text" },
          { key: "account_no", label: "Account no.", type: "account_no" },
          { key: "existing_loan_obligations", label: "Existing loan obligations (₦)", type: "money" },
          { key: "monthly_loan_repayment", label: "Monthly loan repayment (₦)", type: "money" },
          { key: "net_disposable_income", label: "Estimated net disposable income (₦)", type: "money" },
          {
            key: "residential_status",
            label: "Residential status",
            type: "select",
            options: { owner: "Owner", rented: "Rented", family_house: "Family house", other: "Other" },
          },
          { key: "residential_status_other", label: "Other residential status (if Other)", type: "text" },
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Checklists (mirrors loan_checklist_lines)
// ---------------------------------------------------------------------------

export type ChecklistLine = { item: string; label: string; documentType: string | null; required: boolean };

const line = (item: string, label: string, documentType: string | null, required = true): ChecklistLine => ({ item, label, documentType, required });

export const CHECKLISTS: Record<KuunForm, ChecklistLine[]> = {
  payday: [
    line("signed_loan_form", "Signed loan form", "application_form"),
    line("utility_bill", "Utility bill", "utility_bill"),
    line("employment_letter", "Employment letter", "employment_letter"),
    line("valid_id", "Valid ID & Work ID", "id_document"),
    line("passport", "Passport photograph", "passport_photo"),
    line("statement_6m", "6 months statement of account", "bank_statement"),
    line("credit_bureau", "Credit bureau check", "credit_bureau_report"),
    line("direct_debit", "Direct debit mandate", "direct_debit_mandate"),
    line("guarantor_id", "Guarantors ID & Passport", "guarantor_id"),
    line("guarantor_direct_debit", "Direct debit mandate (Guarantor)", "guarantor_mandate"),
    line("two_guarantors", "Two guarantors", null),
  ],
  property_backed: [
    line("signed_form_letter", "Signed loan form & Application letter", "application_form"),
    line("utility_bill", "Utility bill", "utility_bill"),
    line("valid_id", "Valid ID", "id_document"),
    line("passport", "Passport photograph", "passport_photo"),
    line("statement_12m", "12 months statement of account", "bank_statement"),
    line("credit_bureau", "Credit bureau check", "credit_bureau_report"),
    line("direct_debit", "Direct debit mandate (customer)", "direct_debit_mandate"),
    line("guarantor_id", "Guarantors ID & Passport", "guarantor_id"),
    line("guarantor_direct_debit", "Direct debit mandate (Guarantor)", "guarantor_mandate"),
    line("mortgage_deed", "Signed Deed of legal mortgage", "mortgage_deed"),
    line("cheque_leaves", "Cheque leaf(ves)", "cheque_leaves"),
    line("sale_of_assets", "Sale of Assets Agreement", "sale_of_assets_agreement"),
    line("credit_memo", "Credit Assessment Memorandum", null),
  ],
  kuun_asset: [
    line("loan_form", "Loan form", "application_form"),
    line("passport", "Recent passport photograph", "passport_photo"),
    line("valid_id", "Valid ID", "id_document"),
    line("utility_bill", "Utility bill", "utility_bill"),
    line("bank_statement", "Bank statement", "bank_statement"),
    line("proforma", "Proforma invoice", "proforma_invoice"),
    line("insurance", "Insurance evidence", "insurance_evidence"),
    line("repayment_cheques", "Repayment cheques", "cheque_leaves"),
    line("gsi", "GSI (Global Standing Instruction)", "gsi_mandate"),
    line("guarantor_form", "Guarantor form", "guarantor_form"),
    line("equity", "Evidence of equity contribution (where applicable)", "equity_evidence", false),
  ],
};

// ---------------------------------------------------------------------------
// Declarations, word for word from the forms
// ---------------------------------------------------------------------------

export const DECLARATIONS = {
  payday: (name: string) =>
    `I ${name} (hereinafter referred to as the "Borrower") being of a sound mind and legal capacity, do hereby apply for a loan with Silverkuun Cooperative Society Limited. I agree that the information given herein is correct and for the basis of granting myself the requested loan amount. Silverkuun cooperative Society Limited can charge me a 6% daily default fee on outstanding loan amount should I fail to repay loan on due date. I also agree to pay all associated costs and charges of loan recovery as affected on me. I know that these costs and charges on loan recovery are different from the default penal fees and I am responsible for both of them should they crystallize in accordance with the terms and conditions of the loan.`,
  property_backed: (name: string, day: string, month: string, year: string) =>
    `I ${name} (hereinafter referred to as the "Borrower") being of a sound mind and legal capacity, do hereby appoint Silverkuun Cooperative Society Limited (hereinafter called the "Attorney and Lender") as my true and lawful attorney in fact, to act for me in my name, place, and stead, at any time and on my behalf to do and perform the following for the recovery and repayment of this loan liability: (i) To take unrestrained and unrestricted possession of my property at any time without let or hindrance when I default in my loan repayment. (ii) To take unrestrained and unrestricted possession, carry, dispose or sell without let or hindrance the fixed and floating stock and assets (both personal and business) belonging to me to the tune of 400% of the loan value. (iii) Pay a default interest of 12% of the principal on the month I fail to pay rather than the agreed monthly interest. This irrevocable Power of Attorney which is dated this ${day} day of ${month} ${year} will remain in effect, even in the event that I should become or be declared disabled, incapacitated, incompetent or demised, and shall only terminate upon the full repayment of the loan principal, accrued loan interests and other charges. I hereby take personal responsibility for all action taken against me by Silverkuun Cooperative Society Limited and its Staff and absolve them of any culpability. I also agree to pay all associated costs and charges of this loan recovery as affected on me/us. I know that these costs and charges on loan recovery are different from the default penal fees and I am responsible for both of them should they crystallize in accordance with the terms and conditions of the loan.`,
  kuun_asset: [
    "I hereby declare that the information provided in this application is true, complete and accurate. I authorise SilverKuun Cooperative Society/SilverKuun Group to verify the information provided, conduct credit checks and obtain relevant information from appropriate sources for the purpose of assessing this application.",
    "I understand that approval is subject to SilverKuun's credit assessment, applicable terms and conditions, and satisfactory completion of all required documentation.",
    "I agree that the financed asset shall serve as primary collateral and may be repossessed in accordance with the applicable terms in the event of default. I further agree to execute all required loan, lease, insurance, GSI and other legal documentation.",
  ],
};

export const GUARANTEE_CONDITIONS = [
  "Where the borrower defaults in repaying the loan to Silverkuun Cooperative Society Ltd, the guarantor would be completely responsible for repaying the total outstanding amount of the loan, interest and any other charges thereon.",
  "The guarantor shall not have the right to withdraw from this guarantee without the prior written consent and agreement of Silverkuun Cooperative Society Ltd.",
  "This guarantee shall be a continuous one and the liability of the guarantor will be valid until the principal and interest and other charges have been repaid.",
];
export const PAYDAY_EXTRA_CONDITION =
  "Silverkuun Cooperative Society Ltd has the right to debit guarantor's account/power of attorney over assets in compensation of the loan.";

export const PROPERTY_PLEDGE = [
  "I hereby also pledged my assets, properties and stocks listed below as collateral for this loan and fully give the company unhindered authority to repossess them from my residence and business premises and dispose them as they please without let or hindrance, and at any price, and without any notice, for the partial or full repayment of the loan, interest and charges.",
  "These stocks and assets have henceforth become the property of Silverkuun Cooperative Society Ltd. I will be liable legally and otherwise for any costs, damage, injury, loss, and any other unintended effect that may arise during the repossession of these stocks and assets by the Company.",
];
export const PROPERTY_ATTACH =
  "Please, attach copy of your valid means of identification, passport photograph and signed, undated cheque leaf (yes) if any. Please note that a dud cheque is a punishable offence under BOFIA 1991.";

export const ASSET_UNDERTAKING = [
  "hereby confirm that I have agreed to act as guarantor for the above-named applicant in respect of the Kuun Asset Loan facility granted by SilverKuun Cooperative Society.",
  "I confirm that the information provided in this form is true and accurate and authorise SilverKuun Cooperative Society/SilverKuun Group to verify my identity, employment/business, financial information, bank details and credit history.",
  "I undertake to support the applicant in meeting the repayment obligations and acknowledge that, in the event of default and failure by the applicant to regularise the facility, SilverKuun may enforce the guarantee and take recovery action against me in accordance with the applicable loan and guarantee terms.",
  "I agree to provide any additional documentation required, including undated personal cheques, six-month bank statement, valid identification, utility bill and GSI documentation, as applicable to the facility.",
];

export const ASSET_GUARANTOR_DOCUMENTS = [
  "Valid means of identification",
  "Recent passport",
  "Recent utility bill",
  "Six (6) months bank statement",
  "Undated personal cheque(s)",
  "Duly executed GSI",
  "Evidence of employment/business/income, where applicable",
];

export const SALE_OF_ASSETS = (name: string) =>
  `I ${name} of the above stated address and any other address I may relocate to in the future have hereby willingly and freely sold the below underlisted assets to Silverkuun Cooperative Society Limited (the "lender") and give them all authority to take unhindered possession of these assets from my business and home premises whether in my presence or absence. These assets have henceforth become the property of Silverkuun Cooperative Society Limited. I will be liable legally and otherwise for any costs, damage, injury, loss, and any other unintended effect that may arise during the collection of these assets by the company.`;

// ---------------------------------------------------------------------------
// Checking answers
// ---------------------------------------------------------------------------

/** Input names carry a prefix so they never clash with the standard application fields. */
export const inputName = (key: string) => `fd_${key}`;

function fieldSchema(f: FormField) {
  const text = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters`);
  switch (f.type) {
    case "bvn":
      return text(11).regex(/^$|^\d{11}$/, "A BVN is 11 digits");
    case "nin":
      return text(11).regex(/^$|^\d{11}$/, "A NIN is 11 digits");
    case "account_no":
      return text(10).regex(/^$|^\d{10}$/, "An account number is 10 digits");
    case "phone":
      return text(20).regex(/^$|^[+\d][\d\s-]{6,}$/, "Enter a phone number");
    case "email":
      return text(200).regex(/^$|^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter an email address");
    case "date":
      return text(10).regex(/^$|^\d{4}-\d{2}-\d{2}$/, "Enter a date");
    case "money":
      return text(20)
        .regex(/^$|^\d+(\.\d{1,2})?$/, "Enter an amount in naira, such as 250000")
        .transform((v) => (v === "" ? v : String(Number(v))));
    case "select":
      return text(40).refine((v) => v === "" || Object.hasOwn(f.options ?? {}, v), "Choose from the list");
    case "textarea":
      return text(1000);
    default:
      return text(300);
  }
}

/** The fields of the given sections, in order. */
export const fieldsOf = (sections: FormSection[]) => sections.flatMap((s) => s.fields);

/**
 * Reads a form's answers from submitted form data. Returns the answers (empty ones left out) or errors keyed by input
 * name.
 */
export function parseFormDetails(
  sections: FormSection[],
  formData: FormData,
): { ok: true; details: FormDetails } | { ok: false; fieldErrors: Record<string, string> } {
  const details: FormDetails = {};
  const fieldErrors: Record<string, string> = {};
  for (const f of fieldsOf(sections)) {
    const raw = formData.get(inputName(f.key));
    const parsed = fieldSchema(f).safeParse(typeof raw === "string" ? raw : "");
    if (!parsed.success) {
      fieldErrors[inputName(f.key)] = parsed.error.issues[0]?.message ?? "Check this answer";
    } else if (parsed.data === "") {
      if (f.required) fieldErrors[inputName(f.key)] = `Enter the ${f.label.replace(/ \(.*\)$/, "").toLowerCase()}`;
    } else {
      details[f.key] = parsed.data;
    }
  }
  return Object.keys(fieldErrors).length ? { ok: false, fieldErrors } : { ok: true, details };
}

/** How an answer reads on screen and on the printed form. */
export function displayValue(f: FormField, value: string | undefined, money: (v: string) => string, date: (v: string) => string): string {
  if (!value) return "";
  if (f.type === "select") return f.options?.[value] ?? value;
  if (f.type === "money") return money(value);
  if (f.type === "date") return date(value);
  return value;
}

/** The share of the asset's cost the applicant pays, when both figures are given. */
export function equityShare(details: FormDetails): number | null {
  const cost = Number(details.asset_total_cost);
  const equity = Number(details.equity_contribution);
  return cost > 0 && details.equity_contribution ? equity / cost : null;
}

/** Kuun's asset loan form asks for at least this share of the cost from the applicant, where it applies. */
export const MIN_EQUITY_SHARE = 0.4;
