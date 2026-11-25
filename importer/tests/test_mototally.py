import os
import unittest
from unittest import mock

from importer import mototally, pipeline, scoring, sources
from importer.tests.test_importer import DIVS, EVENT, EVENT_ROW, SERIES, cls

FIX = os.path.join(os.path.dirname(__file__), "fixtures")


def page(name):
    with open(os.path.join(FIX, name), encoding="utf-8") as f:
        return f.read()


class Links(unittest.TestCase):
    def test_parse_link(self):
        self.assertEqual(mototally.parse_link("https://www.moto-tally.com/CORCS/Results.aspx/2026/3"),
                         ("CORCS", "2026", "3"))
        self.assertEqual(mototally.parse_link("https://www.moto-tally.com/CORCS/Results.aspx/2026/4/O1/S"),
                         ("CORCS", "2026", "4"))
        self.assertTrue(mototally.is_link("moto-tally.com/CORCS/Results.aspx/2026/12"))
        self.assertFalse(mototally.is_link("https://www.livelaps.com/events/1/races/2"))

    def test_mixed_links_in_one_cell(self):
        cell = "https://www.moto-tally.com/CORCS/Results.aspx/2026/3, https://www.livelaps.com/events/1/races/222"
        self.assertEqual([sources.describe(x) for x in sources.links(cell)],
                         ["MotoTally CORCS 2026/3", "LiveLaps race 222"])


class Parsing(unittest.TestCase):
    def test_class_list(self):
        codes = mototally.class_options(mototally.parse_page(page("mototally_2026_4_C2.html")))
        self.assertEqual(len(codes), 35)
        self.assertIn(("C5", "A Senior 40+"), codes)
        self.assertNotIn("O1", [c for c, _ in codes])

    def test_enduro_class_page(self):
        rows = mototally.parse_class_page(page("mototally_2026_4_C2.html"), "A Open",
                                          source="MotoTally CORCS 2026/4", key_prefix="mt/CORCS/2026/4/C2")
        self.assertEqual(len(rows), 13)
        first = rows[0]
        self.assertEqual((first["fullName"], first["classPosition"], first["groupPosition"], first["classGroup"]),
                         ("Andrew Cox", 1, 5, "Overall A/B"))
        self.assertEqual(first["standing"], "Scored")
        self.assertIsNone(first["displayedNumber"])  # enduro "Row" is not a rider number
        dnf = rows[-2]
        self.assertEqual((dnf["fullName"], dnf["standing"], dnf["classPosition"]), ("Derek Henderson", "DNF", None))
        self.assertEqual(pipeline.result_status(dnf), {"dns": False, "dnf": True, "disqualified": False})
        self.assertEqual(len({r["source_key"] for r in rows}), 13)

    def test_hare_scramble_class_page(self):
        rows = mototally.parse_class_page(page("mototally_2026_3_C30.html"), "Mini 4",
                                          source="MotoTally CORCS 2026/3", key_prefix="mt/CORCS/2026/3/C30")
        self.assertEqual(len(rows), 8)
        self.assertEqual((rows[0]["fullName"], rows[0]["displayedNumber"], rows[0]["sectionsCompleted"],
                          rows[0]["groupPosition"], rows[0]["classGroup"]),
                         ("Jace Brinkman", "249", 15, 3, "Overall Mini 4"))

    def test_star_marks_removed(self):
        self.assertEqual(mototally.clean_name("Jackson Watson ***"), "Jackson Watson")
        self.assertEqual(mototally.clean_name("Steve Berscheid***"), "Steve Berscheid")


class NameStore:
    """In-memory store for a MotoTally import (riders matched by name)."""
    dry_run = False

    def __init__(self, riders, classes):
        self.riders, self._classes, self.results, self.processed, self.created = riders, classes, [], False, []

    def classes(self): return self._classes
    def divisions(self): return DIVS
    def series(self): return SERIES
    def riders_by_livelaps_id(self, ids): return {}
    def riders_for_name_matching(self): return self.riders
    def event_results(self, event_id): return [dict(r) for r in self.results]

    def create_riders(self, rows):
        made = [dict(r, id=f"new-{i}") for i, r in enumerate(rows)]
        self.created += made
        self.riders += made
        return made

    def save_results(self, rows):
        for row in rows:
            assert row["livelaps_result_id"] is None and row["source_key"]
            existing = next((r for r in self.results if r["source_key"] == row["source_key"]), None)
            if existing:
                existing.update(row)
            else:
                self.results.append(dict(row, id=f"res-{len(self.results)}", points=None, division_points=None))

    def save_points(self, proposed, existing):
        for p in proposed:
            next(r for r in self.results if r["id"] == p["id"]).update(points=p["points"], division_points=p["division_points"])

    def delete_results(self, ids): return 0
    def mark_processed(self, event_id): self.processed = True


class ImportFromMotoTally(unittest.TestCase):
    def test_import_matches_existing_rider_by_name_and_creates_others(self):
        raw = mototally.parse_class_page(page("mototally_2026_4_C2.html"), "A Open",
                                         source="MotoTally CORCS 2026/4", key_prefix="mt/CORCS/2026/4/C2")
        store = NameStore([{"id": "andrew", "full_name": "Andrew Cox", "first_name": "Andrew", "last_name": "Cox"}],
                          [cls("aopen", "A Open", "A")])
        event = dict(EVENT_ROW, results_url="https://www.moto-tally.com/CORCS/Results.aspx/2026/4")
        with mock.patch.object(sources, "fetch_results", return_value=([dict(r) for r in raw], [("MotoTally", len(raw))])):
            pipeline.import_event(store, event, log=lambda *_: None)
        self.assertTrue(store.processed)
        self.assertEqual(len(store.results), 13)
        self.assertEqual(len(store.created), 12)          # everyone except Andrew Cox
        cox = next(r for r in store.results if r["rider_id"] == "andrew")
        self.assertEqual(cox["points"], 36)                 # A division winner (best group place among A)
        dnfs = [r for r in store.results if r["dnf"]]
        self.assertEqual([r["points"] for r in dnfs], [0, 0])

        # Running it again updates the same rows and creates nobody new.
        with mock.patch.object(sources, "fetch_results", return_value=([dict(r) for r in raw], [("MotoTally", len(raw))])):
            pipeline.import_event(store, event, log=lambda *_: None)
        self.assertEqual(len(store.results), 13)
        self.assertEqual(len(store.created), 12)

    def test_two_riders_with_the_same_name_stop_the_import(self):
        raw = mototally.parse_class_page(page("mototally_2026_4_C2.html"), "A Open",
                                         source="x", key_prefix="mt/x")
        twins = [{"id": "a", "full_name": "Seth Hillman"}, {"id": "b", "full_name": "Seth Hillman"}]
        store = NameStore(twins, [cls("aopen", "A Open", "A")])
        with mock.patch.object(sources, "fetch_results", return_value=(raw, [("x", len(raw))])):
            with self.assertRaises(pipeline.EventImportError) as ctx:
                pipeline.import_event(store, dict(EVENT_ROW, results_url="x"), log=lambda *_: None)
        self.assertIn("Seth Hillman", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
