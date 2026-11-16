import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { getCurrentStaff } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { listBranches } from "@/modules/administration/queries";
import { createSignupLink, revokeSignupLink } from "@/modules/clients/actions";
import { LinkForm } from "@/modules/clients/components/link-form";
import { LINK_STATES } from "@/modules/clients/constants";
import { linkState, listMyLinks } from "@/modules/clients/queries";

/** Any staff member sends a client a one-time link to fill the member form themselves. */
export default async function SignupLinksPage() {
  const staff = await getCurrentStaff();
  const [branches, links] = await Promise.all([listBranches(), listMyLinks()]);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const now = Date.now();

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Sign-up links"
        description="Send a client a link to fill the member form and upload their documents themselves, without visiting the branch. Their file comes to you to confirm, then the Operations Officer completes it and the Branch Manager approves it."
      />

      <Card title="New link">
        <LinkForm action={createSignupLink} branches={branches} defaultBranchId={staff.homeBranchId} />
        <p className="mt-4 text-xs text-zinc-500">
          Each link works once and closes when it expires. Anyone holding it can open the form, so send it only to your client. Only a
          scrambled copy is stored, so the link can&apos;t be shown again: create a new one if it&apos;s lost.
        </p>
      </Card>

      <Card title="Your links">
        {links.length === 0 ? (
          <EmptyState>You haven&apos;t created any links yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-zinc-200 text-zinc-500">
                <tr>
                  <th className="px-3 py-2 font-medium">For</th>
                  <th className="px-3 py-2 font-medium">Branch</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium">Closes</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {links.map((l) => {
                  const state = linkState(l, now);
                  return (
                    <tr key={l.id} className="border-b border-zinc-100 last:border-0">
                      <td className="px-3 py-2">{l.client_name ?? <span className="text-zinc-500">Not named</span>}</td>
                      <td className="px-3 py-2">{branchName.get(l.branch_id) ?? "—"}</td>
                      <td className="px-3 py-2">{formatDateTime(l.created_at)}</td>
                      <td className="px-3 py-2">{formatDateTime(l.expires_at)}</td>
                      <td className="px-3 py-2">
                        <Badge tone={LINK_STATES[state].tone}>{LINK_STATES[state].label}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {state === "used" && l.member_id && (
                          <Link href={`/clients/${l.member_id}`} className="text-sm underline-offset-4 hover:underline">
                            Open file
                          </Link>
                        )}
                        {state === "open" && (
                          <ActionButton
                            action={revokeSignupLink.bind(null, l.id)}
                            label="Switch off"
                            pendingLabel="Switching off…"
                            variant="secondary"
                            confirm="Switch this link off? The client won't be able to use it."
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
