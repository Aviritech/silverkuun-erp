/** The Silverkuun crescent mark: a yellow moon on black. */
export function BrandMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={className}>
      <defs>
        <mask id="sk-crescent">
          <circle cx="19" cy="20" r="11" fill="white" />
          <circle cx="24.5" cy="16.5" r="9" fill="black" />
        </mask>
      </defs>
      <rect width="40" height="40" rx="10" fill="#0b0b0c" />
      <rect x="0.5" y="0.5" width="39" height="39" rx="9.5" fill="none" stroke="#333336" />
      <rect width="40" height="40" fill="#ffc800" mask="url(#sk-crescent)" />
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
          className={`block text-[15px] font-semibold tracking-[0.08em] uppercase ${tone === "dark" ? "text-white" : "text-ink"}`}
        >
          SilverKuun
        </span>
        <span className={`block text-[11px] tracking-wide ${tone === "dark" ? "text-neutral-400" : "text-zinc-500"}`}>
          {subtitle}
        </span>
      </span>
    </span>
  );
}
