"use client";

import { useState } from "react";
import type { RaceResult, Standing } from "@/lib/standings";
import type { SeasonRace } from "@/lib/standings-data";
import { SelectField } from "@/components/ui";

type RaceClass = { id: string; name: string; division_id: string | null };
type Division = { id: string; name: string };

type Props = {
  classes: RaceClass[];
  /** Empty for junior standings (class standings only). */
  divisions: Division[];
  races: SeasonRace[];
  standingsByClass: Record<string, Standing[]>;
  standingsByDivision: Record<string, Standing[]>;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03-28" -> "Mar 28" (no time zones involved, so server and browser agree). */
function shortDate(date: string | null) {
  if (!date) return "";
  const [, m, d] = date.split("-").map(Number);
  return m && d ? `${MONTHS[m - 1]} ${d}` : "";
}

const DIVISION_ALL = "division";
const ALL_RACES = "all";

export default function StandingsBoard({ classes, divisions, races, standingsByClass, standingsByDivision }: Props) {
  const hasDivisions = divisions.length > 0;
  const [division, setDivision] = useState(
    () => divisions.find((d) => d.name.toLowerCase().startsWith("a"))?.id ?? divisions[0]?.id ?? "",
  );
  const [view, setView] = useState(hasDivisions ? DIVISION_ALL : classes[0]?.id ?? "");
  const [race, setRace] = useState(ALL_RACES);

  const classOptions = hasDivisions ? classes.filter((c) => c.division_id === division) : classes;
  const isDivisionView = hasDivisions && view === DIVISION_ALL;
  const standings = (isDivisionView ? standingsByDivision[division] : standingsByClass[view]) ?? [];

  // Only show race columns somebody in this standing actually rode.
  const shownRaces = races.filter((r) => standings.some((s) => s.races[r.id]));
  const selectedRace = shownRaces.find((r) => r.id === race) ?? null;

  const divisionName = divisions.find((d) => d.id === division)?.name ?? "Division";
  const title = isDivisionView
    ? divisions.find((d) => d.id === division)?.name ?? "Division"
    : classes.find((c) => c.id === view)?.name ?? "Class";

  function chooseDivision(id: string) {
    setDivision(id);
    setView(DIVISION_ALL);
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

      <div className="grid gap-4 rounded-2xl border border-white/10 bg-[#141816] p-5 sm:grid-cols-2">
        <SelectField
          id="standings-class"
          label={hasDivisions ? "Standings" : "Class"}
          value={view}
          onChange={(e) => setView(e.target.value)}
        >
          {hasDivisions && <option value={DIVISION_ALL}>All of {divisionName} — division points</option>}
          {classOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </SelectField>

        <SelectField id="standings-race" label="Race" value={selectedRace ? race : ALL_RACES} onChange={(e) => setRace(e.target.value)}>
          <option value={ALL_RACES}>All races — season total</option>
          {shownRaces.map((r) => (
            <option key={r.id} value={r.id}>
              {shortDate(r.date)} · {r.name}
            </option>
          ))}
        </SelectField>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#141816]">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-xl font-black uppercase tracking-tight">
              {title}
              {selectedRace && <span className="text-lime-400"> · {selectedRace.name}</span>}
            </h2>
            <p className="mt-1 text-sm text-neutral-400">
              {selectedRace
                ? `${shortDate(selectedRace.date)} — ${isDivisionView ? "division" : "class"} points and place at this race.`
                : `${isDivisionView ? "Division" : "Class"} points from every race. Ties go to the rider with more wins.`}
            </p>
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">
            {standings.length} rider{standings.length === 1 ? "" : "s"}
          </p>
        </div>

        {standings.length === 0 ? (
          <p className="p-8 text-neutral-400">No standings for this selection yet.</p>
        ) : selectedRace ? (
          <SingleRaceTable standings={standings} raceId={selectedRace.id} />
        ) : (
          <SeasonTable standings={standings} races={shownRaces} />
        )}
      </div>
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

function RiderCell({ s }: { s: Standing }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-bold text-white">{s.riderName}</div>
      {s.riderNumber && <div className="text-xs text-neutral-500">#{s.riderNumber}</div>}
    </div>
  );
}

function RaceCell({ result }: { result: RaceResult | undefined }) {
  if (!result) return <span className="text-neutral-700">—</span>;
  return (
    <div className="leading-tight">
      <div className={`font-bold ${result.points > 0 ? "text-white" : "text-neutral-500"}`}>{result.points}</div>
      {result.status ? (
        <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-red-300/80">{result.status}</div>
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
                  <RiderCell s={s} />
                </td>
                {races.map((r) => (
                  <td key={r.id} className="px-3 py-3 text-center group-hover:bg-white/[0.02]">
                    <RaceCell result={s.races[r.id]} />
                  </td>
                ))}
                <td className="px-4 py-3 text-center font-semibold text-neutral-300 group-hover:bg-white/[0.02]">{s.wins}</td>
                <td className="px-4 py-3 text-right text-lg font-black text-lime-400 group-hover:bg-white/[0.02]">
                  {s.points}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SingleRaceTable({ standings, raceId }: { standings: Standing[]; raceId: string }) {
  const rows = standings
    .filter((s) => s.races[raceId])
    .sort((a, b) => {
      const ra = a.races[raceId], rb = b.races[raceId];
      return (ra.place ?? 9999) - (rb.place ?? 9999) || rb.points - ra.points || a.riderName.localeCompare(b.riderName);
    });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-white/10 text-[11px] uppercase tracking-[0.15em] text-neutral-400">
            <th className="w-20 px-4 py-3">Place</th>
            <th className="px-4 py-3">Rider</th>
            <th className="px-4 py-3 text-center text-lime-400">Race points</th>
            <th className="px-4 py-3 text-right">Season total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const r = s.races[raceId];
            return (
              <tr key={s.riderId} className="border-b border-white/5 transition last:border-0 hover:bg-white/[0.02]">
                <td className="px-4 py-3">
                  {r.status ? (
                    <span className="rounded-full bg-red-400/10 px-2.5 py-1 text-xs font-bold text-red-300">{r.status}</span>
                  ) : (
                    <RankBadge rank={r.place} />
                  )}
                </td>
                <td className="px-4 py-3">
                  <RiderCell s={s} />
                </td>
                <td className="px-4 py-3 text-center text-lg font-black text-lime-400">{r.points}</td>
                <td className="px-4 py-3 text-right text-neutral-300">
                  {s.points} <span className="text-xs text-neutral-500">(#{s.rank})</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
