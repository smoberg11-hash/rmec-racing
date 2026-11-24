"use client";

import { useMemo, useState } from "react";
import type { Standing } from "@/lib/standings";
import StandingsTable from "./StandingsTable";

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

const selectClass =
  "w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200";

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
    () => classes.filter((raceClass) => raceClass.division_id === selectedDivision),
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

  const standings = isDivisionView
    ? standingsByDivision[selectedDivision] ?? []
    : standingsByClass[selectedClass] ?? [];

  const title = isDivisionView
    ? selectedDivisionInfo?.name ?? "Division Standings"
    : classes.find((raceClass) => raceClass.id === selectedClass)?.name ??
      "Class Standings";

  return (
    <section className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-gray-700">Division</span>
          <select
            value={selectedDivision}
            onChange={(event) => changeDivision(event.target.value)}
            className={selectClass}
          >
            {divisions.map((division) => (
              <option key={division.id} value={division.id}>
                {division.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-gray-700">Class</span>
          <select
            value={selectedClass}
            onChange={(event) => setSelectedClass(event.target.value)}
            className={selectClass}
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

      <StandingsTable
        title={title}
        description={
          isDivisionView
            ? "Ranked by total division points across the season. Ties go to the rider with more division wins."
            : "Ranked by total class points across the season. Ties go to the rider with more class wins."
        }
        standings={standings}
        showEvents={!isDivisionView}
      />
    </section>
  );
}
