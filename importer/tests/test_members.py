import csv
import os
import tempfile
import unittest
from datetime import date

from importer import members

TODAY = date(2026, 6, 1)


def write_csv(rows, header):
    f = tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, newline="")
    w = csv.DictWriter(f, fieldnames=header)
    w.writeheader()
    w.writerows(rows)
    f.close()
    return f.name


PROMOTER = ["First Name", "Last Name", "Email", "Date Registered", "Organization Name", "Membership Number", "Expiration Date"]


class ReadMembers(unittest.TestCase):
    def test_promoter_report(self):
        path = write_csv([
            {"First Name": "Adam", "Last Name": "Griffith", "Organization Name": "A - RMEC (Rocky Mountain Enduro Circuit)",
             "Membership Number": "2373", "Expiration Date": "2026-12-31"},
            {"First Name": "Adam", "Last Name": "Griffith", "Organization Name": "A - RMEC (Rocky Mountain Enduro Circuit)",
             "Membership Number": "2373", "Expiration Date": "2026-12-31"},
            {"First Name": "Old", "Last Name": "Timer", "Organization Name": "A - RMEC (Rocky Mountain Enduro Circuit)",
             "Membership Number": "1", "Expiration Date": "2025-12-31"},
            {"First Name": "Other", "Last Name": "Club", "Organization Name": "Some Other Club",
             "Membership Number": "9", "Expiration Date": "2026-12-31"},
        ], PROMOTER)
        try:
            got, skipped = members.read_members(path, TODAY)
        finally:
            os.unlink(path)
        self.assertEqual([(m["first"], m["number"]) for m in got], [("Adam", "2373")])
        reasons = " ".join(why for _, why in skipped)
        self.assertIn("expired", reasons)
        self.assertIn("not an RMEC", reasons)

    def test_older_format_without_org_column(self):
        path = write_csv([{"First Name": "Nathan", "Last Name": "Beal", "Number": "2204",
                           "Expiration Date": "2026-12-30"}],
                         ["First Name", "Last Name", "Number", "Expiration Date"])
        try:
            got, _ = members.read_members(path, TODAY)
        finally:
            os.unlink(path)
        self.assertEqual(got[0]["number"], "2204")

    def test_dates(self):
        self.assertEqual(members.parse_date("2026-12-31"), date(2026, 12, 31))
        self.assertEqual(members.parse_date("12/31/2026"), date(2026, 12, 31))
        self.assertEqual(members.parse_date("2026-02-01 14:17:43.9401"), date(2026, 2, 1))
        self.assertIsNone(members.parse_date("soon"))


class Plan(unittest.TestCase):
    def test_matching(self):
        csv_members = [
            {"first": "adam ", "last": "GRIFFITH", "number": "2373", "expires": date(2026, 12, 31)},
            {"first": "Sam", "last": "Smith", "number": "5", "expires": date(2026, 12, 31)},
            {"first": "New", "last": "Person", "number": "6", "expires": date(2026, 12, 31)},
        ]
        riders = [
            {"id": "r1", "first_name": "Adam", "last_name": "Griffith", "is_member": False},
            {"id": "r2", "first_name": "Sam", "last_name": "Smith"},
            {"id": "r3", "first_name": "Sam", "last_name": "Smith"},
            {"id": "r4", "first_name": "Lapsed", "last_name": "Rider", "is_member": True,
             "membership_expiration": "2025-12-31"},
        ]
        updates, problems, expirations = members.plan(csv_members, riders, TODAY)
        self.assertEqual([u[0] for u in updates], ["r1"])
        self.assertEqual(updates[0][2]["membership_expiration"], "2026-12-31")
        self.assertEqual(len(problems), 2)  # two Sam Smiths, and New Person hasn't raced
        self.assertEqual([e[0] for e in expirations], ["r4"])


if __name__ == "__main__":
    unittest.main()


class ListWithoutDates(unittest.TestCase):
    def test_name_only_list_uses_year_from_file_name(self):
        import tempfile
        folder = tempfile.mkdtemp()
        path = os.path.join(folder, "2026 RMEC Membership.csv")
        with open(path, "w", newline="", encoding="utf-8-sig") as f:
            f.write("Last Name,First Name,Email,\nSauerbrey,Aaron,a@example.com,Aaron Sauerbrey\n")
        try:
            default = members.default_expiration(path)
            got, skipped = members.read_members(path, TODAY, expires_default=default)
        finally:
            os.unlink(path)
            os.rmdir(folder)
        self.assertEqual(default, date(2026, 12, 31))
        self.assertEqual([(m["first"], m["last"], m["expires"]) for m in got], [("Aaron", "Sauerbrey", date(2026, 12, 31))])
        self.assertEqual(skipped, [])

    def test_existing_number_kept_when_list_has_none(self):
        updates, _, _ = members.plan(
            [{"first": "Aaron", "last": "Sauerbrey", "number": None, "expires": date(2026, 12, 31)}],
            [{"id": "r1", "first_name": "Aaron", "last_name": "Sauerbrey", "is_member": False, "membership_number": "77"}],
            TODAY)
        self.assertEqual(updates[0][2], {"is_member": True, "membership_expiration": "2026-12-31"})


class MembershipAliases(unittest.TestCase):
    def test_alias_links_nickname(self):
        updates, problems, _ = members.plan(
            [{"first": "Sammy", "last": "Moberg", "number": None, "expires": date(2026, 12, 31)}],
            [{"id": "r9", "first_name": "Samuel", "last_name": "Moberg", "full_name": "Samuel Moberg"}],
            TODAY, aliases={"sammy moberg": "samuel moberg"})
        self.assertEqual([u[0] for u in updates], ["r9"])
        self.assertEqual(problems, [])
