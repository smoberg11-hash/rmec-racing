"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import EventStatus from "@/components/EventStatus";

export type CalendarEvent = {
  id: string;
  name: string;
  race_date: string;
  location: string | null;
  city: string | null;
  state: string | null;
  processed: boolean | null;
  /** Non-race events (e.g. the banquet): their own link and colour, no results. */
  kind?: "race" | "event";
  href?: string;
  linkText?: string;
};

type RaceCalendarProps = {
  events: CalendarEvent[];
};

function getDateKey(dateString: string) {
  return dateString.slice(0, 10);
}

function getMonthKey(dateString: string) {
  return getDateKey(dateString).slice(0, 7);
}

function formatMonth(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(
    "en-US",
    {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }
  );
}

function formatDay(dateString: string) {
  const [year, month, day] = getDateKey(dateString)
    .split("-")
    .map(Number);

  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(
    "en-US",
    {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }
  );
}

function getEventLocation(event: CalendarEvent) {
  const parts = [
    event.location,
    [event.city, event.state].filter(Boolean).join(", "),
  ].filter(Boolean);

  return [...new Set(parts)].join(" · ") || "Location TBD";
}

export default function RaceCalendar({ events }: RaceCalendarProps) {
  const availableMonths = useMemo(() => {
    return [
      ...new Set(
        events
          .filter((event) => event.race_date)
          .map((event) => getMonthKey(event.race_date))
      ),
    ].sort();
  }, [events]);

  const initialMonth = useMemo(() => {
    const currentMonth = new Date().toISOString().slice(0, 7);

    if (availableMonths.includes(currentMonth)) {
      return currentMonth;
    }

    const nextMonth = availableMonths.find(
      (month) => month >= currentMonth
    );

    return nextMonth ?? availableMonths[availableMonths.length - 1] ?? currentMonth;
  }, [availableMonths]);

  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  const displayedMonth = selectedMonth ?? initialMonth;

  const [year, month] = displayedMonth.split("-").map(Number);

  // Every month of the years that have events (Jan–Dec), plus whatever month is showing.
  const monthOptions = (() => {
    const years = new Set(availableMonths.map((m) => Number(m.slice(0, 4))));
    years.add(year);
    const list: string[] = [];
    for (const y of [...years].sort()) {
      for (let m = 1; m <= 12; m++) list.push(`${y}-${String(m).padStart(2, "0")}`);
    }
    return list;
  })();

  const firstWeekday = new Date(
    Date.UTC(year, month - 1, 1)
  ).getUTCDay();

  const daysInMonth = new Date(
    Date.UTC(year, month, 0)
  ).getUTCDate();

  const eventsByDate = useMemo(() => {
    const grouped: Record<string, CalendarEvent[]> = {};

    for (const event of events) {
      if (!event.race_date) continue;

      const dateKey = getDateKey(event.race_date);

      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }

      grouped[dateKey].push(event);
    }

    return grouped;
  }, [events]);

  const monthEvents = events
    .filter(
      (event) =>
        event.race_date &&
        getMonthKey(event.race_date) === displayedMonth
    )
    .sort((a, b) => a.race_date.localeCompare(b.race_date));

  function changeMonth(direction: -1 | 1) {
    const nextDate = new Date(
      Date.UTC(year, month - 1 + direction, 1)
    );

    const nextMonth = [
      nextDate.getUTCFullYear(),
      String(nextDate.getUTCMonth() + 1).padStart(2, "0"),
    ].join("-");

    setSelectedMonth(nextMonth);
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-[#111513] p-5 sm:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.25em] text-lime-400">
            Race Schedule
          </p>

          <h2 className="text-2xl font-black uppercase tracking-tight text-white sm:text-3xl">
            Race Calendar
          </h2>

          <p className="mt-2 text-sm text-neutral-400">
            Select a date to see its scheduled races.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => changeMonth(-1)}
            aria-label="Previous month"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 text-white transition hover:border-lime-400 hover:text-lime-400"
          >
            ←
          </button>

          <label className="relative">
            <span className="sr-only">Choose a month</span>
            <select
              value={displayedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="min-w-44 cursor-pointer appearance-none rounded-lg border border-white/15 bg-[#181d1a] py-2 pl-4 pr-9 text-center font-bold text-white transition hover:border-lime-400 focus:border-lime-400 focus:outline-none"
            >
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {formatMonth(m)}
                </option>
              ))}
            </select>
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-lime-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 8l5 5 5-5" />
            </svg>
          </label>

          <button
            type="button"
            onClick={() => changeMonth(1)}
            aria-label="Next month"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/15 text-white transition hover:border-lime-400 hover:text-lime-400"
          >
            →
          </button>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 p-8 text-center">
          <p className="font-semibold text-white">
            No races scheduled yet.
          </p>
          <p className="mt-2 text-sm text-neutral-400">
            Check back for upcoming race dates.
          </p>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <div>
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                (day) => (
                  <div
                    key={day}
                    className="py-2 text-center text-xs font-bold uppercase text-neutral-500"
                  >
                    {day}
                  </div>
                )
              )}

              {Array.from({ length: firstWeekday }).map((_, index) => (
                <div key={`empty-${index}`} />
              ))}

              {Array.from({ length: daysInMonth }, (_, index) => {
                const day = index + 1;

                const dateKey = [
                  year,
                  String(month).padStart(2, "0"),
                  String(day).padStart(2, "0"),
                ].join("-");

                const dayEvents = eventsByDate[dateKey] ?? [];
                const hasEvents = dayEvents.length > 0;
                const onlySpecial = hasEvents && dayEvents.every((e) => e.kind === "event");

                return (
                  <button
                    key={dateKey}
                    type="button"
                    disabled={!hasEvents}
                    onClick={() => {
                      document
                        .getElementById(`race-day-${dateKey}`)
                        ?.scrollIntoView({
                          behavior: "smooth",
                          block: "nearest",
                        });
                    }}
                    aria-label={
                      hasEvents
                        ? `${dateKey}: ${dayEvents.length} race${dayEvents.length > 1 ? "s" : ""}`
                        : dateKey
                    }
                    className={`relative flex min-h-12 flex-col items-center justify-center rounded-lg border text-sm transition sm:min-h-16 ${
                      onlySpecial
                        ? "cursor-pointer border-amber-400/40 bg-amber-400/10 font-bold text-amber-200 hover:border-amber-400 hover:bg-amber-400/20"
                        : hasEvents
                          ? "cursor-pointer border-lime-400/40 bg-lime-400/10 font-bold text-lime-300 hover:border-lime-400 hover:bg-lime-400/20"
                          : "border-white/5 bg-white/[0.02] text-neutral-500"
                    }`}
                  >
                    {day}

                    {hasEvents && (
                      <span className="mt-1 flex gap-1">
                        {dayEvents.slice(0, 3).map((event) => (
                          <span
                            key={event.id}
                            className={`h-1 w-1 rounded-full ${event.kind === "event" ? "bg-amber-400" : "bg-lime-400"}`}
                          />
                        ))}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex items-center gap-2 text-xs text-neutral-400">
              <span className="h-2 w-2 rounded-full bg-lime-400" />
              Race scheduled
              <span className="ml-4 h-2 w-2 rounded-full bg-amber-400" />
              Banquet / event
            </div>
          </div>

          <div>
            <h3 className="mb-4 text-lg font-bold text-white">
              This month
            </h3>

            {monthEvents.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/15 p-6 text-center">
                <p className="font-bold text-white">Rest up and wrench on the bike.</p>
                <p className="mt-1 text-sm text-neutral-400">No races this month. Racing will be back soon!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {monthEvents.map((event) => {
                  const dateKey = getDateKey(event.race_date);

                  return (
                    <article
                      id={`race-day-${dateKey}`}
                      key={event.id}
                      className="scroll-mt-6 rounded-xl border border-white/10 bg-black/20 p-4"
                    >
                      <div className="flex items-start gap-4">
                        <div className="min-w-14 rounded-lg bg-lime-400/10 px-3 py-2 text-center">
                          <span className="block text-xs font-bold uppercase text-lime-400">
                            {formatDay(event.race_date).split(" ")[0]}
                          </span>

                          <span className="block text-xl font-black text-white">
                            {Number(dateKey.slice(-2))}
                          </span>
                        </div>

                        <div className="min-w-0 flex-1">
                          <h4 className="font-bold text-white">
                            {event.name}
                          </h4>

                          <p className="mt-1 text-sm text-neutral-400">
                            {getEventLocation(event)}
                          </p>

                          {event.kind === "event" ? (
                            <Link
                              href={event.href ?? "/"}
                              className="mt-3 inline-block text-sm font-bold text-amber-300 transition hover:text-amber-200"
                            >
                              {event.linkText ?? "Details →"}
                            </Link>
                          ) : (
                            <>
                              <EventStatus raceDate={event.race_date} processed={event.processed} className="mt-2" />
                              <Link
                                href={`/results/${event.id}`}
                                className="mt-3 block text-sm font-bold text-lime-400 transition hover:text-lime-300"
                              >
                                View Results →
                              </Link>
                            </>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}