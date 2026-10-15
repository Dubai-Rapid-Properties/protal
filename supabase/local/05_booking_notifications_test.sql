-- ============================================================================
-- D|R|P PMS - Booking notifications (0018)
--
-- Runs after 02-04 and reuses their fixtures: unit 2807 (Marina Gate 1,
-- owner B = Sarah Whitfield, login owner.b; valid DET permit), the property
-- manager assigned to Marina Gate 1, and owner A (Ahmed), who does not own
-- 2807. Dates sit 90+ days out, clear of the earlier suites' stays and inside
-- the permit.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/05_booking_notifications_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

-- These suites check what the owner and office emails say, so they are
-- switched on here; 07 and 15 check the defaults (off).
update company_settings set email_owners_about_bookings = true, email_office_about_bookings = true where id;

create or replace function pg_temp.unit(num text) returns uuid
language sql as $$ select id from units where unit_number = num $$;

create or replace function pg_temp.n(who text, booking uuid) returns integer
language sql as $$
  select count(*)::int from notifications n join profiles p on p.id = n.recipient_id
   where p.email = who and n.booking_id = booking
$$;

-- ---------------------------------------------------------------------------
-- TEST 33 - a new booking notifies super admins, assigned staff and the
-- unit's owner, and queues the office and owner emails. Nobody else hears.
-- ---------------------------------------------------------------------------
do $$
declare
  b uuid;
  owner_body text;
  owner_mail text;
begin
  insert into bookings (booking_number, unit_id, channel, status, check_in, check_out, adults,
                        nightly_rate_aed, accommodation_aed, gross_total_aed)
  values ('', pg_temp.unit('2807'), 'direct', 'confirmed', current_date + 90, current_date + 93, 2,
          800, 2400, 2400)
  returning id into b;

  assert pg_temp.n('admin@drp.ae', b) = 1, 'super admin notified';
  assert pg_temp.n('pm@drp.ae', b) = 1, 'assigned property manager notified';
  assert pg_temp.n('owner.b@example.com', b) = 1, 'owner of the unit notified';
  assert pg_temp.n('owner.a@example.com', b) = 0, 'other owners not notified';
  assert pg_temp.n('tenant@example.com', b) = 0, 'tenants not notified';
  assert pg_temp.n('finance@drp.ae', b) = 0, 'unassigned staff not notified';

  select n.body into owner_body from notifications n join profiles p on p.id = n.recipient_id
   where p.email = 'owner.b@example.com' and n.booking_id = b;
  assert owner_body !~ 'AED|2400|800|DRP-BKG', 'owner text carries no money and no booking number: ' || owner_body;
  assert owner_body ~ '3 nights', 'owner text states the nights: ' || owner_body;

  assert (select count(*) from messages where booking_id = b and channel = 'email' and status = 'queued') = 2,
    'office + owner email queued';
  assert exists (select 1 from messages where booking_id = b and to_address = 'office@dubairapidproperties.com'),
    'office email queued';
  select body into owner_mail from messages where booking_id = b and to_address = 'owner.b@example.com';
  assert owner_mail = owner_body, 'owner email matches the owner notification';

  raise notice 'TEST 33  PASS  new booking: admin, assigned PM and owner B notified; office + owner emailed; owner text has no money';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 34 - moved dates and a cancellation are announced; a check-in is not.
-- ---------------------------------------------------------------------------
do $$
declare
  b uuid := (select id from bookings where unit_id = pg_temp.unit('2807')
              and check_in = current_date + 90 and channel = 'direct');
begin
  update bookings set check_out = current_date + 94 where id = b;
  assert exists (select 1 from notifications where booking_id = b and kind = 'booking_changed'),
    'date change announced';

  update bookings set status = 'checked_in' where id = b;
  update bookings set status = 'confirmed' where id = b;
  assert (select count(*) from notifications where booking_id = b and kind = 'booking_new') = 3,
    'status moves inside a live stay are not announced';

  update bookings set status = 'cancelled', cancelled_on = current_date where id = b;
  assert (select count(*) from notifications where booking_id = b and kind = 'booking_cancelled') = 3,
    'cancellation announced to the same three people';
  raise notice 'TEST 34  PASS  date change and cancellation announced; check-in not';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 35 - no noise: past stays and the first read of a new Airbnb link.
-- ---------------------------------------------------------------------------
do $$
declare
  b uuid;
  before_count integer := (select count(*) from notifications);
begin
  -- A stay already over (as when history is entered by hand).
  insert into bookings (booking_number, unit_id, channel, status, check_in, check_out, adults)
  values ('', pg_temp.unit('2807'), 'direct', 'checked_out', current_date - 20, current_date - 17, 1);
  -- Enquiries do not hold dates and are not bookings yet.
  insert into bookings (booking_number, unit_id, channel, status, check_in, check_out, adults)
  values ('', pg_temp.unit('2807'), 'direct', 'inquiry', current_date + 100, current_date + 102, 1)
  returning id into b;
  assert (select count(*) from notifications) = before_count, 'past stay and enquiry not announced';

  -- ...until it is confirmed.
  update bookings set status = 'confirmed' where id = b;
  assert pg_temp.n('owner.b@example.com', b) = 1, 'confirmed enquiry announced';

  -- First sync of a freshly linked calendar: everything it imports is old news.
  update units set ical_last_synced_at = null where id = pg_temp.unit('2807');
  before_count := (select count(*) from notifications);
  insert into bookings (booking_number, unit_id, channel, status, check_in, check_out, adults, ical_uid)
  values ('', pg_temp.unit('2807'), 'airbnb', 'confirmed', current_date + 105, current_date + 108, 1, 'first-sync@airbnb.com');
  assert (select count(*) from notifications) = before_count, 'first-sync import not announced';

  -- From the next sync on, a new Airbnb reservation is announced, flagged as unpriced for staff.
  update units set ical_last_synced_at = now() where id = pg_temp.unit('2807');
  insert into bookings (booking_number, unit_id, channel, status, check_in, check_out, adults, ical_uid, external_booking_id)
  values ('', pg_temp.unit('2807'), 'airbnb', 'confirmed', current_date + 110, current_date + 112, 1, 'later@airbnb.com', 'HMTEST0001')
  returning id into b;
  assert pg_temp.n('owner.b@example.com', b) = 1, 'later Airbnb import announced to the owner';
  assert (select body from notifications n join profiles p on p.id = n.recipient_id
           where p.email = 'admin@drp.ae' and n.booking_id = b) ~ 'Price not entered yet',
    'staff told the Airbnb stay has no price yet';
  assert (select body from notifications n join profiles p on p.id = n.recipient_id
           where p.email = 'owner.b@example.com' and n.booking_id = b) ~ 'via Airbnb',
    'owner told the channel';
  raise notice 'TEST 35  PASS  past stays, enquiries and the first Airbnb sync stay quiet; later imports announced';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 36 - the guest's first name reaches owners only when settings allow.
-- ---------------------------------------------------------------------------
do $$
declare
  g uuid;
  b uuid;
begin
  insert into guests (full_name) values ('Maria Lopez Garcia') returning id into g;

  insert into bookings (booking_number, unit_id, guest_id, channel, status, check_in, check_out, adults)
  values ('', pg_temp.unit('2807'), g, 'direct', 'confirmed', current_date + 114, current_date + 116, 2)
  returning id into b;
  assert (select body from notifications n join profiles p on p.id = n.recipient_id
           where p.email = 'owner.b@example.com' and n.booking_id = b) !~ 'Maria',
    'no guest name by default';

  update company_settings set show_guest_first_name_to_owners = true where id;
  insert into bookings (booking_number, unit_id, guest_id, channel, status, check_in, check_out, adults)
  values ('', pg_temp.unit('2807'), g, 'direct', 'confirmed', current_date + 117, current_date + 119, 2)
  returning id into b;
  assert (select body from notifications n join profiles p on p.id = n.recipient_id
           where p.email = 'owner.b@example.com' and n.booking_id = b) ~ 'Guest: Maria\.',
    'first name only, with the setting on';
  update company_settings set show_guest_first_name_to_owners = false where id;
  raise notice 'TEST 36  PASS  guest first name shown to owners only when the setting is on, never the surname';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 37 - RLS: people see and mark read only their own notifications, and
-- cannot write them.
-- ---------------------------------------------------------------------------
do $$
declare
  mine integer;
  others integer;
  n_id uuid;
  refused boolean;
begin
  perform set_config('role', 'authenticated', true);

  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);  -- owner B
  select count(*) into mine from notifications;
  select count(*) into others from notifications
   where recipient_id <> '44444444-4444-4444-4444-444444444444';
  assert mine > 0 and others = 0, 'owner B sees only their own';
  select id into n_id from notifications limit 1;
  update notifications set read_at = now() where id = n_id;
  assert (select read_at is not null from notifications where id = n_id), 'owner B marks read';

  refused := false;
  begin
    update notifications set body = 'tampered' where id = n_id;
  exception when insufficient_privilege then refused := true;
  end;
  assert refused, 'only read_at can be changed';

  refused := false;
  begin
    insert into notifications (recipient_id, kind, title, body)
    values ('44444444-4444-4444-4444-444444444444', 'booking_new', 'x', 'y');
  exception when insufficient_privilege then refused := true;
  end;
  assert refused, 'clients cannot create notifications';

  perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);  -- owner A
  assert (select count(*) from notifications n join bookings b on b.id = n.booking_id
           where b.unit_id = pg_temp.unit('2807')) = 0, 'owner A sees nothing about 2807';

  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);  -- PM
  assert (select count(*) from notifications
           where recipient_id <> '22222222-2222-2222-2222-222222222222') = 0,
    'staff do not see other people''s notifications either';

  perform set_config('role', 'postgres', true);
  raise notice 'TEST 37  PASS  notifications are private to their recipient; only read_at is writable; nobody can insert';
end $$;

select 'ALL BOOKING NOTIFICATION TESTS PASSED' as result;
