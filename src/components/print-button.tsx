"use client";

import { Button } from "./ui";

/** Opens the browser's print dialog, where staff can also choose "Save as PDF". */
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
