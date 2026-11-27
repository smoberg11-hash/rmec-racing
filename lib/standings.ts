/**
 * Season standings: total points per rider, members only.
 *
 * - Only riders in `members` are ranked, but every race they ran this season
 *   counts, including races before they joined.
 * - A DNF that still scored (rulebook 7.5 B: a valid first check) shows its
 *   points and place; DNS / DQ and non-scoring DNFs show their status.
 * - Ties (rulebook 7.6): most division overall wins, then most class wins,
 *   then the last race both riders rode (better place wins). Riders still level
 *   share the same rank.
 * - Worker points (rulebook 5): see applyWorkerPoints.
 * - Eligibility "E" (rulebook 7.7, 7.8, 9): see markEligibility.
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
  status: "DNS" | "DNF" | "DQ" | "WP" | null;
  /** For worker points: the result the WP took the place of (none = a missed race). */
  replaced?: RaceResult;
};

export type Standing = {
  riderId: string;
  riderName: string;
  riderNumber: string | null;
  /** Counted points (after drops, when drops apply). */
  points: number;
  /** Points from every race, before drops. */
  rawPoints?: number;
  /** Race ids whose result was dropped (missed races included). */
  dropped?: string[];
  events: number;
  /** Wins in this standing: class wins in a class, division overall wins in a division. */
  wins: number;
  /** Season tie-breakers (rulebook 7.6), the same in every standing of the rider. */
  overallWins: number;
  classWins: number;
  /** Has earned eligibility for year-end awards ("E"). */
  eligible?: boolean;
  rank: number;
  races: Record<string, RaceResult>;
};

type Tally = Omit<Standing, "rank">;

function finished(result: StandingResult) {
  return !result.dns && !result.dnf && !result.disqualified;
}

/** Finished, or a DNF that still got points for its class place. */
function scored(result: StandingResult) {
  return finished(result) || (!result.disqualified && !result.dns && (result.points ?? 0) > 0);
}

function status(result: StandingResult): RaceResult["status"] {
  if (result.disqualified) return "DQ";
  if (result.dnf) return "DNF";
  if (result.dns) return "DNS";
  return null;
}

/** Rulebook 7.6, last step: the last race both rode where both have a place. */
function headToHead(a: Tally, b: Tally, raceOrder: string[]) {
  for (let i = raceOrder.length - 1; i >= 0; i--) {
    const pa = a.races[raceOrder[i]]?.place;
    const pb = b.races[raceOrder[i]]?.place;
    if (pa != null && pb != null && pa !== pb) return pa - pb;
  }
  return 0;
}

/**
 * Sort by points, then the rulebook 7.6 tie-breakers. `raceOrder` (oldest first)
 * enables the head-to-head step. Riders level on everything share a rank.
 */
export function rankStandings(rows: Tally[], raceOrder: string[] = []): Standing[] {
  const compare = (a: Tally, b: Tally) =>
    b.points - a.points ||
    b.overallWins - a.overallWins ||
    b.classWins - a.classWins ||
    headToHead(a, b, raceOrder);
  const sorted = [...rows].sort((a, b) => compare(a, b) || a.riderName.localeCompare(b.riderName));

  const ranked: Standing[] = [];
  sorted.forEach((row, index) => {
    const previous = ranked[index - 1];
    const tied = previous && compare(previous, row) === 0;
    ranked.push({ ...row, rank: tied ? previous.rank : index + 1 });
  });
  return ranked;
}

export function buildStandings({
  results,
  members,
  classes,
  annualDivisionIds,
  raceOrder = [],
}: {
  results: StandingResult[];
  members: StandingRider[];
  classes: StandingClass[];
  annualDivisionIds: Set<string>;
  raceOrder?: string[];
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
    if (!d || !scored(r) || (r.division_points ?? 0) <= 0) continue;
    const key = `${r.event_id}|${d}`;
    if (!byEventDivision.has(key)) byEventDivision.set(key, []);
    byEventDivision.get(key)!.push(r);
  }
  for (const group of byEventDivision.values()) {
    for (const r of group) {
      divisionPlace.set(r, 1 + group.filter((o) => (o.division_points ?? 0) > (r.division_points ?? 0)).length);
    }
  }

  // Season tie-breakers per rider, across every class and division.
  const overallWins = new Map<string, number>();
  const classWins = new Map<string, number>();
  for (const r of results) {
    if (divisionPlace.get(r) === 1) overallWins.set(r.rider_id, (overallWins.get(r.rider_id) ?? 0) + 1);
    if (finished(r) && r.position === 1) classWins.set(r.rider_id, (classWins.get(r.rider_id) ?? 0) + 1);
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
        overallWins: overallWins.get(member.id) ?? 0,
        classWins: classWins.get(member.id) ?? 0,
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
      place: scored(result) ? result.position : null,
      status: status(result),
    };

    const division = divisionOf(result);
    if (division) {
      const divisionTally = tallyFor(byDivision, division, member);
      const place = divisionPlace.get(result) ?? null;
      if (place === 1) divisionTally.wins += 1;
      // A rider in two classes of one division at the same race keeps the better result.
      const previous = divisionTally.races[result.event_id];
      if (!previous) divisionTally.events += 1;
      if (!previous || (result.division_points ?? 0) > previous.points) {
        divisionTally.points += (result.division_points ?? 0) - (previous?.points ?? 0);
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
      [...groups].map(([id, group]) => [id, rankStandings([...group.values()], raceOrder)]),
    ) as Record<string, Standing[]>;

  return { byClass: rank(byClass), byDivision: rank(byDivision) };
}

/** Rulebook 7.7 / 9.4: races needed for year-end awards, and before worker points apply (5.10). */
export const MIN_EVENTS = 4;

/** Distinct races each rider rode this season (any class in these results). */
export function eventsRidden(results: StandingResult[]) {
  const seen = new Map<string, Set<string>>();
  for (const r of results) {
    if (r.dns) continue; // listed but didn't ride
    if (!seen.has(r.rider_id)) seen.set(r.rider_id, new Set());
    seen.get(r.rider_id)!.add(r.event_id);
  }
  return new Map([...seen].map(([id, events]) => [id, events.size]));
}

/** A worker-points value: the average of the rider's best 3 race results, rounded. */
export function workerPointsValue(races: Record<string, RaceResult>) {
  const best = Object.values(races)
    .filter((r) => r.status !== "WP")
    .map((r) => r.points)
    .sort((a, b) => b - a)
    .slice(0, 3);
  return best.length ? Math.round(best.reduce((sum, p) => sum + p, 0) / best.length) : 0;
}

/**
 * Worker points (rulebook 5), applied before drops:
 * - Each worker credit adds one WP once the rider has ridden MIN_EVENTS races (5.10).
 * - A WP is worth the average of the rider's best 3 results in that standing, rounded.
 * - It takes the place of a race the rider missed or didn't start, or else their lowest-scoring race (5.6, 5.9).
 * - It applies to one class only (5.7): the class they rode most (then the most points),
 *   and to that class's division standing (5.5).
 */
export function applyWorkerPoints({
  byClass,
  byDivision,
  classDivision,
  workerCredits,
  ridden,
  seasonRaceIds,
}: {
  byClass: Record<string, Standing[]>;
  byDivision: Record<string, Standing[]>;
  /** class id -> annual division id (or null) */
  classDivision: Map<string, string | null>;
  /** rider id -> number of worker-point credits this season */
  workerCredits: Map<string, number>;
  ridden: Map<string, number>;
  seasonRaceIds: string[];
}) {
  const homeClass = new Map<string, Standing & { classId: string }>();
  for (const [classId, rows] of Object.entries(byClass)) {
    for (const s of rows) {
      const best = homeClass.get(s.riderId);
      if (!best || s.events > best.events || (s.events === best.events && s.points > best.points)) {
        homeClass.set(s.riderId, { ...s, classId });
      }
    }
  }

  const award = (s: Standing, count: number): Standing => {
    const races = { ...s.races };
    let points = s.points;
    for (let n = 0; n < count; n++) {
      const value = workerPointsValue(races);
      const slot = seasonRaceIds
        .map((id, index) => ({ id, index, result: races[id] }))
        .filter((x) => x.result?.status !== "WP")
        .sort(
          (a, b) =>
            // A race not ridden (missed, or listed as DNS) first, e.g. the day they worked.
            Number(Boolean(a.result) && a.result?.status !== "DNS") -
              Number(Boolean(b.result) && b.result?.status !== "DNS") ||
            (a.result?.points ?? 0) - (b.result?.points ?? 0) ||
            a.index - b.index,
        )[0];
      if (!slot || value <= (slot.result?.points ?? 0)) break;
      races[slot.id] = { points: value, place: null, status: "WP", replaced: slot.result };
      points += value - (slot.result?.points ?? 0);
    }
    return { ...s, races, points };
  };

  const out = { byClass: { ...byClass }, byDivision: { ...byDivision } };
  for (const [riderId, count] of workerCredits) {
    const home = homeClass.get(riderId);
    if (!home || count <= 0 || (ridden.get(riderId) ?? 0) < MIN_EVENTS) continue;
    out.byClass[home.classId] = out.byClass[home.classId].map((s) => (s.riderId === riderId ? award(s, count) : s));
    const division = classDivision.get(home.classId);
    if (division && out.byDivision[division]) {
      out.byDivision[division] = out.byDivision[division].map((s) => (s.riderId === riderId ? award(s, count) : s));
    }
  }
  return out;
}

/**
 * "E" (rulebook 7.7, 7.8, 9): a member (everyone in these standings is) who has ridden
 * MIN_EVENTS races and has earned eligibility (worker points, an eligibility request,
 * sportsman points or any other credit on file).
 */
export function markEligibility(standings: Standing[], credited: Set<string>, ridden: Map<string, number>) {
  return standings.map((s) => ({
    ...s,
    eligible: credited.has(s.riderId) && (ridden.get(s.riderId) ?? 0) >= MIN_EVENTS,
  }));
}

/**
 * Drops: each rider's lowest `drops` results in the season don't count, and a
 * missed race counts as a 0 (so missed races are dropped first). Only the best
 * (races held - drops) results are added up. If fewer races than `drops` have
 * been held, nothing is dropped yet.
 *
 * Which equal results get dropped doesn't change totals; for display, missed
 * races go first, then the lowest points, then the earliest race.
 */
export function applyDrops(standings: Standing[], seasonRaceIds: string[], drops: number): Standing[] {
  const counted = seasonRaceIds.length - drops;
  if (drops <= 0 || counted <= 0) {
    return rankStandings(standings.map((s) => ({ ...s, rawPoints: s.points, dropped: [] })), seasonRaceIds);
  }
  const rows = standings.map((s) => {
    const ordered = seasonRaceIds
      .map((id, index) => ({ id, index, points: s.races[id]?.points ?? 0, missed: !s.races[id] }))
      .sort((a, b) => Number(b.missed) - Number(a.missed) || a.points - b.points || a.index - b.index);
    const droppedRaces = ordered.slice(0, drops);
    const kept = ordered.slice(drops);
    return {
      ...s,
      rawPoints: s.points,
      points: kept.reduce((sum, r) => sum + r.points, 0),
      dropped: droppedRaces.map((r) => r.id),
    };
  });
  return rankStandings(rows, seasonRaceIds);
}
