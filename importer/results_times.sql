-- Race times on the results page. Run once in the Supabase SQL Editor, BEFORE the next import.
-- Safe to re-run.
alter table results add column if not exists total_time text;               -- e.g. 01:46:19.258 (LiveLaps / hare scrambles)
alter table results add column if not exists enduro_checks integer;         -- MotoTally enduros: checks reached
alter table results add column if not exists enduro_penalty_seconds integer; -- MotoTally enduros: penalty (Min*60 + Sec)
