import type { Metadata } from "next";
import { formatDateTime } from "@/lib/format";
import { serviceClient } from "@/lib/supabase/admin";
import type { CbnBank } from "@/modules/administration/queries";
import { JoinNotice as Notice, JoinShell as Shell } from "@/modules/clients/components/join-shell";
import { SignupForm } from "@/modules/clients/components/signup-form";
import { openLink, pageViewAllowed } from "@/modules/clients/signup";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Join Silverkuun",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** The client's own sign-up form, opened from a one-time link a staff member sent them. No login. */
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await pageViewAllowed())) {
    return <Notice title="Please wait a little">Too many pages were opened from this connection. Try again in an hour.</Notice>;
  }
  const link = await openLink(token);
  if (link === "invalid") {
    return <Notice title="This link isn't valid">Check you copied the whole link, or ask the Silverkuun staff member who sent it for a new one.</Notice>;
  }
  if (link === "closed") {
    return (
      <Notice title="This link has closed">
        It has expired, has already been used, or was switched off. Ask the Silverkuun staff member who sent it for a new one.
      </Notice>
    );
  }

  const { data: banks } = await serviceClient().from("cbn_banks").select("code, name").order("name");

  return (
    <Shell>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Silverkuun membership</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
        {link.clientName ? `Welcome, ${link.clientName}` : "Become a member"}
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-zinc-700">
        {link.staffName} at our {link.branchName} branch sent you this form. Fill in your details and send it; {link.staffName} confirms
        them, then an officer completes your file and the Branch Manager approves your membership. The link works once, until{" "}
        {formatDateTime(link.expiresAt)}.
      </p>
      <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-4 sm:p-6">
        <SignupForm token={token} banks={(banks ?? []) as CbnBank[]} staffName={link.staffName} />
      </div>
    </Shell>
  );
}
