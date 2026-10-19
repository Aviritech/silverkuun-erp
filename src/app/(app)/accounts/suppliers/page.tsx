import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { addSupplier, setSupplierActive } from "@/modules/accounts/actions";
import { SupplierForm } from "@/modules/accounts/components/bill-forms";
import { accountsModule } from "@/modules/accounts/module";
import { listSuppliers } from "@/modules/accounts/queries";

export default async function SuppliersPage() {
  await requireModule(accountsModule);
  const staff = await requirePermission("accounts.read");
  const supabase = await createClient();
  const [suppliers, balances] = await Promise.all([
    listSuppliers(),
    supabase.from("supplier_bill_balances").select("supplier_id, outstanding").eq("status", "posted"),
  ]);
  if (balances.error) throw dbFailure(balances.error);
  const owed = new Map<string, number>();
  for (const b of balances.data) owed.set(b.supplier_id, (owed.get(b.supplier_id) ?? 0) + Number(b.outstanding));
  const canManage = staff.permissions.has("accounts.suppliers.manage");

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Suppliers"
        description="The people and companies the Society buys from. Their bills are recorded under Bills and paid as supplier payments."
        actions={
          <Link href="/accounts/bills" className="text-sm underline">
            Bills
          </Link>
        }
      />
      <Card actions={canManage && <SupplierForm action={addSupplier} />}>
        {suppliers.length === 0 ? (
          <EmptyState>No suppliers yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 pr-3 font-medium">Supplier</th>
                  <th className="py-1 pr-3 font-medium">Contact</th>
                  <th className="py-1 pr-3 font-medium">Bank details</th>
                  <th className="py-1 pr-3 font-medium">TIN</th>
                  <th className="py-1 pr-3 text-right font-medium">Owed</th>
                  <th className="py-1 font-medium" />
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id} className="border-t border-zinc-100 align-top">
                    <td className="py-2 pr-3">
                      <Link href={`/accounts/bills?supplier=${s.id}`} className="font-medium hover:underline">
                        {s.name}
                      </Link>{" "}
                      {!s.is_active && <Badge>Not in use</Badge>}
                      {s.address && <span className="block text-xs text-zinc-500">{s.address}</span>}
                    </td>
                    <td className="py-2 pr-3">
                      {[s.contact_person, s.phone, s.email].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="py-2 pr-3">{[s.bank_name, s.account_number].filter(Boolean).join(" ") || "—"}</td>
                    <td className="py-2 pr-3">{s.tax_id ?? "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatMoney(owed.get(s.id) ?? 0)}</td>
                    <td className="py-2 text-right">
                      {canManage && (
                        <ActionButton
                          action={setSupplierActive.bind(null, s.id, !s.is_active)}
                          label={s.is_active ? "Stop using" : "Use again"}
                          variant="secondary"
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
