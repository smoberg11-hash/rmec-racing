"""Run with:  python3 -m unittest discover -s importer/tests -t .   (from the rmec-racing folder)"""

import json
import os
import unittest

from importer import livelaps, pipeline, scoring

SEASON, ADULT, JUNIOR, EVENT = "season-1", "series-adult", "series-junior", "event-1"
SERIES = [{"id": ADULT, "season_id": SEASON, "name": "Adult"},
          {"id": JUNIOR, "season_id": SEASON, "name": "Junior"}]
DIVS = [{"id": f"div-{d}", "series_id": ADULT, "name": d, "has_annual_points": d != "D"} for d in "ABCD"]
EVENT_ROW = {"id": EVENT, "name": "Test Enduro", "series_id": ADULT, "season_id": SEASON}


def cls(cid, name, div=None, series=ADULT):
    return {"id": cid, "name": name, "series_id": series, "division_id": f"div-{div}" if div else None,
            "livelaps_class_id": None}


def res(rid, class_id, pos, overall, standing="Scored", **flags):
    return {"id": rid, "event_id": EVENT, "rider_id": f"rider-{rid}", "class_id": class_id,
            "position": pos, "overall_position": overall, "standing": standing,
            "dns": flags.get("dns", False), "dnf": flags.get("dnf", False),
            "disqualified": flags.get("dq", False), "points": None, "division_points": None}


class PointsTable(unittest.TestCase):
    def test_table(self):
        self.assertEqual([scoring.table_points(p) for p in (1, 2, 3, 4, 5, 6, 20, 21)],
                         [30, 25, 21, 18, 16, 15, 1, 0])
        self.assertEqual(scoring.table_points(None), 0)


class Scoring(unittest.TestCase):
    def setUp(self):
        self.classes = [cls("a-open", "A Open", "A"), cls("a-30", "A 30+", "A"),
                        cls("d-vet", "60+ Expert", "D"), cls("jr", "16 or Under", series=JUNIOR)]

    def run_calc(self, results):
        return scoring.calculate(EVENT, results, EVENT_ROW, self.classes, DIVS, SERIES)

    def by_id(self, out):
        return {p["id"]: p for p in out["proposed"]}

    def test_division_winner_gets_36_and_class_shifts(self):
        out = self.run_calc([
            res("w", "a-open", 1, 1), res("x", "a-open", 2, 3), res("y", "a-open", 3, 4),
            res("p", "a-30", 1, 2), res("q", "a-30", 2, 5),
        ])
        self.assertTrue(out["valid"], out["errors"])
        p = self.by_id(out)
        self.assertEqual((p["w"]["points"], p["x"]["points"], p["y"]["points"]), (36, 30, 25))
        # A 30+ has no division winner in it, so normal table.
        self.assertEqual((p["p"]["points"], p["q"]["points"]), (30, 25))
        # Division points by overall order inside division A: w, p, x, y, q
        self.assertEqual([p[k]["division_points"] for k in "wpxyq"], [30, 25, 21, 18, 16])

    def test_dnf_gets_zero_and_cannot_rank_ahead(self):
        out = self.run_calc([res("a", "a-open", 1, 1), res("b", "a-open", 2, 2),
                             res("c", "a-open", None, None, standing="DNF", dnf=True)])
        self.assertTrue(out["valid"], out["errors"])
        self.assertEqual(self.by_id(out)["c"]["points"], 0)

        bad = self.run_calc([res("a", "a-open", 2, 2), res("c", "a-open", 1, 1, standing="DNF", dnf=True)])
        self.assertFalse(bad["valid"])

    def test_division_d_and_juniors_get_no_division_points(self):
        out = self.run_calc([res("d1", "d-vet", 1, 1), res("j1", "jr", 1, None)])
        self.assertTrue(out["valid"], out["errors"])
        p = self.by_id(out)
        self.assertEqual((p["d1"]["points"], p["d1"]["division_points"]), (30, 0))
        self.assertEqual((p["j1"]["points"], p["j1"]["division_points"]), (30, 0))

    def test_tied_positions_block_the_update(self):
        out = self.run_calc([res("a", "a-open", 1, 1), res("b", "a-open", 1, 2)])
        self.assertFalse(out["valid"])
        self.assertTrue(any("Duplicate class position" in e for e in out["errors"]))

    def test_missing_rider_blocks_the_update(self):
        r = res("a", "a-open", 1, 1)
        r["rider_id"] = None
        self.assertFalse(self.run_calc([r])["valid"])


class Importing(unittest.TestCase):
    def test_api_url(self):
        self.assertEqual(livelaps.api_url("https://www.livelaps.com/livelaps/scores/82714"),
                         livelaps.API_PREFIX + "82714")
        self.assertEqual(livelaps.api_url("82714"), livelaps.API_PREFIX + "82714")
        self.assertEqual(livelaps.api_url("https://www.livelaps.com/events/25656/races/87818"),
                         livelaps.API_PREFIX + "87818")
        self.assertEqual(livelaps.api_url("https://www.livelaps.com/events/25656/races/87818/?tab=results"),
                         livelaps.API_PREFIX + "87818")
        self.assertEqual(livelaps.api_url(livelaps.API_PREFIX + "83628"), livelaps.API_PREFIX + "83628")
        with self.assertRaises(ValueError):
            livelaps.api_url("https://example.com/82714")

    def test_parse_n8n_wrapped_payload(self):
        inner = {"current_page": 1, "has_more_pages": False, "data": [{"id": 1}, {"id": 2}]}
        rows, info = livelaps.parse_payload({"data": json.dumps(inner)})
        self.assertEqual(len(rows), 2)
        self.assertFalse(info["has_more_pages"])

    def test_rider_rows_dedupes_and_skips_membership(self):
        rows = pipeline.rider_rows([
            {"id": 1, "userId": 10, "firstName": "Ann", "lastName": "Lee", "fullName": "Ann Lee", "displayedNumber": "1A", "brand": "KTM"},
            {"id": 2, "userId": 10, "firstName": "Ann", "lastName": "Lee", "fullName": "Ann Lee", "displayedNumber": "1A", "brand": "KTM"},
        ])
        self.assertEqual(len(rows), 1)
        self.assertNotIn("is_member", rows[0])

    def test_class_matching_alias_and_junior_series(self):
        classes = [cls("ebike", "E-Bike", "D"), cls("jr", "16 or Under", series=JUNIOR), cls("aopen", "A Open", "A")]
        match = pipeline.build_class_matcher(classes, EVENT_ROW, SERIES)
        self.assertEqual(match({"className": "Electric Open"})["id"], "ebike")
        self.assertEqual(match({"className": " a  open "})["id"], "aopen")
        self.assertEqual(match({"className": "16 or Under"})["id"], "jr")
        self.assertIsNone(match({"className": "Mystery Class"}))

    def test_duplicate_class_names_are_not_guessed(self):
        classes = [cls("sp-c", "Sportsman", "C"), cls("sp-d", "Sportsman", "D")]
        match = pipeline.build_class_matcher(classes, EVENT_ROW, SERIES)
        with self.assertRaises(pipeline.EventImportError) as ctx:
            pipeline.result_rows([{"id": 5, "userId": 9, "className": "Sportsman"}], EVENT, {9: "r9"}, match)
        self.assertIn("More than one", str(ctx.exception))

    def test_junior_event_scores_without_divisions(self):
        jr_event = {"id": EVENT, "name": "Jr Enduro", "series_id": JUNIOR, "season_id": SEASON}
        classes = [cls("jr65", "65cc", series=JUNIOR)]
        out = scoring.calculate(EVENT, [res("a", "jr65", 1, 1), res("b", "jr65", 2, 2)], jr_event, classes, DIVS, SERIES)
        self.assertTrue(out["valid"], out["errors"])
        self.assertEqual([p["points"] for p in out["proposed"]], [30, 25])

    def test_same_rider_twice_in_a_class_stops_the_import(self):
        match = pipeline.build_class_matcher([cls("a30", "A 30+", "A")], EVENT_ROW, SERIES)
        raw = [{"id": 4768804, "userId": 452791, "fullName": "Collin Heath", "className": "A 30+", "classPosition": 9},
               {"id": 4774782, "userId": 452791, "fullName": "Collin Heath", "className": "A 30+", "classPosition": 14}]
        with self.assertRaises(pipeline.EventImportError) as ctx:
            pipeline.result_rows(raw, EVENT, {452791: "r1"}, match)
        self.assertIn("Collin Heath", str(ctx.exception))
        self.assertIn("listed 2 times", str(ctx.exception))

    def test_empty_duplicate_is_dropped(self):
        raw = [{"id": 10, "userId": 5, "fullName": "Pat", "className": "A 30+", "sectionsCompleted": 12},
               {"id": 11, "userId": 5, "fullName": "Pat", "className": "A 30+", "sectionsCompleted": 0},
               {"id": 12, "userId": 6, "fullName": "Lee", "className": "A 30+", "sectionsCompleted": 12}]
        kept = pipeline.drop_ignored_and_empty_duplicates(raw, log=lambda *_: None)
        self.assertEqual([r["id"] for r in kept], [10, 12])

    def test_duplicate_with_scores_on_both_is_kept_for_a_person(self):
        raw = [{"id": 10, "userId": 5, "className": "A 30+", "sectionsCompleted": 12},
               {"id": 11, "userId": 5, "className": "A 30+", "sectionsCompleted": 9}]
        self.assertEqual(len(pipeline.drop_ignored_and_empty_duplicates(raw, log=lambda *_: None)), 2)

    def test_ignore_list(self):
        raw = [{"id": 4774782, "userId": 452791, "className": "A 30+"}]
        self.assertEqual(pipeline.drop_ignored_and_empty_duplicates(raw, log=lambda *_: None), [])

    def test_unmatched_class_stops_the_import(self):
        match = pipeline.build_class_matcher([cls("aopen", "A Open", "A")], EVENT_ROW, SERIES)
        with self.assertRaises(pipeline.EventImportError) as ctx:
            pipeline.result_rows([{"id": 5, "userId": 9, "className": "Z Class", "fullName": "Z"}],
                                 EVENT, {9: "r9"}, match)
        self.assertIn("Z Class", str(ctx.exception))

    def test_results_follow_rider_by_user_id_not_list_order(self):
        match = pipeline.build_class_matcher([cls("aopen", "A Open", "A")], EVENT_ROW, SERIES)
        raw = [{"id": 1, "userId": 111, "className": "A Open"}, {"id": 2, "userId": 222, "className": "A Open"}]
        rows = pipeline.result_rows(raw, EVENT, {222: "rider-B", 111: "rider-A"}, match)
        self.assertEqual([r["rider_id"] for r in rows], ["rider-A", "rider-B"])
        self.assertNotIn("points", rows[0])  # re-import must not wipe points

    def test_status_from_standing(self):
        self.assertEqual(pipeline.result_status({"standing": "DNF", "isDisqualified": ""}),
                         {"dns": False, "dnf": True, "disqualified": False})
        self.assertTrue(pipeline.result_status({"standing": "Scored", "isDisqualified": True})["disqualified"])


class FakeStore:
    """In-memory database that enforces one result per (event, rider, class)."""
    dry_run = False

    def __init__(self, classes, results):
        self._classes, self.results, self.processed = classes, results, False

    def classes(self): return self._classes
    def divisions(self): return DIVS
    def series(self): return SERIES
    def riders_by_livelaps_id(self, ids): return {i: f"rider-{i}" for i in ids}
    def save_riders(self, rows): return {r["livelaps_id"]: f"rider-{r['livelaps_id']}" for r in rows}
    def event_results(self, event_id): return [dict(r) for r in self.results]

    def delete_results(self, ids):
        self.results = [r for r in self.results if r["id"] not in ids]
        return len(ids)

    def save_results(self, rows):
        for row in rows:
            existing = next((r for r in self.results if r["livelaps_result_id"] == row["livelaps_result_id"]), None)
            clash = next((r for r in self.results if r is not existing and
                          (r["event_id"], r["rider_id"], r["class_id"]) == (row["event_id"], row["rider_id"], row["class_id"])), None)
            if clash:
                raise AssertionError("duplicate (event, rider, class)")
            if existing:
                existing.update(row)
            else:
                self.results.append(dict(row, id=f"new-{row['livelaps_result_id']}", points=None, division_points=None))

    def save_points(self, proposed, existing):
        for p in proposed:
            next(r for r in self.results if r["id"] == p["id"])["points"] = p["points"]

    def mark_processed(self, event_id): self.processed = True


class FixesOldMixedUpRiders(unittest.TestCase):
    def test_swapped_riders_are_replaced_without_collisions(self):
        import tempfile
        raw = [{"id": 1, "userId": 111, "className": "A Open", "classPosition": 1, "overallPosition": 1, "standing": "Scored"},
               {"id": 2, "userId": 222, "className": "A Open", "classPosition": 2, "overallPosition": 2, "standing": "Scored"}]
        # The old n8n import saved these two with their riders swapped.
        old = [{"id": "o1", "event_id": EVENT, "rider_id": "rider-222", "class_id": "aopen", "livelaps_result_id": 1},
               {"id": "o2", "event_id": EVENT, "rider_id": "rider-111", "class_id": "aopen", "livelaps_result_id": 2}]
        store = FakeStore([cls("aopen", "A Open", "A")], old)
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump(raw, f)
        try:
            pipeline.import_event(store, EVENT_ROW, log=lambda *_: None, results_file=f.name)
        finally:
            os.unlink(f.name)
        got = {r["livelaps_result_id"]: (r["rider_id"], r["points"]) for r in store.results}
        self.assertEqual(got, {1: ("rider-111", 36), 2: ("rider-222", 30)})
        self.assertTrue(store.processed)


SAMPLE = os.environ.get("RMEC_SAMPLE_RESULTS")


@unittest.skipUnless(SAMPLE and os.path.exists(SAMPLE), "set RMEC_SAMPLE_RESULTS to a saved LiveLaps JSON file")
class RealHaystackSample(unittest.TestCase):
    """Runs the real 180-result Haystack sample through matching and scoring with stand-in classes."""

    def test_full_event(self):
        raw = livelaps.load_results_file(SAMPLE)
        names = sorted({r["className"] for r in raw})
        classes = []
        for i, n in enumerate(names):
            if n == "16 or Under":
                classes.append(cls(f"c{i}", n, series=JUNIOR))
            elif n == "Electric Open":
                classes.append(cls(f"c{i}", "E-Bike", "D"))
            elif n.startswith("AA") or n.startswith("A "):
                classes.append(cls(f"c{i}", n, "A"))
            elif n.startswith("B "):
                classes.append(cls(f"c{i}", n, "B"))
            elif n.startswith("C "):
                classes.append(cls(f"c{i}", n, "C"))
            else:
                classes.append(cls(f"c{i}", n, "D"))
        riders = {r["livelaps_id"]: f"rider-{r['livelaps_id']}" for r in pipeline.rider_rows(raw)}
        rows = pipeline.result_rows(raw, EVENT, riders, pipeline.build_class_matcher(classes, EVENT_ROW, SERIES))
        for i, r in enumerate(rows):
            r["id"] = f"r{i}"
        out = scoring.calculate(EVENT, rows, EVENT_ROW, classes, DIVS, SERIES)
        self.assertTrue(out["valid"], out["errors"][:5])
        self.assertEqual(len(out["proposed"]), len(raw))
        self.assertEqual(len(out["winners"]), 3)
        self.assertEqual(sorted(p["points"] for p in out["proposed"]).count(36), 3)


if __name__ == "__main__":
    unittest.main()


class ClassMapSheet(unittest.TestCase):
    def test_load_and_skip(self):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, newline="") as f:
            f.write("livelaps_class,rmec_class,suggested,riders,first_seen_at\n"
                    "Novice C 250,C 250,C 250,8,x\nVintage,SKIP,,2,x\nMaster 40,,,7,x\n")
        try:
            got = pipeline.load_class_map(f.name)
        finally:
            os.unlink(f.name)
        self.assertEqual(got, {"novice c 250": "c 250", "vintage": pipeline.SKIP})

    def test_suggestions(self):
        names = ["AA", "A Open", "B 30+", "C 250", "C 60+", "C Open", "A Ladies"]
        self.assertEqual(pipeline.suggest_class("Pro AA", names), "AA")
        self.assertEqual(pipeline.suggest_class("Over 60+ C", names), "C 60+")
        self.assertEqual(pipeline.suggest_class("C <251", names), "C 250")
        self.assertEqual(pipeline.suggest_class("Vintage", names), "")


class MergedClasses(unittest.TestCase):
    def test_rerank_by_overall(self):
        raw = [{"className": "16 - Under Large Wheel"}, {"className": "16 - Under Large Wheel"},
               {"className": "Super Short -16"}, {"className": "Super Short -16"}]
        rows = [{"class_id": "u16", "position": 1, "overall_position": 10, "dns": False, "dnf": False, "disqualified": False},
                {"class_id": "u16", "position": 2, "overall_position": 30, "dns": False, "dnf": False, "disqualified": False},
                {"class_id": "u16", "position": 1, "overall_position": 20, "dns": False, "dnf": False, "disqualified": False},
                {"class_id": "u16", "position": 2, "overall_position": None, "dns": False, "dnf": True, "disqualified": False}]
        pipeline.rerank_merged_classes(raw, rows, log=lambda *_: None)
        self.assertEqual([r["position"] for r in rows], [1, 3, 2, None])
