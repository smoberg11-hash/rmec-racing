-- Worker points / eligibility requests from the website form (/worker-points).
-- Run once in the Supabase SQL Editor, AFTER importer/credits.sql. Safe to re-run.
--
-- How it works:
--   1. The form calls submit_credit_request(...). It saves a row in credit_requests with
--      status 'pending'. The website only has the public key; this function is the one
--      thing it can do here, and nobody can read the table from the website.
--   2. To approve: open credit_requests in the Table Editor, check rider_id (set it if the
--      rider wasn't matched), and change status to 'approved'. The trigger below adds the
--      credit to rider_credits right away. Changing it back (or to 'rejected') removes it.

-- Credits now say where they came from, so the CSV import only replaces its own rows.
alter table rider_credits add column if not exists source text not null default 'csv';

create table if not exists credit_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  season_id uuid references seasons(id) on delete cascade,
  rider_id uuid references riders(id) on delete set null,   -- picked on the form, or set by you
  first_name text not null,
  last_name text not null,
  email text not null,                                       -- private: never shown on the site
  phone text,                                                -- private
  class_text text,
  event_id uuid references events(id) on delete set null,
  event_label text,
  kind text not null check (kind in ('worker_points', 'eligibility')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  note text
);

create index if not exists credit_requests_status_idx on credit_requests (status, created_at desc);

-- No policies: the public key can't read or change this table directly.
alter table credit_requests enable row level security;

create or replace function submit_credit_request(
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_class_text text,
  p_event_id uuid,
  p_kind text,
  p_rider_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_season uuid;
  v_label text;
  v_rider uuid;
begin
  p_first_name := btrim(coalesce(p_first_name, ''));
  p_last_name := btrim(coalesce(p_last_name, ''));
  p_email := lower(btrim(coalesce(p_email, '')));
  if p_first_name = '' or p_last_name = '' or length(p_first_name) > 60 or length(p_last_name) > 60 then
    raise exception 'Please enter your first and last name.';
  end if;
  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(p_email) > 200 then
    raise exception 'Please enter a valid email address.';
  end if;
  if p_kind not in ('worker_points', 'eligibility') then
    raise exception 'Please choose Worker Points or Eligibility.';
  end if;
  if length(coalesce(p_phone, '')) > 30 or length(coalesce(p_class_text, '')) > 80 then
    raise exception 'Please shorten the phone number or class.';
  end if;
  -- A light brake on repeated submissions.
  if (select count(*) from credit_requests
      where email = p_email and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many requests from this email. Please try again later.';
  end if;

  if p_event_id is not null then
    select season_id, name into v_season, v_label from events where id = p_event_id;
    if not found then
      raise exception 'Please choose an event from the list.';
    end if;
  else
    select id into v_season from seasons order by year desc limit 1;
  end if;

  if p_rider_id is not null and exists (select 1 from riders where id = p_rider_id) then
    v_rider := p_rider_id;
  end if;

  insert into credit_requests (season_id, rider_id, first_name, last_name, email, phone, class_text,
                               event_id, event_label, kind)
  values (v_season, v_rider, p_first_name, p_last_name, p_email, nullif(btrim(coalesce(p_phone, '')), ''),
          nullif(btrim(coalesce(p_class_text, '')), ''), p_event_id, v_label, p_kind)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function submit_credit_request(text, text, text, text, text, uuid, text, uuid) from public;
grant execute on function submit_credit_request(text, text, text, text, text, uuid, text, uuid) to anon, authenticated;

-- Approving a request adds its credit; un-approving removes it.
create or replace function credit_request_to_credit() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved' and new.rider_id is not null and new.season_id is not null then
    insert into rider_credits (season_id, rider_id, kind, event_label, event_id, approved,
                               class_text, submitted_on, note, source, source_key)
    values (new.season_id, new.rider_id, new.kind, lower(new.event_label), new.event_id, true,
            new.class_text, new.created_at::date, 'website form', 'website', 'web|' || new.id)
    on conflict (source_key) do update
      set rider_id = excluded.rider_id, kind = excluded.kind, event_label = excluded.event_label,
          event_id = excluded.event_id, season_id = excluded.season_id;
  else
    delete from rider_credits where source_key = 'web|' || new.id;
  end if;
  if new.status <> 'pending' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.reviewed_at := now();
  end if;
  return new;
end;
$$;

-- Deleting a request removes its credit too.
create or replace function credit_request_removed() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from rider_credits where source_key = 'web|' || old.id;
  return old;
end;
$$;

drop trigger if exists credit_request_removed on credit_requests;
create trigger credit_request_removed
  after delete on credit_requests
  for each row execute function credit_request_removed();

drop trigger if exists credit_request_to_credit on credit_requests;
create trigger credit_request_to_credit
  before insert or update on credit_requests
  for each row execute function credit_request_to_credit();
