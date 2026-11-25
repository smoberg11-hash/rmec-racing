"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { inputClassName } from "@/components/ui";

type Rider = {
  id: string;
  full_name: string | null;
  rider_number: string | number | null;
};

function normalize(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export default function RiderSearch({ riders }: { riders: Rider[] }) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);

  const indexed = useMemo(
    () =>
      riders.map((rider) => ({
        rider,
        name: normalize(rider.full_name),
        number: normalize(rider.rider_number),
      })),
    [riders],
  );

  const matches = useMemo(() => {
    const words = normalize(deferredQuery).split(" ").filter(Boolean);
    if (words.length === 0) return riders;
    return indexed
      .filter(({ name, number }) =>
        // Every word must match part of the name, or the rider number.
        words.every((word) => name.includes(word) || number.startsWith(word)),
      )
      .sort((a, b) => {
        // Names that start with what was typed come first.
        const first = normalize(deferredQuery);
        return Number(b.name.startsWith(first)) - Number(a.name.startsWith(first));
      })
      .map(({ rider }) => rider);
  }, [deferredQuery, indexed, riders]);

  return (
    <>
      <div className="my-6">
        <label htmlFor="rider-search" className="sr-only">
          Search riders
        </label>
        <input
          id="rider-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Start typing a rider name or number…"
          autoComplete="off"
          autoFocus
          className={`${inputClassName} py-4 text-lg`}
        />
      </div>

      <p className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-neutral-500" aria-live="polite">
        {query.trim()
          ? `${matches.length} of ${riders.length} riders match “${query.trim()}”`
          : `${riders.length} riders`}
      </p>

      {matches.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-[#141816] p-8 text-center text-neutral-400">
          No riders match “{query.trim()}”.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {matches.map((rider) => (
            <Link
              key={rider.id}
              href={`/riders/${rider.id}`}
              className="group flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#141816] p-4 transition hover:-translate-y-0.5 hover:border-lime-400/60 hover:bg-[#18201b]"
            >
              <div className="min-w-0">
                <h2 className="truncate font-bold text-white group-hover:text-lime-300">
                  {rider.full_name || "Unknown Rider"}
                </h2>
                {rider.rider_number != null && rider.rider_number !== "" && (
                  <p className="mt-1 text-sm text-neutral-500">#{rider.rider_number}</p>
                )}
              </div>
              <span className="shrink-0 text-xs font-bold uppercase tracking-wide text-lime-400 transition group-hover:translate-x-0.5">Stats →</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
