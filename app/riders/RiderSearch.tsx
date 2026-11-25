"use client";

import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";

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
          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-lg shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
      </div>

      <p className="mb-4 text-sm text-gray-500" aria-live="polite">
        {query.trim()
          ? `${matches.length} of ${riders.length} riders match “${query.trim()}”`
          : `${riders.length} riders`}
      </p>

      {matches.length === 0 ? (
        <p className="rounded-lg border p-6 text-center text-gray-500">
          No riders match “{query.trim()}”.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {matches.map((rider) => (
            <Link
              key={rider.id}
              href={`/riders/${rider.id}`}
              className="flex items-center justify-between gap-4 rounded-lg border p-4 transition hover:border-blue-300 hover:bg-gray-50"
            >
              <div className="min-w-0">
                <h2 className="truncate font-semibold">
                  {rider.full_name || "Unknown Rider"}
                </h2>
                {rider.rider_number != null && rider.rider_number !== "" && (
                  <p className="mt-1 text-sm text-gray-500">Rider #{rider.rider_number}</p>
                )}
              </div>
              <span className="shrink-0 text-sm font-medium text-blue-600">View Stats →</span>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
