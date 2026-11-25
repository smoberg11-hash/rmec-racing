/**
 * Shared look for every page: the dark RMEC theme with lime accents used on the
 * home and results pages. Use these instead of styling buttons, headers and
 * dropdowns by hand, so pages stay consistent.
 */
import Link from "next/link";
import type { ReactNode, SelectHTMLAttributes } from "react";

export const theme = {
  page: "bg-[#101211] text-white",
  panel: "rounded-2xl border border-white/10 bg-[#141816]",
  muted: "text-neutral-400",
  accent: "text-lime-400",
};

/** Full-width page with the standard background and content width. */
export function Page({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <main className={`w-full flex-1 ${theme.page}`}>
      <div className={`mx-auto w-full max-w-7xl px-5 py-10 sm:px-8 md:py-14 ${className}`}>{children}</div>
    </main>
  );
}

/** Eyebrow + big title + description, with optional buttons on the right. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-10 flex flex-wrap items-end justify-between gap-6 border-b border-white/10 pb-8">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && (
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.25em] text-lime-400">{eyebrow}</p>
        )}
        <h1 className="text-4xl font-black uppercase tracking-tight md:text-5xl">{title}</h1>
        {description && <p className="mt-4 leading-7 text-neutral-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-3">{actions}</div>}
    </header>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost";

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-lime-400 text-[#101211] shadow-[0_0_0_1px_rgba(163,230,53,0.4),0_8px_24px_-8px_rgba(163,230,53,0.6)] hover:bg-lime-300 hover:-translate-y-0.5",
  secondary:
    "border border-white/15 bg-white/[0.04] text-white hover:border-lime-400/70 hover:bg-lime-400/10 hover:text-lime-300 hover:-translate-y-0.5",
  ghost: "text-neutral-400 hover:text-lime-300",
};

/** Pill-shaped link button. `back` puts an arrow before the label, otherwise after. */
export function ButtonLink({
  href,
  children,
  variant = "secondary",
  back = false,
}: {
  href: string;
  children: ReactNode;
  variant?: ButtonVariant;
  back?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold uppercase tracking-wide transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lime-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#101211] ${buttonStyles[variant]}`}
    >
      {back && (
        <span aria-hidden="true" className="transition group-hover:-translate-x-0.5">
          ←
        </span>
      )}
      {children}
      {!back && (
        <span aria-hidden="true" className="transition group-hover:translate-x-0.5">
          →
        </span>
      )}
    </Link>
  );
}

/** Styled dropdown with a label and a custom arrow. */
export function SelectField({
  label,
  id,
  children,
  className = "",
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; id: string }) {
  return (
    <label htmlFor={id} className={`block ${className}`}>
      <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-400">{label}</span>
      <span className="relative block">
        <select
          id={id}
          {...props}
          className="w-full cursor-pointer appearance-none rounded-xl border border-white/10 bg-[#181d1a] py-3 pl-4 pr-11 text-sm font-semibold text-white shadow-inner shadow-black/20 transition hover:border-white/25 focus:border-lime-400 focus:outline-none focus:ring-2 focus:ring-lime-400/30"
        >
          {children}
        </select>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-lime-400"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 8l5 5 5-5" />
        </svg>
      </span>
    </label>
  );
}

/** Styled text/search input matching SelectField. */
export const inputClassName =
  "w-full rounded-xl border border-white/10 bg-[#181d1a] px-4 py-3 text-sm font-medium text-white shadow-inner shadow-black/20 outline-none transition placeholder:text-neutral-500 hover:border-white/25 focus:border-lime-400 focus:ring-2 focus:ring-lime-400/30";
