"""Run with:  python3 -m unittest discover -s importer/tests -t .   (from the rmec-racing folder)"""

import csv
import os
import tempfile
import unittest

from importer import credits

RIDERS = [
    {"id": "jdb", "full_name": "James D Buck", "first_name": "James", "last_name": "Buck"},
    {"id": "jb2", "full_name": "James Buck 2nd", "first_name": "James", "last_name": "Buck"},
    {"id": "lp", "full_name": "Lauren Pearce", "first_name": "Lauren", "last_name": "Pearce", "email": "lolo@example.com"},
    {"id": "dn-aa", "full_name": "Dominic Nudy"}, {"id": "dn-b", "full_name": "Dominic Nudy"},
    {"id": "ms", "full_name": "Mike Smith"},
]
CLASSES = {"jdb": {"AA"}, "jb2": {"Sportsman"}, "lp": {"C Ladies"}, "dn-aa": {"AA"}, "dn-b": {"B 60+"}, "ms": {"A 50+"}}
EVENTS = [{"id": "sb1", "name": "Shady Burro Enduro Day 1", "race_date": "2026-07-18"},
          {"id": "sb2", "name": "Shady Burro Enduro Day 2", "race_date": "2026-07-19"},
          {"id": "bljr", "name": "BIG LAKE Jr ENDURO", "race_date": "2026-08-29"},
          {"id": "bl", "name": "Big Lake Enduro", "race_date": "2026-08-30"}]


def row(name, kind="Worker Points", event="Shady Burro", cls="", approved="1", email="", line=2):
    return {"line": line, "name": name, "email": email, "class_text": cls, "event": event,
            "kind_text": kind, "kind": credits._kind(kind), "approved": credits._approved(approved),
            "submitted_on": None}


class Matching(unittest.TestCase):
    def match(self, r, aliases=None):
        return credits.match_rider(r, RIDERS, aliases or {}, CLASSES)

    def test_class_on_the_form_picks_between_riders_with_the_same_name(self):
        self.assertEqual(self.match(row("James Buck", cls="AA"))[0]["id"], "jdb")
        self.assertEqual(self.match(row("James Buck", cls="Sportmen"))[0]["id"], "jb2")
        self.assertEqual(self.match(row("Dominic Nudy", cls="AA"))[0]["id"], "dn-aa")

    def test_no_class_and_two_riders_is_left_for_a_person(self):
        found, why = self.match(row("Dominic Nudy"))
        self.assertIsNone(found)
        self.assertIn("2 riders fit", why)

    def test_email_and_lower_case_names_match(self):
        self.assertEqual(self.match(row("Lolo Pearce", email="lolo@example.com"))[0]["id"], "lp")
        self.assertEqual(self.match(row("mike smith"))[0]["id"], "ms")

    def test_alias_wins_unless_the_class_clearly_fits_someone_else(self):
        aliases = {"james buck": "james d buck"}
        self.assertEqual(self.match(row("James Buck", cls="AA"), aliases)[0]["id"], "jdb")
        self.assertEqual(self.match(row("James Buck", cls="Sportmen"), aliases)[0]["id"], "jb2")

    def test_events(self):
        self.assertEqual(credits.match_event("Shady Burro", EVENTS)["id"], "sb1")
        self.assertEqual(credits.match_event("Monte Vista", EVENTS)["id"], "bl")  # Monte Vista is Big Lake, adult first
        self.assertIsNone(credits.match_event("", EVENTS))


class Plan(unittest.TestCase):
    def test_every_row_counts_and_duplicates_count_once(self):
        rows = [row("Mike Smith", line=2), row("Mike Smith", approved="0", line=3),
                row("Mike Smith", kind="Eligibility", line=4),
                row("Mike Smith", kind="", event="", approved="", line=5),
                row("Nobody Here", line=6)]
        out, problems = credits.plan(rows, RIDERS, EVENTS, {}, CLASSES, "s26")
        kinds = sorted((c["kind"], c["event_label"] or "") for c in out)
        self.assertEqual(kinds, [("eligibility", ""), ("eligibility", "shady burro"), ("worker_points", "shady burro")])
        wp = next(c for c in out if c["kind"] == "worker_points")
        self.assertEqual((wp["approved"], wp["_lines"], wp["event_id"]), (True, [2, 3], "sb1"))
        blank = next(c for c in out if not c["event_label"])
        self.assertIn("blank", blank["note"])
        self.assertEqual([p[0] for p in problems], ["line 6: Nobody Here (Worker Points, Shady Burro)"])
        # Nothing private is saved.
        saved_keys = {k for c in out for k in c if not k.startswith("_")}
        self.assertFalse({"email", "phone"} & saved_keys)

    def test_read_rows_skips_blank_names(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "2026 WP & Eligibility.csv")
            with open(path, "w", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                w.writerow([credits.DATE, credits.NAME, credits.EMAIL, "Phone Number", credits.CLASS,
                            credits.EVENT, credits.KIND, credits.APPROVED])
                w.writerow(["9-Nov-26", "Kenny Perkins", "k@example.com", "555", "70 c", "Shady Burro", "Eligibility", "1"])
                w.writerow(["", "", "", "", "", "", "", ""])
            rows, skipped = credits.read_rows(path)
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]["kind"], rows[0]["approved"], str(rows[0]["submitted_on"])),
                         ("eligibility", True, "2026-11-09"))
        self.assertEqual(len(skipped), 1)


if __name__ == "__main__":
    unittest.main()
