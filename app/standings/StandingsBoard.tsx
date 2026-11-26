"use client";

import { useEffect, useRef, useState } from "react";
import { rankStandings, type RaceResult, type Standing } from "@/lib/standings";
import type { SeasonRace } from "@/lib/standings-data";

type RaceClass = { id: string; name: string; division_id: string | null };
type Division = { id: string; name: string };

type Props = {
  classes: RaceClass[];
  /** Empty for junior standings (class standings only). */
  divisions: Division[];
  races: SeasonRace[];
  standingsByClass: Record<string, Standing[]>;
  standingsByDivision: Record<string, Standing[]>;
  /** Lowest results dropped from each season total (0 = none). */
  drops?: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03-28" -> "Mar 28" (no time zones involved, so server and browser agree). */
function shortDate(date: string | null) {
  if (!date) return "";
  const [, m, d] = date.split("-").map(Number);
  return m && d ? `${MONTHS[m - 1]} ${d}` : "";
}

const DIVISION_ALL = "division";

/** Re-total and re-rank standings using only the chosen races. */
function forRaces(standings: Standing[], raceIds: string[], countWins: (r: RaceResult) => boolean): Standing[] {
  const rows = standings
    .map((s) => {
      const picked = raceIds.map((id) => s.races[id]).filter(Boolean) as RaceResult[];
      return {
        ...s,
        points: picked.reduce((sum, r) => sum + r.points, 0),
        rawPoints: undefined,
        dropped: [],
        events: picked.length,
        wins: picked.filter(countWins).length,
      };
    })
    .filter((s) => s.events > 0);
  return rankStandings(rows);
}

export default function StandingsBoard({ classes, divisions, races, standingsByClass, standingsByDivision, drops = 0 }: Props) {
  const hasDivisions = divisions.length > 0;
  const [division, setDivision] = useState(
    () => divisions.find((d) => d.name.toLowerCase().startsWith("a"))?.id ?? divisions[0]?.id ?? "",
  );
  // Which standings to show. Adult: starts with the division overall only. Junior: every class.
  const [views, setViews] = useState<string[]>(() => (hasDivisions ? [DIVISION_ALL] : classes.map((c) => c.id)));
  // null = all races; otherwise the ids that are ticked.
  const [picked, setPicked] = useState<string[] | null>(null);

  const divisionName = divisions.find((d) => d.id === division)?.name ?? "Division";
  const classOptions = hasDivisions ? classes.filter((c) => c.division_id === division) : classes;
  const viewOptions = [
    ...(hasDivisions ? [{ id: DIVISION_ALL, primary: `${divisionName} overall`, secondary: "Division points" }] : []),
    ...classOptions.map((c) => ({ id: c.id, primary: c.name })),
  ];
  const shownViews = viewOptions.map((o) => o.id).filter((id) => views.includes(id));

  const tables = shownViews.map((id) => ({
    id,
    isDivision: id === DIVISION_ALL,
    title: id === DIVISION_ALL ? `${divisionName} overall` : classes.find((c) => c.id === id)?.name ?? "Class",
    full: (id === DIVISION_ALL ? standingsByDivision[division] : standingsByClass[id]) ?? [],
  }));

  // Races anyone in the shown standings rode, oldest first.
  const available = races.filter((r) => tables.some((t) => t.full.some((s) => s.races[r.id])));
  const availableIds = available.map((r) => r.id);
  const selectedRaceIds = picked === null ? availableIds : availableIds.filter((id) => picked.includes(id));
  const allRaces = selectedRaceIds.length === availableIds.length;

  function chooseDivision(id: string) {
    setDivision(id);
    setViews([DIVISION_ALL]);
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
        <MultiSelect
          label={hasDivisions ? "Standings" : "Classes"}
          options={viewOptions}
          selected={shownViews}
          onChange={(ids) => setViews(ids ?? viewOptions.map((o) => o.id))}
          allText={(n) => (hasDivisions ? `Overall + all classes (${n})` : `All classes (${n})`)}
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
      </div>

      {tables.length === 0 && (
        <p className="rounded-2xl border border-white/10 bg-[#141816] p-8 text-neutral-400">
          Pick at least one standing above.
        </p>
      )}

      {tables.map((t) => {
        const shownRaces = available.filter((r) => selectedRaceIds.includes(r.id) && t.full.some((s) => s.races[r.id]));
        const standings = allRaces ? t.full : forRaces(t.full, selectedRaceIds, (r) => r.place === 1 && !r.status);
        return (
          <div key={t.id} className="overflow-hidden rounded-2xl border border-white/10 bg-[#141816]">
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div>
                <h2 className="text-xl font-black uppercase tracking-tight">{t.title}</h2>
                <p className="mt-1 text-sm text-neutral-400">
                  {allRaces
                    ? `${t.isDivision ? "Division" : "Class"} points${
                        drops > 0 ? `, best results only — each rider's ${drops} lowest (missed races count as 0) are dropped` : " from every race"
                      }. Ties go to the rider with more wins.`
                    : `${t.isDivision ? "Division" : "Class"} points for the selected races only (no drops).`}
                </p>
              </div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-neutral-500">
                {standings.length} rider{standings.length === 1 ? "" : "s"}
              </p>
            </div>
            {t.full.length === 0 ? (
              <p className="p-8 text-neutral-400">No standings for this class yet.</p>
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

type Option = { id: string; primary: string; secondary?: string; tag?: string };

/** Checklist dropdown. onChange(null) means "everything selected". */
function MultiSelect({
  label,
  options,
  selected,
  onChange,
  allText,
  noun,
}: {
  label: string;
  options: Option[];
  selected: string[];
  onChange: (ids: string[] | null) => void;
  allText: (n: number) => string;
  noun: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouse = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouse);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouse);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const all = options.length > 0 && selected.length === options.length;
  const summary = all
    ? allText(options.length)
    : selected.length === 0
      ? `No ${noun} selected`
      : selected.length === 1
        ? options.find((o) => o.id === selected[0])?.primary ?? `1 of ${options.length}`
        : `${selected.length} of ${options.length} ${noun}`;

  function toggle(id: string) {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onChange(next.length === options.length ? null : next);
  }

  return (
    <div ref={box} className="relative">
      <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-400">{label}</span>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-3 rounded-xl border bg-[#181d1a] py-3 pl-4 pr-3.5 text-left text-sm font-semibold text-white shadow-inner shadow-black/20 transition hover:border-white/25 focus:outline-none focus:ring-2 focus:ring-lime-400/30 ${
          open ? "border-lime-400" : "border-white/10"
        }`}
      >
        <span className="truncate">{summary}</span>
        <span className="flex items-center gap-2">
          {!all && selected.length > 1 && (
            <span className="rounded-full bg-lime-400 px-2 py-0.5 text-[11px] font-black text-[#101211]">{selected.length}</span>
          )}
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className={`h-4 w-4 text-lime-400 transition ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 8l5 5 5-5" />
          </svg>
        </span>
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-full min-w-[18rem] overflow-hidden rounded-xl border border-white/15 bg-[#181d1a] shadow-2xl shadow-black/60">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 text-xs font-bold uppercase tracking-wider">
            <button type="button" onClick={() => onChange(null)} className="text-lime-400 hover:text-lime-300">
              Select all
            </button>
            <button type="button" onClick={() => onChange([])} className="text-neutral-400 hover:text-white">
              Clear
            </button>
          </div>
          <ul role="listbox" aria-multiselectable="true" className="max-h-80 overflow-y-auto py-1">
            {options.map((o) => {
              const on = selected.includes(o.id);
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => toggle(o.id)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition hover:bg-white/[0.05]"
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                        on ? "border-lime-400 bg-lime-400 text-[#101211]" : "border-white/25"
                      }`}
                    >
                      {on && (
                        <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M4.5 10.5l3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    {o.tag && <span className="w-14 shrink-0 font-bold text-lime-400">{o.tag}</span>}
                    <span className={`min-w-0 truncate ${on ? "font-semibold text-white" : "text-neutral-400"}`}>{o.primary}</span>
                    {o.secondary && (
                      <span className="ml-auto shrink-0 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                        {o.secondary}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
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
                  <div className="min-w-0">
                    <div className="truncate font-bold text-white">{s.riderName}</div>
                    {s.riderNumber && <div className="text-xs text-neutral-500">#{s.riderNumber}</div>}
                  </div>
                </td>
                {races.map((r) => {
                  const dropped = s.dropped?.includes(r.id);
                  return (
                    <td
                      key={r.id}
                      title={dropped ? "Dropped — doesn't count toward the total" : undefined}
                      className={`px-3 py-3 text-center group-hover:bg-white/[0.02] ${dropped ? "opacity-35 [&_div:first-child]:line-through" : ""}`}
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
