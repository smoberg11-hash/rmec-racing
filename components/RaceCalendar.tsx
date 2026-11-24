"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type CalendarEvent = {
  id: string;
  name: string;
  race_date: string;
  location: string | null;
  city: string | null;
  state: string | null;
  status: string | null;
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

  const monthEvents = useMemo(() => {
    return events
      .filter(
        (event) =>
          event.race_date &&
          getMonthKey(event.race_date) === displayedMonth
      )
      .sort((a, b) => a.race_date.localeCompare(b.race_date));
  }, [events, displayedMonth]);

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

          <span className="min-w-36 text-center font-bold text-white">
            {formatMonth(displayedMonth)}
          </span>

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
                      hasEvents
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
                            className="h-1 w-1 rounded-full bg-lime-400"
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
            </div>
          </div>

          <div>
            <h3 className="mb-4 text-lg font-bold text-white">
              Races this month
            </h3>

            {monthEvents.length === 0 ? (
              <div className="rounded-xl border border-white/10 p-5">
                <p className="text-sm text-neutral-400">
                  No races scheduled for this month.
                </p>
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

                          {event.status && (
                            <span className="mt-2 inline-block rounded-full border border-white/10 px-2 py-1 text-xs text-neutral-300">
                              {event.status}
                            </span>
                          )}

                          <Link
                            href={`/results/${event.id}`}
                            className="mt-3 inline-block text-sm font-bold text-lime-400 transition hover:text-lime-300"
                          >
                 
                            View Results →
                          </Link>
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