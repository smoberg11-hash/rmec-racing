"use client";

import { useState } from "react";
import type { Standing } from "@/lib/standings";
import StandingsTable from "../StandingsTable";

type RaceClass = { id: string; name: string };

export default function JuniorStandingsFilters({
  classes,
  standingsByClass,
}: {
  classes: RaceClass[];
  standingsByClass: Record<string, Standing[]>;
}) {
  const [selectedClass, setSelectedClass] = useState(classes[0]?.id ?? "");

  if (classes.length === 0) {
    return <p className="text-gray-600">No junior classes are set up for this season yet.</p>;
  }

  const selected = classes.find((raceClass) => raceClass.id === selectedClass);

  return (
    <section className="space-y-6">
      <label className="block max-w-sm space-y-2">
        <span className="text-sm font-medium text-gray-700">Class</span>
        <select
          value={selectedClass}
          onChange={(event) => setSelectedClass(event.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
        >
          {classes.map((raceClass) => (
            <option key={raceClass.id} value={raceClass.id}>
              {raceClass.name}
            </option>
          ))}
        </select>
      </label>

      <StandingsTable
        title={selected?.name ?? "Class Standings"}
        description="Ranked by total class points across the season. Ties go to the rider with more class wins."
        standings={standingsByClass[selectedClass] ?? []}
      />
    </section>
  );
}
