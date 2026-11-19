import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Letter } from "@/components/letter";
import { requireModule } from "@/lib/auth/session";
import { today } from "@/lib/reports/filters";
import { ApplicationForm, ComplianceChecklist, GuarantorForm, SaleOfAssets } from "@/modules/credit/components/kuun-form-print";
import { FORMS, isKuunForm } from "@/modules/credit/loan-forms";
import { creditModule } from "@/modules/credit/module";

export const metadata: Metadata = { title: "Blank loan form · Silverkuun ERP" };

const PARTS = { application: "application form", guarantor: "guarantor form", checklist: "compliance checklist" } as const;

/** A blank copy of one of Kuun's loan forms, to hand to a customer or guarantor to fill in by hand. */
export default async function BlankLoanFormPage({ params }: { params: Promise<{ form: string; part: string }> }) {
  await requireModule(creditModule);
  const { form, part } = await params;
  if (!isKuunForm(form) || !Object.hasOwn(PARTS, part)) notFound();
  const p = part as keyof typeof PARTS;

  return (
    <Letter
      title={`${FORMS[form].name} · blank ${PARTS[p]}`}
      date={today()}
      backHref="/credit/products"
      backLabel="Back to loan products"
      notes="A blank copy to fill in by hand. Once the customer has filled it in, the officer enters it on a new application."
    >
      {p === "application" && (
        <>
          <ApplicationForm form={form} d={null} />
          {form === "property_backed" && <SaleOfAssets d={null} />}
        </>
      )}
      {p === "guarantor" && <GuarantorForm form={form} g={null} />}
      {p === "checklist" && <ComplianceChecklist form={form} c={null} />}
    </Letter>
  );
}
