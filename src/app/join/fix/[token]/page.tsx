import type { Metadata } from "next";
import { formatDateTime } from "@/lib/format";
import { serviceClient } from "@/lib/supabase/admin";
import type { CbnBank, Member } from "@/modules/administration/queries";
import { JoinNotice, JoinShell } from "@/modules/clients/components/join-shell";
import { SignupForm } from "@/modules/clients/components/signup-form";
import { openFixLink, pageViewAllowed } from "@/modules/clients/signup";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Correct your Silverkuun form",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** A client corrects the member form they filled in, after staff sent it back. Opened from a one-time link. No login. */
export default async function FixPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await pageViewAllowed())) {
    return <JoinNotice title="Please wait a little">Too many pages were opened from this connection. Try again in an hour.</JoinNotice>;
  }
  const link = await openFixLink(token);
  if (link === "invalid") {
    return (
      <JoinNotice title="This link isn't valid">
        Check you copied the whole link, or ask the Silverkuun staff member who sent it for a new one.
      </JoinNotice>
    );
  }
  if (link === "closed") {
    return (
      <JoinNotice title="This link has closed">
        It has expired, has already been used, or your file has already been corrected. If something still needs fixing, ask the
        Silverkuun staff member who sent it for a new link.
      </JoinNotice>
    );
  }

  const { data: banks } = await serviceClient().from("cbn_banks").select("code, name").order("name");

  return (
    <JoinShell>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Silverkuun membership</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">Please correct your form</h1>
      <p className="mt-2 max-w-2xl text-sm text-zinc-700">
        {link.staffName} at our {link.branchName} branch sent your membership form back. Your answers are filled in below: correct what
        is needed and send it again. The link works once, until {formatDateTime(link.expiresAt)}.
      </p>
      <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        <p className="font-medium">What needs correcting</p>
        <p className="mt-1 whitespace-pre-line">{link.returnReason}</p>
      </div>
      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 sm:p-6">
        <SignupForm
          token={token}
          banks={(banks ?? []) as CbnBank[]}
          staffName={link.staffName}
          fix={{ member: link.member as Partial<Member>, documents: link.documents }}
        />
      </div>
    </JoinShell>
  );
}
