import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { selectPublicRows } from "@/lib/supabase/data";
import { ButtonLink, Page, SelectField } from "@/components/ui";

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
  return <Page><p className="text-neutral-400">Loading rider stats...</p></Page>;
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
      <Page>
        <ButtonLink href="/riders" back>
          All riders
        </ButtonLink>
        <h1 className="mt-6 text-2xl font-black uppercase">Unable to load rider stats</h1>
        <p className="mt-2 text-neutral-400">
          Please try again later. If the problem continues, check the server
          logs for the Supabase query error.
        </p>
      </Page>
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
    <Page>
      <ButtonLink href="/riders" back>
        All riders
      </ButtonLink>

      <div className="mt-8 flex flex-wrap items-end justify-between gap-6 border-b border-white/10 pb-8">
        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.25em] text-lime-400">Rider stats</p>
          <h1 className="text-4xl font-black uppercase tracking-tight md:text-5xl">
            {rider.full_name || "Unknown Rider"}
          </h1>
          {rider.rider_number != null && (
            <p className="mt-3 inline-flex rounded-full border border-white/15 px-3 py-1 text-sm font-bold text-neutral-300">
              #{rider.rider_number}
            </p>
          )}
        </div>

        <form action="" method="GET" className="flex items-end gap-2">
          <SelectField id="season" name="season" label="Season" defaultValue={selectedSeason?.year ?? ""} className="w-36">
            {seasons.map((season) => (
              <option key={season.id} value={season.year}>
                {season.year}
              </option>
            ))}
          </SelectField>
          <button
            type="submit"
            className="rounded-xl bg-lime-400 px-4 py-3 text-sm font-bold uppercase tracking-wide text-[#101211] transition hover:bg-lime-300"
          >
            Show
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
        <h2 className="mb-4 text-xl font-black uppercase tracking-tight">Race History</h2>

        {riderResults.length === 0 ? (
          <p className="rounded-2xl border border-white/10 bg-[#141816] p-8 text-center text-neutral-400">
            No results found for this season.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-white/10 bg-[#141816]">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-white/10 text-[11px] uppercase tracking-[0.15em] text-neutral-400">
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
                    <tr key={result.id} className="border-t border-white/5 transition hover:bg-white/[0.02]">
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
                            className="font-bold text-white transition hover:text-lime-300"
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

      <p className="mt-4 text-sm text-neutral-500">
        Best class finish this season: {bestFinish}
      </p>
    </Page>
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
    <div className="rounded-2xl border border-white/10 bg-[#141816] p-5">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-400">{label}</p>
      <p className="mt-2 text-3xl font-black text-lime-400">{value}</p>
    </div>
  );
}