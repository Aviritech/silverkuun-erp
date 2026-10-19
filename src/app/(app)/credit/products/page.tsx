import { Badge, PageHeader } from "@/components/ui";
import { requireModule, requirePermission } from "@/lib/auth/session";
import { formatMoney } from "@/lib/format";
import { saveProduct } from "@/modules/credit/actions";
import { ProductForm } from "@/modules/credit/components/forms";
import { INTEREST_METHODS, RATE_BASES } from "@/modules/credit/constants";
import { creditModule } from "@/modules/credit/module";
import { listProducts } from "@/modules/credit/queries";

export default async function LoanProductsPage() {
  const staff = await requireModule(creditModule);
  await requirePermission("credit.read");
  const products = await listProducts();
  const canEdit = staff.permissions.has("credit.config");

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Loan products"
        description="The rate, limits and requirements each new application starts from. Changes apply to new applications only; existing loans keep their agreed terms."
        actions={canEdit && <ProductForm action={saveProduct.bind(null, null)} />}
      />
      <div className="space-y-3">
        {products.map((p) => (
          <div key={p.code} className="rounded-xl border border-zinc-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-medium">
                  {p.name} {!p.is_active && <Badge tone="gray">Closed to new applications</Badge>}
                </h2>
                {p.description && <p className="mt-0.5 text-sm text-zinc-600">{p.description}</p>}
                <p className="mt-2 text-sm">
                  {Number(p.interest_rate)}
                  {RATE_BASES[p.rate_basis]}, {INTEREST_METHODS[p.interest_method].toLowerCase()} · {formatMoney(p.min_amount)} to{" "}
                  {p.max_amount ? formatMoney(p.max_amount) : "no limit"} · up to {p.max_tenor_months} months
                </p>
                <p className="mt-1 flex flex-wrap gap-2 text-xs">
                  {p.requires_guarantor && <Badge tone="blue">Guarantor</Badge>}
                  {p.requires_collateral && <Badge tone="blue">Collateral</Badge>}
                  {p.requires_proforma && <Badge tone="blue">Proforma invoice</Badge>}
                </p>
              </div>
              {canEdit && <ProductForm action={saveProduct.bind(null, p.code)} product={p} />}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-6 text-sm text-zinc-500">The starting rates and limits are placeholders until Kuun confirms its loan policy.</p>
    </div>
  );
}
