import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandLogo } from "@/components/brand";
import { createClient } from "@/lib/supabase/server";
import { changePassword } from "./actions";
import { PasswordForm } from "./password-form";

// Outside the main layout on purpose: the layout sends anyone with a temporary password here.
export default async function ChangePasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: staff } = await supabase.from("staff").select("must_change_password").eq("id", user.id).maybeSingle();
  const forced = staff?.must_change_password ?? false;

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <BrandLogo tone="light" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Change your password</h1>
        <p className="mb-8 mt-1.5 text-sm text-zinc-600">
          {forced
            ? "You signed in with a temporary password. Choose your own before you carry on."
            : `Signed in as ${user.email}.`}
        </p>
        <PasswordForm action={changePassword} />
        {!forced && (
          <p className="mt-6 text-center text-sm">
            <Link href="/" className="text-zinc-600 underline-offset-4 hover:underline">
              Back to the ERP
            </Link>
          </p>
        )}
      </div>
    </main>
  );
}
