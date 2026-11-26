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


class NestedLayout(unittest.TestCase):
    def test_results_table_inside_layout_table(self):
        body = page("mototally_2026_4_C2.html").split("<body>")[1].split("</body>")[0]
        nested = "<html><body><table><tr><td>menu</td><td>" + body + "</td></tr><tr><td>footer</td></tr></table></body></html>"
        rows = mototally.parse_class_page(nested, "A Open", source="x", key_prefix="k")
        self.assertEqual(len(rows), 13)


class CombiningJuniorClasses(unittest.TestCase):
    def row(self, pos):
        return {"class_id": "lb", "position": pos, "overall_position": None, "dns": False, "dnf": False, "disqualified": False}

    def test_same_group_uses_group_position(self):
        raw = [{"className": "Women Beg", "classGroup": "Overall Women Beg", "groupPosition": 2, "_livelaps_race": "m"},
               {"className": "Women Vet Beginner", "classGroup": "Overall Women Beg", "groupPosition": 1, "_livelaps_race": "m"}]
        rows = [self.row(1), self.row(1)]
        pipeline.rerank_merged_classes(raw, rows, log=lambda *_: None)
        self.assertEqual([r["position"] for r in rows], [2, 1])

    def test_different_links_stop(self):
        raw = [{"className": "65cc (7-9)", "_livelaps_race": "a"}, {"className": "65cc (10-11)", "_livelaps_race": "b"}]
        rows = [dict(self.row(1), overall_position=1), dict(self.row(1), overall_position=1)]
        with self.assertRaises(pipeline.EventImportError) as ctx:
            pipeline.rerank_merged_classes(raw, rows, log=lambda *_: None)
        self.assertIn("different results links", str(ctx.exception))


class RealPages(unittest.TestCase):
    """Pages exactly as MotoTally sent them (with its `</span</td>` typo)."""

    def test_enduro_pro(self):
        rows = mototally.parse_class_page(page("mototally_real_2026_4_C1.html"), "Pro", source="x", key_prefix="k")
        self.assertEqual(len(rows), 16)
        self.assertEqual((rows[0]["fullName"], rows[0]["classPosition"], rows[0]["brand"], rows[0]["source_key"]),
                         ("Chase Lorenz", 1, "KAW", "k/r6036"))
        self.assertEqual(rows[-1]["standing"], "DNF")

    def test_junior_hare_scramble(self):
        rows = mototally.parse_class_page(page("mototally_real_2026_3_C125.html"), "Supermini", source="x", key_prefix="k")
        self.assertEqual([(r["fullName"], r["groupPosition"]) for r in rows],
                         [("Oliver Roths", 1), ("Wyatt Roths", 2), ("Isaac Wills", 13)])

    def test_plain_header_layout(self):
        rows = mototally.parse_class_page(page("mototally_real_2026_12_C112.html"), "VINTAGE EXP", source="x", key_prefix="k")
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["classPosition"], rows[0]["groupPosition"], rows[0]["classGroup"], rows[0]["displayedNumber"]),
                         (1, 4, "Overall RMVMC XC", "377"))


class RiderAliases(unittest.TestCase):
    def test_alias_links_spelling_variant(self):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as f:
            f.write("results_name,rider_name,note\nSeth Hilman,Seth Hillman,\n")
        store = NameStore([{"id": "seth", "full_name": "Seth Hillman"}], [])
        named = {("name", "seth hilman"): {"full_name": "Seth Hilman", "first_name": "Seth", "last_name": "Hilman"}}
        try:
            with mock.patch.object(pipeline, "RIDER_ALIASES_FILE", f.name):
                ids = pipeline.match_named_riders(store, named, log=lambda *_: None)
        finally:
            os.unlink(f.name)
        self.assertEqual(ids, {("name", "seth hilman"): "seth"})


class AliasToRiderId(unittest.TestCase):
    def test_alias_can_pick_one_of_two_same_name_riders(self):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False) as f:
            f.write("results_name,rider_name,rider_id,note\nRori Dyar,,kid-account,\n")
        store = NameStore([{"id": "parent-account", "full_name": "Rori Dyar", "livelaps_id": 1},
                           {"id": "kid-account", "full_name": "Rori Dyar", "livelaps_id": 2}], [])
        named = {("name", "rori dyar"): {"full_name": "Rori Dyar", "first_name": "Rori", "last_name": "Dyar"}}
        try:
            with mock.patch.object(pipeline, "RIDER_ALIASES_FILE", f.name):
                ids = pipeline.match_named_riders(store, named, log=lambda *_: None)
        finally:
            os.unlink(f.name)
        self.assertEqual(ids, {("name", "rori dyar"): "kid-account"})


class OtherSeries(unittest.TestCase):
    def test_multi_part_series_link(self):
        link = "https://www.moto-tally.com/IERA/HS/Results.aspx/2026/1"
        self.assertEqual(mototally.parse_link(link), ("IERA/HS", "2026", "1"))
        self.assertEqual(sources.describe(link), "MotoTally IERA/HS 2026/1")
        self.assertEqual(mototally.parse_link("https://www.moto-tally.com/CORCS/Results.aspx/2026/4/C2/S"),
                         ("CORCS", "2026", "4"))

    def test_extra_ama_column(self):
        html = page("mototally_2026_3_C30.html").replace(
            '<th rowspan="3"><a>Rider Name</a></th>', '<th rowspan="3">AMA#</th><th rowspan="3"><a>Rider Name</a></th>'
        ).replace('<td><a>Jace Brinkman</a></td>', '<td>1234</td><td><a>Jace Brinkman</a></td>')
        rows = mototally.parse_class_page(html, "Mini 4", source="x", key_prefix="k")
        self.assertEqual(rows[0]["fullName"], "Jace Brinkman")   # the row with the extra cell is read
        self.assertEqual(len(rows), 1)                           # rows without it don't match this layout


class RealIowaPage(unittest.TestCase):
    def test_iera_hare_scramble_with_ama_column(self):
        rows = mototally.parse_class_page(page("mototally_real_IERA_HS_2026_1_C1.html"), "AA",
                                          source="x", key_prefix="k")
        self.assertEqual([(r["fullName"], r["classPosition"], r["groupPosition"], r["displayedNumber"], r["standing"])
                          for r in rows],
                         [("Benjamin Ward", 1, 1, "251", "Scored"), ("Ayden White", 2, 2, "881", "Scored"),
                          ("Bryan Johnson", 7, 13, "199", "Scored"), ("David Stickel", None, None, "112", "DNF")])
        self.assertEqual(rows[0]["classGroup"], "Overall A")
        self.assertEqual(rows[0]["source_key"], "k/r312")


class SeriesIndexLink(unittest.TestCase):
    INDEX = "https://www.moto-tally.com/IERA/HS/Results.aspx"

    def test_index_link_is_recognised(self):
        self.assertTrue(mototally.is_index_link(self.INDEX))
        self.assertFalse(mototally.is_index_link(self.INDEX + "/2026/1"))
        self.assertEqual(sources.describe(self.INDEX), "MotoTally IERA/HS (race on the event date)")

    def test_race_picked_by_date(self):
        with mock.patch.object(mototally, "_get", return_value=page("mototally_real_IERA_HS_index.html")):
            self.assertEqual(mototally.resolve_index_link(self.INDEX, "2026-03-22"), self.INDEX + "/2026/1")
            self.assertEqual(mototally.resolve_index_link(self.INDEX, "2025-03-23"), self.INDEX + "/2025/1")
            with self.assertRaises(ValueError) as two:
                mototally.resolve_index_link(self.INDEX, "2026-08-01")
            self.assertIn("Dayton Enduro Youth 50's HS: " + self.INDEX + "/2026/35", str(two.exception))
            with self.assertRaises(ValueError):
                mototally.resolve_index_link(self.INDEX, "2026-07-04")


class ClassOnlyLayout(unittest.TestCase):
    def test_youth_page_without_overall_group(self):
        rows = mototally.parse_class_page(page("mototally_real_IERA_HS_2026_39_C15.html"), "Mini 9-14 (85s)",
                                          source="x", key_prefix="k")
        self.assertEqual([(r["fullName"], r["classPosition"], r["groupPosition"], r["classGroup"], r["displayedNumber"])
                          for r in rows],
                         [("Wyatt Maxwell", 1, None, None, "711"), ("Hoyt Kammeyer", 2, None, None, "731"),
                          ("Jace Brinkman", 4, None, None, "249")])


class CombineByLapsAndTime(unittest.TestCase):
    def test_classes_without_any_ranking_use_laps_then_time(self):
        raw = [{"className": "Girls 4-9", "sectionsCompleted": 4, "totalCumulatedTime": "0:50:10", "_livelaps_race": "m"},
               {"className": "Womens Beginner", "sectionsCompleted": 5, "totalCumulatedTime": "0:55:00", "_livelaps_race": "m"},
               {"className": "Girls 4-9", "sectionsCompleted": 5, "totalCumulatedTime": "0:52:30", "_livelaps_race": "m"}]
        rows = [{"class_id": "lb", "position": p, "overall_position": None, "dns": False, "dnf": False, "disqualified": False}
                for p in (1, 1, 2)]
        pipeline.rerank_merged_classes(raw, rows, log=lambda *_: None)
        self.assertEqual([r["position"] for r in rows], [3, 2, 1])


class PlainClassOnlyLayout(unittest.TestCase):
    def test_single_rider_class_page(self):
        rows = mototally.parse_class_page(page("mototally_real_IERA_HS_2026_30_C48.html"), "A 250 (RMEC)",
                                          source="x", key_prefix="k")
        self.assertEqual([(r["fullName"], r["classPosition"], r["groupPosition"], r["standing"]) for r in rows],
                         [("Byron Sutter", 1, None, "Scored")])


class FillFromOverallPages(unittest.TestCase):
    def test_single_rider_class_gets_overall_place(self):
        base = "https://www.moto-tally.com/IERA/HS/Results.aspx/2026/30"
        index = '<select name="mtR$ddlSelectClass"><option value="O1">Overall A</option><option value="C48">A 250 (RMEC)</option></select>'
        overall = ('<table><tr><th>Overall A Results</th><th>Class Results</th><th>Class</th><th>Rider Name</th></tr>'
                   '<tr><td>7</td><td></td><td></td><td>1</td><td></td><td></td><td>A250</td>'
                   "<td><a href='javascript:getRiderDetail(4877);'>Byron Sutter</a></td></tr></table>")
        pages = {base: index, base + "/C48/S": page("mototally_real_IERA_HS_2026_30_C48.html"), base + "/O1/S": overall}
        with mock.patch.object(mototally, "_get", side_effect=lambda url: pages[url]), mock.patch.object(mototally.time, "sleep"):
            rows = mototally.fetch_results(base)
        self.assertEqual((rows[0]["fullName"], rows[0]["groupPosition"], rows[0]["classGroup"]), ("Byron Sutter", 7, "Overall A"))


class ScopedClassMapAndEnduroScore(unittest.TestCase):
    def test_source_scoped_rows(self):
        rows = [("aa", "skip", "mototally iera/hs"), ("+45a (rmec)", "a 45+", "mototally iera/hs"), ("pro aa", "aa", "")]
        target = pipeline.class_lookup(rows)
        self.assertEqual(target("AA", "MotoTally IERA/HS 2026/30"), "skip")
        self.assertIsNone(target("AA", "LiveLaps race 83628"))      # RMEC's own AA is untouched
        self.assertEqual(target("+45A (RMEC)", "MotoTally IERA/HS 2026/30"), "a 45+")
        self.assertEqual(target("Pro AA", "LiveLaps race 1"), "aa")
        self.assertEqual(target("Electric Open", None), "e-bike")   # built-in alias still works

    def test_division_ranked_by_enduro_score(self):
        classes = {"a45": {"id": "a45", "division_id": "div-A"}, "a250": {"id": "a250", "division_id": "div-A"}}
        raw = [{"className": "+45A (RMEC)", "enduroScore": (-8, 44, 15), "_livelaps_race": "m"},
               {"className": "+45A (RMEC)", "enduroScore": (-7, 48, 12), "_livelaps_race": "m"},
               {"className": "A 250 (RMEC)", "enduroScore": (-8, 40, 2), "_livelaps_race": "m"},
               {"className": "A 250 (RMEC)", "enduroScore": None, "_livelaps_race": "m"}]
        rows = [{"class_id": c, "overall_position": None, "dns": False, "dnf": d, "disqualified": False}
                for c, d in (("a45", False), ("a45", False), ("a250", False), ("a250", True))]
        used = pipeline.fill_group_positions(raw, rows, classes, log=lambda *_: None)
        self.assertEqual([r["overall_position"] for r in rows], [2, 3, 1, None])
        self.assertEqual(used, {"div-A"})


class TwoOverallsLayout(unittest.TestCase):
    def test_iera_b_class_listed_in_overall_a_and_b(self):
        # Bartlett 2026: B classes show "Overall A", "Overall B" and the class; the class's
        # own overall (B) is the one next to the class column.
        rows = mototally.parse_class_page(page("mototally_real_IERA_HS_2026_30_C6.html"), "B",
                                          source="MotoTally IERA/HS 2026/30", key_prefix="mt/IERA/HS/2026/30")
        self.assertEqual(len(rows), 15)
        first = rows[0]
        self.assertEqual((first["fullName"], first["classPosition"], first["groupPosition"], first["classGroup"]),
                         ("Garrett Reynolds", 1, 1, "Overall B"))
        self.assertEqual(first["enduroScore"], (-16, 79, 42))
        self.assertEqual([(r["fullName"], r["standing"]) for r in rows[-2:]],
                         [("Brenden Trail", "DNF"), ("Nicholas Sebesta", "DNF")])
