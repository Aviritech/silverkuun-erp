import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireModule } from "@/lib/auth/session";
import { formatDate } from "@/lib/format";
import { hrModule } from "@/modules/hr/module";
import { listDepartments } from "@/modules/hr/queries";
import { scheduleTraining } from "@/modules/hr/training/actions";
import { TrainingForm } from "@/modules/hr/training/components";
import { TRAINING_STATUSES } from "@/modules/hr/training/constants";
import { listTrainings, seatsTaken, today, type Training } from "@/modules/hr/training/queries";

function TrainingTable({ trainings, taken, departmentName }: { trainings: Training[]; taken: Map<string, number>; departmentName: Map<string, string> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-zinc-500">
          <tr>
            <th className="py-2 pr-4 font-medium">Training</th>
            <th className="py-2 pr-4 font-medium">Dates</th>
            <th className="py-2 pr-4 font-medium">Where</th>
            <th className="py-2 pr-4 font-medium">For</th>
            <th className="py-2 pr-4 font-medium">Enrolled</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {trainings.map((t) => {
            const s = TRAINING_STATUSES[t.status];
            const count = taken.get(t.id) ?? 0;
            return (
              <tr key={t.id} className="border-b border-zinc-100 align-top last:border-0 hover:bg-zinc-50">
                <td className="py-2 pr-4">
                  <Link href={`/hr/training/${t.id}`} className="font-medium hover:underline">
                    {t.title}
                  </Link>
                  {t.trainer && <div className="text-xs text-zinc-500">{t.trainer}</div>}
                </td>
                <td className="whitespace-nowrap py-2 pr-4">
                  {formatDate(t.starts_on)}
                  {t.ends_on !== t.starts_on && <> to {formatDate(t.ends_on)}</>}
                </td>
                <td className="py-2 pr-4">{t.is_virtual ? "Online" : (t.venue ?? "—")}</td>
                <td className="py-2 pr-4">
                  {t.departments.length === 0 ? "Everyone" : t.departments.map((d) => departmentName.get(d) ?? d).join(", ")}
                </td>
                <td className="py-2 pr-4 tabular-nums">
                  {count}
                  {t.capacity !== null && ` of ${t.capacity}`}
                  {t.capacity !== null && count >= t.capacity && t.status === "scheduled" && (
                    <span className="ml-2">
                      <Badge tone="amber">Full</Badge>
                    </span>
                  )}
                </td>
                <td className="py-2">
                  <Badge tone={s.tone}>{s.label}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function TrainingPage() {
  const staff = await requireModule(hrModule);
  const [trainings, departments] = await Promise.all([listTrainings(), listDepartments()]);
  const taken = await seatsTaken(trainings.map((t) => t.id));
  const departmentName = new Map(departments.map((d) => [d.code, d.name]));
  const now = today();
  const upcoming = trainings.filter((t) => t.status === "scheduled" && t.ends_on >= now).reverse();
  const past = trainings.filter((t) => !upcoming.includes(t));

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader title="Training" description="Scheduled courses, who is enrolled, and how they did." />
      {staff.permissions.has("training.manage") && <TrainingForm action={scheduleTraining} departments={departments} />}

      <Card title="Upcoming and running">
        {upcoming.length === 0 ? (
          <EmptyState>No training is scheduled.</EmptyState>
        ) : (
          <TrainingTable trainings={upcoming} taken={taken} departmentName={departmentName} />
        )}
      </Card>

      <Card title="Past">
        {past.length === 0 ? (
          <EmptyState>No past training yet.</EmptyState>
        ) : (
          <TrainingTable trainings={past} taken={taken} departmentName={departmentName} />
        )}
      </Card>
    </div>
  );
}
