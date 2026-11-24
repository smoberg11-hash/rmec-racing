"""RMEC race importer.

Usage (run from the rmec-racing folder):

  python3 -m importer                      # dry run: every unprocessed event, writes nothing
  python3 -m importer --apply              # import + score every unprocessed event for real
  python3 -m importer --event <uuid>       # just one event (even if already processed)
  python3 -m importer --event <uuid> --apply

Offline testing with CSV exports of the database (always a dry run):

  python3 -m importer --offline <folder> --event <uuid> --results-file <livelaps.json>
"""

from __future__ import annotations

import argparse
import csv
import os
import sys

from . import pipeline
from .supabase_client import Supabase, SupabaseError


def load_env(path):
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def write_report(path, proposed):
    cols = ["class_name", "division", "position", "overall_position", "status", "is_division_winner",
            "class_scoring_position", "division_rank", "points", "division_points",
            "current_points", "current_division_points", "rider_id", "id"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(proposed)


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python3 -m importer", description="Import LiveLaps results into Supabase and score them.")
    ap.add_argument("--apply", action="store_true", help="actually write to the database (default is a dry run)")
    ap.add_argument("--event", help="import only this event id")
    ap.add_argument("--offline", metavar="FOLDER", help="use CSV exports in FOLDER instead of Supabase (dry run only)")
    ap.add_argument("--results-file", help="read LiveLaps results from a saved JSON file instead of the API")
    ap.add_argument("--report", metavar="FOLDER", help="write a points CSV per event into FOLDER")
    args = ap.parse_args(argv)

    here = os.path.dirname(os.path.abspath(__file__))
    load_env(os.path.join(here, ".env"))
    load_env(os.path.join(os.path.dirname(here), ".env.local"))

    if args.offline:
        if args.apply:
            ap.error("--offline is always a dry run; remove --apply.")
        store = pipeline.CsvStore(args.offline)
    else:
        try:
            db = Supabase(os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", ""),
                          os.environ.get("SUPABASE_SECRET_KEY", ""))
        except SupabaseError as e:
            print(f"Error: {e}", file=sys.stderr)
            return 2
        store = pipeline.LiveStore(db, dry_run=not args.apply)

    print("MODE:", "APPLY — changes will be saved" if not store.dry_run else "DRY RUN — nothing will be saved")

    try:
        if args.event:
            ev = store.event(args.event)
            if not ev:
                print(f"Error: event {args.event} not found.", file=sys.stderr)
                return 2
            events = [ev]
        else:
            events = store.events_to_process()
    except SupabaseError as e:
        print(f"Error reading events: {e}", file=sys.stderr)
        return 2

    if not events:
        print("No events to process.")
        return 0
    if args.results_file and len(events) != 1:
        ap.error("--results-file needs --event (it holds one race).")

    failures = 0
    for ev in events:
        try:
            out = pipeline.import_event(store, ev, results_file=args.results_file)
            if args.report:
                os.makedirs(args.report, exist_ok=True)
                path = os.path.join(args.report, f"points-{ev['id'][:8]}.csv")
                write_report(path, out["proposed"])
                print(f"Points report: {path}")
        except (pipeline.EventImportError, SupabaseError, ValueError) as e:
            failures += 1
            print(f"FAILED: {e}\nThis event was NOT marked processed; fix the problem and run again.", file=sys.stderr)

    print(f"\nDone: {len(events) - failures} ok, {failures} failed.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
