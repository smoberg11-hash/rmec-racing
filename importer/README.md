# RMEC race importer

Replaces the n8n race-import and "Calculate Race Points" workflows. For each event that has finished, has a LiveLaps `results_url` and isn't `processed`, it:

1. Downloads the results from the LiveLaps API.
2. Adds new riders and updates existing ones in one request, matched by LiveLaps user id (`riders.livelaps_id`).
3. Matches each result to its rider and class by id (never by list order) and saves it. Re-running updates the same rows, keyed on `livelaps_result_id`, and doesn't wipe points.
4. Calculates class and division points (same rules as the old n8n workflow; see `scoring.py`).
5. Marks the event `processed`, but only if every step worked.

If anything looks wrong (a class it can't match, tied positions, a DNF ranked ahead of a finisher), it stops for that event and says why. Nothing is marked processed.

## Membership CSV
```bash
python3 -m importer.members "LiveLaps - Promoter Reports.csv"           # dry run
python3 -m importer.members "LiveLaps - Promoter Reports.csv" --apply   # save
```
It matches riders on first AND last name and never creates riders. Members who haven't raced yet, riders who share a name, other organizations and expired rows are all listed rather than guessed. It also switches riders whose membership has expired back to non-members. See `members.py`.

## One-time setup
1. Run `importer/setup.sql` in the Supabase SQL Editor (step 1, check the output, then step 2).
2. Copy `importer/.env.example` to `importer/.env` and paste in a new Supabase secret key.

## Running it (from the `rmec-racing` folder)
```bash
python3 -m importer                       # dry run: shows what it would do, saves nothing
python3 -m importer --report reports      # dry run + a points CSV per event to check
python3 -m importer --apply               # do it for real
python3 -m importer --event <uuid> --apply   # one event, even if already processed
python3 -m unittest discover -s importer/tests -t .   # run the tests
```
Needs Python 3.10+ and nothing else to install.

## A LiveLaps class name doesn't match
Promoters name classes differently ("Novice C 250", "Pro AA", ...). Run
```bash
python3 -m importer --find-classes
```
It adds every unmatched name to `importer/class_map.csv` with a suggestion. Open it (Numbers/Excel are fine, save as CSV) and fill in `rmec_class` with the RMEC class name, or `SKIP` for classes that don't count for RMEC points. Then run the import again.

## One race, several LiveLaps links
Some races (often Junior) split classes across several LiveLaps links. Put all of them in that event's `results_url` cell, separated by spaces, commas or new lines. The importer fetches each one and imports them as one race. A division's classes must all be in the same link, because places from different links can't be compared; if they're split, the importer stops and says so.

## Scheduling
`importer/import-results.yml` runs it weekly on GitHub Actions. Move it to `.github/workflows/import-results.yml` once the repo is on GitHub. Add two repository secrets, `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. You can also run it by hand from the Actions tab and choose an event or a dry run.
