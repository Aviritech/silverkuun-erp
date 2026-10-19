"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, { error: initialError });

  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-zinc-800">Work email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 shadow-sm outline-none transition-colors focus:border-ink focus:ring-2 focus:ring-silver-200"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-zinc-800">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 shadow-sm outline-none transition-colors focus:border-ink focus:ring-2 focus:ring-silver-200"
        />
      </label>
      {state.error && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-ink px-3 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-ink-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
