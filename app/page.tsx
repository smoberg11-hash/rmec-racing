import Link from "next/link";
import { Suspense } from "react";

import { SITE_EVENTS } from "@/lib/site-events";
import { selectPublicRows } from "@/lib/supabase/data";
import RaceCalendar, {
  type CalendarEvent,
} from "../components/RaceCalendar";

const activeSeasonId = "93a2ed41-7bd5-45f8-8add-194d94916b08";

type EventRow = CalendarEvent & {
  season_id: string;
};

function formatRaceDate(dateString: string) {
  const [year, month, day] = dateString.slice(0, 10).split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(
    "en-US",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }
  );
}

function QuickLink({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-white/10 bg-white/[0.03] p-5 transition hover:border-lime-400/50 hover:bg-white/[0.06]"
    >
      <h3 className="font-bold text-white transition group-hover:text-lime-400">
        {title} <span aria-hidden="true">→</span>
      </h3>

      <p className="mt-2 text-sm leading-6 text-neutral-400">
        {description}
      </p>
    </Link>
  );
}

async function RaceCalendarSection() {
  const result = await selectPublicRows<EventRow>(
    "events",
    "id, season_id, name, race_date, location, city, state, processed",
    {
      equals: { column: "season_id", value: activeSeasonId },
      orderBy: "race_date",
      ascending: true,
    },
  );

  if (result.error || !Array.isArray(result.data)) {
    return (
      <section className="rounded-2xl border border-white/10 bg-[#111513] p-8">
        <h2 className="text-2xl font-black uppercase text-white">
          Race Calendar
        </h2>

        <p className="mt-3 text-sm text-neutral-400">
          The race calendar could not be loaded. Please try again later.
        </p>
      </section>
    );
  }

  const events: CalendarEvent[] = result.data.map((event) => ({
    id: event.id,
    name: event.name,
    race_date: event.race_date,
    location: event.location,
    city: event.city,
    state: event.state,
    processed: event.processed,
  }));

  // The banquet and other non-race events (lib/site-events.ts), once they have a date.
  for (const e of SITE_EVENTS) {
    if (!e.date) continue;
    events.push({
      id: e.id,
      name: e.name,
      race_date: e.date,
      location: e.location,
      city: null,
      state: null,
      processed: null,
      kind: "event",
      href: e.href,
      linkText: e.linkText,
    });
  }

  return <RaceCalendar events={events} />;
}

async function LatestRaces() {
  const result = await selectPublicRows<EventRow>(
    "events",
    "id, season_id, name, race_date, location, city, state, processed",
    {
      equals: { column: "season_id", value: activeSeasonId },
      orderBy: "race_date",
      ascending: false,
      limit: 5,
    },
  );

  if (result.error || !Array.isArray(result.data)) {
    return (
      <p className="text-sm text-neutral-400">
        Race information is temporarily unavailable.
      </p>
    );
  }

  const events = [...result.data].sort((a, b) =>
    b.race_date.localeCompare(a.race_date)
  );

  if (events.length === 0) {
    return (
      <p className="text-sm text-neutral-400">
        No race events have been added yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {events.map((event) => (
        <Link
          key={event.id}
          href={`/results/${event.id}`}
          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-lime-400/40"
        >
          <div>
            <h3 className="font-bold text-white">{event.name}</h3>

            <p className="mt-1 text-sm text-neutral-400">
              {[event.location, event.city, event.state]
                .filter(Boolean)
                .filter(
                  (value, index, values) => values.indexOf(value) === index
                )
                .join(" · ") || "Location TBD"}
            </p>
          </div>

          <div className="text-right">
            <p className="text-sm font-semibold text-neutral-300">
              {formatRaceDate(event.race_date)}
            </p>

            <span className="mt-1 inline-block text-sm font-bold text-lime-400">
              View Results →
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

export default function HomePage() {
  return (
    <main className="w-full flex-1 bg-[#101211] text-white">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(163,230,53,0.12),transparent_55%)]" />

        <div className="relative mx-auto grid max-w-7xl gap-10 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[1.3fr_0.7fr] lg:items-center">
          <div>
            <p className="mb-5 text-xs font-bold uppercase tracking-[0.3em] text-lime-400">
              Rocky Mountain Enduro Circuit
            </p>

            <h1 className="max-w-4xl text-5xl font-black uppercase leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
              The Race.
              <br />
              The Results.
              <br />
              <span className="text-lime-400">The Season.</span>
            </h1>

            <p className="mt-6 max-w-xl text-base leading-7 text-neutral-300 sm:text-lg">
              Follow race results, track championship standings, and keep up
              with every round of the RMEC season.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/results"
                className="rounded-lg bg-lime-400 px-5 py-3 font-black text-black transition hover:bg-lime-300"
              >
                Race Results
              </Link>

              <Link
                href="/join"
                className="rounded-lg border border-lime-400/60 px-5 py-3 font-bold text-lime-300 transition hover:bg-lime-400 hover:text-black"
              >
                Join RMEC
              </Link>

              <Link
                href="/worker-points"
                className="rounded-lg border border-white/20 px-5 py-3 font-bold text-white transition hover:border-lime-400 hover:text-lime-400"
              >
                Worker Points &amp; Eligibility
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-lime-400/20 bg-[#121713] p-7 sm:p-9">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-lime-400">
              Current Season
            </p>

            <p className="mt-4 text-6xl font-black tracking-tight text-white">
              2026
            </p>

            <p className="mt-3 text-sm leading-6 text-neutral-400">
              One place for race-day results, rider performance, and the
              championship chase.
            </p>

            <div className="mt-7 border-t border-white/10 pt-5">
              <div className="flex flex-col gap-3">
                <Link
                  href="/standings"
                  className="font-bold text-lime-400 hover:text-lime-300"
                >
                  Explore Adult standings →
                </Link>
                <Link
                  href="/standings/junior"
                  className="font-bold text-lime-400 hover:text-lime-300"
                >
                  Explore JR standings →
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Links */}
      <section className="mx-auto max-w-7xl px-5 py-12 sm:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <QuickLink
            title="Adult Standings"
            description="Follow the championship points race."
            href="/standings"
          />

          <QuickLink
            title="Junior Standings"
            description="See junior championship progress."
            href="/standings/junior"
          />

          <QuickLink
            title="Race Results"
            description="Find race results and individual event details."
            href="/results"
          />

          <QuickLink
            title="Rider Stats"
            description="Explore rider profiles and season performance."
            href="/riders"
          />

          <QuickLink
            title="Worker Points & Eligibility"
            description="Request worker points or eligibility for year-end awards."
            href="/worker-points"
          />
        </div>
      </section>

      {/* Race Calendar — moved above Race Results */}
      <section
        id="calendar"
        className="mx-auto max-w-7xl px-5 py-10 sm:px-8"
      >
        <Suspense
          fallback={
            <div className="rounded-2xl border border-white/10 bg-[#111513] p-8">
              <p className="text-sm text-neutral-400">
                Loading the race calendar…
              </p>
            </div>
          }
        >
          <RaceCalendarSection />
        </Suspense>
      </section>

      {/* Latest Race Results */}
      <section
        id="results"
        className="mx-auto max-w-7xl px-5 py-10 sm:px-8"
      >
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.25em] text-lime-400">
              On the Course
            </p>

            <h2 className="text-3xl font-black uppercase tracking-tight sm:text-4xl">
              Race Results
            </h2>
          </div>

          <Link
            href="/results"
            className="text-sm font-bold text-lime-400 hover:text-lime-300"
          >
            All Results →
          </Link>
        </div>

        <Suspense
          fallback={
            <p className="text-sm text-neutral-400">
              Loading race information…
            </p>
          }
        >
          <LatestRaces />
        </Suspense>
      </section>

      {/* Standings Preview */}
      <section className="mx-auto max-w-7xl px-5 py-10 sm:px-8">
        <div className="grid gap-5 md:grid-cols-2">
          <div
            id="adult"
            className="rounded-2xl border border-white/10 bg-[#111513] p-7 sm:p-9"
          >
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-lime-400">
              Championship
            </p>

            <h2 className="mt-3 text-2xl font-black uppercase">
              Adult Standings
            </h2>

            <p className="mt-3 text-sm leading-6 text-neutral-400">
              Check class points, division points, and the current
              championship order.
            </p>

            <Link
              href="/standings"
              className="mt-6 inline-block font-bold text-lime-400 hover:text-lime-300"
            >
              View Adult Standings →
            </Link>
          </div>

          <div
            id="junior"
            className="rounded-2xl border border-white/10 bg-[#111513] p-7 sm:p-9"
          >
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-lime-400">
              Next Generation
            </p>

            <h2 className="mt-3 text-2xl font-black uppercase">
              Junior Standings
            </h2>

            <p className="mt-3 text-sm leading-6 text-neutral-400">
              Follow junior riders and their progress throughout the season.
            </p>

            <Link
              href="/standings/junior"
              className="mt-6 inline-block font-bold text-lime-400 hover:text-lime-300"
            >
              View Junior Standings →
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-neutral-500 sm:px-8">
          <p>RMEC Racing · 2026 Season</p>

          <div className="flex gap-5">
            <Link href="/results" className="transition hover:text-lime-400">
              Results
            </Link>

            <Link
              href="/standings"
              className="transition hover:text-lime-400"
            >
              Standings
            </Link>

            <Link href="/riders" className="transition hover:text-lime-400">
              Riders
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}