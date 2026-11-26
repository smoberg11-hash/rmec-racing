"use client";

/**
 * A race's status, worked out from its date and whether its results have been imported,
 * instead of the hand-typed events.status column (which went stale).
 * Runs in the browser so "today" is the visitor's today.
 */
export function eventStatus(raceDate: string | null, processed: boolean | null, today = new Date()) {
  if (processed) return "Results posted";
  if (!raceDate) return null;
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return raceDate.slice(0, 10) < todayKey ? "Results coming soon" : "Upcoming";
}

export default function EventStatus({
  raceDate,
  processed,
  className = "",
}: {
  raceDate: string | null;
  processed: boolean | null;
  className?: string;
}) {
  const status = eventStatus(raceDate, processed);
  if (!status) return null;
  const tone =
    status === "Results posted"
      ? "border-lime-400/30 text-lime-300"
      : status === "Upcoming"
        ? "border-sky-400/30 text-sky-300"
        : "border-amber-400/30 text-amber-200";
  return (
    <span suppressHydrationWarning className={`inline-block rounded-full border px-2 py-1 text-xs ${tone} ${className}`}>
      {status}
    </span>
  );
}
