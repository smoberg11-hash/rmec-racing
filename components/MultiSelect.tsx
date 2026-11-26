"use client";

import { useEffect, useRef, useState } from "react";

export type Option = { id: string; primary: string; secondary?: string; tag?: string };

/** Checklist dropdown. onChange(null) means "everything selected". */
export default function MultiSelect({
  label,
  options,
  selected,
  onChange,
  allText,
  noun,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (ids: string[] | null) => void;
  allText: (n: number) => string;
  noun: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouse = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouse);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouse);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const all = options.length > 0 && selected.length === options.length;
  const summary = all
    ? allText(options.length)
    : selected.length === 0
      ? `No ${noun} selected`
      : selected.length === 1
        ? options.find((o) => o.id === selected[0])?.primary ?? `1 of ${options.length}`
        : `${selected.length} of ${options.length} ${noun}`;

  function toggle(id: string) {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onChange(next.length === options.length ? null : next);
  }

  return (
    <div ref={box} className="relative">
      <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-400">{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-3 rounded-xl border bg-[#181d1a] py-3 pl-4 pr-3.5 text-left text-sm font-semibold text-white shadow-inner shadow-black/20 transition hover:border-white/25 focus:outline-none focus:ring-2 focus:ring-lime-400/30 ${
          open ? "border-lime-400" : "border-white/10"
        }`}
      >
        <span className="truncate">{summary}</span>
        <span className="flex items-center gap-2">
          {!all && selected.length > 1 && (
            <span className="rounded-full bg-lime-400 px-2 py-0.5 text-[11px] font-black text-[#101211]">{selected.length}</span>
          )}
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className={`h-4 w-4 text-lime-400 transition ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 8l5 5 5-5" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-full min-w-[18rem] overflow-hidden rounded-xl border border-white/15 bg-[#181d1a] shadow-2xl shadow-black/60">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 text-xs font-bold uppercase tracking-wider">
            <button type="button" onClick={() => onChange(null)} className="text-lime-400 hover:text-lime-300">
              Select all
            </button>
            <button type="button" onClick={() => onChange([])} className="text-neutral-400 hover:text-white">
              Clear
            </button>
          </div>
          <ul role="listbox" aria-multiselectable="true" className="max-h-80 overflow-y-auto py-1">
            {options.map((o) => {
              const on = selected.includes(o.id);
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => toggle(o.id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-white/[0.05]"
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                        on ? "border-lime-400 bg-lime-400 text-[#101211]" : "border-white/25"
                      }`}
                    >
                      {on && (
                        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M4.5 10.5l3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    {o.tag && <span className="w-14 shrink-0 font-bold text-lime-400">{o.tag}</span>}
                    <span className={`min-w-0 truncate ${on ? "font-semibold text-white" : "text-neutral-400"}`}>{o.primary}</span>
                    {o.secondary && (
                      <span className="ml-auto shrink-0 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                        {o.secondary}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
