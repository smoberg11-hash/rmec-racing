"""Merge duplicate riders that share a name: one from LiveLaps (has a LiveLaps id)
and one created from a site without ids, like MotoTally (no LiveLaps id).

  python3 -m importer.merge_riders            # dry run: list what would be merged
  python3 -m importer.merge_riders --apply    # do it

For each name with exactly one LiveLaps rider and one or more riders without a
LiveLaps id: their results and membership history move to the LiveLaps rider,
membership details are kept if the LiveLaps rider has none, and the empty
duplicates are deleted. Names with two LiveLaps riders (two different LiveLaps
accounts) are listed for a person to sort out, and nothing is changed for them.
"""

from __future__ import annotations

import argparse
import os
import sys

from .__main__ import load_env
from .pipeline import normalize
from .supabase_client import Supabase, SupabaseError

MEMBER_FIELDS = ("is_member", "membership_number", "membership_expiration")


def plan(riders):
    by_name: dict = {}
    for r in riders:
        n = normalize(r.get("full_name"))
        if n:
            by_name.setdefault(n, []).append(r)
    merges, unsure = [], []
    for name, group in sorted(by_name.items()):
        if len(group) < 2:
            continue
        with_id = [r for r in group if r.get("livelaps_id") not in (None, "")]
        without = [r for r in group if r.get("livelaps_id") in (None, "")]
        if len(with_id) == 1 and without:
            merges.append((with_id[0], without))
        elif len(with_id) == 0 and len(without) > 1:
            merges.append((without[0], without[1:]))
        else:
            unsure.append((group[0].get("full_name"), len(with_id)))
    return merges, unsure


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python3 -m importer.merge_riders")
    ap.add_argument("--apply", action="store_true", help="save changes (default is a dry run)")
    args = ap.parse_args(argv)

    here = os.path.dirname(os.path.abspath(__file__))
    load_env(os.path.join(here, ".env"))
    load_env(os.path.join(os.path.dirname(here), ".env.local"))
    try:
        db = Supabase(os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", ""),
                      os.environ.get("SUPABASE_SECRET_KEY", ""))
        riders = db.select("riders", {"select": "id,full_name,livelaps_id," + ",".join(MEMBER_FIELDS)})
    except SupabaseError as e:
        print(f"Error: {e}", file=sys.stderr)
        return 2

    merges, unsure = plan(riders)
    print("MODE:", "APPLY — changes will be saved" if args.apply else "DRY RUN — nothing will be saved")
    print(f"{len(merges)} duplicate riders to merge:")
    for keep, dupes in merges:
        print(f"  {keep['full_name']}: keep {keep['id']} (LiveLaps {keep.get('livelaps_id') or '—'}), "
              f"merge {', '.join(d['id'] for d in dupes)}")
    if unsure:
        print(f"\n{len(unsure)} names are shared by riders with different LiveLaps ids (probably different people, "
              "or one person with two LiveLaps accounts). Left alone:")
        for name, n in unsure:
            print(f"  {name} ({n} LiveLaps riders)")
    if not args.apply:
        print("\nDry run: nothing was written. Add --apply to merge.")
        return 0

    problems = 0
    for keep, dupes in merges:
        for d in dupes:
            try:
                keep_results = db.select("results", {"select": "event_id,class_id", "rider_id": f"eq.{keep['id']}"})
                taken = {(r["event_id"], r["class_id"]) for r in keep_results}
                theirs = db.select("results", {"select": "id,event_id,class_id", "rider_id": f"eq.{d['id']}"})
                clash = [r for r in theirs if (r["event_id"], r["class_id"]) in taken]
                if clash:
                    print(f"  ! {keep['full_name']}: both riders have a result in the same race and class "
                          f"({len(clash)}); skipped, fix by hand.")
                    problems += 1
                    continue
                if theirs:
                    db.update("results", {"rider_id": f"eq.{d['id']}"}, {"rider_id": keep["id"]})
                db.update("membership_history", {"rider_id": f"eq.{d['id']}"}, {"rider_id": keep["id"]})
                if not keep.get("is_member") and d.get("is_member"):
                    db.update("riders", {"id": f"eq.{keep['id']}"}, {k: d.get(k) for k in MEMBER_FIELDS})
                db.delete("riders", {"id": f"eq.{d['id']}"})
                print(f"  merged {keep['full_name']} ({len(theirs)} results moved)")
            except SupabaseError as e:
                print(f"  ! {keep['full_name']}: {e}")
                problems += 1
    print(f"\nDone: {len(merges) - problems} merged, {problems} need a look.")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
