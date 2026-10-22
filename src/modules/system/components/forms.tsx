"use client";

import { useActionState, useState } from "react";
import { InlineForm } from "@/components/inline-form";
import { Button, Field, FormError, Input, Select } from "@/components/ui";
import type { ActionState } from "@/lib/action-state";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;
type Ref = { id: string; name: string };

export function NewStaffForm({
  action,
  departments,
  branches,
}: {
  action: Action;
  departments: { code: string; name: string }[];
  branches: Ref[];
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [copied, setCopied] = useState(false);
  const e = state.fieldErrors ?? {};

  if (state.secret) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-zinc-700">{state.message}</p>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <code className="select-all font-mono text-lg tracking-wider text-ink">{state.secret}</code>
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              await navigator.clipboard.writeText(state.secret!);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
          <span className="text-xs text-amber-900">Shown only once. It isn&apos;t stored anywhere.</span>
        </div>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <FormError message={state.error} />
      </div>
      <Field label="Full name" error={e.full_name}>
        <Input name="full_name" required />
      </Field>
      <Field label="Email" error={e.email} hint="What they'll sign in with">
        <Input name="email" type="email" required />
      </Field>
      <Field label="Department" error={e.department_code}>
        <Select name="department_code" defaultValue="" required>
          <option value="">Choose</option>
          {departments.map((d) => (
            <option key={d.code} value={d.code}>
              {d.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Home branch" error={e.home_branch_id}>
        <Select name="home_branch_id" defaultValue="">
          <option value="">None</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create login"}
        </Button>
      </div>
    </form>
  );
}

export function GrantRoleForm({
  action,
  roles,
  regions,
  branches,
}: {
  action: Action;
  roles: { code: string; name: string; department: string }[];
  regions: Ref[];
  branches: Ref[];
}) {
  const [scope, setScope] = useState("branch");
  const byDepartment = new Map<string, typeof roles>();
  for (const r of roles) byDepartment.set(r.department, [...(byDepartment.get(r.department) ?? []), r]);

  return (
    <InlineForm action={action} openLabel="Give a role" submitLabel="Give role" variant="primary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Role" error={e.role_code}>
            <Select name="role_code" defaultValue="" required>
              <option value="">Choose</option>
              {[...byDepartment].map(([department, list]) => (
                <optgroup key={department} label={department}>
                  {list.map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label="Applies to" error={e.scope}>
            <Select name="scope" value={scope} onChange={(ev) => setScope(ev.target.value)}>
              <option value="branch">One branch</option>
              <option value="region">One region</option>
              <option value="organisation">The whole organisation</option>
            </Select>
          </Field>
          {scope === "branch" && (
            <Field label="Branch" error={e.branch_id}>
              <Select name="branch_id" defaultValue="" required>
                <option value="">Choose</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {scope === "region" && (
            <Field label="Region" error={e.region_id}>
              <Select name="region_id" defaultValue="" required>
                <option value="">Choose</option>
                {regions.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      )}
    </InlineForm>
  );
}

export function RegionForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Add region" submitLabel="Add region">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
          <Field label="Code" error={e.code}>
            <Input name="code" placeholder="SW" maxLength={10} required />
          </Field>
          <Field label="Name" error={e.name}>
            <Input name="name" placeholder="South West" required />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}

export function BranchForm({ action, regions }: { action: Action; regions: Ref[] }) {
  return (
    <InlineForm action={action} openLabel="Add branch" submitLabel="Add branch" variant="primary">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem_1fr]">
          <Field label="Region" error={e.region_id}>
            <Select name="region_id" defaultValue="" required>
              <option value="">Choose</option>
              {regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Code" error={e.code} hint="Used in membership numbers">
            <Input name="code" placeholder="LAG" maxLength={10} required />
          </Field>
          <Field label="Name" error={e.name}>
            <Input name="name" placeholder="Lagos" required />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}

export function DepartmentForm({ action }: { action: Action }) {
  return (
    <InlineForm action={action} openLabel="Add department" submitLabel="Add department">
      {(e) => (
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <Field label="Code" error={e.code} hint="For example marketing">
            <Input name="code" required />
          </Field>
          <Field label="Name" error={e.name}>
            <Input name="name" placeholder="Marketing" required />
          </Field>
        </div>
      )}
    </InlineForm>
  );
}
