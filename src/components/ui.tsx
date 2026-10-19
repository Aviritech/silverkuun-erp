import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <div className="mt-1.5 text-sm text-zinc-600">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children }: { title?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200/80 bg-white shadow-[0_1px_2px_rgba(16,17,20,0.04),0_1px_3px_rgba(16,17,20,0.06)]">
      {(title || actions) && (
        <div className="flex items-center justify-between gap-4 border-b border-zinc-100 px-5 py-3.5">
          {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

// Disabled buttons turn grey and ignore hover, so it's clear they can't be used yet.
const buttonStyles = {
  primary:
    "bg-ink text-white shadow-sm hover:bg-ink-700 disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none",
  secondary:
    "border border-zinc-300 bg-white text-zinc-900 shadow-sm hover:bg-silver-50 disabled:border-zinc-200 disabled:bg-zinc-50 disabled:text-zinc-400 disabled:shadow-none",
  danger:
    "border border-red-300 bg-white text-red-700 hover:bg-red-50 disabled:border-zinc-200 disabled:bg-zinc-50 disabled:text-zinc-400",
};
const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-silver-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof buttonStyles }) {
  return (
    <button
      {...props}
      className={`${buttonBase} ${buttonStyles[variant]} ${className}`}
    />
  );
}

export function ButtonLink({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: keyof typeof buttonStyles }) {
  return <Link {...props} className={`${buttonBase} ${buttonStyles[variant]} ${className}`} />;
}

const inputClass =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-ink focus:ring-2 focus:ring-silver-200 disabled:bg-zinc-50 disabled:text-zinc-500";

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-zinc-800">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-zinc-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-700">{error}</span>}
    </label>
  );
}

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={inputClass} />;
}

export function Select(props: ComponentProps<"select">) {
  return <select {...props} className={inputClass} />;
}

export function Textarea(props: ComponentProps<"textarea">) {
  return <textarea {...props} className={inputClass} />;
}

const badgeTones = {
  gray: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-800 ring-red-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  blue: "bg-sky-50 text-sky-800 ring-sky-200",
};

export function Badge({ tone = "gray", children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${badgeTones[tone]}`}>
      {children}
    </span>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </p>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-zinc-500">{children}</p>;
}
