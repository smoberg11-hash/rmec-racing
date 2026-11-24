import Link from "next/link";
import { selectPublicRows } from "@/lib/supabase/data";
import StandingsFilters from "./StandingsFilters";

type Season = {
  id: string;
  year: number;
  name: string;
};

type Event = {
  id: string;
  season_id: string;
  name: string;
  race_date: string;
};

type MemberRider = {
  id: string;
  full_name: string;
  rider_number: string | null;
};

type RaceClass = {
  id: string;
  season_id: string;
  name: string;
  display_order: number | null;
  division_id: string | null;
};

type Division = {
  id: string;
  name: string;
  display_order: number;
  has_annual_points: boolean;
};

type Result = {
  id: string;
  event_id: string;
  rider_id: string;
  class_id: string;
  points: number | null;
  division_points: number | null;
  dns: boolean | null;
  dnf: boolean | null;
  disqualified: boolean | null;
};

type Standing = {
  riderId: string;
  riderName: string;
  riderNumber: string | null;
  points: number;
  events: number;
};

type DataRow = Record<string, unknown>;

function errorMessage(message: string) {
  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-3xl font-bold">Season Standings</h1>
      <p className="mt-4 text-red-600">{message}</p>
    </main>
  );
}

export default async function StandingsPage() {
  const [
    seasonsResponse,
    membersResponse,
    classesResponse,
    divisionsResponse,
  ] = await Promise.all([
    selectPublicRows<Season>("seasons", "id, year, name", {
      orderBy: "year",
      ascending: false,
    }),

    selectPublicRows<MemberRider>(
      "member_standings_riders",
      "id, full_name, rider_number",
    ),

    selectPublicRows<RaceClass>(
      "classes",
      "id, season_id, name, display_order, division_id",
    ),

    selectPublicRows<Division>(
      "divisions",
      "id, name, display_order, has_annual_points",
    ),
  ]);

  const firstError =
    seasonsResponse.error ??
    membersResponse.error ??
    classesResponse.error ??
    divisionsResponse.error;

  if (firstError) {
    return errorMessage(
      "Unable to load standings data. Please try again later.",
    );
  }

  const seasons = seasonsResponse.data ?? [];
  const members = membersResponse.data ?? [];
  const allClasses = classesResponse.data ?? [];
  const allDivisions = divisionsResponse.data ?? [];

  const currentSeason =
    seasons.find((season) => season.year === new Date().getFullYear()) ??
    seasons[0];

  if (!currentSeason) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <h1 className="text-3xl font-bold">Season Standings</h1>
        <p className="mt-4">No seasons are available yet.</p>
      </main>
    );
  }

  const eventsResponse = await selectPublicRows<Event>(
    "events",
    "id, season_id, name, race_date",
    {
      equals: {
        column: "season_id",
        value: currentSeason.id,
      },
    },
  );

  if (eventsResponse.error) {
    return errorMessage("Unable to load season events.");
  }

  const events = eventsResponse.data ?? [];
  const eventIds = new Set(events.map((event) => event.id));

  // Only include classes belonging to the selected season.
  const classes = allClasses
    .filter((raceClass) => raceClass.season_id === currentSeason.id)
    .sort(
      (a, b) =>
        (a.display_order ?? 999) - (b.display_order ?? 999) ||
        a.name.localeCompare(b.name),
    );

  // Only divisions that award annual points.
  const divisions = allDivisions
    .filter((division) => division.has_annual_points)
    .sort(
      (a, b) =>
        a.display_order - b.display_order ||
        a.name.localeCompare(b.name),
    );

  const resultsResponse = await selectPublicRows<Result>(
    "results",
    "id, event_id, rider_id, class_id, points, division_points, dns, dnf, disqualified",
  );

  if (resultsResponse.error) {
    return errorMessage("Unable to load race results.");
  }

  // Keep results from the selected season only.
  const results = (resultsResponse.data ?? []).filter((result) =>
    eventIds.has(result.event_id),
  );

  const membersById = new Map(
    members.map((member) => [member.id, member]),
  );

  const classesById = new Map(
    classes.map((raceClass) => [raceClass.id, raceClass]),
  );

  const divisionsById = new Map(
    divisions.map((division) => [division.id, division]),
  );

  const standingsByClass = new Map<
    string,
    Map<string, Standing>
  >();

  const standingsByDivision = new Map<
    string,
    Map<string, Standing>
  >();

  for (const result of results) {
    const member = membersById.get(result.rider_id);

    // Only current members qualify, including earlier race results.
    if (!member) continue;

    const raceClass = classesById.get(result.class_id);

    if (!raceClass) continue;

    // Class standings: sum class points for each rider in each class.
    if (!standingsByClass.has(result.class_id)) {
      standingsByClass.set(result.class_id, new Map());
    }

    const classStandings = standingsByClass.get(result.class_id)!;

    const existingClassStanding =
      classStandings.get(result.rider_id) ?? {
        riderId: member.id,
        riderName: member.full_name,
        riderNumber: member.rider_number,
        points: 0,
        events: 0,
      };

    existingClassStanding.points += result.points ?? 0;
    existingClassStanding.events += 1;

    classStandings.set(result.rider_id, existingClassStanding);

    // Division standings: sum division points across all events.
    if (raceClass.division_id) {
      const division = divisionsById.get(raceClass.division_id);

      if (!division) continue;

      if (!standingsByDivision.has(division.id)) {
        standingsByDivision.set(division.id, new Map());
      }

      const divisionStandings = standingsByDivision.get(division.id)!;

      const existingDivisionStanding =
        divisionStandings.get(result.rider_id) ?? {
          riderId: member.id,
          riderName: member.full_name,
          riderNumber: member.rider_number,
          points: 0,
          events: 0,
        };

      existingDivisionStanding.points += result.division_points ?? 0;
      existingDivisionStanding.events += 1;

      divisionStandings.set(result.rider_id, existingDivisionStanding);
    }
  }

  function sortedStandings(
    standings: Map<string, Standing> | undefined,
  ): Standing[] {
    return [...(standings?.values() ?? [])].sort(
      (a, b) =>
        b.points - a.points ||
        a.riderName.localeCompare(b.riderName),
    );
  }

  // Convert the calculated standings into serializable objects for the client.
  const standingsByClassData: Record<string, Standing[]> =
    Object.fromEntries(
      classes.map((raceClass) => [
        raceClass.id,
        sortedStandings(standingsByClass.get(raceClass.id)),
      ]),
    );

  const standingsByDivisionData: Record<string, Standing[]> =
    Object.fromEntries(
      divisions.map((division) => [
        division.id,
        sortedStandings(standingsByDivision.get(division.id)),
      ]),
    );

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6">
      <header className="space-y-2">
        <Link
          href="/"
          className="text-sm text-blue-600 underline"
        >
          ← Home
        </Link>

        <h1 className="text-3xl font-bold">
          {currentSeason.year} Season Standings
        </h1>

        <p className="text-gray-600">
          Current members are ranked by points earned throughout the season.
        </p>

        <div className="text-sm text-gray-500">
          {events.length} events · {members.length} eligible riders
        </div>
      </header>

      <StandingsFilters
        classes={classes}
        divisions={divisions}
        standingsByClass={standingsByClassData}
        standingsByDivision={standingsByDivisionData}
      />
    </main>
  );
}