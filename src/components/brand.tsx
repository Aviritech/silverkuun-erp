/** The Silverkuun crescent mark: a silver moon on the group's ink black. */
export function BrandMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="sk-silver" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4f5f7" />
          <stop offset="0.45" stopColor="#bcc2cb" />
          <stop offset="0.6" stopColor="#eef0f3" />
          <stop offset="1" stopColor="#8d949f" />
        </linearGradient>
        <mask id="sk-crescent">
          <circle cx="19" cy="20" r="11" fill="white" />
          <circle cx="24.5" cy="16.5" r="9" fill="black" />
        </mask>
      </defs>
      <rect width="40" height="40" rx="10" fill="#0b0b0c" />
      <rect x="0.5" y="0.5" width="39" height="39" rx="9.5" fill="none" stroke="#34363b" />
      <rect width="40" height="40" fill="url(#sk-silver)" mask="url(#sk-crescent)" />
    </svg>
  );
}

/** Mark plus "SilverKuun" wordmark. `tone` is the background it sits on. */
export function BrandLogo({ tone = "dark", subtitle = "Enterprise Resource Planning" }: { tone?: "dark" | "light"; subtitle?: string }) {
  return (
    <span className="flex items-center gap-3">
      <BrandMark />
      <span className="leading-tight">
        <span
          className={`block text-[15px] font-semibold tracking-[0.08em] uppercase ${tone === "dark" ? "silver-text" : "text-ink"}`}
        >
          SilverKuun
        </span>
        <span className={`block text-[11px] tracking-wide ${tone === "dark" ? "text-silver-400" : "text-zinc-500"}`}>
          {subtitle}
        </span>
      </span>
    </span>
  );
}
