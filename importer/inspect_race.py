"""Look at what LiveLaps sends for a race (read-only).

  python3 -m importer.inspect_race                 # every event waiting to import
  python3 -m importer.inspect_race <event uuid>    # one event
"""

import collections
import os
import sys

from . import livelaps, sources
from .__main__ import load_env
from .supabase_client import Supabase

FIELDS = ["id", "fullName", "className", "classPosition", "overallPosition", "groupPosition",
          "standing", "isDisqualified", "isOverallExcluded", "sectionsCompleted",
          "totalCumulatedTime", "totalCumulatedPenalty", "averageTime", "bestTime", "raceName"]


def main(argv):
    here = os.path.dirname(os.path.abspath(__file__))
    load_env(os.path.join(here, ".env"))
    load_env(os.path.join(os.path.dirname(here), ".env.local"))
    db = Supabase(os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", ""),
                  os.environ["SUPABASE_SECRET_KEY"])
    if argv:
        events = db.select("events", {"select": "id,name,race_date,results_url", "id": f"eq.{argv[0]}"})
    else:
        events = db.select("events", {"select": "id,name,race_date,results_url,processed",
                                      "results_url": "not.is.null", "order": "race_date.asc"})
        events = [e for e in events if not e.get("processed")]

    for ev in events:
        print(f"\n=== {ev['name']} ({ev['race_date']}) {ev['id']}")
        try:
            raw, _ = sources.fetch_results(ev["results_url"], ev.get("race_date"))
        except Exception as e:
            print("  could not fetch:", e)
            continue
        missing = [r for r in raw if r.get("overallPosition") in (None, "", 0)]
        print(f"  {len(raw)} results; {len(missing)} have no overallPosition")
        if not missing:
            continue
        print("  standing:", dict(collections.Counter(str(r.get("standing")) for r in missing)))
        print("  isOverallExcluded:", dict(collections.Counter(str(r.get("isOverallExcluded")) for r in missing)))
        print("  classes:", dict(collections.Counter(str(r.get("className")) for r in missing)))
        print("  sample WITHOUT overall:")
        for r in missing[:3]:
            print("   ", {k: r.get(k) for k in FIELDS})
        have = [r for r in raw if r not in missing]
        if have:
            print("  sample WITH overall:")
            for r in have[:2]:
                print("   ", {k: r.get(k) for k in FIELDS})


if __name__ == "__main__":
    main(sys.argv[1:])
