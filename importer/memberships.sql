-- Online memberships from the website's Join page (/join). Run once in the Supabase SQL Editor.
-- Safe to re-run. Nothing here is used until MEMBERSHIP_PROVIDER is set to stripe or square in Vercel;
-- LiveLaps memberships keep coming in through the membership CSV import either way.
--
-- Flow: Join form -> start_membership_application() saves the person as 'pending' ->
--       the site sends them to Stripe/Square -> the provider's webhook calls
--       record_membership_payment() -> the application becomes 'paid' and, when it's linked
--       to a rider, that rider becomes a member until Dec 31.
--
-- The website only has the public key. The two "server" functions below also need a shared
-- secret token, so only the site's own server (which knows the token) can mark payments.
-- To set the token, run once with your own long random value, and put the SAME value in
-- Vercel as PAYMENTS_TOKEN:
--   insert into app_settings (key, value) values ('payments_token', 'paste-a-long-random-string')
--   on conflict (key) do update set value = excluded.value;

create table if not exists app_settings (
  key text primary key,
  value text not null
);
alter table app_settings enable row level security;  -- no policies: never readable from the website

create table if not exists membership_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  season_year integer not null,
  plan text not null,
  price_cents integer not null,
  rider_id uuid references riders(id) on delete set null,   -- picked on the form, or set by you
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text,
  birth_date date,
  city text,
  state text,
  emergency_contact text,
  agreed_to_terms boolean not null default false,
  provider text,                    -- stripe / square
  provider_reference text,          -- Stripe checkout session id / Square order id
  provider_payment_id text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  paid_at timestamptz
);
create index if not exists membership_applications_ref_idx on membership_applications (provider_reference);
alter table membership_applications enable row level security;  -- private: no policies

create or replace function start_membership_application(
  p_season_year integer, p_plan text, p_price_cents integer, p_rider_id uuid,
  p_first_name text, p_last_name text, p_email text, p_phone text, p_birth_date date,
  p_city text, p_state text, p_emergency_contact text, p_agreed boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if btrim(coalesce(p_first_name, '')) = '' or btrim(coalesce(p_last_name, '')) = '' then
    raise exception 'Please enter your first and last name.';
  end if;
  if lower(btrim(coalesce(p_email, ''))) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter a valid email address.';
  end if;
  if not coalesce(p_agreed, false) then
    raise exception 'Please agree to the membership terms.';
  end if;
  if p_price_cents is null or p_price_cents <= 0 then
    raise exception 'Please choose a membership.';
  end if;
  if (select count(*) from membership_applications
      where email = lower(btrim(p_email)) and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many tries from this email. Please try again later.';
  end if;
  insert into membership_applications (season_year, plan, price_cents, rider_id, first_name, last_name, email,
                                       phone, birth_date, city, state, emergency_contact, agreed_to_terms)
  values (p_season_year, p_plan, p_price_cents,
          (select id from riders where id = p_rider_id),
          btrim(p_first_name), btrim(p_last_name), lower(btrim(p_email)), nullif(btrim(coalesce(p_phone, '')), ''),
          p_birth_date, nullif(btrim(coalesce(p_city, '')), ''), nullif(btrim(coalesce(p_state, '')), ''),
          nullif(btrim(coalesce(p_emergency_contact, '')), ''), true)
  returning id into v_id;
  return v_id;
end $$;

create or replace function _payments_token_ok(p_token text) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (select 1 from app_settings where key = 'payments_token' and value = p_token and length(value) >= 24);
$$;

-- The site's server calls this right after creating the checkout, to remember the provider's reference.
create or replace function attach_membership_checkout(p_id uuid, p_provider text, p_reference text, p_token text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not _payments_token_ok(p_token) then raise exception 'Not allowed.'; end if;
  update membership_applications set provider = p_provider, provider_reference = p_reference
  where id = p_id and status = 'pending';
end $$;

-- The payment webhook calls this. Marks the application paid and makes the rider a member.
create or replace function record_membership_payment(p_id uuid, p_reference text, p_payment_id text, p_token text)
returns void language plpgsql security definer set search_path = public as $$
declare a membership_applications;
begin
  if not _payments_token_ok(p_token) then raise exception 'Not allowed.'; end if;
  select * into a from membership_applications
  where (p_id is not null and id = p_id) or (p_reference is not null and provider_reference = p_reference)
  limit 1;
  if not found or a.status = 'paid' then return; end if;   -- unknown, or already handled (webhooks repeat)
  update membership_applications set status = 'paid', paid_at = now(), provider_payment_id = p_payment_id
  where id = a.id;
  if a.rider_id is not null then
    update riders set is_member = true,
                      membership_expiration = greatest(coalesce(membership_expiration, make_date(a.season_year, 12, 31)),
                                                       make_date(a.season_year, 12, 31))
    where id = a.rider_id;
  end if;
end $$;

revoke all on function start_membership_application(integer, text, integer, uuid, text, text, text, text, date, text, text, text, boolean) from public;
revoke all on function attach_membership_checkout(uuid, text, text, text) from public;
revoke all on function record_membership_payment(uuid, text, text, text) from public;
revoke all on function _payments_token_ok(text) from public;
grant execute on function start_membership_application(integer, text, integer, uuid, text, text, text, text, date, text, text, text, boolean) to anon, authenticated;
grant execute on function attach_membership_checkout(uuid, text, text, text) to anon, authenticated;
grant execute on function record_membership_payment(uuid, text, text, text) to anon, authenticated;
-- Paid applications without a rider_id (people who haven't raced yet): set rider_id in the
-- Table Editor once they have a rider profile, then mark them a member in riders.
