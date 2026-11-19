// Printed copies of Kuun's loan forms, on the letterhead: filled in from a loan, or blank (dotted lines) for a customer
// to fill in by hand. The wording follows the forms in the project library.

import type { ReactNode } from "react";
import { Blank } from "@/components/letter";
import { formatDate } from "@/lib/format";
import { naira, nairaInWords } from "@/lib/letters/words";
import { REPAYMENT_FREQUENCIES, REPAYMENT_MODES, type RepaymentFrequency, type RepaymentMode } from "../constants";
import {
  ASSET_GUARANTOR_DOCUMENTS,
  ASSET_UNDERTAKING,
  CHECKLISTS,
  CHECKLIST_ANSWERS,
  DECLARATIONS,
  FORMS,
  GUARANTEE_CONDITIONS,
  KYC_RECOMMENDATIONS,
  KYC_STATUSES,
  PAYDAY_EXTRA_CONDITION,
  PROPERTY_ATTACH,
  PROPERTY_PLEDGE,
  SALE_OF_ASSETS,
  VERIFICATION_METHODS,
  displayValue,
  type ChecklistAnswer,
  type FormDetails,
  type FormField,
  type KuunForm,
  type VerificationMethod,
} from "../loan-forms";

const money = (v: string | number) => naira(v);
const date = (v: string) => formatDate(v);
const blankIfEmpty = (v: ReactNode) => (v === null || v === undefined || v === "" ? undefined : v);

function Title({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-3 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-[13pt] font-extrabold uppercase tracking-tight">{children}</h2>
        {sub && <p className="text-[9pt] italic text-neutral-600">{sub}</p>}
      </div>
      <div className="flex h-[32mm] w-[26mm] shrink-0 items-center justify-center border border-dashed border-neutral-500 text-center text-[7.5pt] text-neutral-500">
        Affix passport
      </div>
    </div>
  );
}

function Band({ children }: { children: ReactNode }) {
  return <p className="mt-3 mb-1.5 bg-[#f2b705] px-2 py-0.5 text-[9.5pt] font-bold uppercase break-after-avoid">{children}</p>;
}

/** "Label: value", or dotted lines when there is no value. */
function Row({ label, value, width }: { label: string; value?: ReactNode; width?: string }) {
  return (
    <p className="break-inside-avoid">
      {label}: <Blank width={width ?? "w-56"}>{blankIfEmpty(value)}</Blank>
    </p>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-6 gap-y-1">{children}</div>;
}

function Choice({ options, value }: { options: Record<string, string>; value?: string | null }) {
  return (
    <span className="inline-flex flex-wrap gap-x-3">
      {Object.entries(options).map(([k, l]) => (
        <span key={k}>
          {value === k ? "☒" : "☐"} {l}
        </span>
      ))}
    </span>
  );
}

/** The extra answers of a form, as rows. */
function DetailRows({ fields, details }: { fields: FormField[]; details: FormDetails }) {
  return (
    <Grid>
      {fields.map((f) => (
        <div key={f.key} className={f.wide ? "col-span-2" : undefined}>
          <Row label={f.label.replace(/ \(.*\)$/, "")} value={displayValue(f, details[f.key], money, date)} width={f.wide ? "w-96" : "w-40"} />
        </div>
      ))}
    </Grid>
  );
}

const field = (form: KuunForm, part: "application" | "guarantor", key: string) =>
  FORMS[form][part].flatMap((s) => s.fields).find((f) => f.key === key)!;

function Signatures({ rows }: { rows: { role: string; name?: string | null; date?: string | null }[] }) {
  return (
    <table className="mt-2 w-full border-collapse text-[9pt] break-inside-avoid">
      <thead>
        <tr className="bg-amber-100">
          <th className="border border-neutral-400 px-2 py-0.5 text-left">Role</th>
          <th className="border border-neutral-400 px-2 py-0.5 text-left">Name</th>
          <th className="border border-neutral-400 px-2 py-0.5 text-left">Signature</th>
          <th className="border border-neutral-400 px-2 py-0.5 text-left">Date</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.role}>
            <td className="border border-neutral-400 px-2 py-2">{r.role}</td>
            <td className="border border-neutral-400 px-2 py-2">{r.name ?? ""}</td>
            <td className="border border-neutral-400 px-2 py-2" />
            <td className="border border-neutral-400 px-2 py-2">{r.date ? formatDate(r.date) : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SignLine({ name, label = "Name" }: { name?: string | null; label?: string }) {
  return (
    <div className="mt-4 grid grid-cols-3 gap-4 break-inside-avoid">
      <Row label={label} value={name} width="w-36" />
      <Row label="Signature" width="w-28" />
      <Row label="Date" width="w-24" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export type ApplicationPrint = {
  name: string;
  membershipNo: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  email: string | null;
  phone: string;
  address: string;
  landmark: string | null;
  nin: string | null;
  idType: string | null;
  idNumber: string | null;
  employerName: string | null;
  occupation: string | null;
  employerAddress: string | null;
  monthlyIncome: string | null;
  amountRequested: string;
  tenorMonths: number;
  frequency: RepaymentFrequency;
  purpose: string;
  interestRate: string;
  repaymentMode: RepaymentMode;
  details: FormDetails;
  collaterals: { description: string; value: string }[];
  applicationDate: string;
  officerName: string | null;
  branchName: string;
  managerName: string | null;
  bureauCheck: string | null;
  recommendation: "approve" | "decline" | null;
  approvedAmount: string | null;
  approverName: string | null;
  approvedAt: string | null;
  review: { methods: VerificationMethod[]; kycStatus: string | null; kycRecommendation: string | null } | null;
};

const GENDERS = { male: "Male", female: "Female" };
const MARITAL = { single: "Single", married: "Married", other: "Others" };

/** Personal information as the payday and property-backed forms lay it out. */
function PersonalSection({ form, d, nameLabel }: { form: "payday" | "property_backed"; d: ApplicationPrint | null; nameLabel: string }) {
  const x = d?.details ?? {};
  const ref = form === "payday" ? "remita_reference" : "direct_debit_reference";
  return (
    <>
      <Band>Customer&rsquo;s personal information</Band>
      <Row label={nameLabel} value={d?.name} width="w-96" />
      <Row label="Membership Number" value={d?.membershipNo} />
      <p>
        Gender: <Choice options={GENDERS} value={d?.gender} /> &nbsp; Marital Status: <Choice options={MARITAL} value={x.marital_status} />
      </p>
      <Grid>
        <Row label="BVN" value={x.bvn} width="w-36" />
        <Row label="Date of Birth" value={d?.dateOfBirth && formatDate(d.dateOfBirth)} width="w-32" />
      </Grid>
      <Row label="Residential Address" value={d?.address} width="w-[120mm]" />
      <Row label="Nearest Bus Stop" value={d?.landmark} />
      <Row label="House Rent Expiration Date" value={x.house_rent_expiry && formatDate(x.house_rent_expiry)} />
      <Row label="Place of Worship & Address" value={x.place_of_worship} width="w-[110mm]" />
      <Grid>
        <Row label="Phone Number" value={d?.phone} width="w-36" />
        <Row label="Email Address" value={d?.email} width="w-40" />
        <Row label="Brother/Sister's Name" value={x.sibling_name} width="w-32" />
        <Row label="Phone Number" value={x.sibling_phone} width="w-36" />
      </Grid>
      <Row label="Residential Address" value={x.sibling_address} width="w-[120mm]" />
      <Grid>
        <Row label="Spouse's Name" value={x.spouse_name} width="w-36" />
        <Row label="Phone number" value={x.spouse_phone} width="w-36" />
      </Grid>
      <Row label={field(form, "application", ref).label} value={x[ref]} />
    </>
  );
}

function LoanInformation({ d, extra }: { d: ApplicationPrint | null; extra?: ReactNode }) {
  return (
    <>
      <Band>Loan information</Band>
      <Row label="Loan Amount (in words)" value={d && nairaInWords(d.amountRequested)} width="w-[110mm]" />
      <Row label="Loan Amount (in figure)" value={d && naira(d.amountRequested)} />
      <Grid>
        <Row label="Tenure" value={d && `${d.tenorMonths} month${d.tenorMonths === 1 ? "" : "s"}`} width="w-28" />
        <Row label="Loan Purpose" value={d?.purpose} width="w-44" />
      </Grid>
      {extra}
      <p>Loan Repayment Frequency: MONTHLY.</p>
    </>
  );
}

function dateParts(iso: string | null) {
  if (!iso) return { day: "……", month: "……………", year: "20……" };
  const dt = new Date(`${iso}T00:00:00`);
  return { day: String(dt.getDate()), month: dt.toLocaleString("en-GB", { month: "long" }), year: String(dt.getFullYear()) };
}

const BLANK_NAME = "…………………………………………………………";

function PaydayApplication({ d }: { d: ApplicationPrint | null }) {
  const x = d?.details ?? {};
  return (
    <>
      <Title>{FORMS.payday.applicationTitle}</Title>
      <PersonalSection form="payday" d={d} nameLabel="Name" />
      <Band>Employment information</Band>
      <Row label="Employer's Name" value={d?.employerName} width="w-96" />
      <Row label="Address" value={d?.employerAddress} width="w-[120mm]" />
      <Grid>
        <Row label="Nearest Bus stop" value={x.employer_bus_stop} width="w-36" />
        <Row label="Designation" value={d?.occupation} width="w-36" />
        <Row label="Nature of work" value={x.nature_of_work} width="w-36" />
        <Row label="No. of Years/months in organization" value={x.years_in_organisation} width="w-20" />
      </Grid>
      <Row label="Total existing loans with other Banks" value={x.existing_loans && naira(x.existing_loans)} />
      <Row label="Bank Name(s)" value={x.other_banks} width="w-96" />
      <LoanInformation
        d={d}
        extra={
          <Grid>
            <Row label="Interest Rate" value={d && `${Number(d.interestRate)}% monthly`} width="w-28" />
            <Row label="Processing Fee" width="w-32" />
          </Grid>
        }
      />
      <Band>Account details</Band>
      <Grid>
        <Row label="Account Name" value={x.account_name} width="w-40" />
        <Row label="Account Number" value={x.account_number} width="w-32" />
      </Grid>
      <Row label="Bank Name" value={x.account_bank} />
      <p className="mt-3 text-justify break-inside-avoid">
        <strong>DECLARATION:</strong> {DECLARATIONS.payday(d?.name ?? BLANK_NAME)}
      </p>
      <SignLine name={d?.name} />
    </>
  );
}

function PropertyApplication({ d }: { d: ApplicationPrint | null }) {
  const x = d?.details ?? {};
  const p = dateParts(d?.applicationDate ?? null);
  return (
    <>
      <Title>{FORMS.property_backed.applicationTitle}</Title>
      <PersonalSection form="property_backed" d={d} nameLabel="Account Name" />
      <Band>Business information</Band>
      <Row label="Business Name" value={d?.employerName} width="w-96" />
      <Row label="Business Address" value={d?.employerAddress} width="w-[120mm]" />
      <Grid>
        <Row label="When will your rent expire?" value={x.business_rent_expiry && formatDate(x.business_rent_expiry)} width="w-28" />
        <Row label="Nearest Bus stop" value={x.business_bus_stop} width="w-36" />
        <Row label="Nature of business" value={x.nature_of_business} width="w-36" />
        <Row label="No. of Years in Business" value={x.years_in_business} width="w-24" />
      </Grid>
      <Row label="Total existing loans with other Banks" value={x.existing_loans && naira(x.existing_loans)} />
      <Row label="Bank Name" value={x.other_banks} width="w-96" />
      <LoanInformation d={d} />
      <p className="mt-3 text-justify break-inside-avoid">
        <strong>DECLARATION:</strong> {DECLARATIONS.property_backed(d?.name ?? BLANK_NAME, p.day, p.month, p.year)}
      </p>
      <SignLine name={d?.name} />
    </>
  );
}

/** The sale of assets agreement that goes with a property-backed loan, listing the collateral recorded on the loan. */
export function SaleOfAssets({ d }: { d: ApplicationPrint | null }) {
  const assets = d?.collaterals ?? [];
  const total = assets.reduce((s, a) => s + Number(a.value), 0);
  return (
    <div className="break-before-page">
      <Row label="NAME" value={d?.name} width="w-96" />
      <Row label="ADDRESS" value={d?.address} width="w-[120mm]" />
      <Row label="CITY/STATE" width="w-56" />
      <Row label="DATE" value={d && formatDate(d.applicationDate)} width="w-40" />
      <div className="mt-4 font-semibold">
        <p>THE MANAGER,</p>
        <p>SILVERKUUN COOPERATIVE SOCIETY LIMITED.</p>
        <Row label="ADDRESS" width="w-96" />
      </div>
      <p className="mt-3">Dear Sir,</p>
      <p className="mt-2 text-center font-bold underline">SALE OF ASSETS AGREEMENT.</p>
      <p className="mt-2 text-justify">
        {SALE_OF_ASSETS(d?.name ?? BLANK_NAME)} This sale is in consideration of a loan of{" "}
        <Blank width="w-32">{d && naira(d.approvedAmount ?? d.amountRequested)}</Blank> given to me by Silverkuun Cooperative Society Limited.
      </p>
      <p className="mt-2">
        All these assets have been sold to Silverkuun Cooperative Society Limited for <Blank width="w-32">{total > 0 ? naira(total) : undefined}</Blank>
      </p>
      <p className="mt-3 font-semibold">LIST OF ASSETS SOLD &amp; ADDRESSES.</p>
      <ol className="list-decimal space-y-1 pl-6">
        {[0, 1, 2, 3, 4].map((i) => (
          <li key={i}>
            <Blank width="w-[150mm]">{assets[i] && `${assets[i].description} (${naira(assets[i].value)})`}</Blank>
          </li>
        ))}
      </ol>
      <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 break-inside-avoid">
        <Row label="Customer Name" value={d?.name} width="w-40" />
        <Row label="Account Officer" value={d?.officerName} width="w-40" />
        <Row label="Signature" width="w-40" />
        <Row label="Signature" width="w-40" />
        <Row label="Compliance Officer" width="w-36" />
        <Row label="Branch Manager" value={d?.managerName} width="w-40" />
        <Row label="Signature" width="w-40" />
        <Row label="Signature" width="w-40" />
      </div>
      <p className="mt-6 text-right">Customer to affix stamp Signature: ………………………</p>
    </div>
  );
}

function AssetApplication({ d }: { d: ApplicationPrint | null }) {
  const x = d?.details ?? {};
  const f = (key: string) => field("kuun_asset", "application", key);
  const box = (on: boolean) => (on ? "☒" : "☐");
  return (
    <>
      <Title sub="“OWN IT NOW. LIVE BETTER. PAY WITH EASE.” Please complete this form in BLOCK LETTERS and attach all required supporting documents.">
        {FORMS.kuun_asset.applicationTitle}
      </Title>
      <Band>01 · Applicant / member information</Band>
      <Grid>
        <Row label="Full Name" value={d?.name} width="w-48" />
        <Row label="Membership No." value={d?.membershipNo} width="w-32" />
        <Row label="Date of Birth" value={d?.dateOfBirth && formatDate(d.dateOfBirth)} width="w-32" />
        <Row label="Phone No." value={d?.phone} width="w-36" />
        <Row label="Email" value={d?.email} width="w-44" />
        <Row label="Means of Identification" value={d?.idType} width="w-32" />
      </Grid>
      <Row label="Residential Address" value={d?.address} width="w-[120mm]" />
      <Grid>
        <Row label="Employment / Business Name" value={d?.employerName} width="w-36" />
        <Row label="Occupation / Position" value={d?.occupation} width="w-36" />
        <Row label="Years in Employment / Business" value={x.years_in_employment} width="w-20" />
        <Row label="Monthly Net Income" value={d?.monthlyIncome && naira(d.monthlyIncome)} width="w-32" />
        <Row label="Other Income" value={x.other_income && naira(x.other_income)} width="w-32" />
        <Row label="ID No." value={d?.idNumber} width="w-36" />
        <Row label="BVN" value={x.bvn} width="w-36" />
        <Row label="NIN No." value={d?.nin} width="w-36" />
      </Grid>

      <Band>02 · Asset financing request</Band>
      <p>
        Asset Category: <Choice options={f("asset_category").options!} value={x.asset_category} />{" "}
        {x.asset_category === "other" && <Blank>{x.asset_category_other}</Blank>}
      </p>
      <Row label="Description of Asset" value={x.asset_description} width="w-[120mm]" />
      <Grid>
        <Row label="Vendor / Supplier" value={x.vendor} width="w-40" />
        <Row label="Proforma Invoice No." value={x.proforma_invoice_no} width="w-32" />
        <Row label="Invoice Date" value={x.invoice_date && formatDate(x.invoice_date)} width="w-32" />
        <Row label="Total Asset Cost" value={x.asset_total_cost && naira(x.asset_total_cost)} width="w-32" />
        <Row label="Applicant Equity Contribution" value={x.equity_contribution && naira(x.equity_contribution)} width="w-28" />
        <p>
          Minimum 40% applicable: <Choice options={{ yes: "Yes", no: "No" }} value={x.equity_applicable} />
        </p>
        <Row label="Amount Requested" value={d && naira(d.amountRequested)} width="w-32" />
        <p>
          Preferred payment plan: {box(d?.frequency === "weekly")} Weekly {box(d?.frequency === "monthly")} Monthly · Tenor{" "}
          <Blank width="w-12">{d?.tenorMonths}</Blank> Months
        </p>
      </Grid>
      <Row label="Purpose / Reason for Asset Acquisition" value={d?.purpose} width="w-[110mm]" />

      <Band>03 · Repayment information</Band>
      <Row label="Preferred Repayment Method" value={d && REPAYMENT_MODES[d.repaymentMode]} />
      <Row label="Proposed Repayment" value={d && `${d.frequency === "weekly" ? "per week" : "per month"} (see the repayment schedule)`} />
      <p>
        Source of Repayment: <Choice options={f("repayment_source").options!} value={x.repayment_source} />{" "}
        {x.repayment_source === "other" && <Blank>{x.repayment_source_other}</Blank>}
      </p>

      <Band>04 · Declaration &amp; authorisation</Band>
      {DECLARATIONS.kuun_asset.map((p) => (
        <p key={p.slice(0, 20)} className="mb-1 text-justify">
          {p}
        </p>
      ))}
      <SignLine name={d?.name} label="Applicant's Name" />

      <Band>05 · Required attachments</Band>
      <p className="flex flex-wrap gap-x-4">
        {CHECKLISTS.kuun_asset.map((l) => (
          <span key={l.item}>☐ {l.label.replace(/ \(.*\)$/, "")}</span>
        ))}
      </p>

      <div className="break-before-page" />
      <Band>06 · Verification &amp; credit assessment · for official use only</Band>
      <p>
        Verification Method:{" "}
        {Object.entries(VERIFICATION_METHODS).map(([k, l]) => (
          <span key={k} className="mr-3">
            {box(!!d?.review?.methods.includes(k as VerificationMethod))} {l}
          </span>
        ))}
      </p>
      <p>
        KYC Verification Status: <Choice options={KYC_STATUSES} value={d?.review?.kycStatus} />
      </p>
      <p>
        KYC Verification Recommendation: <Choice options={KYC_RECOMMENDATIONS} value={d?.review?.kycRecommendation} />
      </p>
      <Grid>
        <Row label="Application Date" value={d && formatDate(d.applicationDate)} width="w-32" />
        <Row label="Branch" value={d?.branchName} width="w-32" />
        <Row label="Loan Officer / RM" value={d?.officerName} width="w-40" />
      </Grid>
      <p>
        Credit Search Result:{" "}
        <Choice
          options={{ satisfactory: "Satisfactory", unsatisfactory: "Unsatisfactory" }}
          value={d?.bureauCheck ? (d.bureauCheck === "adverse" ? "unsatisfactory" : "satisfactory") : null}
        />
      </p>
      <p>
        Credit Assessment: <Choice options={{ approve: "Recommended", decline: "Not Recommended" }} value={d?.recommendation} />
      </p>

      <Band>07 · Loan approval details</Band>
      <Grid>
        <Row label="Approved Amount" value={d?.approvedAmount && naira(d.approvedAmount)} width="w-32" />
        <Row label="Approved Tenor" value={d?.approvedAmount && `${d.tenorMonths} months`} width="w-28" />
        <Row label="Interest Rate (% Flat Monthly)" value={d?.approvedAmount && `${Number(d.interestRate)}%`} width="w-20" />
        <Row label="Management / Processing Fee" width="w-28" />
        <Row label="Insurance Premium" width="w-28" />
        <Row label="Equity Contribution" value={x.equity_contribution && naira(x.equity_contribution)} width="w-28" />
      </Grid>

      <Band>08 · Approval &amp; sign-off</Band>
      <Signatures
        rows={[
          { role: "Loan Officer / RM", name: d?.officerName },
          { role: "Branch Manager", name: d?.managerName },
          { role: "Credit / Approving Officer", name: d?.approverName, date: d?.approvedAt?.slice(0, 10) },
        ]}
      />
      <p className="mt-3">Remarks</p>
      {[0, 1, 2].map((i) => (
        <p key={i} className="mt-3 border-b border-dotted border-black">
          &nbsp;
        </p>
      ))}
    </>
  );
}

export function ApplicationForm({ form, d }: { form: KuunForm; d: ApplicationPrint | null }) {
  if (form === "payday") return <PaydayApplication d={d} />;
  if (form === "property_backed") return <PropertyApplication d={d} />;
  return <AssetApplication d={d} />;
}

// ---------------------------------------------------------------------------
// Guarantor
// ---------------------------------------------------------------------------

export type GuarantorPrint = {
  fullName: string;
  phone: string;
  address: string;
  relationship: string | null;
  occupation: string | null;
  employer: string | null;
  monthlyIncome: string | null;
  details: FormDetails;
  borrowerName: string;
  loanAmount: string;
  tenorMonths: number;
  date: string;
  officerName: string | null;
  managerName: string | null;
  confirmedBy: string | null;
  confirmationNote: string | null;
};

function PaydayOrPropertyGuarantor({ form, g }: { form: "payday" | "property_backed"; g: GuarantorPrint | null }) {
  const x = g?.details ?? {};
  const p = dateParts(g?.date ?? null);
  const ref = form === "payday" ? "remita_reference" : "direct_debit_reference";
  const amount = x.amount_guaranteed ?? g?.loanAmount;
  const conditions = form === "payday" ? [...GUARANTEE_CONDITIONS, PAYDAY_EXTRA_CONDITION] : GUARANTEE_CONDITIONS;
  const pledges = [1, 2, 3].map((n) => ({
    property: x[`pledged_${n}_property`],
    location: x[`pledged_${n}_location`],
    value: x[`pledged_${n}_value`],
  }));
  const pledgedTotal = pledges.reduce((s, a) => s + Number(a.value ?? 0), 0);
  return (
    <>
      <Title>{FORMS[form].guarantorTitle}</Title>
      <Row label="Name" value={g?.fullName} width="w-96" />
      <p>
        Gender: <Choice options={GENDERS} value={x.gender} /> &nbsp; Marital Status: <Choice options={MARITAL} value={x.marital_status} />
      </p>
      <Grid>
        <Row label="BVN" value={x.bvn} width="w-36" />
        <Row label="Date of Birth" value={x.date_of_birth && formatDate(x.date_of_birth)} width="w-32" />
      </Grid>
      <Row label="Residential Address" value={g?.address} width="w-[120mm]" />
      <Row label="Nearest Bus Stop" value={x.nearest_bus_stop} />
      <Row label="Place of Worship & Address" value={x.place_of_worship} width="w-[110mm]" />
      <Grid>
        <Row label="Phone Number" value={g?.phone} width="w-36" />
        <Row label="Email Address" value={x.email} width="w-40" />
        <Row label="Brother/Sister's Name" value={x.sibling_name} width="w-32" />
        <Row label="Phone Number" value={x.sibling_phone} width="w-36" />
      </Grid>
      <Row label="Residential Address" value={x.sibling_address} width="w-[120mm]" />
      <Grid>
        <Row label="Spouse's Name" value={x.spouse_name} width="w-36" />
        <Row label="Phone number" value={x.spouse_phone} width="w-36" />
      </Grid>
      <Row label={form === "payday" ? "Business/Employer's Name" : "Business Name"} value={g?.employer} width="w-96" />
      <Row label={form === "payday" ? "Business/ Employer's Address" : "Business Address"} value={x.employer_address} width="w-[110mm]" />
      <Grid>
        <Row label="Nearest Bus stop" value={x.employer_bus_stop} width="w-36" />
        <Row label="Nature of business" value={x.nature_of_business} width="w-36" />
        <Row label="No. of Years in Business" value={x.years_in_business} width="w-24" />
        <Row label="Annual Income" value={x.annual_income && naira(x.annual_income)} width="w-32" />
      </Grid>
      <Row label="Relationship to Borrower" value={g?.relationship} />
      <Row label={form === "payday" ? "Loan Amount Guaranteed" : "Loan Amount (in words)"} value={amount && (form === "payday" ? naira(amount) : nairaInWords(amount))} width="w-96" />
      <Row label={field(form, "guarantor", ref).label} value={x[ref]} />

      <p className="mt-3 text-justify">
        I <Blank width="w-48">{g?.fullName}</Blank> being of sound mind and body have read the terms and conditions of this loan and have
        irrevocably and unconditionally agreed to guarantee <Blank width="w-48">{g?.borrowerName}</Blank> for a loan amount of (NGN){" "}
        <Blank width="w-28">{amount && naira(amount).slice(1)}</Blank> Amount in words <Blank width="w-64">{amount && nairaInWords(amount)}</Blank>{" "}
        from Silverkuun Cooperative Society Ltd. This guarantee is dated this {p.day} day of {p.month} {p.year}.
        {form === "property_backed" && ` ${PROPERTY_PLEDGE[0]}`}
      </p>
      {form === "property_backed" && (
        <>
          <p className="mt-2 text-justify">{PROPERTY_PLEDGE[1]}</p>
          <p className="mt-2 font-semibold">Property, location and value.</p>
          <table className="w-full border-collapse text-[9pt]">
            <tbody>
              {pledges.map((a, i) => (
                <tr key={i}>
                  <td className="w-6 border border-neutral-400 px-2 py-1">{i + 1}</td>
                  <td className="border border-neutral-400 px-2 py-1">{a.property}</td>
                  <td className="border border-neutral-400 px-2 py-1">{a.location}</td>
                  <td className="border border-neutral-400 px-2 py-1 text-right">{a.value && naira(a.value)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} className="border border-neutral-400 px-2 py-1 font-semibold">
                  TOTAL VALUE:
                </td>
                <td className="border border-neutral-400 px-2 py-1 text-right font-semibold">{pledgedTotal > 0 && naira(pledgedTotal)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-justify">{PROPERTY_ATTACH}</p>
        </>
      )}
      <p className="mt-2">The conditions of this guarantee are:</p>
      <ol className="list-decimal space-y-1 pl-6 text-justify">
        {conditions.map((c) => (
          <li key={c.slice(0, 20)}>{c}</li>
        ))}
      </ol>
      <p className="mt-2 font-semibold">Please note that it is RISKY to guaranty someone you do not know well.</p>
      <SignLine name={g?.fullName} label="Guarantor Name" />
    </>
  );
}

function AssetGuarantor({ g }: { g: GuarantorPrint | null }) {
  const x = g?.details ?? {};
  const f = (key: string) => field("kuun_asset", "guarantor", key);
  return (
    <>
      <Title sub="Guarantor Information & Undertaking">{FORMS.kuun_asset.guarantorTitle}</Title>
      <Grid>
        <Row label="Applicant's Name" value={g?.borrowerName} width="w-44" />
        <Row label="Loan Amount" value={g && naira(g.loanAmount)} width="w-32" />
        <Row label="Tenor" value={g && `${g.tenorMonths} months`} width="w-24" />
      </Grid>
      <Band>01 · Guarantor information</Band>
      <Grid>
        <Row label="Full Name" value={g?.fullName} width="w-48" />
        <Row label="Relationship with Applicant" value={g?.relationship} width="w-32" />
        <Row label="Phone No." value={g?.phone} width="w-36" />
        <Row label="Email" value={x.email} width="w-44" />
        <Row label="Means of Identification" value={displayValue(f("id_type"), x.id_type, money, date)} width="w-36" />
        <Row label="ID No." value={x.id_number} width="w-36" />
      </Grid>
      <Row label="Residential Address" value={g?.address} width="w-[120mm]" />
      <Grid>
        <Row label="Occupation / Business" value={g?.occupation} width="w-36" />
        <Row label="Employer / Business Name" value={g?.employer} width="w-36" />
        <Row label="Position" value={x.position} width="w-36" />
        <Row label="Years in Employment / Business" value={x.years_in_business} width="w-20" />
        <Row label="Monthly Net Income / Business Income" value={g?.monthlyIncome && naira(g.monthlyIncome)} width="w-28" />
        <Row label="BVN" value={x.bvn} width="w-36" />
        <Row label="NIN No." value={x.nin} width="w-36" />
      </Grid>
      <Band>02 · Financial information</Band>
      <DetailRows fields={FORMS.kuun_asset.guarantor[1].fields.filter((ff) => !ff.key.startsWith("residential"))} details={x} />
      <p>
        Residential Status: <Choice options={f("residential_status").options!} value={x.residential_status} />{" "}
        {x.residential_status === "other" && <Blank>{x.residential_status_other}</Blank>}
      </p>
      <Band>03 · Guarantor undertaking</Band>
      <p className="text-justify">
        I, <Blank width="w-56">{g?.fullName}</Blank>, {ASSET_UNDERTAKING[0]}
      </p>
      {ASSET_UNDERTAKING.slice(1).map((p) => (
        <p key={p.slice(0, 20)} className="mt-1 text-justify">
          {p}
        </p>
      ))}
      <SignLine name={g?.fullName} label="Guarantor's Full Name" />
      <Band>04 · Guarantor document checklist</Band>
      <p className="flex flex-wrap gap-x-4">
        {ASSET_GUARANTOR_DOCUMENTS.map((l) => (
          <span key={l}>☐ {l}</span>
        ))}
      </p>
      <Band>05 · Verification · for official use only</Band>
      <Grid>
        <Row label="Guarantor Verified By" value={g?.confirmedBy} width="w-40" />
        <Row label="Verification Status" value={g?.confirmedBy ? "Confirmed" : undefined} width="w-32" />
      </Grid>
      <p>
        KYC Verification Method:{" "}
        {Object.values(VERIFICATION_METHODS).map((l) => (
          <span key={l} className="mr-3">
            ☐ {l}
          </span>
        ))}
      </p>
      {g?.confirmationNote && <Row label="Note" value={g.confirmationNote} width="w-[110mm]" />}
      <Grid>
        <Row label="Estimated Capacity to Guarantee" width="w-32" />
        <Row label="Credit Search" width="w-32" />
        <Row label="Related Party" width="w-32" />
        <Row label="Recommendation" width="w-32" />
        <Row label="Loan Officer / RM" value={g?.officerName} width="w-40" />
      </Grid>
      <Band>06 · Approval &amp; sign-off</Band>
      <Signatures
        rows={[
          { role: "Loan Officer / RM", name: g?.officerName },
          { role: "Branch Manager", name: g?.managerName },
          { role: "Approving Authority" },
        ]}
      />
    </>
  );
}

export function GuarantorForm({ form, g }: { form: KuunForm; g: GuarantorPrint | null }) {
  return form === "kuun_asset" ? <AssetGuarantor g={g} /> : <PaydayOrPropertyGuarantor form={form} g={g} />;
}

// ---------------------------------------------------------------------------
// Checklist
// ---------------------------------------------------------------------------

export type ChecklistPrint = {
  name: string;
  membershipNo: string | null;
  answers: Record<string, { answer: ChecklistAnswer; remark: string | null }>;
  reviewerName: string | null;
  reviewedAt: string | null;
  note: string | null;
  approvedAmount: string | null;
  approvalNote: string | null;
  officerName: string | null;
  evaluatorName: string | null;
  evaluatedAt: string | null;
  headOfCreditName: string | null;
  headOfCreditAt: string | null;
  headOfBusinessName: string | null;
  headOfBusinessAt: string | null;
  managerName: string | null;
};

export function ComplianceChecklist({ form, c }: { form: KuunForm; c: ChecklistPrint | null }) {
  return (
    <>
      <h2 className="mb-3 text-center text-[13pt] font-extrabold uppercase">{FORMS[form].checklistTitle}</h2>
      <Row label="Name of Customer" value={c?.name} width="w-96" />
      <Row label="Membership No." value={c?.membershipNo} />
      <table className="mt-3 w-full border-collapse text-[9.5pt]">
        <thead>
          <tr className="bg-amber-100">
            <th className="border border-neutral-400 px-2 py-1 text-left">DOCUMENT</th>
            <th className="w-12 border border-neutral-400 px-2 py-1">YES</th>
            <th className="w-12 border border-neutral-400 px-2 py-1">NO</th>
            <th className="border border-neutral-400 px-2 py-1 text-left">REMARK</th>
          </tr>
        </thead>
        <tbody>
          {CHECKLISTS[form].map((l) => {
            const a = c?.answers[l.item];
            return (
              <tr key={l.item} className="break-inside-avoid">
                <td className="border border-neutral-400 px-2 py-1.5">{l.label}</td>
                <td className="border border-neutral-400 px-2 py-1.5 text-center">{a?.answer === "yes" ? "✓" : ""}</td>
                <td className="border border-neutral-400 px-2 py-1.5 text-center">{a?.answer === "no" ? "✗" : ""}</td>
                <td className="border border-neutral-400 px-2 py-1.5">
                  {a?.answer === "not_applicable" ? CHECKLIST_ANSWERS.not_applicable : ""}
                  {a?.remark ? `${a.answer === "not_applicable" ? ": " : ""}${a.remark}` : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {c?.note && <p className="mt-2">Note: {c.note}</p>}
      <div className="mt-4 grid grid-cols-3 gap-4 break-inside-avoid">
        <Row label="Compliance Name" value={c?.reviewerName} width="w-36" />
        <Row label="Signature" width="w-28" />
        <Row label="Date" value={c?.reviewedAt && formatDate(c.reviewedAt)} width="w-24" />
      </div>

      {form === "property_backed" && (
        <div className="mt-6 break-inside-avoid">
          <Band>Approval section</Band>
          <Row label="Customer Name" value={c?.name} width="w-96" />
          <Row label="Membership No." value={c?.membershipNo} />
          <Row label="Amount Approved" value={c?.approvedAmount && naira(c.approvedAmount)} />
          <p className="mt-1">Credit Committee Comment:</p>
          <p className="min-h-[14mm] border-b border-dotted border-black">{c?.approvalNote}</p>
          <Signatures
            rows={[
              { role: "Account Officer", name: c?.officerName },
              { role: "Evaluation Officer", name: c?.evaluatorName, date: c?.evaluatedAt?.slice(0, 10) },
              { role: "Marketing Manager" },
              { role: "Head of Credit", name: c?.headOfCreditName, date: c?.headOfCreditAt?.slice(0, 10) },
              { role: "Head of Business", name: c?.headOfBusinessName, date: c?.headOfBusinessAt?.slice(0, 10) },
              { role: "Branch Manager", name: c?.managerName },
              { role: "Director" },
            ]}
          />
        </div>
      )}
    </>
  );
}

export const frequencyLabel = (f: RepaymentFrequency) => REPAYMENT_FREQUENCIES[f];
