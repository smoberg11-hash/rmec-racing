import { Suspense } from "react";
import Link from "next/link";
import { loadSeasonStandings } from "@/lib/standings-data";
import StandingsFilters from "./StandingsFilters";
import StandingsLoading from "./StandingsLoading";

async function AdultStandings() {
  const { data, error } = await loadSeasonStandings("adult");

  if (error || !data) {
    return <p className="text-red-600">{error}</p>;
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        {data.season.year} season · {data.eventCount} events · {data.memberCount} eligible riders
      </p>
      <StandingsFilters
        classes={data.classes}
        divisions={data.divisions}
        standingsByClass={data.byClass}
        standingsByDivision={data.byDivision}
      />
    </div>
  );
}

export default function StandingsPage() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 space-y-8 p-6">
      <header className="space-y-2">
        <Link href="/" className="text-sm text-blue-600 underline">
          ← Home
        </Link>
        <h1 className="text-3xl font-bold">Season Standings</h1>
        <p className="text-gray-600">
          Current members are ranked by points earned throughout the season,
          including races before they joined.{" "}
          <Link href="/standings/junior" className="text-blue-600 underline">
            Junior standings →
          </Link>
        </p>
      </header>

      <Suspense fallback={<StandingsLoading />}>
        <AdultStandings />
      </Suspense>
    </main>
  );
}
