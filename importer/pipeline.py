"""Import one event: LiveLaps results -> riders -> results -> points -> processed."""

from __future__ import annotations

import csv
import os
import re
from datetime import date

from . import livelaps, scoring

# LiveLaps class names that differ from the official class name in Supabase.
# Key: LiveLaps name. Value: Supabase classes.name. Case and spacing don't matter.
CLASS_ALIASES = {
    "Electric Open": "E-Bike",
}


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


# ---------------------------------------------------------------- riders

def rider_rows(results: list[dict]) -> list[dict]:
    """One row per LiveLaps rider, ready to upsert on riders.livelaps_id.

    is_member and every private field are left out on purpose, so importing
    never overwrites membership data.
    """
    by_user: dict = {}
    for r in results:
        uid = _int_or_none(r.get("userId"))
        if uid is None:
            raise EventImportError(f"LiveLaps result {r.get('id')} ({r.get('fullName')}) has no userId.")
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
    aliases = {normalize(k): normalize(v) for k, v in CLASS_ALIASES.items()}

    def match(r: dict):
        """Returns a class row, None if nothing matches, or AMBIGUOUS if several classes share the name."""
        hit = by_ll_id.get(_int_or_none(r.get("classId")))
        if hit and hit.get("series_id") in ({ev_series} | sibling_series):
            return hit
        name = normalize(r.get("className"))
        name = aliases.get(name, name)
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
        rider_id = rider_ids.get(_int_or_none(r.get("userId")))
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
        })

    problems = []
    if missing_riders:
        problems.append(f"{len(missing_riders)} results have no rider id: {', '.join(missing_riders[:10])}")
    if missing_classes:
        listed = ", ".join(f"'{k}' ({v})" for k, v in sorted(missing_classes.items(), key=lambda kv: str(kv[0])))
        problems.append(
            f"These LiveLaps classes don't match any Supabase class: {listed}. "
            "Add them to CLASS_ALIASES in importer/pipeline.py or fix the class name in Supabase."
        )
    if ambiguous:
        problems.append(
            f"More than one Supabase class has these names: {', '.join(sorted(map(str, ambiguous)))}. "
            "Set classes.livelaps_class_id on the right one, or rename the duplicate."
        )
    if any(r["livelaps_result_id"] is None for r in rows):
        problems.append("Some LiveLaps results have no result id.")
    ids = [r["livelaps_result_id"] for r in rows]
    if len(ids) != len(set(ids)):
        problems.append("LiveLaps returned the same result id more than once.")
    if problems:
        raise EventImportError("\n  - ".join(["Can't import this event:"] + problems))
    return rows


# ---------------------------------------------------------------- data access

class LiveStore:
    """Reads and writes the real Supabase database."""

    def __init__(self, db, dry_run: bool):
        self.db, self.dry_run = db, dry_run

    def events_to_process(self):
        today = date.today().isoformat()
        return self.db.select("events", {
            "select": "*",
            "or": "(processed.is.false,processed.is.null)",
            "race_date": f"lt.{today}",
            "results_url": "not.is.null",
            "order": "race_date.asc",
        })

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
        return self.db.upsert("results", rows, on_conflict="livelaps_result_id")

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

    def events_to_process(self):
        today = date.today().isoformat()
        return [e for e in self.tables["events"]
                if not e.get("processed") and e.get("results_url") and str(e.get("race_date")) < today]

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


# ---------------------------------------------------------------- orchestration

def import_event(store, event: dict, log=print, results_file: str | None = None) -> dict:
    """Import and score one event. Returns a summary dict. Raises EventImportError on failure."""
    event_id = event["id"]
    log(f"\n=== {event.get('name')} ({event.get('race_date')}) — {event_id}")

    # 1. LiveLaps
    if results_file:
        raw = livelaps.load_results_file(results_file)
        log(f"Loaded {len(raw)} LiveLaps results from {os.path.basename(results_file)}")
    else:
        if not event.get("results_url"):
            raise EventImportError("Event has no results_url.")
        raw = livelaps.fetch_results(event["results_url"])
        log(f"Fetched {len(raw)} LiveLaps results from {livelaps.api_url(event['results_url'])}")
    if not raw:
        raise EventImportError("LiveLaps returned no results (results may not be posted yet).")

    classes, divisions, series = store.classes(), store.divisions(), store.series()

    # 2. Riders: one upsert covers new and existing riders, and returns every id.
    riders = rider_rows(raw)
    existing = store.riders_by_livelaps_id({r["livelaps_id"] for r in riders})
    new = [r for r in riders if r["livelaps_id"] not in existing]
    log(f"Riders: {len(riders)} in this race — {len(riders) - len(new)} already in database, {len(new)} new")
    if store.dry_run:
        rider_ids = dict(existing)
        rider_ids.update({r["livelaps_id"]: f"NEW-{r['livelaps_id']}" for r in new})
    else:
        rider_ids = store.save_riders(riders)
        if len(rider_ids) != len(riders):
            raise EventImportError(f"Saved {len(rider_ids)} riders but expected {len(riders)}.")

    # 3. Results, matched by LiveLaps userId and class — never by list position.
    class_for = build_class_matcher(classes, event, series)
    rows = result_rows(raw, event_id, rider_ids, class_for)
    before = store.event_results(event_id)
    known = {_int_or_none(r.get("livelaps_result_id")) for r in before}
    incoming = {r["livelaps_result_id"] for r in rows}
    stale = [r for r in before if _int_or_none(r.get("livelaps_result_id")) not in incoming]
    log(f"Results: {len(rows)} to save — {len(incoming & known)} update existing rows, {len(incoming - known)} new")
    if stale:
        log(f"  ! {len(stale)} results already in the database for this event are no longer on LiveLaps "
            f"(they will be left alone; review them).")

    # Rows saved earlier with the wrong rider or class (the old n8n bug). They're
    # removed and re-saved, because correcting them in place can collide with the
    # database rule "one result per rider per class per event".
    by_ll = {_int_or_none(r.get("livelaps_result_id")): r for r in before}
    wrong = [by_ll[r["livelaps_result_id"]]["id"] for r in rows
             if r["livelaps_result_id"] in by_ll
             and (by_ll[r["livelaps_result_id"]].get("rider_id") != r["rider_id"]
                  or by_ll[r["livelaps_result_id"]].get("class_id") != r["class_id"])]

    if store.dry_run:
        if wrong:
            log(f"  ! {len(wrong)} existing results have the wrong rider or class and would be replaced.")
        saved = [dict(r, id=f"LL-{r['livelaps_result_id']}",
                      points=by_ll.get(r["livelaps_result_id"], {}).get("points"),
                      division_points=by_ll.get(r["livelaps_result_id"], {}).get("division_points"))
                 for r in rows]
    else:
        if wrong:
            removed = store.delete_results(wrong)
            log(f"  Removed {removed} results that had the wrong rider or class; saving corrected ones.")
        store.save_results(rows)
        saved = store.event_results(event_id)

    # 4. Points (scored on what's in the database for this event)
    to_score = [r for r in saved if _int_or_none(r.get("livelaps_result_id")) in incoming]
    calc = scoring.calculate(event_id, to_score, event, classes, divisions, series)
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
