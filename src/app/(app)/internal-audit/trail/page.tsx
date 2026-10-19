import { redirect } from "next/navigation";

export default function AuditTrailPage() {
  redirect("/internal-audit/reports/audit-trail");
}
