import { ActionButton } from "@/components/action-button";
import { Card } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { createFixLink, revokeFixLink } from "../actions";
import type { FixLink } from "../queries";
import { FixLinkForm } from "./link-form";

/**
 * A client's own sign-up that came back. The client has no login, so staff send them a one-time link to correct it;
 * the officer can also correct the file themselves. Shown to the staff member who brought them in and to officers.
 */
export function ReturnedSignupCard({
  memberId,
  openLink,
  openLinkBy,
  officerCanEdit,
}: {
  memberId: string;
  openLink: FixLink | null;
  /** Who made the open link, for the line that says one is waiting. */
  openLinkBy: string | null;
  /** True on the officer's view, where "Edit details" is the other way to fix it. */
  officerCanEdit: boolean;
}) {
  return (
    <Card title="Send it back to the client">
      <div className="space-y-4">
        <p className="max-w-2xl text-sm text-zinc-700">
          The client filled this form in themselves, so they can correct it. Create a link and send it to them: it opens their form with
          their answers and the reason above. When they send it, the file goes back to the staff member who brought them in to confirm
          again. {officerCanEdit ? "Or correct it yourself with Edit details and send it to staff." : "The Operations Officer can also correct it for them."}
        </p>
        {openLink && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-neutral-50 p-3 text-sm text-zinc-700 ring-1 ring-zinc-200">
            <span>
              A link{openLinkBy ? ` from ${openLinkBy}` : ""} is waiting for the client, open until {formatDateTime(openLink.expires_at)}.
              A new link replaces it.
            </span>
            <ActionButton
              action={revokeFixLink.bind(null, openLink.id, memberId)}
              label="Switch it off"
              pendingLabel="Switching off…"
              variant="secondary"
              confirm="Switch off the link the client has? They won't be able to use it."
            />
          </div>
        )}
        <FixLinkForm action={createFixLink.bind(null, memberId)} />
      </div>
    </Card>
  );
}
