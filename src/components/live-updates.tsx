"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { browserClient } from "@/lib/supabase/browser";

/** Changes often come in bursts (a payment posts several rows); wait for the burst to finish. */
const SETTLE_MS = 700;
/** While a refresh is held back, look again this often. */
const RETRY_MS = 2000;

type Status = "connecting" | "live" | "offline";

/**
 * True while refreshing would get in someone's way: they are typing, a confirm box is open, or a form on the page
 * holds something they haven't saved yet.
 */
export function shouldHoldRefresh(doc: Document): boolean {
  if (doc.visibilityState === "hidden") return true;
  if (doc.querySelector("dialog[open]")) return true;
  const active = doc.activeElement as HTMLElement | null;
  if (active && (active.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName))) return true;
  for (const el of Array.from(doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("form input, form textarea, form select"))) {
    if (el instanceof HTMLSelectElement) {
      const options = Array.from(el.options);
      if (el.multiple) {
        if (options.some((o) => o.selected !== o.defaultSelected)) return true;
      } else if (el.selectedIndex !== Math.max(0, options.findIndex((o) => o.defaultSelected))) {
        // With no option marked as the default, the browser shows the first one.
        return true;
      }
    } else if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      if (el.checked !== el.defaultChecked) return true;
    } else if (el instanceof HTMLInputElement && el.type === "file") {
      if (el.files && el.files.length > 0) return true;
    } else if (el.type !== "hidden" && el.value !== el.defaultValue) {
      return true;
    }
  }
  return false;
}

/**
 * Keeps the open page up to date. The database sends a bare "something changed" signal for each branch the staff
 * member works in (see the live updates migration); on a signal the page asks the server for fresh data, which the
 * server reads with the staff member's own permissions. Refreshes wait while someone is typing or has a form
 * half filled, and a tab in the background catches up when it is shown again.
 */
export function LiveUpdates() {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<Status>("connecting");
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A new page has just loaded fresh data, so nothing is owed.
  useEffect(() => {
    pending.current = false;
    clearTimeout(timer.current);
  }, [pathname]);

  useEffect(() => {
    let cancelled = false;
    const supabase = browserClient();
    const channels: RealtimeChannel[] = [];
    const joined = new Map<string, boolean>();
    let everLive = false;
    let live = false;

    const tryRefresh = () => {
      clearTimeout(timer.current);
      if (!pending.current || cancelled) return;
      if (shouldHoldRefresh(document)) {
        timer.current = setTimeout(tryRefresh, RETRY_MS);
        return;
      }
      pending.current = false;
      router.refresh();
    };
    const changed = () => {
      pending.current = true;
      clearTimeout(timer.current);
      timer.current = setTimeout(tryRefresh, SETTLE_MS);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") tryRefresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focusout", changedSoonIfPending);
    function changedSoonIfPending() {
      if (pending.current) {
        clearTimeout(timer.current);
        timer.current = setTimeout(tryRefresh, SETTLE_MS);
      }
    }

    const updateStatus = () => {
      const all = [...joined.values()];
      const nowLive = all.length > 0 && all.every(Boolean);
      // Back after a dropped connection (a sleeping laptop, a network blip): catch up on what was missed.
      if (nowLive && !live && everLive) changed();
      if (nowLive) everLive = true;
      live = nowLive;
      setStatus(live ? "live" : everLive ? "offline" : "connecting");
    };

    (async () => {
      const { data: topics, error } = await supabase.rpc("my_live_topics");
      if (cancelled) return;
      if (error || !Array.isArray(topics) || topics.length === 0) {
        setStatus("offline");
        return;
      }
      // Private channels check the staff member's access token against the database's listener rules.
      await supabase.realtime.setAuth();
      if (cancelled) return;
      for (const topic of topics as string[]) {
        joined.set(topic, false);
        const channel = supabase
          .channel(topic, { config: { private: true } })
          .on("broadcast", { event: "changed" }, changed)
          .subscribe((state) => {
            joined.set(topic, state === "SUBSCRIBED");
            updateStatus();
          });
        channels.push(channel);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focusout", changedSoonIfPending);
      for (const channel of channels) void supabase.removeChannel(channel);
    };
  }, [router]);

  const label = status === "live" ? "Live" : status === "connecting" ? "Connecting" : "Offline";
  const hint =
    status === "live"
      ? "This page updates by itself when something changes."
      : status === "connecting"
        ? "Connecting for live updates."
        : "Live updates are paused. Reload the page to see the latest.";
  return (
    <span title={hint} className="hidden items-center gap-1.5 text-xs text-zinc-500 sm:flex" aria-live="polite">
      <span
        aria-hidden="true"
        className={`h-2 w-2 rounded-full ${status === "live" ? "bg-emerald-500" : status === "connecting" ? "bg-brand" : "bg-zinc-400"}`}
      />
      {label}
    </span>
  );
}
