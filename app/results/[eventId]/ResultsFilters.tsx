"use client";

import { SelectField, inputClassName } from "@/components/ui";

import { useMemo, useState } from "react";

type Result = {
  id: string;
  riderName: string;
  riderNumber: string;
  classId: string;
  className: string;
  divisionId: string;
  position: number | null;
  points: number | null;
  divisionPoints: number | null;
  overallPosition: number | null;
  dns: boolean | null;
  dnf: boolean | null;
  disqualified: boolean | null;
};

type RaceClass = {
  id: string;
  name: string;
};

type Division = {
  id: string;
  name: string;
  display_order: number;
};

function resultStatus(result: Result) {
  if (result.disqualified) return "Disqualified";
  if (result.dns) return "DNS";
  if (result.dnf) return "DNF";
  return result.position === null ? "—" : `${result.position}`;
}

export default function ResultsFilters({
  results,
  classes,
  divisions,
}: {
  results: Result[];
  classes: RaceClass[];
  divisions: Division[];
}) {
  const [selectedClass, setSelectedClass] = useState("all");
  const [selectedDivision, setSelectedDivision] = useState("all");
  const [search, setSearch] = useState("");

  const filteredResults = useMemo(() => {
    const query = search.trim().toLowerCase();

    return results
      .filter((result) => {
        const matchesClass =
          selectedClass === "all" || result.classId === selectedClass;

        const matchesDivision =
          selectedDivision === "all" ||
          result.divisionId === selectedDivision;

        const matchesRider =
          !query ||
          result.riderName.toLowerCase().includes(query) ||
          result.riderNumber.toLowerCase().includes(query) ||
          `#${result.riderNumber}`.toLowerCase().includes(query);

        return matchesClass && matchesDivision && matchesRider;
      })
      .sort((a, b) => {
        // Sort by overall finishing position.
        if (a.overallPosition == null && b.overallPosition == null) {
          return 0;
        }
        if (a.overallPosition == null) return 1;
        if (b.overallPosition == null) return -1;

        return a.overallPosition - b.overallPosition;
      });
  }, [results, selectedClass, selectedDivision, search]);

  function clearFilters() {
    setSelectedClass("all");
    setSelectedDivision("all");
    setSearch("");
  }

  const hasActiveFilters =
    selectedClass !== "all" ||
    selectedDivision !== "all" ||
    search !== "";

  return (
    <>
      <div className="flex flex-col gap-4 border-b border-white/10 p-5 md:flex-row md:flex-wrap md:items-end">
        {/* Rider search */}
        <div className="min-w-[220px] flex-1">
          <label
            htmlFor="rider-search"
            className="mb-2 block text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-400"
          >
            Search rider
          </label>

          <input
            id="rider-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Enter rider name or number..."
            className={inputClassName}
          />
        </div>

        {/* Class filter */}
        <div className="w-full md:w-56">
          <SelectField id="class-filter" label="Filter by class" value={selectedClass} onChange={(event) => setSelectedClass(event.target.value)}>
            <option value="all">All classes</option>

            {classes.map((raceClass) => (
              <option key={raceClass.id} value={raceClass.id}>
                {raceClass.name}
              </option>
            ))}
          </SelectField>
        </div>

        {/* Division filter */}
        <div className="w-full md:w-56">
          <SelectField id="division-filter" label="Filter by division" value={selectedDivision} onChange={(event) => setSelectedDivision(event.target.value)}>
            <option value="all">All divisions</option>

            {divisions.map((division) => (
              <option key={division.id} value={division.id}>
                {division.name}
              </option>
            ))}
          </SelectField>
        </div>

        {/* Clear filters */}
        <button
          type="button"
          onClick={clearFilters}
          disabled={!hasActiveFilters}
          className="rounded-full border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-bold uppercase tracking-wide text-neutral-300 transition hover:border-lime-400/70 hover:text-lime-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear filters
        </button>
      </div>

      {/* Result count */}
      <div
        className="px-5 py-3 text-sm text-neutral-400"
        aria-live="polite"
      >
        Showing {filteredResults.length} of {results.length} results
      </div>

      {/* Results table */}
      {filteredResults.length === 0 ? (
        <p className="p-6 text-sm text-neutral-400">
          No riders match your filters. Try another search or clear the filters.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-neutral-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Rider</th>
                <th className="px-5 py-3 font-semibold">Class</th>
                <th className="px-5 py-3 font-semibold">Finish</th>
                <th className="px-5 py-3 font-semibold">Overall</th>
                <th className="px-5 py-3 font-semibold">Class points</th>
                <th className="px-5 py-3 font-semibold">Division points</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-white/10">
              {filteredResults.map((result) => (
                <tr key={result.id}>
                  <td className="px-5 py-4 font-medium">
                    {result.riderName}

                    {result.riderNumber !== "" && (
                      <span className="ml-2 text-neutral-400">
                        #{result.riderNumber}
                      </span>
                    )}
                  </td>

                  <td className="px-5 py-4 font-medium">
                    {result.className}
                  </td>

                  <td className="px-5 py-4">
                    {resultStatus(result)}
                  </td>

                  <td className="px-5 py-4">
                    {result.overallPosition ?? "—"}
                  </td>

                  <td className="px-5 py-4">
                    {result.points ?? "—"}
                  </td>

                  <td className="px-5 py-4">
                    {result.divisionPoints ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}