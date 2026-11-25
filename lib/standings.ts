/**
 * Season standings: total points per rider, members only.
 *
 * - Only riders in `members` are ranked, but every race they ran this season
 *   counts, including races before they joined.
 * - Ties on points are broken by most wins. Class standings count class wins
 *   (finished 1st in the class). Division standings count division wins (most
 *   division points in that division at an event). Riders still level share
 *   the same rank.
 * - DNS / DNF / disqualified results never count as wins.
 * - Each standing also carries a per-race breakdown (points, place, status) so
 *   the page can show every race and filter to one race.
 */

export type StandingResult = {
  event_id: string;
  rider_id: string;
  class_id: string;
  position: number | null;
  points: number | null;
  division_points: number | null;
  dns: boolean | null;
  dnf: boolean | null;
  disqualified: boolean | null;
};

export type StandingRider = {
  id: string;
  full_name: string;
  rider_number: string | null;
};

export type StandingClass = {
  id: string;
  division_id: string | null;
};

/** One rider's result at one race, as shown in a standings column. */
export type RaceResult = {
  points: number;
  /** Class place for class standings; place within the division for division standings. */
  place: number | null;
  status: "DNS" | "DNF" | "DQ" | null;
};

export type Standing = {
  riderId: string;
  riderName: string;
  riderNumber: string | null;
  points: number;
  events: number;
  wins: number;
  rank: number;
  races: Record<string, RaceResult>;
};

type Tally = Omit<Standing, "rank">;

function finished(result: StandingResult) {
  return !result.dns && !result.dnf && !result.disqualified;
}

function status(result: StandingResult): RaceResult["status"] {
  if (result.disqualified) return "DQ";
  if (result.dnf) return "DNF";
  if (result.dns) return "DNS";
  return null;
}

/** Sort by points, then wins; equal points and wins share a rank. */
export function rankStandings(rows: Tally[]): Standing[] {
  const sorted = [...rows].sort(
    (a, b) =>
      b.points - a.points ||
      b.wins - a.wins ||
      a.riderName.localeCompare(b.riderName),
  );

  const ranked: Standing[] = [];
  sorted.forEach((row, index) => {
    const previous = ranked[index - 1];
    const tied =
      previous &&
      previous.points === row.points &&
      previous.wins === row.wins;
    ranked.push({ ...row, rank: tied ? previous.rank : index + 1 });
  });
  return ranked;
}

export function buildStandings({
  results,
  members,
  classes,
  annualDivisionIds,
}: {
  results: StandingResult[];
  members: StandingRider[];
  classes: StandingClass[];
  annualDivisionIds: Set<string>;
}) {
  const membersById = new Map(members.map((m) => [m.id, m]));
  const classesById = new Map(classes.map((c) => [c.id, c]));
  const divisionOf = (r: StandingResult) => {
    const d = classesById.get(r.class_id)?.division_id;
    return d && annualDivisionIds.has(d) ? d : null;
  };

  // Place within the division at each event, from division points (everyone
  // counts here, members or not). Riders with no division points get no place.
  const divisionPlace = new Map<StandingResult, number>();
  const byEventDivision = new Map<string, StandingResult[]>();
  for (const r of results) {
    const d = divisionOf(r);
    if (!d || !finished(r) || (r.division_points ?? 0) <= 0) continue;
    const key = `${r.event_id}|${d}`;
    if (!byEventDivision.has(key)) byEventDivision.set(key, []);
    byEventDivision.get(key)!.push(r);
  }
  for (const group of byEventDivision.values()) {
    for (const r of group) {
      divisionPlace.set(r, 1 + group.filter((o) => (o.division_points ?? 0) > (r.division_points ?? 0)).length);
    }
  }

  const byClass = new Map<string, Map<string, Tally>>();
  const byDivision = new Map<string, Map<string, Tally>>();

  function tallyFor(groups: Map<string, Map<string, Tally>>, groupId: string, member: StandingRider) {
    if (!groups.has(groupId)) groups.set(groupId, new Map());
    const group = groups.get(groupId)!;
    let tally = group.get(member.id);
    if (!tally) {
      tally = {
        riderId: member.id,
        riderName: member.full_name,
        riderNumber: member.rider_number,
        points: 0,
        events: 0,
        wins: 0,
        races: {},
      };
      group.set(member.id, tally);
    }
    return tally;
  }

  for (const result of results) {
    const member = membersById.get(result.rider_id);
    if (!member) continue;
    const raceClass = classesById.get(result.class_id);
    if (!raceClass) continue;

    const classTally = tallyFor(byClass, raceClass.id, member);
    classTally.points += result.points ?? 0;
    classTally.events += 1;
    if (finished(result) && result.position === 1) classTally.wins += 1;
    classTally.races[result.event_id] = {
      points: result.points ?? 0,
      place: finished(result) ? result.position : null,
      status: status(result),
    };

    const division = divisionOf(result);
    if (division) {
      const divisionTally = tallyFor(byDivision, division, member);
      const place = divisionPlace.get(result) ?? null;
      divisionTally.points += result.division_points ?? 0;
      divisionTally.events += 1;
      if (place === 1) divisionTally.wins += 1;
      // A rider in two classes of one division at the same race keeps the better result.
      const previous = divisionTally.races[result.event_id];
      if (!previous || (result.division_points ?? 0) > previous.points) {
        divisionTally.races[result.event_id] = {
          points: result.division_points ?? 0,
          place,
          status: status(result),
        };
      }
    }
  }

  const rank = (groups: Map<string, Map<string, Tally>>) =>
    Object.fromEntries(
      [...groups].map(([id, group]) => [id, rankStandings([...group.values()])]),
    ) as Record<string, Standing[]>;

  return { byClass: rank(byClass), byDivision: rank(byDivision) };
}
