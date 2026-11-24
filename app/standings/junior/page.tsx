import { Suspense } from "react";
import Link from "next/link";
import { loadSeasonStandings } from "@/lib/standings-data";
import StandingsLoading from "../StandingsLoading";
import JuniorStandingsFilters from "./JuniorStandingsFilters";

async function JuniorStandings() {
  const { data, error } = await loadSeasonStandings("junior");

  if (error || !data) {
    return <p className="text-red-600">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        {data.season.year} season · {data.classes.length} junior classes
      </p>
      <JuniorStandingsFilters
        classes={data.classes.map(({ id, name }) => ({ id, name }))}
        standingsByClass={data.byClass}
      />
    </div>
  );
}

export default function JuniorStandingsPage() {
  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6">
      <header className="space-y-2">
        <Link href="/standings" className="text-sm text-blue-600 underline">
          ← Adult standings
        </Link>
        <h1 className="text-3xl font-bold">Junior Standings</h1>
        <p className="text-gray-600">
          Current members are ranked by class points earned throughout the
          season, including races before they joined.
        </p>
      </header>

      <Suspense fallback={<StandingsLoading />}>
        <JuniorStandings />
      </Suspense>
    </main>
  );
}
