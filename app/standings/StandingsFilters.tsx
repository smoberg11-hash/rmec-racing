"use client";

import { useMemo, useState } from "react";

type Standing = {
  riderId: string;
  riderName: string;
  riderNumber: string | null;
  points: number;
  events: number;
};

type RaceClass = {
  id: string;
  name: string;
  display_order: number | null;
  division_id: string | null;
};

type Division = {
  id: string;
  name: string;
  display_order: number;
  has_annual_points: boolean;
};

type Props = {
  classes: RaceClass[];
  divisions: Division[];
  standingsByClass: Record<string, Standing[]>;
  standingsByDivision: Record<string, Standing[]>;
};

export default function StandingsFilters({
  classes,
  divisions,
  standingsByClass,
  standingsByDivision,
}: Props) {
  const [selectedDivision, setSelectedDivision] = useState(() => {
    const aDivision = divisions.find(
      (division) => division.name.toLowerCase() === "a division",
    );
    return aDivision?.id ?? divisions[0]?.id ?? "all";
  });

  const [selectedClass, setSelectedClass] = useState("division");

  const filteredClasses = useMemo(
    () =>
      classes.filter(
        (raceClass) => raceClass.division_id === selectedDivision,
      ),
    [classes, selectedDivision],
  );

  function changeDivision(divisionId: string) {
    setSelectedDivision(divisionId);
    setSelectedClass("division");
  }

  const selectedDivisionInfo = divisions.find(
    (division) => division.id === selectedDivision,
  );

  const isDivisionView = selectedClass === "division";

  const standings = useMemo(() => {
    if (isDivisionView) {
      return standingsByDivision[selectedDivision] ?? [];
    }

    return standingsByClass[selectedClass] ?? [];
  }, [
    isDivisionView,
    selectedDivision,
    selectedClass,
    standingsByDivision,
    standingsByClass,
  ]);

  const title = isDivisionView
    ? selectedDivisionInfo?.name ?? "Division Standings"
    : classes.find((raceClass) => raceClass.id === selectedClass)?.name ??
      "Class Standings";

  return (
    <section className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-gray-700">
            Division
          </span>
          <select
            value={selectedDivision}
            onChange={(event) => changeDivision(event.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            {divisions.map((division) => (
              <option key={division.id} value={division.id}>
                {division.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-gray-700">
            Class
          </span>
          <select
            value={selectedClass}
            onChange={(event) => setSelectedClass(event.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
          >
            <option value="division">
              All {selectedDivisionInfo?.name ?? "Division"} — Division Points
            </option>

            {filteredClasses.map((raceClass) => (
              <option key={raceClass.id} value={raceClass.id}>
                {raceClass.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border">
        <div className="border-b bg-gray-50 px-4 py-3">
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-gray-600">
            {isDivisionView
              ? "Ranked by total division points across the season."
              : "Ranked by total class points across the season."}
          </p>
        </div>

        {standings.length === 0 ? (
          <p className="p-6 text-gray-600">
            No standings are available for this selection yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-gray-600">
                <tr>
                  <th className="px-4 py-3">Rank</th>
                  <th className="px-4 py-3">Rider</th>
                  <th className="px-4 py-3">Number</th>
                  {!isDivisionView && (
                    <th className="px-4 py-3 text-right">Events</th>
                  )}
                  <th className="px-4 py-3 text-right">Points</th>
                </tr>
              </thead>

              <tbody>
                {standings.map((standing, index) => (
                  <tr
                    key={standing.riderId}
                    className="border-b last:border-0"
                  >
                    <td className="px-4 py-3">{index + 1}</td>
                    <td className="px-4 py-3 font-medium">
                      {standing.riderName}
                    </td>
                    <td className="px-4 py-3">
                      {standing.riderNumber ?? "—"}
                    </td>
                    {!isDivisionView && (
                      <td className="px-4 py-3 text-right">
                        {standing.events}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right font-semibold">
                      {standing.points}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}