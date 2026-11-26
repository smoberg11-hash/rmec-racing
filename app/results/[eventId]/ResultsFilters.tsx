"use client";

import { useMemo, useState } from "react";
import MultiSelect from "@/components/MultiSelect";
import { inputClassName } from "@/components/ui";

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

const NO_DIVISION = "none";

/** Finished, or a DNF that still scored by class place (rulebook 7.5 B). */
function placed(result: Result) {
  if (result.disqualified || result.dns) return false;
  return !result.dnf || (result.points ?? 0) > 0;
}

function finishText(result: Result) {
  if (result.disqualified) return "DQ";
  if (result.dns) return "DNS";
  if (result.dnf) return result.position != null && (result.points ?? 0) > 0 ? `${result.position} (DNF)` : "DNF";
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
  // null = everything selected.
  const [pickedDivisions, setPickedDivisions] = useState<string[] | null>(null);
  const [pickedClasses, setPickedClasses] = useState<string[] | null>(null);
  const [search, setSearch] = useState("");

  // Only divisions (and "no division" for junior classes) that have results at this race.
  const divisionOptions = useMemo(() => {
    const present = new Set(results.map((r) => r.divisionId || NO_DIVISION));
    const options = divisions
      .filter((d) => present.has(d.id))
      .sort((a, b) => a.display_order - b.display_order)
      .map((d) => ({ id: d.id, primary: d.name }));
    if (present.has(NO_DIVISION)) options.push({ id: NO_DIVISION, primary: "Junior / no division" });
    return options;
  }, [results, divisions]);
  const selectedDivisions = pickedDivisions ?? divisionOptions.map((o) => o.id);

  // Classes in the chosen divisions.
  const classDivision = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of results) map.set(r.classId, r.divisionId || NO_DIVISION);
    return map;
  }, [results]);
  const classOptions = classes
    .filter((c) => selectedDivisions.includes(classDivision.get(c.id) ?? NO_DIVISION))
    .map((c) => ({ id: c.id, primary: c.name }));
  const selectedClasses = pickedClasses === null ? classOptions.map((o) => o.id) : classOptions.map((o) => o.id).filter((id) => pickedClasses.includes(id));

  const filteredResults = useMemo(() => {
    const query = search.trim().toLowerCase();
    const inClasses = new Set(selectedClasses);
    const rows = results.filter((result) => {
      const matchesRider =
        !query ||
        result.riderName.toLowerCase().includes(query) ||
        result.riderNumber.toLowerCase().includes(query) ||
        `#${result.riderNumber}`.toLowerCase().includes(query);
      return inClasses.has(result.classId) && matchesRider;
    });

    // One class: class order. Several classes: combined, by overall place, then class place.
    const oneClass = new Set(rows.map((r) => r.classId)).size <= 1;
    const key = (r: Result) =>
      [
        placed(r) ? 0 : 1,
        oneClass ? (r.position ?? Infinity) : (r.overallPosition ?? Infinity),
        r.position ?? Infinity,
      ] as const;
    return rows.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2] || a.riderName.localeCompare(b.riderName);
    });
  }, [results, selectedClasses, search]);

  // A combined place only makes sense inside one division (overall places are per division).
  const divisionsShown = new Set(filteredResults.map((r) => r.divisionId || NO_DIVISION));
  const classesShown = new Set(filteredResults.map((r) => r.classId));
  const showCombinedPlace = classesShown.size > 1 && divisionsShown.size === 1 && !search.trim();
  let combinedPlace = 0;

  const hasActiveFilters = pickedDivisions !== null || pickedClasses !== null || search !== "";

  function clearFilters() {
    setPickedDivisions(null);
    setPickedClasses(null);
    setSearch("");
  }

  return (
    <>
      <div className="grid gap-4 border-b border-white/10 p-5 md:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_auto] lg:items-end">
        <div>
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

        <MultiSelect
          label="Divisions"
          options={divisionOptions}
          selected={selectedDivisions}
          onChange={(ids) => {
            setPickedDivisions(ids);
            setPickedClasses(null);
          }}
          allText={(n) => `All divisions (${n})`}
          noun="divisions"
        />

        <MultiSelect
          label="Classes"
          options={classOptions}
          selected={selectedClasses}
          onChange={setPickedClasses}
          allText={(n) => `All classes (${n})`}
          noun="classes"
        />

        <button
          type="button"
          onClick={clearFilters}
          disabled={!hasActiveFilters}
          className="rounded-xl border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-bold uppercase tracking-wide text-neutral-300 transition hover:border-lime-400/70 hover:text-lime-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear filters
        </button>
      </div>

      <div className="px-5 py-3 text-sm text-neutral-400" aria-live="polite">
        Showing {filteredResults.length} of {results.length} results
        {classesShown.size > 1 && " — classes combined, ordered by overall place"}
      </div>

      {filteredResults.length === 0 ? (
        <p className="p-6 text-sm text-neutral-400">
          No riders match your filters. Try another search or clear the filters.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-neutral-500">
              <tr>
                {showCombinedPlace && (
                  <th className="px-5 py-3 font-semibold" title="Place among the selected classes">
                    Place
                  </th>
                )}
                <th className="px-5 py-3 font-semibold">Rider</th>
                <th className="px-5 py-3 font-semibold">Class</th>
                <th className="px-5 py-3 font-semibold">Class finish</th>
                <th className="px-5 py-3 font-semibold">Overall</th>
                <th className="px-5 py-3 font-semibold">Class points</th>
                <th className="px-5 py-3 font-semibold">Division points</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-white/10">
              {filteredResults.map((result) => {
                const place = showCombinedPlace && placed(result) ? ++combinedPlace : null;
                return (
                  <tr key={result.id}>
                    {showCombinedPlace && (
                      <td className="px-5 py-4 font-black text-lime-400">{place ?? "—"}</td>
                    )}
                    <td className="px-5 py-4 font-medium">
                      {result.riderName}
                      {result.riderNumber !== "" && (
                        <span className="ml-2 text-neutral-400">#{result.riderNumber}</span>
                      )}
                    </td>
                    <td className="px-5 py-4 font-medium">{result.className}</td>
                    <td className="px-5 py-4">{finishText(result)}</td>
                    <td className="px-5 py-4">{result.overallPosition ?? "—"}</td>
                    <td className="px-5 py-4">{result.points ?? "—"}</td>
                    <td className="px-5 py-4">{result.divisionPoints ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
