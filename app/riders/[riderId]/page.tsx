import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { selectPublicRows } from "@/lib/supabase/data";

type Rider = {
  id: string;
  full_name: string | null;
  rider_number: string | number | null;
};

type Season = {
  id: string;
  year: number;
  name: string | null;
};

type Event = {
  id: string;
  name: string;
  race_date: string;
  season_id: string;
};

type RaceClass = {
  id: string;
  name: string;
};

type Result = {
  id: string;
  rider_id: string;
  event_id: string;
  class_id: string;
  position: number | null;
  overall_position: number | null;
  points: number | null;
  division_points: number | null;
  dns: boolean | null;
  dnf: boolean | null;
  disqualified: boolean | null;
};

function LoadingStats() {
  return <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 text-gray-500 sm:px-6">Loading rider stats...</main>;
}

export default async function RiderStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ riderId: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  return (
    <Suspense fallback={<LoadingStats />}>
      <RiderStatsContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function RiderStatsContent({
  params,
  searchParams,
}: {
  params: Promise<{ riderId: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const [{ riderId }, query] = await Promise.all([params, searchParams]);

  const [riderResponse, seasonsResponse, eventsResponse, classesResponse, resultsResponse] =
    await Promise.all([
      selectPublicRows<Rider>("public_riders", "id, full_name, rider_number", {
        equals: { column: "id", value: riderId },
      }),
      selectPublicRows<Season>("seasons", "id, year, name", {
        orderBy: "year",
        ascending: false,
      }),
      selectPublicRows<Event>("events", "id, name, race_date, season_id", {
        orderBy: "race_date",
        ascending: false,
      }),
      selectPublicRows<RaceClass>("classes", "id, name"),
      selectPublicRows<Result>(
        "results",
        "id, rider_id, event_id, class_id, position, overall_position, points, division_points, dns, dnf, disqualified",
        { equals: { column: "rider_id", value: riderId } },
      ),
    ]);

  if (
    riderResponse.error ||
    seasonsResponse.error ||
    eventsResponse.error ||
    classesResponse.error ||
    resultsResponse.error ||
    !Array.isArray(riderResponse.data) ||
    !Array.isArray(seasonsResponse.data) ||
    !Array.isArray(eventsResponse.data) ||
    !Array.isArray(classesResponse.data) ||
    !Array.isArray(resultsResponse.data)
  ) {
    return (
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        <Link href="/riders" className="text-blue-600 hover:underline">
          ← All Riders
        </Link>
        <h1 className="mt-4 text-2xl font-bold">Unable to load rider stats</h1>
        <p className="mt-2 text-gray-600">
          Please try again later. If the problem continues, check the server
          logs for the Supabase query error.
        </p>
      </main>
    );
  }

  const riders = riderResponse.data;
  const seasons = seasonsResponse.data;
  const events = eventsResponse.data;
  const classes = classesResponse.data;
  const allResults = resultsResponse.data;

  const rider = riders.find((item) => item.id === riderId);

  if (!rider) notFound();

  const selectedYear = Number(query.season);

  const selectedSeason =
    seasons.find((season) => season.year === selectedYear) ??
    seasons.find((season) => season.year === new Date().getFullYear()) ??
    seasons[0];

  const seasonEventIds = new Set(
    events
      .filter((event) => !selectedSeason || event.season_id === selectedSeason.id)
      .map((event) => event.id)
  );

  const eventsById = new Map(events.map((event) => [event.id, event]));
  const classesById = new Map(classes.map((item) => [item.id, item]));

  const riderResults = allResults
    .filter(
      (result) =>
        result.rider_id === riderId && seasonEventIds.has(result.event_id)
    )
    .sort((a, b) => {
      const dateA = eventsById.get(a.event_id)?.race_date ?? "";
      const dateB = eventsById.get(b.event_id)?.race_date ?? "";
      return dateB.localeCompare(dateA);
    });

  const completedResults = riderResults.filter(
    (result) =>
      result.position != null &&
      !result.dns &&
      !result.dnf &&
      !result.disqualified
  );

  const wins = completedResults.filter(
    (result) => result.position === 1
  ).length;

  const podiums = completedResults.filter(
    (result) => result.position! <= 3
  ).length;

  const averageFinish =
    completedResults.length > 0
      ? (
          completedResults.reduce(
            (sum, result) => sum + Number(result.position),
            0
          ) / completedResults.length
        ).toFixed(1)
      : "—";

  const bestFinish =
    completedResults.length > 0
      ? Math.min(...completedResults.map((result) => Number(result.position)))
      : "—";

  const totalPoints = riderResults.reduce(
    (sum, result) => sum + (result.points ?? 0),
    0
  );

  const totalDivisionPoints = riderResults.reduce(
    (sum, result) => sum + (result.division_points ?? 0),
    0
  );

  const eventCount = new Set(riderResults.map((result) => result.event_id)).size;

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
      <Link href="/riders" className="text-sm text-blue-600 hover:underline">
        ← All Riders
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">
            {rider.full_name || "Unknown Rider"}
          </h1>
          {rider.rider_number != null && (
            <p className="mt-2 text-gray-500">
              Rider #{rider.rider_number}
            </p>
          )}
        </div>

        <form action="" method="GET" className="flex items-center gap-2">
          <label htmlFor="season" className="text-sm font-medium">
            Season
          </label>
          <select
            id="season"
            name="season"
            defaultValue={selectedSeason?.year ?? ""}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2"
          >
            {seasons.map((season) => (
              <option key={season.id} value={season.year}>
                {season.year}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Go
          </button>
        </form>
      </div>

      <section className="my-8 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Races" value={eventCount} />
        <StatCard label="Class Wins" value={wins} />
        <StatCard label="Podiums" value={podiums} />
        <StatCard label="Class Points" value={totalPoints} />
        <StatCard label="Division Points" value={totalDivisionPoints} />
        <StatCard label="Average Finish" value={averageFinish} />
      </section>

      <section>
        <h2 className="mb-4 text-xl font-bold">Race History</h2>

        {riderResults.length === 0 ? (
          <p className="rounded-lg border p-6 text-center text-gray-500">
            No results found for this season.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="p-3">Date</th>
                  <th className="p-3">Event</th>
                  <th className="p-3">Class</th>
                  <th className="p-3 text-center">Class Finish</th>
                  <th className="p-3 text-center">Overall</th>
                  <th className="p-3 text-center">Class Points</th>
                  <th className="p-3 text-center">Division Points</th>
                </tr>
              </thead>
              <tbody>
                {riderResults.map((result) => {
                  const event = eventsById.get(result.event_id);
                  const raceClass = classesById.get(result.class_id);

                  const status = result.disqualified
                    ? "DQ"
                    : result.dns
                      ? "DNS"
                      : result.dnf
                        ? "DNF"
                        : null;

                  return (
                    <tr key={result.id} className="border-t">
                      <td className="whitespace-nowrap p-3">
                        {event?.race_date
                          ? new Date(
                              `${event.race_date}T12:00:00`
                            ).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="p-3">
                        {event ? (
                          <Link
                            href={`/results/${event.id}`}
                            className="font-medium text-blue-600 hover:underline"
                          >
                            {event.name}
                          </Link>
                        ) : (
                          "Unknown Event"
                        )}
                      </td>
                      <td className="p-3">
                        {raceClass?.name ?? "Unknown Class"}
                      </td>
                      <td className="p-3 text-center">
                        {status ?? result.position ?? "—"}
                      </td>
                      <td className="p-3 text-center">
                        {result.overall_position ?? "—"}
                      </td>
                      <td className="p-3 text-center">
                        {result.points ?? 0}
                      </td>
                      <td className="p-3 text-center">
                        {result.division_points ?? 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-4 text-sm text-gray-500">
        Best class finish this season: {bestFinish}
      </p>
    </main>
  );
}

function StatCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}