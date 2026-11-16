import { BrandLogo } from "@/components/brand";

/** The frame of the public client pages: no sidebar, no login. */
export function JoinShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="bg-ink px-4 py-5 sm:px-8">
        <BrandLogo subtitle="Membership" />
      </header>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">{children}</div>
    </main>
  );
}

export function JoinNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <JoinShell>
      <div className="rounded-xl border border-zinc-200 bg-white p-6">
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        <p className="mt-2 text-sm text-zinc-700">{children}</p>
      </div>
    </JoinShell>
  );
}
