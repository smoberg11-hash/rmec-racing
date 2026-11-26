"""Import one event: LiveLaps results -> riders -> results -> points -> processed."""

from __future__ import annotations

import csv
import os
import re
from datetime import date

from . import livelaps, scoring, sources

# LiveLaps class names that differ from the official class name in Supabase.
# Key: LiveLaps name. Value: Supabase classes.name. Case and spacing don't matter.
CLASS_ALIASES = {
    "Electric Open": "E-Bike",
    "Electric Bikes": "E-Bike",
    "Electric Bike": "E-Bike",
    "Ebike": "E-Bike",
}


# Spreadsheet of LiveLaps class names -> RMEC class names, kept next to this file.
# rmec_class = an RMEC class name from Supabase, or SKIP for classes that don't
# count for RMEC points. Fill it with:  python3 -m importer --find-classes
CLASS_MAP_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "class_map.csv")
CLASS_MAP_COLUMNS = ["livelaps_class", "rmec_class", "source", "note", "suggested", "riders", "first_seen_at"]
SKIP = "skip"


def load_class_map_rows(path: str | None = None) -> list[tuple[str, str, str]]:
    """(normalized class name, normalized RMEC class or 'skip', normalized source) for filled-in rows.
    `source` is optional: when set (e.g. "MotoTally IERA/HS"), the row only applies to results
    from that site/series, so a name like "AA" can be skipped there without skipping RMEC's AA."""
    path = path or CLASS_MAP_FILE
    out = []
    if os.path.exists(path):
        with open(path, newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                target = normalize(row.get("rmec_class"))
                if row.get("livelaps_class") and target:
                    out.append((normalize(row["livelaps_class"]), target, normalize(row.get("source"))))
    return out


def load_class_map(path: str | None = None) -> dict:
    """{normalized class name: RMEC class or 'skip'} for rows that apply everywhere (no source)."""
    return {name: target for name, target, source in load_class_map_rows(path) if not source}


def class_lookup(rows=None):
    """Returns target(class_name, source_label) -> normalized RMEC class, 'skip', or None.
    Rows for a matching source win over rows without a source."""
    rows = load_class_map_rows() if rows is None else rows
    builtin = {normalize(k): normalize(v) for k, v in CLASS_ALIASES.items()}

    def target(class_name, source_label=None):
        name, label = normalize(class_name), normalize(source_label)
        for n, t, src in rows:
            if src and n == name and label.startswith(src):
                return t
        for n, t, src in rows:
            if not src and n == name:
                return t
        return builtin.get(name)

    return target


def all_aliases() -> dict:
    aliases = {normalize(k): normalize(v) for k, v in CLASS_ALIASES.items()}
    aliases.update(load_class_map())
    return aliases


def suggest_class(livelaps_name: str, rmec_names) -> str:
    """Best guess at the RMEC class for a promoter's class name ('' if no idea)."""
    names = {normalize(n): n for n in rmec_names}
    n = normalize(livelaps_name)
    n = re.sub(r"\bwomen\b", "ladies", n)
    n = re.sub(r"^(novice|intermediate|expert|pro)\s+", "", n)
    n = re.sub(r"^([abc])(\d)", r"\1 \2", n)
    m = re.match(r"^over (\d+)\+? ([abc])$", n)
    if m:
        n = f"{m.group(2)} {m.group(1)}+"
    n = re.sub(r"^([abc]) ?<\s?251$", r"\1 250", n)
    n = re.sub(r"^([abc]) ?251\+$", r"\1 open", n)
    return names.get(n, "")


class EventImportError(RuntimeError):
    """Raised when an event can't be imported safely. Nothing is marked processed."""


def normalize(name) -> str:
    return re.sub(r"\s+", " ", str(name or "").strip()).lower()


def _int_or_none(v):
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _truthy(v) -> bool:
    return v is True or v == 1 or str(v).strip().lower() in ("true", "1", "yes")


def result_status(r: dict) -> dict:
    """Work out DNS / DNF / DQ from LiveLaps' `standing` and `isDisqualified` fields."""
    standing = normalize(r.get("standing")).replace(".", "")
    dq = _truthy(r.get("isDisqualified")) or standing in ("dq", "dsq", "disq", "disqualified")
    return {
        "dns": standing in ("dns", "did not start"),
        "dnf": standing in ("dnf", "did not finish"),
        "disqualified": dq,
    }


# LiveLaps result ids to skip entirely, with a note on why.
IGNORE_RESULTS = {
    4774782: "Collin Heath listed twice in A 30+ at Shady Burro day 2; this entry has no scores",
    # LTR Day 1 (race 80366): two riders are listed twice in AA with full scores. The second
    # copies have hand-typed times (whole seconds); the first ones are the timing entries,
    # and LiveLaps' own series standings use those.
    4585724: "James D Buck listed twice in AA at LTR Day 1; duplicate with hand-typed time",
    4586596: "Scott Forstrom listed twice in AA at LTR Day 1; duplicate with hand-typed time",
}


def rider_key(r: dict):
    """LiveLaps riders are identified by their LiveLaps user id; riders from sites
    without ids (MotoTally) by their normalized full name."""
    uid = _int_or_none(r.get("userId"))
    if uid is not None:
        return ("ll", uid)
    name = r.get("fullName") or f"{r.get('firstName') or ''} {r.get('lastName') or ''}"
    return ("name", normalize(name))


def result_key(r: dict):
    """Stable id of a result across re-imports: source_key (MotoTally), else the LiveLaps result id.
    Works for raw results, built rows and rows read back from the database."""
    if r.get("source_key"):
        return str(r["source_key"])
    lid = _int_or_none(r["livelaps_result_id"] if "livelaps_result_id" in r else r.get("id"))
    return f"ll:{lid}" if lid is not None else None


def _has_scores(r: dict) -> bool:
    return (_int_or_none(r.get("sectionsCompleted")) or 0) > 0


def drop_ignored_and_empty_duplicates(results: list[dict], log=print) -> list[dict]:
    """Remove results listed in IGNORE_RESULTS, and empty duplicate entries.

    When LiveLaps lists the same rider twice in the same class and exactly one
    entry has scores, the empty one is dropped (with a note in the output). Any
    other duplicate is left in, so the import stops and a person decides.
    """
    kept = []
    for r in results:
        rid = _int_or_none(r.get("id"))
        if rid in IGNORE_RESULTS:
            log(f"  Skipping LiveLaps result {rid}: {IGNORE_RESULTS[rid]}")
        else:
            kept.append(r)

    groups: dict = {}
    for r in kept:
        groups.setdefault((rider_key(r), normalize(r.get("className"))), []).append(r)
    drop = set()
    for entries in groups.values():
        if len(entries) < 2:
            continue
        scored = [r for r in entries if _has_scores(r)]
        if len(scored) == 1:
            for r in entries:
                if r is not scored[0]:
                    drop.add(id(r))
                    log(f"  Skipping empty duplicate entry for {r.get('fullName')} in {r.get('className')} "
                        f"(LiveLaps result {r.get('id')}, no sections completed)")
    return [r for r in kept if id(r) not in drop]


# ---------------------------------------------------------------- riders

def rider_rows(results: list[dict]) -> list[dict]:
    """One row per LiveLaps rider (results with a userId), ready to upsert on riders.livelaps_id.

    is_member and every private field are left out on purpose, so importing
    never overwrites membership data.
    """
    by_user: dict = {}
    for r in results:
        uid = _int_or_none(r.get("userId"))
        if uid is None:
            continue
        first, last = (r.get("firstName") or "").strip(), (r.get("lastName") or "").strip()
        by_user[uid] = {
            "livelaps_id": uid,
            "first_name": first or None,
            "last_name": last or None,
            "full_name": (r.get("fullName") or f"{first} {last}").strip() or f"LiveLaps rider {uid}",
            "rider_number": (str(r["displayedNumber"]).strip() or None) if r.get("displayedNumber") not in (None, "") else None,
            "bike_brand": (r.get("brand") or "").strip() or None,
        }
    return list(by_user.values())


def named_rider_rows(results: list[dict]) -> dict:
    """{("name", normalized name): new-rider row} for results without a LiveLaps id (MotoTally)."""
    out: dict = {}
    for r in results:
        key = rider_key(r)
        if key[0] != "name" or not key[1]:
            continue
        first, last = (r.get("firstName") or "").strip(), (r.get("lastName") or "").strip()
        out.setdefault(key, {
            "first_name": first or None,
            "last_name": last or None,
            "full_name": (r.get("fullName") or f"{first} {last}").strip(),
            "rider_number": (str(r["displayedNumber"]).strip() or None) if r.get("displayedNumber") not in (None, "") else None,
            "bike_brand": (r.get("brand") or "").strip() or None,
        })
    return out


RIDER_ALIASES_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rider_aliases.csv")


def load_rider_aliases(path: str | None = None) -> dict:
    """{normalized name on the results site: normalized name of the existing rider}.
    For the same person spelled differently, e.g. MotoTally "Dave Bower" = "David Bower"."""
    path = path or RIDER_ALIASES_FILE
    out = {}
    if os.path.exists(path):
        with open(path, newline="", encoding="utf-8-sig") as f:
            for row in csv.DictReader(f):
                a = normalize(row.get("results_name"))
                b = (row.get("rider_id") or "").strip() or normalize(row.get("rider_name"))
                if a and b:
                    out[a] = b
    return out


def match_named_riders(store, named: dict, log=print) -> dict:
    """Match riders without a LiveLaps id to existing riders by full name.
    One match: use it. Several: stop and list them. None: create a new rider
    (and print existing riders with a similar name, in case it's a spelling variant)."""
    if not named:
        return {}
    by_name: dict = {}
    by_last: dict = {}
    for r in store.riders_for_name_matching():
        for n in {normalize(r.get("full_name")), normalize(f"{r.get('first_name') or ''} {r.get('last_name') or ''}")}:
            if n:
                by_name.setdefault(n, {})[r["id"]] = r
        if r.get("last_name"):
            by_last.setdefault(normalize(r["last_name"]), []).append(r)

    aliases = load_rider_aliases()
    by_id = {rid: r for group in by_name.values() for rid, r in group.items()}
    ids, new, clashes = {}, [], []
    for key, row in named.items():
        target = aliases.get(key[1], key[1])
        if target in by_id:           # the sheet names a specific rider id
            ids[key] = target
            continue
        found = list(by_name.get(target, {}).values())
        if len(found) == 1:
            ids[key] = found[0]["id"]
        elif len(found) > 1:
            clashes.append(f"{row['full_name']} ({len(found)} riders have this name: "
                           + ", ".join(f"{r['id']}" + (f" LiveLaps {r['livelaps_id']}" if r.get('livelaps_id') else "")
                                       for r in found) + ")")
        else:
            new.append((key, row))
    if clashes:
        raise EventImportError(
            "Can't tell these riders apart by name. Run `python3 -m importer.merge_riders` first; if they're "
            "still listed (two LiveLaps accounts for one person), add a row to importer/rider_aliases.csv with "
            "the name and the rider_id to use:\n    " + "\n    ".join(clashes))

    log(f"Riders matched by name: {len(ids)} already in database, {len(new)} new")
    for key, row in new:
        first = normalize(row.get("first_name"))
        similar = [r.get("full_name") for r in by_last.get(normalize(row.get("last_name")), [])
                   if first and normalize(r.get("first_name"))[:3] == first[:3]]
        if similar:
            log(f"  ? New rider {row['full_name']} looks like existing {', '.join(similar)}. "
                "If it's the same person, add a row to importer/rider_aliases.csv, then re-run.")
    if not new:
        return ids
    if store.dry_run:
        ids.update({key: f"NEW-{row['full_name']}" for key, row in new})
        return ids
    created = store.create_riders([row for _, row in new])
    by_created = {normalize(r["full_name"]): r["id"] for r in created}
    for key, row in new:
        ids[key] = by_created.get(normalize(row["full_name"]))
    return ids


# ---------------------------------------------------------------- classes

AMBIGUOUS = {"id": None, "ambiguous": True}


def build_class_matcher(classes: list[dict], event: dict, series: list[dict]):
    """Return a function mapping a LiveLaps result to a Supabase class row.

    Order: classes.livelaps_class_id if it's set and matches; otherwise the class
    name (after aliases) in the event's series; otherwise the name in another
    series from the same season (e.g. the Junior series).
    """
    by_ll_id = {}
    for c in classes:
        if c.get("livelaps_class_id") not in (None, ""):
            by_ll_id[_int_or_none(c["livelaps_class_id"])] = c

    series_map = {s["id"]: s for s in series}
    ev_series = event.get("series_id")
    season = series_map.get(ev_series, {}).get("season_id") or event.get("season_id")
    sibling_series = {s["id"] for s in series if season and s.get("season_id") == season} - {ev_series}

    by_name: dict = {}
    for c in classes:
        by_name.setdefault((c.get("series_id"), normalize(c.get("name"))), []).append(c)
    lookup = class_lookup()

    def match(r: dict):
        """Returns a class row, None if nothing matches, or AMBIGUOUS if several classes share the name."""
        hit = by_ll_id.get(_int_or_none(r.get("classId")))
        if hit and hit.get("series_id") in ({ev_series} | sibling_series):
            return hit
        name = normalize(r.get("className"))
        name = lookup(r.get("className"), r.get("_livelaps_race")) or name
        if (ev_series, name) in by_name:
            found = by_name[(ev_series, name)]
            return found[0] if len(found) == 1 else AMBIGUOUS
        candidates = [c for s in sibling_series for c in by_name.get((s, name), [])]
        if len(candidates) == 1:
            return candidates[0]
        return AMBIGUOUS if candidates else None

    return match


# ---------------------------------------------------------------- results

def result_rows(results, event_id, rider_ids: dict, class_for) -> list[dict]:
    """Build results rows. points / division_points are left out so a re-import
    never wipes points that scoring already set."""
    rows, missing_riders, missing_classes, ambiguous = [], [], {}, set()
    for r in results:
        rider_id = rider_ids.get(rider_key(r))
        cls = class_for(r)
        if not rider_id:
            missing_riders.append(f"{r.get('fullName')} (userId {r.get('userId')})")
        if cls is AMBIGUOUS:
            ambiguous.add(r.get("className"))
            cls = None
        elif not cls:
            missing_classes.setdefault(r.get("className"), 0)
            missing_classes[r.get("className")] += 1
        rows.append({
            "event_id": event_id,
            "rider_id": rider_id,
            "class_id": cls["id"] if cls else None,
            "position": _int_or_none(r.get("classPosition")),
            "overall_position": _int_or_none(r.get("overallPosition")),
            "laps": _int_or_none(r.get("sectionsCompleted")),
            "sections_completed": _int_or_none(r.get("sectionsCompleted")),
            "lap_time": r.get("averageTime") or None,
            "average_time": r.get("averageTime") or None,
            "fastest_lap": r.get("bestTime") or None,
            "best_time": r.get("bestTime") or None,
            "standing": r.get("standing") or None,
            **result_status(r),
            "livelaps_result_id": _int_or_none(r.get("id")),
            "source_key": r.get("source_key"),
        })

    problems = []
    if missing_riders:
        problems.append(f"{len(missing_riders)} results have no rider id: {', '.join(missing_riders[:10])}")
    if missing_classes:
        listed = ", ".join(f"'{k}' ({v})" for k, v in sorted(missing_classes.items(), key=lambda kv: str(kv[0])))
        problems.append(
            f"These classes don't match any Supabase class: {listed}. "
            "Run `python3 -m importer --find-classes`, then fill in importer/class_map.csv "
            "(the RMEC class for each, or SKIP if it doesn't count for RMEC points)."
        )
    if ambiguous:
        problems.append(
            f"More than one Supabase class has these names: {', '.join(sorted(map(str, ambiguous)))}. "
            "Set classes.livelaps_class_id on the right one, or rename the duplicate."
        )
    ids = [result_key(r) for r in rows]
    if any(k is None for k in ids):
        problems.append("Some results have no result id.")
    if len(ids) != len(set(ids)):
        problems.append("The same result appears more than once (same result id, or the same name twice in one class).")
    # The database allows one result per rider per class per event.
    seen_pair: dict = {}
    for raw, row in zip(results, rows):
        if row["rider_id"] and row["class_id"]:
            seen_pair.setdefault((row["rider_id"], row["class_id"]), []).append(raw)
    for entries in seen_pair.values():
        if len(entries) > 1:
            e = entries[0]
            detail = "; ".join(
                f"result {x.get('id')}: class place {x.get('classPosition')}, overall {x.get('overallPosition')}, "
                f"standing {x.get('standing')}, sections {x.get('sectionsCompleted')}"
                for x in entries)
            problems.append(f"{e.get('fullName')} (userId {e.get('userId')}) is listed {len(entries)} times "
                            f"in {e.get('className')}: {detail}")
    if problems:
        raise EventImportError("\n  - ".join(["Can't import this event:"] + problems))
    return rows


def check_divisions_single_race(raw: list[dict], rows: list[dict], classes_by_id: dict) -> None:
    """With several LiveLaps links per event, class places are fine (each class is
    in one link), but overall/group positions from different links can't be compared.
    A division (which is ranked across classes) must therefore come from one link."""
    by_div: dict = {}
    for r, row in zip(raw, rows):
        cls = classes_by_id.get(row["class_id"]) or {}
        if cls.get("division_id") and r.get("_livelaps_race"):
            by_div.setdefault(cls["division_id"], {}).setdefault(r["_livelaps_race"], set()).add(str(r.get("className")))
    for races in by_div.values():
        if len(races) > 1:
            detail = "; ".join(f"race {rid}: {', '.join(sorted(names))}" for rid, names in races.items())
            raise EventImportError(
                "One division's classes are spread over several LiveLaps links, so riders can't be ranked "
                f"across them for division points ({detail}).")


def fill_group_positions(raw: list[dict], rows: list[dict], classes_by_id: dict, log=print) -> set:
    """Some races only give an overall position to one group (e.g. A riders at
    Outlaw); B/C riders on a separate loop only get a groupPosition (their rank
    within their LiveLaps group). Division points only compare riders inside one
    division, so for a division where overall positions are missing we use
    groupPosition instead, but only if everyone in that division is in the same
    LiveLaps group, so the numbers are comparable. Otherwise nothing changes and
    scoring stops with an error for a person to look at."""
    used: set = set()
    by_div: dict = {}
    for r, row in zip(raw, rows):
        div = (classes_by_id.get(row["class_id"]) or {}).get("division_id")
        if div:
            by_div.setdefault(div, []).append((r, row))
    for div_id, entries in by_div.items():
        eligible = [(r, row) for r, row in entries if not (row["dns"] or row["dnf"] or row["disqualified"])]
        if all(row["overall_position"] is not None for _, row in eligible):
            continue
        groups = {str(r.get("classGroup")) for r, _ in entries if r.get("classGroup") not in (None, "")}
        classes = sorted({str(r.get("className")) for r, _ in entries})
        if len(groups) <= 1 and all(_int_or_none(r.get("groupPosition")) for r, _ in eligible):
            for r, row in entries:
                row["overall_position"] = _int_or_none(r.get("groupPosition"))
            log(f"  No overall positions for {', '.join(classes)}; "
                f"ranking that division by group position{' (group ' + groups.pop() + ')' if groups else ''}")
            used.add(div_id)
            continue
        links = {r.get("_livelaps_race") for r, _ in eligible}
        if eligible and len(links) == 1 and all(r.get("enduroScore") for r, _ in eligible):
            # No shared overall/group place (e.g. RMEC classes added to another series' enduro):
            # rank the division by enduro score -- most checks, then fewest minutes, then seconds.
            ordered = sorted(eligible, key=lambda e: tuple(e[0]["enduroScore"]))
            for place, (_, row) in enumerate(ordered, start=1):
                row["overall_position"] = place
            ranked = {id(row) for _, row in ordered}
            for r, row in entries:
                if id(row) not in ranked:
                    row["overall_position"] = None
            log(f"  No overall positions for {', '.join(classes)}; ranking that division by enduro score")
            used.add(div_id)
    return used


def _seconds(text):
    """'1:02:03' / '0:49:45.120' / '49:45' -> seconds, or None."""
    parts = str(text or "").strip().split(":")
    try:
        nums = [float(p) for p in parts]
    except ValueError:
        return None
    if not 1 < len(nums) <= 3:
        return None
    total = 0.0
    for n in nums:
        total = total * 60 + n
    return total


def rerank_merged_classes(raw: list[dict], rows: list[dict], log=print) -> None:
    """When several promoter classes map to one RMEC class (e.g. Concho's two
    16-and-under classes -> "16 or Under"), each arrives with its own 1st, 2nd...
    Re-rank the combined class so it has one set of places, using a ranking the
    riders share: overall position, or else group position within one group, or
    else most sections then the shortest total time. These only count when every
    rider comes from the same results link.
    Finishers come first. DNFs that still score (a scored section, rulebook 7.5 B)
    follow, by most sections then shortest time. DNS / DQ / non-scoring DNFs get no
    place. If there's no shared ranking, stop."""
    groups: dict = {}
    for r, row in zip(raw, rows):
        groups.setdefault(row["class_id"], []).append((r, row))
    for entries in groups.values():
        sources = {normalize(r.get("className")) for r, _ in entries}
        if len(sources) < 2:
            continue
        names = sorted({str(r.get("className")) for r, _ in entries})
        finished = [(r, row) for r, row in entries
                    if not (row["dns"] or row["dnf"] or row["disqualified"])]
        scoring_dnf = [(r, row) for r, row in entries
                       if row["dnf"] and not row["disqualified"] and (row.get("sections_completed") or 0) >= 1]
        links = {r.get("_livelaps_race") for r, _ in finished + scoring_dnf}

        def by_sections_and_time(e):
            r, row = e
            secs = _seconds(r.get("totalCumulatedTime"))
            return (-(_int_or_none(r.get("sectionsCompleted")) or 0), secs if secs is not None else float("inf"),
                    row["position"] or 999)

        rank = None
        if len(links) <= 1:
            if finished and all(row["overall_position"] is not None for _, row in finished):
                rank = {id(row): (row["overall_position"], row["position"] or 999) for _, row in finished}
                how = "overall position"
            else:
                grps = {r.get("classGroup") for r, _ in finished}
                if len(grps) == 1 and None not in grps and "" not in grps and all(
                        _int_or_none(r.get("groupPosition")) for r, _ in finished):
                    rank = {id(row): (_int_or_none(r.get("groupPosition")), row["position"] or 999) for r, row in finished}
                    how = f"group position ({grps.pop()})"
                elif all(_int_or_none(r.get("sectionsCompleted")) is not None for r, _ in finished):
                    # No shared ranking (e.g. Sportsman + Trail Rider, class-only youth pages):
                    # most sections first, then the shorter total time.
                    rank = {id(row): by_sections_and_time((r, row)) for r, row in finished}
                    how = "sections, then total time"
        if rank is None:
            why = ("they come from different results links" if len(links) > 1
                   else "they have no overall or group position in common (likely a different course or group)")
            raise EventImportError(
                f"Can't combine {', '.join(names)} into one class: {why}. "
                "In importer/class_map.csv, map one of them to a different RMEC class or to SKIP.")
        finished.sort(key=lambda e: rank[id(e[1])])
        scoring_dnf.sort(key=by_sections_and_time)
        placed = finished + scoring_dnf
        for place, (_, row) in enumerate(placed, start=1):
            row["position"] = place
        done = {id(row) for _, row in placed}
        for _, row in entries:
            if id(row) not in done:
                row["position"] = None
        dnf_note = f" (+{len(scoring_dnf)} scoring DNF)" if scoring_dnf else ""
        log(f"  Combined {', '.join(names)} into one class and re-ranked {len(finished)} finishers{dnf_note} by {how}")


# ---------------------------------------------------------------- data access

class LiveStore:
    """Reads and writes the real Supabase database."""

    def __init__(self, db, dry_run: bool):
        self.db, self.dry_run = db, dry_run

    def events_to_process(self, include_processed=False):
        today = date.today().isoformat()
        params = {
            "select": "*",
            "race_date": f"lt.{today}",
            "results_url": "not.is.null",
            "order": "race_date.asc",
        }
        if not include_processed:
            params["or"] = "(processed.is.false,processed.is.null)"
        return self.db.select("events", params)

    def event(self, event_id):
        rows = self.db.select("events", {"select": "*", "id": f"eq.{event_id}"})
        return rows[0] if rows else None

    def classes(self):
        return self.db.select("classes", {"select": "*"})

    def divisions(self):
        return self.db.select("divisions", {"select": "*"})

    def series(self):
        return self.db.select("series", {"select": "*"})

    def riders_by_livelaps_id(self, ids):
        found = {}
        ids = sorted(ids)
        for i in range(0, len(ids), 200):
            chunk = ",".join(str(x) for x in ids[i:i + 200])
            for row in self.db.select("riders", {"select": "id,livelaps_id", "livelaps_id": f"in.({chunk})"}):
                found[int(row["livelaps_id"])] = row["id"]
        return found

    def event_results(self, event_id):
        return self.db.select("results", {"select": "*", "event_id": f"eq.{event_id}"})

    def save_riders(self, rows):
        saved = self.db.upsert("riders", rows, on_conflict="livelaps_id")
        return {int(r["livelaps_id"]): r["id"] for r in saved}

    def save_results(self, rows):
        # LiveLaps rows are keyed on livelaps_result_id, MotoTally rows on source_key.
        # Each batch only sends its own key column, so LiveLaps imports don't need source_key to exist.
        ll = [{k: v for k, v in r.items() if k != "source_key"} for r in rows if r.get("livelaps_result_id") is not None]
        mt = [{k: v for k, v in r.items() if k != "livelaps_result_id"} for r in rows
              if r.get("livelaps_result_id") is None and r.get("source_key")]
        saved = []
        if ll:
            saved += self.db.upsert("results", ll, on_conflict="livelaps_result_id")
        if mt:
            saved += self.db.upsert("results", mt, on_conflict="source_key")
        return saved

    def riders_for_name_matching(self):
        return self.db.select("riders", {"select": "id,full_name,first_name,last_name,livelaps_id"})

    def set_livelaps_id(self, rider_id, livelaps_id):
        self.db.update("riders", {"id": f"eq.{rider_id}"}, {"livelaps_id": livelaps_id})

    def create_riders(self, rows):
        return self.db.insert("riders", rows)

    def delete_results(self, ids):
        deleted = 0
        for i in range(0, len(ids), 100):
            chunk = ",".join(ids[i:i + 100])
            deleted += len(self.db.delete("results", {"id": f"in.({chunk})"}))
        return deleted

    def save_points(self, proposed, existing):
        by_id = {r["id"]: r for r in existing}
        rows = [{
            "id": p["id"],
            "event_id": by_id[p["id"]]["event_id"],
            "rider_id": by_id[p["id"]]["rider_id"],
            "class_id": by_id[p["id"]]["class_id"],
            "points": p["points"],
            "division_points": p["division_points"],
        } for p in proposed]
        return self.db.upsert("results", rows, on_conflict="id")

    def mark_processed(self, event_id):
        self.db.update("events", {"id": f"eq.{event_id}"}, {"processed": True})


class CsvStore:
    """Read-only copy of the database from CSV exports, for offline testing."""

    FILES = {"classes": "classes", "divisions": "divisions", "series": "series",
             "events": "events", "riders": "riders", "results": "results"}

    def __init__(self, folder):
        self.dry_run = True
        self.tables = {}
        for key, stem in self.FILES.items():
            path = os.path.join(folder, f"{stem}.csv")
            self.tables[key] = self._read(path) if os.path.exists(path) else []

    @staticmethod
    def _read(path):
        with open(path, newline="", encoding="utf-8-sig") as f:
            rows = []
            for row in csv.DictReader(f):
                clean = {}
                for k, v in row.items():
                    if v in ("", "NULL", "null"):
                        clean[k] = None
                    elif v in ("true", "false"):
                        clean[k] = v == "true"
                    elif re.fullmatch(r"-?\d+", v or "") and k not in ("rider_number",):
                        clean[k] = int(v)
                    else:
                        clean[k] = v
                rows.append(clean)
            return rows

    def events_to_process(self, include_processed=False):
        today = date.today().isoformat()
        return [e for e in self.tables["events"]
                if (include_processed or not e.get("processed")) and e.get("results_url")
                and str(e.get("race_date")) < today]

    def event(self, event_id):
        return next((e for e in self.tables["events"] if e["id"] == event_id), None)

    def classes(self):
        return self.tables["classes"]

    def divisions(self):
        return self.tables["divisions"]

    def series(self):
        return self.tables["series"]

    def riders_by_livelaps_id(self, ids):
        return {int(r["livelaps_id"]): r["id"] for r in self.tables["riders"]
                if r.get("livelaps_id") is not None and int(r["livelaps_id"]) in ids}

    def event_results(self, event_id):
        return [r for r in self.tables["results"] if r.get("event_id") == event_id]

    def riders_for_name_matching(self):
        return self.tables["riders"]


# ---------------------------------------------------------------- orchestration

def import_event(store, event: dict, log=print, results_file: str | None = None, replace: bool = False) -> dict:
    """Import and score one event. Returns a summary dict. Raises EventImportError on failure."""
    event_id = event["id"]
    log(f"\n=== {event.get('name')} ({event.get('race_date')}) — {event_id}")

    # 1. Results from every link (LiveLaps and/or MotoTally)
    if results_file:
        raw = livelaps.load_results_file(results_file)
        log(f"Loaded {len(raw)} LiveLaps results from {os.path.basename(results_file)}")
    else:
        if not event.get("results_url"):
            raise EventImportError("Event has no results_url.")
        raw, counts = sources.fetch_results(event["results_url"], event.get("race_date"))
        log(f"Fetched {len(raw)} results from " + ", ".join(f"{label} ({n})" for label, n in counts))
    if not raw:
        raise EventImportError("No results were found (they may not be posted yet).")
    raw = drop_ignored_and_empty_duplicates(raw, log)
    lookup = class_lookup()
    skipped = [r for r in raw if lookup(r.get("className"), r.get("_livelaps_race")) == SKIP]
    if skipped:
        names = sorted({str(r.get("className")) for r in skipped})
        log(f"  Skipping {len(skipped)} results in non-RMEC classes: {', '.join(names)}")
        raw = [r for r in raw if lookup(r.get("className"), r.get("_livelaps_race")) != SKIP]

    classes, divisions, series = store.classes(), store.divisions(), store.series()

    # 2. Riders. LiveLaps riders: one upsert on livelaps_id covers new and existing
    # riders. Riders from sites without ids (MotoTally): matched by name.
    rider_ids: dict = {}
    riders = rider_rows(raw)
    if riders:
        existing = store.riders_by_livelaps_id({r["livelaps_id"] for r in riders})
        new = [r for r in riders if r["livelaps_id"] not in existing]
        # A "new" LiveLaps rider may already exist from a MotoTally race (same name, no
        # LiveLaps id yet). Attach the LiveLaps id to that rider instead of creating a twin.
        adopt = {}
        if new and hasattr(store, "riders_for_name_matching"):
            no_id: dict = {}
            for r in store.riders_for_name_matching():
                if r.get("livelaps_id") in (None, ""):
                    no_id.setdefault(normalize(r.get("full_name")), []).append(r["id"])
            for r in new:
                found = no_id.get(normalize(r["full_name"]), [])
                if len(found) == 1:
                    adopt[r["livelaps_id"]] = found[0]
        log(f"Riders: {len(riders)} in this race — {len(riders) - len(new)} already in database, "
            f"{len(adopt)} linked by name to riders from other results sites, {len(new) - len(adopt)} new")
        if store.dry_run:
            rider_ids.update({("ll", k): v for k, v in existing.items()})
            rider_ids.update({("ll", k): v for k, v in adopt.items()})
            rider_ids.update({("ll", r["livelaps_id"]): f"NEW-{r['livelaps_id']}" for r in new if r["livelaps_id"] not in adopt})
        else:
            for livelaps_id, rider_id in adopt.items():
                store.set_livelaps_id(rider_id, livelaps_id)
            saved_ll = store.save_riders(riders)
            if len(saved_ll) != len(riders):
                raise EventImportError(f"Saved {len(saved_ll)} riders but expected {len(riders)}.")
            rider_ids.update({("ll", k): v for k, v in saved_ll.items()})
    rider_ids.update(match_named_riders(store, named_rider_rows(raw), log))

    # 3. Results, matched to riders by id (or name) and class — never by list position.
    class_for = build_class_matcher(classes, event, series)
    rows = result_rows(raw, event_id, rider_ids, class_for)
    check_divisions_single_race(raw, rows, {c['id']: c for c in classes})
    group_ranked = fill_group_positions(raw, rows, {c['id']: c for c in classes}, log)
    rerank_merged_classes(raw, rows, log)
    before = store.event_results(event_id)
    by_key = {result_key(r): r for r in before}
    incoming = {result_key(r) for r in rows}
    stale = [r for r in before if result_key(r) not in incoming]
    log(f"Results: {len(rows)} to save — {len(incoming & set(by_key))} update existing rows, "
        f"{len(incoming - set(by_key))} new")
    if stale and replace:
        log(f"  {len(stale)} results saved earlier for this event aren't in the current results "
            f"(e.g. the link changed); --replace {'would remove' if store.dry_run else 'removes'} them.")
    elif stale:
        log(f"  ! {len(stale)} results already in the database for this event are no longer in the results "
            f"(left alone). If the link changed, re-run with --event {event_id} --replace to remove them.")

    # Rows saved earlier with the wrong rider or class (the old n8n bug). They're
    # removed and re-saved, because correcting them in place can collide with the
    # database rule "one result per rider per class per event".
    wrong = [by_key[result_key(r)]["id"] for r in rows
             if result_key(r) in by_key
             and (by_key[result_key(r)].get("rider_id") != r["rider_id"]
                  or by_key[result_key(r)].get("class_id") != r["class_id"])]

    if store.dry_run:
        if wrong:
            log(f"  ! {len(wrong)} existing results have the wrong rider or class and would be replaced.")
        saved = [dict(r, id=f"PREVIEW-{result_key(r)}",
                      points=by_key.get(result_key(r), {}).get("points"),
                      division_points=by_key.get(result_key(r), {}).get("division_points"))
                 for r in rows]
    else:
        if wrong:
            removed = store.delete_results(wrong)
            log(f"  Removed {removed} results that had the wrong rider or class; saving corrected ones.")
        if stale and replace:
            removed = store.delete_results([r["id"] for r in stale])
            log(f"  Removed {removed} old results that are no longer in this event's results.")
        store.save_results(rows)
        saved = store.event_results(event_id)

    # 4. Points (scored on what's in the database for this event)
    to_score = [r for r in saved if result_key(r) in incoming]
    calc = scoring.calculate(event_id, to_score, event, classes, divisions, series, group_ranked)
    for w in calc["warnings"]:
        log(f"  warning: {w}")
    if not calc["valid"]:
        raise EventImportError("Scoring found problems, so points were not saved:\n  - " + "\n  - ".join(calc["errors"]))
    for w in calc["winners"]:
        log(f"  Division {w['division']} winner: result {w['result_id']} in {w['class']} (overall {w['overall_position']})")

    if store.dry_run:
        log("Dry run: nothing was written.")
    else:
        store.save_points(calc["proposed"], saved)
        store.mark_processed(event_id)
        log("Saved points and marked the event processed.")

    return {"event_id": event_id, "summary": calc["summary"], "proposed": calc["proposed"]}
