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

export type Standing = {
  riderId: string;
  riderName: string;
  riderNumber: string | null;
  points: number;
  events: number;
  wins: number;
  rank: number;
};

type Tally = Omit<Standing, "rank">;

function finished(result: StandingResult) {
  return !result.dns && !result.dnf && !result.disqualified;
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

  // Division winner at each event = most division points in that division
  // (everyone counts here, members or not, so a non-member win isn't handed
  // to the next member).
  const divisionWinners = new Map<string, { riderId: string; points: number }>();
  for (const result of results) {
    const division = classesById.get(result.class_id)?.division_id;
    if (!division || !annualDivisionIds.has(division) || !finished(result)) continue;
    const points = result.division_points ?? 0;
    if (points <= 0) continue;
    const key = `${result.event_id}|${division}`;
    const best = divisionWinners.get(key);
    if (!best || points > best.points) {
      divisionWinners.set(key, { riderId: result.rider_id, points });
    }
  }

  const byClass = new Map<string, Map<string, Tally>>();
  const byDivision = new Map<string, Map<string, Tally>>();

  function tallyFor(
    groups: Map<string, Map<string, Tally>>,
    groupId: string,
    member: StandingRider,
  ) {
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

    const division = raceClass.division_id;
    if (division && annualDivisionIds.has(division)) {
      const divisionTally = tallyFor(byDivision, division, member);
      divisionTally.points += result.division_points ?? 0;
      divisionTally.events += 1;
      if (divisionWinners.get(`${result.event_id}|${division}`)?.riderId === member.id) {
        divisionTally.wins += 1;
      }
    }
  }

  const rank = (groups: Map<string, Map<string, Tally>>) =>
    Object.fromEntries(
      [...groups].map(([id, group]) => [id, rankStandings([...group.values()])]),
    ) as Record<string, Standing[]>;

  return { byClass: rank(byClass), byDivision: rank(byDivision) };
}
