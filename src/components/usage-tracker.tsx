"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** Tells the server which page was opened, for the Usage page. Fire and forget: it never slows the page down. */
export function UsageTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (!pathname) return;
    const payload = JSON.stringify({ path: pathname });
    try {
      const sent = navigator.sendBeacon?.("/api/activity", new Blob([payload], { type: "application/json" }));
      if (!sent) void fetch("/api/activity", { method: "POST", body: payload, keepalive: true, headers: { "content-type": "application/json" } }).catch(() => {});
    } catch {
      // Logging is best effort.
    }
  }, [pathname]);
  return null;
}
