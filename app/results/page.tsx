import { Suspense } from "react";
import Link from "next/link";
import { selectPublicRows } from "@/lib/supabase/data";

type EventRow = {
  id: string;
  name: string;
  race_date: string;
  location: string | null;
  city: string | null;
  state: string | null;
  season_id: string;
  series_id: string | null;
  series: string | null;
};

type SeasonRow = {
  id: string;
  year: number;
  name: string | null;
};

type SeriesRow = {
  id: string;
  season_id: string;
  name: string;
  display_order: number | null;
};

function formatRaceDate(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

async function ResultsEventGroups() {
  const [eventsResult, seasonsResult, seriesResult] = await Promise.all([
    selectPublicRows<EventRow>(
      "events",
      "id, name, race_date, location, city, state, season_id, series_id, series",
      { orderBy: "race_date", ascending: false },
    ),
    selectPublicRows<SeasonRow>("seasons", "id, year, name"),
    selectPublicRows<SeriesRow>(
      "series",
      "id, season_id, name, display_order",
      { orderBy: "display_order" },
    ),
  ]);

  if (eventsResult.error || seasonsResult.error || seriesResult.error) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-400/30 bg-red-400/5 p-6 text-sm text-red-200"
      >
        Race events could not be loaded. Please try again later.
      </div>
    );
  }

  const events = eventsResult.data ?? [];
  if (!events.length) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-8">
        <h2 className="text-xl font-bold">No race events yet</h2>
        <p className="mt-3 text-sm leading-6 text-neutral-400">
          Events will appear here when they are added to the season schedule.
        </p>
      </div>
    );
  }

  const seasonsById = new Map(
    (seasonsResult.data ?? []).map((season) => [season.id, season]),
  );
  const seriesById = new Map(
    (seriesResult.data ?? []).map((series) => [series.id, series]),
  );
  const seriesOrder = new Map(
    (seriesResult.data ?? []).map((series) => [
      series.id,
      series.display_order ?? Number.MAX_SAFE_INTEGER,
    ]),
  );
  const eventsBySeason = new Map<string, EventRow[]>();

  for (const event of events) {
    const seasonEvents = eventsBySeason.get(event.season_id) ?? [];
    seasonEvents.push(event);
    eventsBySeason.set(event.season_id, seasonEvents);
  }

  const seasonGroups = [...eventsBySeason.entries()].sort(([leftId], [rightId]) => {
    const leftYear = seasonsById.get(leftId)?.year ?? 0;
    const rightYear = seasonsById.get(rightId)?.year ?? 0;
    return rightYear - leftYear;
  });

  return (
    <div className="space-y-12">
      {seasonGroups.map(([seasonId, seasonEvents]) => {
        const season = seasonsById.get(seasonId);
        const eventsBySeries = new Map<string, EventRow[]>();

        for (const event of seasonEvents) {
          const seriesKey = event.series_id ?? `text:${event.series ?? "unknown"}`;
          const seriesEvents = eventsBySeries.get(seriesKey) ?? [];
          seriesEvents.push(event);
          eventsBySeries.set(seriesKey, seriesEvents);
        }

        const seriesGroups = [...eventsBySeries.entries()].sort(
          ([leftId, leftEvents], [rightId, rightEvents]) => {
            const leftOrder = seriesOrder.get(leftId) ?? Number.MAX_SAFE_INTEGER;
            const rightOrder = seriesOrder.get(rightId) ?? Number.MAX_SAFE_INTEGER;
            if (leftOrder !== rightOrder) return leftOrder - rightOrder;
            return (leftEvents[0]?.series ?? "").localeCompare(
              rightEvents[0]?.series ?? "",
            );
          },
        );

        return (
          <section key={seasonId}>
            <div className="mb-6 flex items-end justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.25em] text-lime-400">
                  Season
                </p>
                <h2 className="mt-2 text-2xl font-black">
                  {season?.name ?? `${season?.year ?? "Unknown"} Season`}
                </h2>
              </div>
              {season && (
                <span className="text-sm font-bold text-neutral-400">
                  {season.year}
                </span>
              )}
            </div>

            <div className="space-y-8">
              {seriesGroups.map(([seriesKey, seriesEvents]) => {
                const seriesId = seriesKey.startsWith("text:")
                  ? null
                  : seriesKey;
                const seriesName =
                  (seriesId ? seriesById.get(seriesId)?.name : null) ??
                  seriesEvents[0]?.series ??
                  "Series not listed";

                return (
                  <section key={seriesKey} aria-label={seriesName}>
                    <h3 className="mb-3 text-lg font-bold text-white">
                      {seriesName}
                    </h3>
                    <ul className="divide-y divide-white/10 rounded-xl border border-white/10 bg-white/[0.03]">
                      {seriesEvents.map((event) => {
                        const location =
                          event.location ||
                          [event.city, event.state]
                            .filter(Boolean)
                            .join(", ");

                        return (
                          <li key={event.id}>
                            <Link
                              href={`/results/${event.id}`}
                              className="group flex flex-wrap items-center justify-between gap-4 px-5 py-4 transition hover:bg-white/[0.04]"
                            >
                              <span className="min-w-0">
                                <span className="block font-bold text-white transition group-hover:text-lime-300">
                                  {event.name}
                                </span>
                                {location && (
                                  <span className="mt-1 block text-sm text-neutral-500">
                                    {location}
                                  </span>
                                )}
                              </span>
                              <time
                                dateTime={event.race_date}
                                className="shrink-0 text-sm text-neutral-400"
                              >
                                {formatRaceDate(event.race_date)}
                              </time>
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ResultsLoading() {
  return (
    <div className="animate-pulse space-y-8" aria-label="Loading race events">
      {[0, 1].map((group) => (
        <div key={group}>
          <div className="mb-5 h-9 w-48 rounded bg-white/10" />
          <div className="mb-3 h-6 w-36 rounded bg-white/10" />
          <div className="h-36 rounded-xl border border-white/10 bg-white/[0.03]" />
        </div>
      ))}
    </div>
  );
}

export default function ResultsPage() {
  return (
    <main className="min-h-screen bg-[#101211] text-white">
      <section className="mx-auto max-w-7xl px-6 py-16 md:py-20">
        <p className="text-sm font-bold uppercase tracking-[0.25em] text-lime-400">
          Rocky Mountain Enduro Circuit
        </p>
        <h1 className="mt-3 text-4xl font-black md:text-6xl">Race Results</h1>
        <p className="mt-5 max-w-2xl leading-7 text-neutral-400">
          Browse event schedules by season and series. Select an event to view
          its posted results.
        </p>

        <div className="mt-12">
          <Suspense fallback={<ResultsLoading />}>
            <ResultsEventGroups />
          </Suspense>
        </div>
      </section>
    </main>
  );
}