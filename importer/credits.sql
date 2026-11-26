-- Worker points, eligibility and sportsman-point credits (RMEC rulebook sections 5, 6 and 9).
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- One row per credit from the "WP & Eligibility" form. The points for a worker credit are NOT
-- stored: the website works them out from the rider's results (the average of their best 3,
-- rounded, once they have raced 4 events). No emails or phone numbers are kept here; the
-- importer uses them only to match riders and then drops them.

create table if not exists rider_credits (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  rider_id uuid not null references riders(id) on delete cascade,
  kind text not null check (kind in ('worker_points', 'eligibility', 'sportsman')),
  event_label text,                     -- event named on the form, e.g. "Shady Burro"
  event_id uuid references events(id) on delete set null,   -- first day of that event, when found
  approved boolean,                     -- "Approved by promoter": true / false / null (blank)
  class_text text,                      -- the class the rider typed on the form
  submitted_on date,
  note text,
  source_key text not null unique,      -- kind|rider|event, so a re-import never duplicates
  created_at timestamptz not null default now()
);

create index if not exists rider_credits_season_idx on rider_credits (season_id);
create index if not exists rider_credits_rider_idx on rider_credits (rider_id);

-- Only the importer (secret key) writes or reads the table directly.
alter table rider_credits enable row level security;

-- What the public website may read: no notes or form text.
create or replace view public_rider_credits as
  select id, season_id, rider_id, kind, event_label, event_id
  from rider_credits;

grant select on public_rider_credits to anon, authenticated;

-- Moving a rider's results with importer.merge_riders should move their credits too;
-- merge_riders handles that, so nothing else is needed here.
