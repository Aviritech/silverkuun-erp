"use client";

import { Button } from "@/components/ui";

/** Shown when a page fails to load, with the reason instead of a raw error object. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="max-w-2xl rounded-xl border border-red-200 bg-red-50 p-5">
      <h1 className="font-semibold text-red-900">This page couldn&apos;t load</h1>
      <p className="mt-2 text-sm text-red-900">{error.message || "Something went wrong."}</p>
      {error.digest && <p className="mt-2 text-xs text-red-700">Reference: {error.digest}</p>}
      <Button type="button" variant="secondary" className="mt-4" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
