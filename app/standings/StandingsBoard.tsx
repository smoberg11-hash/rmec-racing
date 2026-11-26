"use client";

import { useState } from "react";
import MultiSelect from "@/components/MultiSelect";
import { rankStandings, type RaceResult, type Standing } from "@/lib/standings";
import type { SeasonRace } from "@/lib/standings-data";

type RaceClass = { id: string; name: string; division_id: string | null };
type Division = { id: string; name: string; has_annual_points?: boolean };

type Props = {
  classes: RaceClass[];
  /** Empty for junior standings (class standings only). */
  divisions: Division[];
  races: SeasonRace[];
  standingsByClass: Record<string, Standing[]>;
  standingsByDivision: Record<string, Standing[]>;
  /** Lowest results dropped from each season total (0 = none). */
  drops?: number;
  /** Whether worker points / eligibility are available yet (rider_credits table). */
  creditsLoaded?: boolean;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03-28" -> "Mar 28" (no time zones involved, so server and browser agree). */
function shortDate(date: string | null) {
  if (!date) return "";
  const [, m, d] = date.split("-").map(Number);
  return m && d ? `${MONTHS[m - 1]} ${d}` : "";
}

const DIVISION_ALL = "division";

export default function StandingsBoard({
  classes,
  divisions,
  races,
  standingsByClass,
  standingsByDivision,
  drops = 0,
  creditsLoaded = true,
}: Props) {
  const hasDivisions = divisions.length > 0;
  // Membership standings: every member. Trophy standings: only riders with an E (rulebook 7.3:
  // everyone else moves up to fill the places).
  const [trophy, setTrophy] = useState(false);
  const raceOrder = races.map((r) => r.id);
  const [division, setDivision] = useState(
    () => divisions.find((d) => d.name.toLowerCase().startsWith("a"))?.id ?? divisions[0]?.id ?? "",
  );
  // A division without annual points (D) has no overall standing, only its classes.
  const hasOverall = (id: string) => divisions.find((d) => d.id === id)?.has_annual_points !== false;
  const startViews = (id: string) =>
    hasOverall(id) ? [DIVISION_ALL] : classes.filter((c) => c.division_id === id).map((c) => c.id);
  // Which standings to show. Adult: starts with the division overall only (all classes in D). Junior: every class.
  const [views, setViews] = useState<string[]>(() => (hasDivisions ? startViews(division) : classes.map((c) => c.id)));
  // null = all races; otherwise the ids that are ticked.
  const [picked, setPicked] = useState<string[] | null>(null);

  const divisionName = divisions.find((d) => d.id === division)?.name ?? "Division";
  const classOptions = hasDivisions ? classes.filter((c) => c.division_id === division) : classes;
  const viewOptions = [
    ...(hasDivisions && hasOverall(division)
      ? [{ id: DIVISION_ALL, primary: `${divisionName} overall`, secondary: "Division points" }]
      : []),
    ...classOptions.map((c) => ({ id: c.id, primary: c.name })),
  ];
  const shownViews = viewOptions.map((o) => o.id).filter((id) => views.includes(id));

  const tables = shownViews.map((id) => ({
    id,
    isDivision: id === DIVISION_ALL,
    title: id === DIVISION_ALL ? `${divisionName} overall` : classes.find((c) => c.id === id)?.name ?? "Class",
    full: (() => {
      const rows = (id === DIVISION_ALL ? standingsByDivision[division] : standingsByClass[id]) ?? [];
      return trophy ? rankStandings(rows.filter((s) => s.eligible), raceOrder) : rows;
    })(),
  }));

  // Races anyone in the shown standings rode, oldest first.
  const available = races.filter((r) => tables.some((t) => t.full.some((s) => s.races[r.id])));
  const availableIds = available.map((r) => r.id);
  const selectedRaceIds = picked === null ? availableIds : availableIds.filter((id) => picked.includes(id));
  const allRaces = selectedRaceIds.length === availableIds.length;

  function chooseDivision(id: string) {
    setDivision(id);
    setViews(startViews(id));
  }

  return (
    <section className="space-y-6">
      {hasDivisions && (
        <div role="tablist" aria-label="Division" className="flex flex-wrap gap-2">
          {divisions.map((d) => {
            const active = d.id === division;
            return (
              <button
                key={d.id}
                role="tab"
                aria-selected={active}
                onClick={() => chooseDivision(d.id)}
                className={`rounded-full px-5 py-2.5 text-sm font-bold uppercase tracking-wide transition ${
                  active
                    ? "bg-lime-400 text-[#101211] shadow-[0_8px_24px_-10px_rgba(163,230,53,0.7)]"
                    : "border border-white/15 bg-white/[0.03] text-neutral-300 hover:border-lime-400/60 hover:text-lime-300"
                }`}
              >
                {d.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-[#141816] p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <MultiSelect
            label={hasDivisions ? "Standings" : "Classes"}
            options={viewOptions}
            selected={shownViews}
            onChange={(ids) => setViews(ids ?? viewOptions.map((o) => o.id))}
            allText={(n) => (hasDivisions && hasOverall(division) ? `Overall + all classes (${n})` : `All classes (${n})`)}
            noun={hasDivisions ? "standings" : "classes"}
          />
          <MultiSelect
            label="Races"
            options={available.map((r) => ({ id: r.id, primary: r.name, tag: shortDate(r.date) }))}
            selected={selectedRaceIds}
            onChange={setPicked}
            allText={(n) => `All races (${n})`}
            noun="races"
          />
          <div className="sm:col-span-2 lg:col-span-1">
            <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-400">Switch to</span>
            <button
              type="button"
              onClick={() => setTrophy((t) => !t)}
              aria-pressed={trophy}
              disabled={!creditsLoaded}
              title={trophy ? "Switch to every member" : "Switch to riders eligible for year-end awards"}
              className={`w-full whitespace-nowrap rounded-xl px-5 py-3 text-sm font-black uppercase tracking-wide transition disabled:cursor-not-allowed disabled:opacity-40 lg:w-auto ${
                trophy
                  ? "border border-white/15 bg-white/[0.04] text-neutral-200 hover:border-lime-400/60 hover:text-lime-300"
                  : "bg-lime-400 text-[#101211] shadow-[0_8px_24px_-10px_rgba(163,230,53,0.7)] hover:bg-lime-300"
              }`}
            >
              {trophy ? "Membership standings" : "Year-end trophy standings"}
            </button>
          </div>
        </div>
        <p className="mt-4 text-sm text-neutral-400">
          {trophy ? (
            <>
              Showing <strong className="text-white">year-end trophy standings</strong>: only riders with an{" "}
              <EBadge /> are ranked.
            </>
          ) : (
            <>
              Showing <strong className="text-white">membership standings</strong>: every member.{" "}
              <EBadge /> = eligible for year-end awards (a member with 4+ races and worker points or eligibility).
            </>
          )}
        </p>
      </div>

      {tables.length === 0 && (
        <p className="rounded-2xl border border-white/10 bg-[#141816] p-8 text-neutral-400">
          Pick at least one standing above.
        </p>
      )}

      {tables.map((t) => {
        const shownRaces = available.filter((r) => selectedRaceIds.includes(r.id) && t.full.some((s) => s.races[r.id]));
        // Totals and ranks are always the full season (with drops); the race filter only picks columns.
        const standings = t.full;
        return (
          <div key={t.id} className="overflow-hidden rounded-2xl border border-white/10 bg-[#141816]">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div>
                <h2 className="text-xl font-black uppercase tracking-tight">{t.title}</h2>
                <p className="mt-1 text-sm text-neutral-400">
                  {`${t.isDivision ? "Division" : "Class"} points${
                    drops > 0
                      ? ` — each rider's ${drops} lowest results (missed races count as 0) are dropped and shown crossed out`
                      : " from every race"
                  }. WP = worker points (average of the rider's best 3 results), in place of a missed or lowest race. Ties go to most overall wins, then class wins, then the last head-to-head.`}
                  {!allRaces && " Showing only the selected races; totals are for the whole season."}
                </p>
              </div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">
                {standings.length} rider{standings.length === 1 ? "" : "s"}
              </p>
            </div>
            {t.full.length === 0 ? (
              <p className="p-8 text-neutral-400">
                {trophy ? "Nobody in this class is eligible for a year-end trophy yet." : "No standings for this class yet."}
              </p>
            ) : shownRaces.length === 0 ? (
              <p className="p-8 text-neutral-400">Nobody in this class rode the selected races.</p>
            ) : (
              <SeasonTable standings={standings} races={shownRaces} />
            )}
          </div>
        );
      })}
    </section>
  );
}

function RankBadge({ rank, tied }: { rank: number | null; tied?: boolean }) {
  if (rank == null) return <span className="text-neutral-600">—</span>;
  const top =
    rank === 1
      ? "bg-lime-400 text-[#101211]"
      : rank === 2
        ? "bg-white/85 text-[#101211]"
        : rank === 3
          ? "bg-amber-600/90 text-white"
          : "bg-white/[0.06] text-neutral-200";
  return (
    <span className={`inline-flex h-8 min-w-8 items-center justify-center rounded-full px-2 text-sm font-black ${top}`}>
      {tied ? "T" : ""}
      {rank}
    </span>
  );
}

function EBadge() {
  return (
    <span
      title="Eligible for year-end awards"
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-sky-400 px-1 text-[11px] font-black text-[#101211]"
    >
      E
    </span>
  );
}

function RaceCell({ result }: { result: RaceResult | undefined }) {
  if (!result) return <span className="text-neutral-700">—</span>;
  if (result.status === "WP") {
    const was = result.replaced
      ? `Worker points, in place of ${result.replaced.points} pts${result.replaced.status ? ` (${result.replaced.status})` : ""}`
      : "Worker points, for a race not ridden";
    return (
      <div className="leading-tight" title={was}>
        <div className="font-bold text-sky-300">{result.points}</div>
        <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-400">WP</div>
      </div>
    );
  }
  return (
    <div className="leading-tight">
      <div className={`font-bold ${result.points > 0 ? "text-white" : "text-neutral-500"}`}>{result.points}</div>
      {result.status && !(result.status === "DNF" && result.points > 0) ? (
        <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-red-300/80">{result.status}</div>
      ) : result.status === "DNF" ? (
        <div className="mt-0.5 text-[11px] font-semibold text-neutral-500" title="Did not finish, but scored by class place">
          P{result.place ?? "?"} <span className="text-[10px] font-bold uppercase text-red-300/80">DNF</span>
        </div>
      ) : result.place ? (
        <div className={`mt-0.5 text-[11px] font-semibold ${result.place <= 3 ? "text-lime-400" : "text-neutral-500"}`}>
          P{result.place}
        </div>
      ) : null}
    </div>
  );
}

const stickyRank = "sticky left-0 z-10 bg-[#141816] w-16";
const stickyRider = "sticky left-16 z-10 bg-[#141816] min-w-[11rem] max-w-[14rem] shadow-[8px_0_12px_-12px_rgba(0,0,0,0.9)]";

function SeasonTable({ standings, races }: { standings: Standing[]; races: SeasonRace[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.15em] text-neutral-400">
            <th className={`${stickyRank} px-4 py-3`}>Rank</th>
            <th className={`${stickyRider} px-4 py-3`}>Rider</th>
            <th className="px-2 py-3 text-center" title="Eligible for year-end awards">E</th>
            {races.map((r) => (
              <th key={r.id} className="px-3 py-3 text-center align-bottom font-semibold" title={r.name}>
                <div className="font-black text-white">{shortDate(r.date)}</div>
                <div className="mx-auto mt-0.5 max-w-[6.5rem] truncate normal-case tracking-normal text-neutral-500">
                  {r.name}
                </div>
              </th>
            ))}
            <th className="px-4 py-3 text-center">Wins</th>
            <th className="px-4 py-3 text-right text-lime-400">Total</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((s, i) => {
            const tied = standings[i - 1]?.rank === s.rank || standings[i + 1]?.rank === s.rank;
            return (
              <tr key={s.riderId} className="group border-b border-white/5 last:border-0">
                <td className={`${stickyRank} px-4 py-3 group-hover:bg-[#1a1f1c]`}>
                  <RankBadge rank={s.rank} tied={tied} />
                </td>
                <td className={`${stickyRider} px-4 py-3 group-hover:bg-[#1a1f1c]`}>
                  <div className="min-w-0">
                    <div className="truncate font-bold text-white">{s.riderName}</div>
                    {s.riderNumber && <div className="text-xs text-neutral-500">#{s.riderNumber}</div>}
                  </div>
                </td>
                <td className="px-2 py-3 text-center group-hover:bg-white/[0.02]">
                  {s.eligible ? <EBadge /> : <span className="text-neutral-700">—</span>}
                </td>
                {races.map((r) => {
                  const dropped = s.dropped?.includes(r.id);
                  return (
                    <td
                      key={r.id}
                      title={dropped ? "Dropped — doesn't count toward the total" : undefined}
                      className={`px-3 py-3 text-center group-hover:bg-white/[0.02] ${dropped ? "opacity-60 [&_div:first-child]:text-neutral-400 [&_div:first-child]:line-through [&_div:first-child]:decoration-red-400 [&_div:first-child]:decoration-2" : ""}`}
                    >
                      <RaceCell result={s.races[r.id]} />
                    </td>
                  );
                })}
                <td className="px-4 py-3 text-center font-semibold text-neutral-300 group-hover:bg-white/[0.02]">{s.wins}</td>
                <td className="px-4 py-3 text-right group-hover:bg-white/[0.02]">
                  <div className="text-lg font-black text-lime-400">{s.points}</div>
                  {s.rawPoints !== undefined && s.rawPoints !== s.points && (
                    <div className="text-[11px] font-semibold text-neutral-500" title="Points from every race, before drops">
                      {s.rawPoints} all races
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
