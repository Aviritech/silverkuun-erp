import { Card, PageHeader } from "@/components/ui";
import { getCurrentStaff } from "@/lib/auth/session";
import { FollowUp, SpeakUpForm } from "@/modules/internal-audit/whistleblowing/speak-up-forms";

export default async function SpeakUpPage() {
  await getCurrentStaff();
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Speak up"
        description="Report fraud, theft, harassment, unsafe practice or anything else you think is wrong. Reports go only to Internal Audit."
      />

      <Card title="How your report is handled">
        <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-700">
          <li>Only Internal Audit can read reports. Your manager, HR and your branch can&apos;t see them.</li>
          <li>
            If you send anonymously, the ERP stores nothing about who sent it: no name, no login and no entry in the audit
            trail. Only the day it arrived is kept, not the time.
          </li>
          <li>
            To be honest about the limits: the company that hosts the ERP keeps request logs that record which login made a
            request, for a limited time. The ERP itself keeps nothing that links you to the report.
          </li>
          <li>
            You get a reference and an access code. With both, you can check progress, read questions from Internal Audit
            and reply, still anonymously.
          </li>
        </ul>
      </Card>

      <Card title="Make a report">
        <SpeakUpForm />
      </Card>

      <Card title="Follow up a report">
        <p className="mb-4 text-sm text-zinc-600">Enter the reference and access code you were given when you made the report.</p>
        <FollowUp />
      </Card>
    </div>
  );
}
