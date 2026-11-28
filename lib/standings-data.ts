import "server-only";

import { selectPublicRows } from "@/lib/supabase/data";
import {
  applyDrops,
  applyWorkerPoints,
  applySportsmanPoints,
  buildStandings,
  eventsRidden,
  markEligibility,
  type Standing,
  type StandingResult,
} from "@/lib/standings";

/** Each rider's lowest results that don't count toward the season total (missed races count as 0). */
export const SEASON_DROPS = { adult: 7, junior: 3 } as const;

export type StandingsClass = {
  id: string;
  season_id: string;
  series_id: string | null;
  name: string;
  display_order: number | null;
  division_id: string | null;
};

export type StandingsDivision = {
  id: string;
  name: string;
  display_order: number;
  has_annual_points: boolean;
};

type Season = { id: string; year: number; name: string | null };
type Series = { id: string; season_id: string; name: string };
type EventRow = { id: string; name: string; race_date: string | null };

export type SeasonRace = { id: string; name: string; date: string | null };
type Member = { id: string; full_name: string; rider_number: string | null };
type Credit = { rider_id: string; season_id: string; kind: string; event_id: string | null };

export type SeasonStandings = {
  season: Season;
  eventCount: number;
  /** Races this season with results in these classes, oldest first. */
  races: SeasonRace[];
  memberCount: number;
  /** Number of lowest results dropped from each rider's season total. */
  drops: number;
  /** Members in these standings who have earned eligibility ("E"). */
  eligibleCount: number;
  /** False until the rider_credits table exists (then nobody can have an E yet). */
  creditsLoaded: boolean;
  /** Riders with results in these classes this season, and how many of them are members. */
  ridersRaced: number;
  membersRaced: number;
  classes: StandingsClass[];
  divisions: StandingsDivision[];
  byClass: Record<string, Standing[]>;
  byDivision: Record<string, Standing[]>;
};

/**
 * Loads this season's standings.
 * "adult": classes that belong to a division, plus division standings.
 * "junior": classes in the Junior series (no divisions), class standings only.
 */
export async function loadSeasonStandings(
  kind: "adult" | "junior",
): Promise<{ data: SeasonStandings | null; error: string | null }> {
  const [seasonsRes, seriesRes, membersRes, classesRes, divisionsRes] =
    await Promise.all([
      selectPublicRows<Season>("seasons", "id, year, name", {
        orderBy: "year",
        ascending: false,
      }),
      selectPublicRows<Series>("series", "id, season_id, name"),
      selectPublicRows<Member>("member_standings_riders", "id, full_name, rider_number"),
      selectPublicRows<StandingsClass>(
        "classes",
        "id, season_id, series_id, name, display_order, division_id",
      ),
      selectPublicRows<StandingsDivision>(
        "divisions",
        "id, name, display_order, has_annual_points",
      ),
    ]);

  if (
    seasonsRes.error ||
    seriesRes.error ||
    membersRes.error ||
    classesRes.error ||
    divisionsRes.error
  ) {
    return { data: null, error: "Unable to load standings data. Please try again later." };
  }

  const seasons = seasonsRes.data ?? [];
  const season =
    seasons.find((s) => s.year === new Date().getFullYear()) ?? seasons[0];
  if (!season) return { data: null, error: "No seasons are available yet." };

  const juniorSeries = new Set(
    (seriesRes.data ?? [])
      .filter((s) => s.season_id === season.id && /junior/i.test(s.name))
      .map((s) => s.id),
  );

  const classes = (classesRes.data ?? [])
    .filter((c) => c.season_id === season.id)
    .filter((c) =>
      kind === "adult"
        ? Boolean(c.division_id)
        : !c.division_id && c.series_id !== null && juniorSeries.has(c.series_id),
    )
    .sort(
      (a, b) =>
        (a.display_order ?? 999) - (b.display_order ?? 999) ||
        a.name.localeCompare(b.name),
    );

  // Every division with classes this season gets a tab (D has class points only, no
  // division standing: rulebook 7.12 / 7.13).
  const seasonDivisionIds = new Set(classes.map((c) => c.division_id).filter(Boolean));
  const divisions =
    kind === "adult"
      ? (divisionsRes.data ?? [])
          .filter((d) => seasonDivisionIds.has(d.id))
          .sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name))
      : [];

  const eventsRes = await selectPublicRows<EventRow>("events", "id, name, race_date", {
    equals: { column: "season_id", value: season.id },
    orderBy: "race_date",
    ascending: true,
  });
  if (eventsRes.error) return { data: null, error: "Unable to load season events." };
  const eventIds = (eventsRes.data ?? []).map((e) => e.id);

  const resultsRes = await selectPublicRows<StandingResult>(
    "results",
    "event_id, rider_id, class_id, position, points, division_points, dns, dnf, disqualified",
    { in: { column: "event_id", values: eventIds } },
  );
  if (resultsRes.error) return { data: null, error: "Unable to load race results." };

  const classIds = new Set(classes.map((c) => c.id));
  const results = (resultsRes.data ?? []).filter((r) => classIds.has(r.class_id));
  const raced = new Set(results.map((r) => r.event_id));
  const races = (eventsRes.data ?? [])
    .filter((e) => raced.has(e.id))
    .map((e) => ({ id: e.id, name: e.name, date: e.race_date }));
  const members = membersRes.data ?? [];
  const memberIds = new Set(members.map((m) => m.id));
  const racedIds = new Set(results.map((r) => r.rider_id));
  const membersRaced = [...racedIds].filter((id) => memberIds.has(id)).length;

  const raceIds = races.map((r) => r.id);
  const annualDivisionIds = new Set(divisions.filter((d) => d.has_annual_points).map((d) => d.id));
  const built = buildStandings({ results, members, classes, annualDivisionIds, raceOrder: raceIds });

  // Worker points and eligibility (rider_credits). If the table isn't there yet,
  // the standings still load, just without WP or E.
  const creditsRes = await selectPublicRows<Credit>("public_rider_credits", "rider_id, season_id, kind, event_id", {
    equals: { column: "season_id", value: season.id },
  });
  const credits = creditsRes.error ? [] : (creditsRes.data ?? []);
  const ridden = eventsRidden(results);
  const credited = new Set(credits.map((c) => c.rider_id));
  const workerCredits = new Map<string, number>();
  // Worker points are for the adult series only (rulebook 5.11).
  if (kind === "adult") {
    for (const c of credits) {
      // One set of worker points per rider per season, in one class (rulebook 5.7).
      if (c.kind === "worker_points") workerCredits.set(c.rider_id, 1);
    }
  }
  // The event each rider worked, as this season's race ids (both days of a two-day event).
  const eventBase = (name: string) => name.replace(/\s*day\s*\d+\s*$/i, "").trim().toLowerCase();
  const allEventNames = new Map((eventsRes.data ?? []).map((e) => [e.id, e.name]));
  const workerEvents = new Map<string, string[]>();
  for (const c of credits) {
    if (c.kind !== "worker_points" || !c.event_id || workerEvents.has(c.rider_id)) continue;
    const name = allEventNames.get(c.event_id);
    const ids = name ? races.filter((r) => eventBase(r.name) === eventBase(name)).map((r) => r.id) : [];
    if (ids.length) workerEvents.set(c.rider_id, ids);
  }
  const classDivision = new Map<string, string | null>(
    classes.map((c) => [c.id, c.division_id && annualDivisionIds.has(c.division_id) ? c.division_id : null]),
  );
  const withWorkerPoints = applyWorkerPoints({
    byClass: built.byClass,
    byDivision: built.byDivision,
    classDivision,
    workerCredits,
    workerEvents,
    ridden,
    seasonRaceIds: raceIds,
  });

  const drops = SEASON_DROPS[kind];
  const dropped = (groups: Record<string, Standing[]>) =>
    Object.fromEntries(Object.entries(groups).map(([id, rows]) => [id, applyDrops(rows, raceIds, drops)]));
  // Sportsman points (rulebook 6): one set per rider per season, added after drops.
  const withSportsmanPoints = applySportsmanPoints({
    byClass: dropped(withWorkerPoints.byClass),
    byDivision: dropped(withWorkerPoints.byDivision),
    classDivision,
    sportsmanRiders: new Set(credits.filter((c) => c.kind === "sportsman").map((c) => c.rider_id)),
    raceOrder: raceIds,
  });
  const eligible = (groups: Record<string, Standing[]>) =>
    Object.fromEntries(Object.entries(groups).map(([id, rows]) => [id, markEligibility(rows, credited, ridden)]));
  const byClass = eligible(withSportsmanPoints.byClass);
  const byDivision = eligible(withSportsmanPoints.byDivision);
  const eligibleCount = members.filter((m) => credited.has(m.id) && (ridden.get(m.id) ?? 0) >= 4 && racedIds.has(m.id)).length;

  return {
    data: {
      season,
      eventCount: races.length,
      races,
      memberCount: members.length,
      drops,
      eligibleCount,
      creditsLoaded: !creditsRes.error,
      ridersRaced: racedIds.size,
      membersRaced,
      classes,
      divisions,
      byClass,
      byDivision,
    },
    error: null,
  };
}
