"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Select } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { searchTopUpMembers } from "@/modules/accounts/actions";
import type { TopUpMemberHit } from "@/modules/accounts/top-ups";

const FREQUENCY: Record<string, string> = { weekly: "weekly", monthly: "monthly", quarterly: "quarterly", one_off: "one off" };

const inputClass =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-ink focus:ring-2 focus:ring-brand-200";

/**
 * "Paid by" for a member inflow: type a name, membership number or phone and pick the member, which fills in their branch and
 * lets Accounts point at the plan. If nobody matches (the name on a transfer often isn't the member's), whatever was
 * typed goes to the branch as written, as before.
 */
export function TopUpMemberSearch({
  defaultPaidBy,
  defaultMatch,
  defaultPlanId,
  branchId,
  error,
  onMatch,
  search = searchTopUpMembers,
}: {
  defaultPaidBy?: string;
  defaultMatch?: TopUpMemberHit | null;
  defaultPlanId?: string | null;
  /** The branch currently chosen in the form; changing it away from the member's branch clears the match. */
  branchId: string;
  error?: string;
  onMatch: (hit: TopUpMemberHit | null) => void;
  /** Where to look members up; the server action unless a preview passes another. */
  search?: (query: string) => Promise<TopUpMemberHit[]>;
}) {
  const [text, setText] = useState(defaultPaidBy ?? "");
  const [match, setMatch] = useState<TopUpMemberHit | null>(defaultMatch ?? null);
  const [planId, setPlanId] = useState(defaultPlanId ?? "");
  const [hits, setHits] = useState<TopUpMemberHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  const listId = useId();

  // The branch was changed by hand to another one: this is no longer the member's money.
  useEffect(() => {
    if (match && branchId && branchId !== match.branch_id) {
      setMatch(null);
      setPlanId("");
      onMatch(null);
    }
  }, [branchId, match, onMatch]);

  // Search as the user types, a moment after they pause. Older replies are ignored.
  useEffect(() => {
    if (match) return;
    const q = text.trim();
    if (q.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      const found = await search(q).catch(() => []);
      if (mine !== seq.current) return;
      setHits(found);
      setActive(0);
      setLoading(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [text, match, search]);

  function pick(hit: TopUpMemberHit) {
    setMatch(hit);
    setText(hit.member_name);
    setPlanId(hit.plans.length === 1 ? hit.plans[0].id : "");
    setOpen(false);
    onMatch(hit);
  }

  function clear() {
    setMatch(null);
    setPlanId("");
    onMatch(null);
  }

  const showList = open && !match && text.trim().length >= 2;

  return (
    <div className="relative">
      <label className="block">
        <span className="text-sm font-medium text-zinc-800">Paid by (search members, or type the name on the transfer)</span>
        <input
          name="paid_by"
          required
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          className={inputClass}
          value={text}
          placeholder="Name, membership number or phone"
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            if (match) clear();
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!showList || hits.length === 0) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % hits.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + hits.length) % hits.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              pick(hits[active]);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {error ? (
          <span className="mt-1 block text-xs text-red-700">{error}</span>
        ) : (
          !match && (
            <span className="mt-1 block text-xs text-zinc-500">Pick the member to fill in their branch. If nobody matches, the name you type goes to the branch as written.</span>
          )
        )}
      </label>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg"
        >
          {loading && hits.length === 0 && <li className="px-3 py-2 text-zinc-500">Searching…</li>}
          {!loading && hits.length === 0 && (
            <li className="px-3 py-2 text-zinc-500">No member matches. &ldquo;{text.trim()}&rdquo; will go to the branch as written.</li>
          )}
          {hits.map((h, i) => (
            <li
              key={h.member_id}
              role="option"
              aria-selected={i === active}
              className={`cursor-pointer px-3 py-2 ${i === active ? "bg-brand-50" : ""}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(h);
              }}
            >
              <span className="font-medium">{h.member_name}</span>
              <span className="block text-xs text-zinc-500">
                {[h.membership_no, h.branch_name, `phone ${h.phone_hint}`].filter(Boolean).join(" · ")}
              </span>
              <span className="block text-xs text-zinc-500">
                {h.plans.length ? h.plans.map((p) => p.plan_name).join(", ") : "No active plan"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <input type="hidden" name="member_id" value={match?.member_id ?? ""} />
      <input type="hidden" name="member_plan_id" value={match ? planId : ""} />

      {match && (
        <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3 text-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p>
              <span className="font-medium">{match.member_name}</span>
              <span className="block text-xs text-zinc-600">
                {[match.membership_no, `${match.branch_name} branch`, match.phone_hint && `phone ${match.phone_hint}`].filter(Boolean).join(" · ")}
              </span>
            </p>
            <button type="button" className="text-xs font-medium text-zinc-600 underline underline-offset-2 hover:text-zinc-900" onClick={clear}>
              Not this member
            </button>
          </div>
          {match.plans.length > 0 ? (
            <label className="mt-2 block">
              <span className="text-xs font-medium text-zinc-700">Plan it&apos;s for (optional)</span>
              <Select value={planId} onChange={(e) => setPlanId(e.target.value)}>
                <option value="">Let the branch choose</option>
                {match.plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.plan_name}
                    {p.contribution_amount ? ` · ${formatMoney(p.contribution_amount)} ${FREQUENCY[p.contribution_frequency] ?? ""}` : ""}
                    {p.start_date ? ` · from ${formatDate(p.start_date)}` : ""}
                  </option>
                ))}
              </Select>
            </label>
          ) : (
            <p className="mt-2 text-xs text-amber-800">This member has no active plan, so the branch will need to open one before logging it.</p>
          )}
        </div>
      )}
    </div>
  );
}
