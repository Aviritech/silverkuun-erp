import { notFound } from "next/navigation";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { getCurrentStaff } from "@/lib/auth/session";
import { dbFailure } from "@/lib/db-errors";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { ReturnForm, StaffConfirmForm } from "@/modules/administration/components/forms";
import { ID_TYPES, MEMBER_STATUSES } from "@/modules/administration/constants";
import { fullName, listBranches, type Member } from "@/modules/administration/queries";
import { confirmClient, returnClient } from "@/modules/clients/actions";
import { listMyClients } from "@/modules/clients/queries";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{children || "—"}</dd>
    </div>
  );
}

/**
 * A client the signed-in staff member brought in. They see the details to confirm them (staff outside Operations have
 * no other way in), and what the client has paid. Operations staff can also open the full file.
 */
export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await getCurrentStaff();
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.from("members").select("*").eq("id", id).maybeSingle();
  if (error) throw dbFailure(error);
  const member = data as Member | null;
  if (!member || member.introduced_by !== staff.id) notFound();

  const [branches, clients, names] = await Promise.all([
    listBranches(),
    listMyClients(),
    member.sent_to_marketer_by
      ? supabase.rpc("staff_display_names", { p_ids: [member.sent_to_marketer_by] })
      : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
  ]);
  const branch = branches.find((b) => b.id === member.branch_id);
  const totals = clients.find((c) => c.member_id === member.id);
  const officer = ((names.data ?? []) as { full_name: string }[])[0]?.full_name;
  const status = MEMBER_STATUSES[member.status];
  const canConfirm = member.status === "with_marketer" && member.sent_to_marketer_by !== staff.id;
  const seesFullFile = branch && staff.permissions.hasForBranch("members.read", branch) && staff.permissions.has("module.administration");

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title={fullName(member)}
        description={[member.membership_no, branch?.name, member.source === "self_signup" ? "Filled in by the client through your link" : null]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <div className="flex items-center gap-3">
            <Badge tone={status.tone}>{status.label}</Badge>
            {seesFullFile && (
              <ButtonLink href={`/administration/members/${member.id}`} variant="secondary">
                Open full file
              </ButtonLink>
            )}
          </div>
        }
      />

      {canConfirm && (
        <Card title="Confirm this client">
          <p className="mb-3 text-sm text-zinc-700">
            You were named as the person who brought this client in. Check the details below and confirm you know them. The file then goes
            to {officer ?? "the Operations Officer"} to finish the documents, and on to the Branch Manager. If you don&apos;t know this
            person or something is wrong, send it back with the reason.
          </p>
          <div className="flex flex-wrap items-start gap-3">
            <StaffConfirmForm action={confirmClient.bind(null, member.id)} />
            <ReturnForm action={returnClient.bind(null, member.id)} />
          </div>
        </Card>
      )}

      {member.status === "approved" && totals && (
        <Card title="Contributions">
          <dl className="grid gap-4 sm:grid-cols-4">
            <Detail label="Total contributions">
              <span className="text-base font-semibold tabular-nums">{formatMoney(totals.total_contributed)}</span>
            </Detail>
            <Detail label="Paid this month">{formatMoney(totals.paid_this_month)}</Detail>
            <Detail label="Open plans">{String(totals.open_plans)}</Detail>
            <Detail label="Last paid">{totals.last_paid_on ? formatDate(totals.last_paid_on) : "Nothing yet"}</Detail>
          </dl>
        </Card>
      )}

      <Card title="Details">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Detail label="Phone">{member.phone}</Detail>
          <Detail label="Email">{member.email}</Detail>
          <Detail label="Date of birth">{member.date_of_birth ? formatDate(member.date_of_birth) : null}</Detail>
          <Detail label="Address">
            {[member.address, member.address_city, member.address_lga, member.address_state].filter(Boolean).join(", ")}
            {member.address_landmark && <span className="block text-xs text-zinc-500">Near {member.address_landmark}</span>}
          </Detail>
          <Detail label="Means of ID">
            {ID_TYPES[member.id_type as keyof typeof ID_TYPES] ?? member.id_type} · {member.id_number}
          </Detail>
          <Detail label="NIN">{member.nin}</Detail>
          <Detail label="Next of kin">
            {[member.next_of_kin_name, member.next_of_kin_relationship, member.next_of_kin_phone].filter(Boolean).join(" · ")}
          </Detail>
          <Detail label="Started">{formatDateTime(member.created_at)}</Detail>
          <Detail label="Confirmed by you">{member.marketer_id === staff.id ? formatDateTime(member.marketer_reviewed_at) : null}</Detail>
        </dl>
      </Card>
    </div>
  );
}
