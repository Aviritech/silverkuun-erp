import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { formatDateTime, formatMoney } from "@/lib/format";
import { hrModule } from "@/modules/hr/module";
import { saveSettings } from "@/modules/hr/payroll/actions";
import { SettingsForm } from "@/modules/hr/payroll/components/forms";
import { monthLabel, thisMonth } from "@/modules/hr/payroll/constants";
import { listSettings, type PayeBand } from "@/modules/hr/payroll/queries";

/** Nigeria Tax Act 2025 and Pension Reform Act 2014, as in the first version the database starts with. */
const STARTING_VALUES = {
  pension_employee_rate: 8,
  pension_employer_rate: 10,
  nhf_rate: 2.5,
  rent_relief_rate: 20,
  rent_relief_cap: 500000,
  paye_bands: [
    { upto: 800000, rate: 0 },
    { upto: 3000000, rate: 15 },
    { upto: 12000000, rate: 18 },
    { upto: 25000000, rate: 21 },
    { upto: 50000000, rate: 23 },
    { upto: null, rate: 25 },
  ],
  note: null,
};

function percent(v: number) {
  return `${Number(v).toLocaleString("en-NG", { maximumFractionDigits: 2 })}%`;
}

function Bands({ bands }: { bands: PayeBand[] }) {
  let lower = 0;
  return (
    <table className="w-full max-w-md text-sm">
      <tbody>
        {bands.map((b, i) => {
          const text =
            b.upto === null
              ? `Above ${formatMoney(lower)}`
              : i === 0
                ? `First ${formatMoney(b.upto)}`
                : `${formatMoney(lower)} to ${formatMoney(b.upto)}`;
          lower = b.upto ?? lower;
          return (
            <tr key={i} className="border-b border-zinc-100 last:border-0">
              <td className="py-1 pr-3">{text}</td>
              <td className="py-1 text-right tabular-nums">{percent(b.rate)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default async function PayrollSettingsPage() {
  const staff = await requireModule(hrModule);
  if (!staff.permissions.has("payroll.read") && !staff.permissions.has("payroll.config")) notFound();
  const canConfig = staff.permissions.has("payroll.config");
  const { settings, usedByApprovedRun, staffName } = await listSettings();
  const latest = settings[0];

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Tax and pension settings"
        description={
          <>
            The rates and PAYE bands each payroll uses. A payroll uses the latest version starting on or before its month.{" "}
            <Link href="/hr/payroll" className="underline-offset-4 hover:underline">
              Back to payroll
            </Link>
          </>
        }
      />

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        The starting values are the Nigeria Tax Act 2025 PAYE bands (from January 2026) and the Pension Reform Act 2014 rates: 8%
        employee and 10% employer pension, 2.5% NHF on basic, and rent relief of 20% of annual rent up to ₦500,000. Confirm them with
        the company&apos;s tax adviser before the first payroll, and whenever the law changes.
      </div>

      {canConfig && (
        <SettingsForm
          action={saveSettings.bind(null, null)}
          openLabel="Add a new version"
          editing={false}
          initial={{ ...(latest ?? STARTING_VALUES), effective_from: thisMonth() }}
        />
      )}

      {settings.length === 0 ? (
        <Card>
          <EmptyState>No settings yet.</EmptyState>
        </Card>
      ) : (
        settings.map((s) => {
          const locked = usedByApprovedRun(s.effective_from);
          return (
            <Card
              key={s.effective_from}
              title={`From ${monthLabel(s.effective_from)}`}
              actions={locked ? <Badge tone="gray">Used by an approved payroll</Badge> : undefined}
            >
              <div className="grid gap-6 md:grid-cols-2">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-zinc-500">Employee pension</dt>
                    <dd>{percent(s.pension_employee_rate)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500">Employer pension</dt>
                    <dd>{percent(s.pension_employer_rate)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500">NHF (of basic)</dt>
                    <dd>{percent(s.nhf_rate)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-zinc-500">Rent relief</dt>
                    <dd>
                      {percent(s.rent_relief_rate)} of rent, up to {formatMoney(s.rent_relief_cap)} a year
                    </dd>
                  </div>
                  <div className="col-span-2 text-xs text-zinc-500">
                    {s.note && <p className="mb-1 text-sm text-zinc-700">{s.note}</p>}
                    {s.updated_by && (
                      <p>
                        Last changed by {staffName(s.updated_by)}, {formatDateTime(s.updated_at)}
                      </p>
                    )}
                  </div>
                </dl>
                <div>
                  <p className="mb-1 text-xs text-zinc-500">PAYE bands on annual taxable income</p>
                  <Bands bands={s.paye_bands} />
                </div>
              </div>
              {canConfig && !locked && (
                <div className="mt-4">
                  <SettingsForm action={saveSettings.bind(null, s.effective_from)} openLabel="Edit" editing initial={s} />
                </div>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
