import { ButtonLink } from "@/components/ui";
import EventStatus from "@/components/EventStatus";
import { notFound } from "next/navigation";
import { selectPublicRows } from "@/lib/supabase/data";
import ResultsFilters from "./ResultsFilters";

type PageProps = {
  params: Promise<{ eventId: string }>;
};

type EventRow = {
  id: string;
  name: string;
  race_date: string | null;
  location: string | null;
  city: string | null;
  state: string | null;
  processed: boolean | null;
  series: string | null;
};

type ClassInfo = {
  name: string;
  division_id: string | null;
};

type RawResult = {
  id: string;
  rider_id: string | null;
  class_id: string | null;
  position: number | null;
  points: number | null;
  division_points: number | null;
  overall_position: number | null;
  dns: boolean | null;
  dnf: boolean | null;
  disqualified: boolean | null;
  classes: ClassInfo | ClassInfo[] | null;
  // Times (importer/results_times.sql); missing until that SQL has run.
  total_time?: string | null;
  best_time?: string | null;
  sections_completed?: number | null;
  enduro_checks?: number | null;
  enduro_penalty_seconds?: number | null;
};

const RESULT_COLUMNS =
  "id, rider_id, class_id, position, points, division_points, overall_position, dns, dnf, disqualified, classes(name, division_id)";
const TIME_COLUMNS = ", total_time, best_time, sections_completed, enduro_checks, enduro_penalty_seconds";

/** Results with times; falls back to results without them if the time columns don't exist yet. */
async function loadResults(eventId: string) {
  const options = { equals: { column: "event_id", value: eventId }, orderBy: "position", limit: 500 } as const;
  const withTimes = await selectPublicRows<RawResult>("results", RESULT_COLUMNS + TIME_COLUMNS, options);
  return withTimes.error ? selectPublicRows<RawResult>("results", RESULT_COLUMNS, options) : withTimes;
}

type Rider = {
  id: string;
  full_name: string;
  rider_number: string | number | null;
};

type Division = {
  id: string;
  name: string;
  display_order: number;
};

function getClassInfo(
  classes: ClassInfo | ClassInfo[] | null
): ClassInfo | null {
  if (Array.isArray(classes)) {
    return classes[0] ?? null;
  }

  return classes;
}

export default async function EventResultsPage({ params }: PageProps) {
  const { eventId } = await params;

  const [eventResult, resultsResult, ridersResult, divisionsResult] =
    await Promise.all([
      selectPublicRows<EventRow>(
        "events",
        "id, name, race_date, location, city, state, processed, series",
        {
          equals: { column: "id", value: eventId },
          limit: 1,
        }
      ),

      loadResults(eventId),

      selectPublicRows<Rider>(
        "public_riders",
        // No limit: Supabase returns at most 1000 rows per request, so this pages through all riders.
        "id, full_name, rider_number",
      ),

      selectPublicRows<Division>(
        "divisions",
        "id, name, display_order",
        {
          orderBy: "display_order",
          limit: 100,
        }
      ),
    ]);

  const event = eventResult.data?.[0];

  if (!event) {
    notFound();
  }

  const rawResults = resultsResult.data ?? [];
  const riders = ridersResult.data ?? [];
  const divisions = divisionsResult.data ?? [];

  const ridersById = new Map(
    riders.map((rider) => [
      rider.id,
      {
        name: rider.full_name,
        number: String(rider.rider_number ?? ""),
      },
    ])
  );

  const results = rawResults.map((result) => {
    const rider = result.rider_id
      ? ridersById.get(result.rider_id)
      : undefined;

    const classInfo = getClassInfo(result.classes);

    return {
      id: result.id,
      riderName: rider?.name ?? "Unknown rider",
      riderNumber: rider?.number ?? "",
      classId: result.class_id ?? "",
      className: classInfo?.name ?? "Unknown class",

      // Connect each result to its class's division.
      divisionId: classInfo?.division_id ?? "",

      position: result.position,
      points: result.points,
      divisionPoints: result.division_points,
      overallPosition: result.overall_position,
      dns: result.dns,
      dnf: result.dnf,
      disqualified: result.disqualified,
      totalTime: result.total_time ?? null,
      bestTime: result.best_time ?? null,
      sections: result.sections_completed ?? null,
      enduroChecks: result.enduro_checks ?? null,
      enduroPenalty: result.enduro_penalty_seconds ?? null,
    };
  });

  const classes = Array.from(
    new Map(
      results
        .filter((result) => result.classId !== "")
        .map((result) => [
          result.classId,
          {
            id: result.classId,
            name: result.className,
          },
        ])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  const location = [event.location, event.city, event.state]
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .join(", ");

  const formattedDate = event.race_date
    ? new Date(`${event.race_date}T12:00:00`).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <main className="w-full flex-1 bg-[#101211] text-white">
      <div className="mx-auto max-w-7xl px-4 py-8 md:px-8 md:py-12">
        <div className="mb-8">
          <ButtonLink href="/results" back>
            All results
          </ButtonLink>
        </div>

        <header className="mb-8 border-b border-white/10 pb-8">
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-lime-400">
            Race results
          </p>

          <h1 className="text-3xl font-black tracking-tight md:text-5xl">
            {event.name}
          </h1>

          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-neutral-400">
            {formattedDate && <span>{formattedDate}</span>}

            {location && <span>{location}</span>}

            <EventStatus raceDate={event.race_date} processed={event.processed} />
          </div>
        </header>

        {resultsResult.error ? (
          <div className="rounded-xl border border-red-400/20 bg-red-400/5 p-6">
            <h2 className="font-bold text-red-300">
              Unable to load race results
            </h2>
            <p className="mt-2 text-sm text-neutral-400">
              Please try again later.
            </p>
          </div>
        ) : (
          <section className="overflow-hidden rounded-xl border border-white/10 bg-[#141816]">
            <div className="border-b border-white/10 p-5">
              <h2 className="text-lg font-bold">Results</h2>
              <p className="mt-1 text-sm text-neutral-400">
                Search riders or filter by class and division.
              </p>
            </div>

            {ridersResult.error && (
              <p className="border-b border-yellow-400/20 bg-yellow-400/5 px-5 py-3 text-sm text-yellow-200">
                Some rider names or numbers may be unavailable.
              </p>
            )}

            {divisionsResult.error && (
              <p className="border-b border-yellow-400/20 bg-yellow-400/5 px-5 py-3 text-sm text-yellow-200">
                Division options could not be loaded.
              </p>
            )}

            {results.length === 0 ? (
              <p className="p-6 text-sm text-neutral-400">
                No results have been published for this event yet.
              </p>
            ) : (
              <ResultsFilters
                results={results}
                classes={classes}
                divisions={divisions}
              />
            )}
          </section>
        )}
      </div>
    </main>
  );
}