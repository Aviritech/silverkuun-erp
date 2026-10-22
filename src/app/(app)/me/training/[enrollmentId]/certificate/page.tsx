import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { ButtonLink } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { employeeName } from "@/modules/hr/queries";
import { earnedCertificate, getMyEnrolment } from "@/modules/hr/training/queries";
import { requireMyEmployee } from "@/modules/me/queries";

export default async function CertificatePage({ params }: { params: Promise<{ enrollmentId: string }> }) {
  const { employee } = await requireMyEmployee();
  const { enrollmentId } = await params;
  const enrolment = await getMyEnrolment(enrollmentId, employee.id);
  if (!enrolment || !earnedCertificate(enrolment)) notFound();
  const t = enrolment.trainings;
  const hours = enrolment.hours_attended ?? t.hours;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="no-print flex flex-wrap justify-end gap-2">
        <ButtonLink href="/me/training" variant="secondary">
          Back to my training
        </ButtonLink>
        <PrintButton label="Print or save as PDF" />
      </div>

      <article className="relative border-[10px] border-double border-ink bg-white px-10 py-14 text-center shadow-sm print:shadow-none">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-zinc-500">Silverkuun Group</p>
        <h1 className="mt-4 font-serif text-4xl font-semibold tracking-tight text-ink">Certificate of completion</h1>
        <p className="mt-10 text-sm text-zinc-600">This is to certify that</p>
        <p className="mt-3 font-serif text-3xl text-ink">{employeeName(employee)}</p>
        <p className="mt-6 text-sm text-zinc-600">has successfully completed</p>
        <p className="mt-3 text-2xl font-semibold text-ink">{t.title}</p>
        <p className="mt-4 text-sm text-zinc-700">
          {formatDate(t.starts_on)}
          {t.ends_on !== t.starts_on && ` to ${formatDate(t.ends_on)}`}
          {hours && ` · ${Number(hours)} hours`}
          {enrolment.score !== null && ` · score ${Number(enrolment.score)}%`}
        </p>
        {t.trainer && <p className="mt-1 text-sm text-zinc-500">Delivered by {t.trainer}</p>}

        <div className="mt-16 flex flex-wrap items-end justify-between gap-8 text-left text-sm">
          <div>
            <div className="w-56 border-t border-zinc-400 pt-1 text-zinc-600">Head of Human Resources</div>
          </div>
          <div className="text-right text-xs text-zinc-500">
            Issued {formatDate(enrolment.completed_at)}
            <br />
            Certificate no. {enrolment.id.slice(0, 8).toUpperCase()}
          </div>
        </div>
      </article>
    </div>
  );
}
