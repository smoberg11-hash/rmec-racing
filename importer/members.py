"""Membership CSV import (replaces the n8n membership form workflow).

  python3 -m importer.members "LiveLaps - Promoter Reports.csv"          # dry run
  python3 -m importer.members "LiveLaps - Promoter Reports.csv" --apply  # save

Rules (same as the n8n workflow, minus its rough edges):
* Riders are matched on first AND last name (ignoring case and extra spaces).
  Nobody is ever created from the CSV; members who haven't raced yet are listed.
* If two riders share a name, that member is skipped and listed so you can
  fix it by hand, instead of updating the wrong person.
* Rows from other organizations (when the CSV has an "Organization Name"
  column) and expired memberships are skipped and listed. Unlike n8n, one bad
  row doesn't stop the whole upload.
* Matched riders get is_member = true, membership_number, membership_expiration.
* Riders still marked as members whose expiration date has passed are switched
  to is_member = false.
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from datetime import date, datetime

from .__main__ import load_env
from .supabase_client import Supabase, SupabaseError

FIRST = ("First Name",)
LAST = ("Last Name",)
NUMBER = ("Membership Number", "Number")
EXPIRES = ("Expiration Date",)
ORG = ("Organization Name",)


def _norm(s) -> str:
    return re.sub(r"\s+", " ", str(s or "").strip()).lower()


def _col(row: dict, names) -> str:
    for n in names:
        if n in row and row[n] is not None:
            return str(row[n]).strip()
    return ""


def parse_date(text: str):
    text = (text or "").strip()
    if not text:
        return None
    first_part = text.split(" ")[0].split("T")[0]
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(first_part, fmt).date()
        except ValueError:
            continue
    return None


def default_expiration(path: str):
    """A list with no expiration dates (e.g. "2026 RMEC Membership.csv") counts as members
    through Dec 31 of the year in the file name."""
    m = re.search(r"(20\d\d)", os.path.basename(path))
    return date(int(m.group(1)), 12, 31) if m else None


def read_members(path: str, today: date | None = None, expires_default: date | None = None):
    """Returns (members, skipped). members: dicts with first, last, number, expires."""
    today = today or date.today()
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    if rows and not (any(c in rows[0] for c in FIRST) and any(c in rows[0] for c in LAST)):
        raise ValueError(f"{os.path.basename(path)} has no 'First Name' / 'Last Name' columns.")

    members: dict = {}
    skipped = []
    for i, row in enumerate(rows, start=2):
        first, last = _col(row, FIRST), _col(row, LAST)
        label = f"line {i}: {first} {last}".strip()
        if not first or not last:
            skipped.append((label, "missing first or last name"))
            continue
        org = _col(row, ORG)
        if any(c in row for c in ORG) and "rmec" not in org.lower():
            skipped.append((label, f"not an RMEC membership ({org or 'blank'})"))
            continue
        expires = parse_date(_col(row, EXPIRES)) or (expires_default if not any(c in row for c in EXPIRES) or not _col(row, EXPIRES) else None)
        if not expires:
            skipped.append((label, f"missing or unreadable expiration date ({_col(row, EXPIRES)!r})"))
            continue
        if expires < today:
            skipped.append((label, f"membership expired {expires.isoformat()}"))
            continue
        key = (_norm(first), _norm(last))
        m = {"first": first, "last": last, "number": _col(row, NUMBER) or None, "expires": expires, "line": i}
        # The same person listed twice (e.g. renewed): keep the latest expiration.
        if key not in members or members[key]["expires"] < expires:
            members[key] = m
    return list(members.values()), skipped


def plan(members, riders, today: date | None = None, aliases: dict | None = None):
    """Work out the updates. Returns (updates, problems, expirations).
    aliases: {normalized name on the list: rider id or normalized rider name} from
    importer/rider_aliases.csv, for people whose race entries use a different name."""
    today = today or date.today()
    aliases = aliases or {}
    by_name: dict = {}
    by_full: dict = {}
    by_id = {r["id"]: r for r in riders}
    for r in riders:
        by_name.setdefault((_norm(r.get("first_name")), _norm(r.get("last_name"))), []).append(r)
        by_full.setdefault(_norm(r.get("full_name")), []).append(r)

    updates, problems, matched_ids = [], [], set()
    for m in members:
        found = by_name.get((_norm(m["first"]), _norm(m["last"])), [])
        alias = aliases.get(_norm(f"{m['first']} {m['last']}"))
        if alias:
            found = [by_id[alias]] if alias in by_id else by_full.get(alias, [])
        name = f"{m['first']} {m['last']}"
        if not found:
            problems.append((name, "no rider with this name has raced yet (not created; if they raced under a "
                                   "different name, add it to importer/rider_aliases.csv)"))
            continue
        if len(found) > 1:
            problems.append((name, f"{len(found)} riders share this name; update the right one by hand"))
            continue
        r = found[0]
        matched_ids.add(r["id"])
        values = {"is_member": True, "membership_expiration": m["expires"].isoformat()}
        if m["number"]:  # lists without membership numbers leave the existing number alone
            values["membership_number"] = m["number"]
        current = {"is_member": r.get("is_member") is True, "membership_number": r.get("membership_number"),
                   "membership_expiration": str(r.get("membership_expiration") or "")[:10] or None}
        current = {k: current[k] for k in values}
        if current != values:
            updates.append((r["id"], name, values))

    expirations = []
    for r in riders:
        exp = parse_date(str(r.get("membership_expiration") or ""))
        if r.get("is_member") is True and r["id"] not in matched_ids and exp and exp < today:
            expirations.append((r["id"], r.get("full_name") or f"{r.get('first_name')} {r.get('last_name')}", exp))
    return updates, problems, expirations


def main(argv=None):
    ap = argparse.ArgumentParser(prog="python3 -m importer.members", description="Update rider memberships from a CSV.")
    ap.add_argument("csv", help="membership CSV exported from LiveLaps")
    ap.add_argument("--apply", action="store_true", help="save changes (default is a dry run)")
    ap.add_argument("--expires", help="expiration date (YYYY-MM-DD) for lists without one; "
                                      "default: Dec 31 of the year in the file name")
    args = ap.parse_args(argv)

    here = os.path.dirname(os.path.abspath(__file__))
    load_env(os.path.join(here, ".env"))
    load_env(os.path.join(os.path.dirname(here), ".env.local"))

    try:
        default = parse_date(args.expires) if args.expires else default_expiration(args.csv)
        members, skipped = read_members(args.csv, expires_default=default)
        db = Supabase(os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL", ""),
                      os.environ.get("SUPABASE_SECRET_KEY", ""))
        riders = db.select("riders", {
            "select": "id,first_name,last_name,full_name,is_member,membership_number,membership_expiration"})
    except (ValueError, OSError, SupabaseError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 2

    from .pipeline import load_rider_aliases
    updates, problems, expirations = plan(members, riders, aliases=load_rider_aliases())

    print("MODE:", "APPLY — changes will be saved" if args.apply else "DRY RUN — nothing will be saved")
    print(f"{len(members)} current RMEC members in the CSV; {len(skipped)} rows skipped.")
    for label, why in skipped:
        print(f"  skipped {label} — {why}")
    if default:
        print(f"Rows without an expiration date count as members until {default.isoformat()}.")
    print(f"\n{len(updates)} riders to update ({len(members) - len(updates) - len(problems)} already up to date).")
    for _, name, v in updates:
        number = f" #{v['membership_number']}" if v.get("membership_number") else ""
        print(f"  {name}: member{number} until {v['membership_expiration']}")
    if problems:
        print(f"\n{len(problems)} members not matched:")
        for name, why in problems:
            print(f"  {name} — {why}")
    if expirations:
        print(f"\n{len(expirations)} riders' memberships have expired and will be set to non-member:")
        for _, name, exp in expirations:
            print(f"  {name} (expired {exp.isoformat()})")

    if not args.apply:
        print("\nDry run: nothing was written. Add --apply to save.")
        return 0
    try:
        # Riders getting identical values are saved together, 100 per request.
        groups: dict = {}
        for rid, _, values in updates:
            groups.setdefault(tuple(sorted(values.items())), []).append(rid)
        groups[(("is_member", False),)] = groups.get((("is_member", False),), []) + [rid for rid, _, _ in expirations]
        total = sum(len(ids) for ids in groups.values())
        done = 0
        for values, ids in groups.items():
            for i in range(0, len(ids), 100):
                chunk = ids[i:i + 100]
                db.update("riders", {"id": f"in.({','.join(chunk)})"}, dict(values))
                done += len(chunk)
                print(f"  saved {done}/{total}", flush=True)
    except SupabaseError as e:
        print(f"Error while saving: {e}", file=sys.stderr)
        return 1
    print(f"\nSaved: {len(updates)} updated, {len(expirations)} set to non-member.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
