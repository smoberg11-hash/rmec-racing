"""Worker points / eligibility import from the "WP & Eligibility" form CSV.

  python3 -m importer.credits "2026 WP & Eligibility.csv"          # dry run
  python3 -m importer.credits "2026 WP & Eligibility.csv" --apply  # save

Needs the rider_credits table (run importer/credits.sql once first).

Rules (decided with the RMEC points keeper, Nov 2026):
* Every row counts, whatever "Approved by promoter" says; the column is kept for reference.
* "Worker Points" rows become worker-point credits; "Eligibility" rows and rows that
  leave the type blank become eligibility credits.
* The same rider, type and event listed more than once counts once.
* "Monte Vista" is Big Lake. Rows without a name are skipped.
* Riders are matched by rider_aliases.csv, then full name, then the email on the form
  (emails and phone numbers are used for matching only and never saved), then by first
  and last name ignoring middle initials and suffixes like "Jr" or "2nd". When several
  riders fit, the class the rider typed on the form picks between them. Nobody is created.
* The points for a worker credit are worked out by the website from results, not here.
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from datetime import datetime

from .__main__ import load_env
from .pipeline import load_rider_aliases, normalize
from .supabase_client import Supabase, SupabaseError

NAME, EMAIL, CLASS, EVENT, KIND, APPROVED, DATE = (
    "Name", "Email Address", "Class", "Event you want to work or gain eligibility:",
    "I intend to work/earn:", "Approved by promoter", "Submission Date")

EVENT_ALIASES = {"monte vista": "big lake", "black hills": "black hill"}
SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "2nd", "3rd"}


def _kind(text: str) -> str:
    t = normalize(text)
    if "worker" in t or t == "wp":
        return "worker_points"
    if "sportsman point" in t:
        return "sportsman"
    return "eligibility"


def _approved(text: str):
    t = (text or "").strip().lower()
    return True if t in ("1", "yes", "y", "true") else False if t in ("0", "no", "n", "false") else None


def _date(text: str):
    for fmt in ("%d-%b-%y", "%d-%b-%Y", "%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d"):
        try:
            return datetime.strptime((text or "").strip(), fmt).date()
        except ValueError:
            continue
    return None


def loose_name(name: str) -> str:
    """first + last, without stars, middle initials or suffixes: "James D Buck" -> "james buck"."""
    parts = [p for p in re.sub(r"[^a-z0-9 ]", " ", normalize(name)).split() if p not in SUFFIXES]
    if len(parts) > 2:
        parts = [parts[0], parts[-1]]
    return " ".join(parts)


def class_hint_score(class_text: str, class_name: str) -> int:
    """How well the class typed on the form ("45A", "Sportmen", "B-open") fits a class name."""
    t = re.sub(r"[^a-z0-9+]", "", (class_text or "").lower())
    c = re.sub(r"[^a-z0-9+]", "", (class_name or "").lower())
    if not t or not c:
        return 0
    score = 0
    if t == c:
        return 10
    for word in ("sport", "expert", "open", "ladies", "women", "250", "under", "bike", "electric"):
        if word in t and word in c:
            score += 3
    if "aa" in t and c.startswith("aa"):
        score += 5
    t_div = re.sub(r"aa|[0-9+]|open|ladies|women|sport\w*|expert|vet|s", "", t)
    if c[:1] in "abc" and not c.startswith("aa") and c[:1] in t_div:
        score += 2
    t_age, c_age = re.findall(r"\d\d", t), re.findall(r"\d\d", c)
    if t_age and c_age and t_age[0] == c_age[0]:
        score += 2
    return score


def read_rows(path: str):
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    if rows and NAME not in rows[0]:
        raise ValueError(f"{os.path.basename(path)} has no '{NAME}' column.")
    out, skipped = [], []
    for i, row in enumerate(rows, start=2):
        name = (row.get(NAME) or "").strip()
        if not name:
            skipped.append((f"line {i}", "no name"))
            continue
        out.append({
            "line": i, "name": name, "email": (row.get(EMAIL) or "").strip().lower(),
            "class_text": (row.get(CLASS) or "").strip(), "event": (row.get(EVENT) or "").strip(),
            "kind_text": (row.get(KIND) or "").strip(), "kind": _kind(row.get(KIND)),
            "approved": _approved(row.get(APPROVED)), "submitted_on": _date(row.get(DATE)),
        })
    return out, skipped


def match_event(label: str, events: list):
    """The first day of the season event the form names, or None. Adult events win over
    junior events of the same name."""
    key = normalize(label)
    key = EVENT_ALIASES.get(key, key)
    if not key:
        return None
    found = [e for e in events if key in normalize(e.get("name"))]
    found.sort(key=lambda e: ("jr" in normalize(e.get("name")).split(), str(e.get("race_date") or "")))
    return found[0] if found else None


def match_rider(row, riders, aliases, rider_classes):
    """Returns (rider, how) or (None, why).

    Every rider who fits by alias, name, email or loose name is a candidate. The class
    the rider typed on the form decides first (so "James Buck, Sportsman" and
    "James Buck, AA" find different riders); then the closest kind of match."""
    by_id = {r["id"]: r for r in riders}
    name = normalize(row["name"])
    tiers = []  # (rank, how, rider)
    alias = aliases.get(name)
    if alias:  # the closest kind of match; only a better-fitting class beats it
        for r in ([by_id[alias]] if alias in by_id else [r for r in riders if normalize(r.get("full_name")) == alias]):
            tiers.append((0, "alias", r))
    loose = loose_name(row["name"])
    for r in riders:
        if normalize(r.get("full_name")) == name or normalize(f"{r.get('first_name') or ''} {r.get('last_name') or ''}") == name:
            tiers.append((1, "name", r))
        elif row["email"] and (r.get("email") or "").strip().lower() == row["email"]:
            tiers.append((2, "email", r))
        elif loose and loose_name(r.get("full_name")) == loose:
            tiers.append((3, "loose name", r))
    best: dict = {}
    for rank, how, r in tiers:
        if r["id"] not in best or rank < best[r["id"]][0]:
            best[r["id"]] = (rank, how, r)
    if not best:
        return None, "no rider with this name or email; add them to rider_aliases.csv if they race under another name"

    def score(r):
        return max([class_hint_score(row["class_text"], c) for c in rider_classes.get(r["id"], [])] or [0])

    ranked = sorted(best.values(), key=lambda t: (-score(t[2]), t[0]))
    top = ranked[0]
    if len(ranked) == 1 or (score(top[2]), top[0]) != (score(ranked[1][2]), ranked[1][0]):
        how = top[1] + (f", class '{row['class_text']}'" if len(ranked) > 1 and score(top[2]) > score(ranked[1][2]) else "")
        return top[2], how
    tied = [t[2] for t in ranked if (score(t[2]), t[0]) == (score(top[2]), top[0])]
    return None, (f"{len(tied)} riders fit ({', '.join(sorted(r.get('full_name') or '?' for r in tied))}); "
                  "add the right one to rider_aliases.csv")


def plan(rows, riders, events, aliases, rider_classes, season_id):
    """Returns (credits, problems). credits are rider_credits rows keyed by source_key."""
    credits: dict = {}
    problems = []
    for row in rows:
        rider, how = match_rider(row, riders, aliases, rider_classes)
        label = f"line {row['line']}: {row['name']} ({row['kind_text'] or 'no type'}, {row['event'] or 'no event'})"
        if not rider:
            problems.append((label, how))
            continue
        event = match_event(row["event"], events)
        if row["event"] and not event:
            problems.append((label, f"event '{row['event']}' not found; saved without an event"))
        event_label = EVENT_ALIASES.get(normalize(row["event"]), normalize(row["event"])) or None
        key = f"{row['kind']}|{rider['id']}|{event_label or ''}"
        note = None if row["kind_text"] else "type left blank on the form; counted as eligibility"
        if key in credits:
            c = credits[key]
            c["approved"] = True if (c["approved"] or row["approved"]) else (
                False if c["approved"] is False or row["approved"] is False else None)
            c["_lines"].append(row["line"])
            continue
        credits[key] = {
            "season_id": season_id, "rider_id": rider["id"], "kind": row["kind"],
            "event_label": event_label, "event_id": event["id"] if event else None,
            "approved": row["approved"], "class_text": row["class_text"] or None,
            "submitted_on": row["submitted_on"].isoformat() if row["submitted_on"] else None,
            "note": note, "source_key": key,
            "_rider": rider.get("full_name"), "_how": how, "_lines": [row["line"]],
            "_event": event.get("name") if event else None,
        }
    return list(credits.values()), problems


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python3 -m importer.credits",
                                 description="Import worker points and eligibility from the form CSV.")
    ap.add_argument("csv", help='e.g. "2026 WP & Eligibility.csv"')
    ap.add_argument("--season", type=int, help="season year (default: the year in the file name)")
    ap.add_argument("--apply", action="store_true", help="save changes (default is a dry run)")
    args = ap.parse_args(argv)

    here = os.path.dirname(os.path.abspath(__file__))
    load_env(os.path.join(here, ".env"))
    load_env(os.path.join(os.path.dirname(here), ".env.local"))

    year = args.season
    if not year:
        m = re.search(r"(20\d\d)", os.path.basename(args.csv))
        year = int(m.group(1)) if m else None
    try:
        if not year:
            raise ValueError("No season year in the file name; pass --season 2026.")
        rows, skipped = read_rows(args.csv)
        db = Supabase(os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", ""),
                      os.environ.get("SUPABASE_SECRET_KEY", ""))
        seasons = db.select("seasons", {"select": "id,year", "year": f"eq.{year}"})
        if len(seasons) != 1:
            raise ValueError(f"Expected one {year} season, found {len(seasons)}.")
        season_id = seasons[0]["id"]
        try:
            riders = db.select("riders", {"select": "id,full_name,first_name,last_name,email"})
        except SupabaseError:
            riders = db.select("riders", {"select": "id,full_name,first_name,last_name"})
        events = db.select("events", {"select": "id,name,race_date,series_id", "season_id": f"eq.{season_id}"})
        classes = {c["id"]: c["name"] for c in db.select("classes", {"select": "id,name"})}
        rider_classes: dict = {}
        if events:
            ids = ",".join(e["id"] for e in events)
            for r in db.select("results", {"select": "id,rider_id,class_id", "event_id": f"in.({ids})"}):
                rider_classes.setdefault(r["rider_id"], set()).add(classes.get(r["class_id"], ""))
    except (ValueError, OSError, SupabaseError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 2

    credits, problems = plan(rows, riders, events, load_rider_aliases(), rider_classes, season_id)

    print("MODE:", "APPLY — changes will be saved" if args.apply else "DRY RUN — nothing will be saved")
    print(f"{len(rows)} form rows for {year}; {len(skipped)} skipped (no name).")
    kinds = {k: sum(c["kind"] == k for c in credits) for k in ("worker_points", "eligibility", "sportsman")}
    print(f"\n{len(credits)} credits: {kinds['worker_points']} worker points, {kinds['eligibility']} eligibility"
          + (f", {kinds['sportsman']} sportsman" if kinds["sportsman"] else "") + ".")
    for c in sorted(credits, key=lambda c: (c["kind"], c["_rider"] or "")):
        flag = {True: "", False: "  [not approved on the form]", None: "  [approval blank]"}[c["approved"]]
        twice = f"  [listed {len(c['_lines'])}x]" if len(c["_lines"]) > 1 else ""
        print(f"  {c['kind']:<13} {c['_rider']:<28} {c['_event'] or c['event_label'] or '(no event)':<28}"
              f" matched by {c['_how']}{flag}{twice}")
    if problems:
        print(f"\n{len(problems)} rows need a look:")
        for label, why in problems:
            print(f"  {label} — {why}")

    if not args.apply:
        print("\nDry run: nothing was written. Add --apply to save.")
        return 0
    try:
        keep = [{k: v for k, v in c.items() if not k.startswith("_")} for c in credits]
        db.upsert("rider_credits", keep, on_conflict="source_key")
        # Only rows this CSV import made; approved website requests (source 'website', key 'web|…') stay.
        try:
            existing = db.select("rider_credits", {"select": "id,source_key", "season_id": f"eq.{season_id}",
                                                   "source": "eq.csv"})
        except SupabaseError:  # before importer/credit_requests.sql added the source column
            existing = db.select("rider_credits", {"select": "id,source_key", "season_id": f"eq.{season_id}"})
        wanted = {c["source_key"] for c in keep}
        stale = [r["id"] for r in existing
                 if r["source_key"] not in wanted and not str(r["source_key"]).startswith("web|")]
        for i in range(0, len(stale), 100):
            db.delete("rider_credits", {"id": f"in.({','.join(stale[i:i + 100])})"})
    except SupabaseError as e:
        print(f"Error while saving: {e}", file=sys.stderr)
        return 1
    print(f"\nSaved {len(keep)} credits; removed {len(stale)} that are no longer in the CSV.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
