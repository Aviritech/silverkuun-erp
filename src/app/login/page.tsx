import { BrandLogo } from "@/components/brand";
import { LoginForm } from "./login-form";

const ERRORS: Record<string, string> = {
  "no-access": "Your account isn't set up for the ERP yet. Ask a system administrator to give you access.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <section className="relative hidden overflow-hidden bg-ink p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle_at_30%_30%,rgba(236,238,242,0.18),rgba(236,238,242,0)_65%)]"
        />
        <BrandLogo />
        <div className="relative max-w-md">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-silver-400">Silverkuun Group</p>
          <h2 className="mt-4 text-4xl font-semibold leading-tight tracking-tight">
            <span className="silver-text">One workspace</span> for every department.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-silver-300">
            Operations, Accounts and Internal Audit work from the same records, so data moves between departments without
            re-typing.
          </p>
        </div>
        <p className="relative text-xs text-silver-500">Premium Tech &amp; Financial Solutions</p>
      </section>
      <section className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <BrandLogo tone="light" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Sign in</h1>
          <p className="mb-8 mt-1.5 text-sm text-zinc-600">Use the account your administrator gave you.</p>
          <LoginForm initialError={error ? ERRORS[error] : undefined} />
        </div>
      </section>
    </main>
  );
}
