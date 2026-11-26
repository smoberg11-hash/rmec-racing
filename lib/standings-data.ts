import "server-only";

import { selectPublicRows } from "@/lib/supabase/data";
import { applyDrops, buildStandings, type Standing, type StandingResult } from "@/lib/standings";

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

export type SeasonStandings = {
  season: Season;
  eventCount: number;
  /** Races this season with results in these classes, oldest first. */
  races: SeasonRace[];
  memberCount: number;
  /** Number of lowest results dropped from each rider's season total. */
  drops: number;
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

  const divisions =
    kind === "adult"
      ? (divisionsRes.data ?? [])
          .filter((d) => d.has_annual_points)
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

  const built = buildStandings({
    results,
    members,
    classes,
    annualDivisionIds: new Set(divisions.map((d) => d.id)),
  });
  const drops = SEASON_DROPS[kind];
  const raceIds = races.map((r) => r.id);
  const withDrops = (groups: Record<string, Standing[]>) =>
    Object.fromEntries(Object.entries(groups).map(([id, rows]) => [id, applyDrops(rows, raceIds, drops)]));
  const byClass = withDrops(built.byClass);
  const byDivision = withDrops(built.byDivision);

  return {
    data: {
      season,
      eventCount: races.length,
      races,
      memberCount: members.length,
      drops,
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
