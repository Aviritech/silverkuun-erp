import { LoginForm } from "./login-form";

const ERRORS: Record<string, string> = {
  "no-access": "Your account isn't set up for the ERP yet. Ask a system administrator to give you access.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold">Silverkuun ERP</h1>
        <p className="mb-6 mt-1 text-sm text-zinc-600">Sign in with the account your administrator gave you.</p>
        <LoginForm initialError={error ? ERRORS[error] : undefined} />
      </div>
    </main>
  );
}
