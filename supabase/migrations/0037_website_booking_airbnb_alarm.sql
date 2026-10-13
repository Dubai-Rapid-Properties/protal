-- ============================================================================
-- D|R|P PMS - 0037 Alarm: a website booking must be blocked on Airbnb
--
-- A stay booked on the D|R|P website holds the unit here at once, but Airbnb
-- only learns of it when it next reads the export link - hours later, if the
-- listing reads it at all. Until then Airbnb can sell the same nights. So a
-- super admin blocks the dates on Airbnb by hand, and the portal sounds an
-- alarm until someone has said it is done.
--
--   * bookings.airbnb_block_done_at / _by: when, and by whom, the dates were
--     blocked on Airbnb.
--   * pending_airbnb_blocks(): live, upcoming website bookings on units with
--     an Airbnb listing that nobody has blocked yet. Super admins only.
--   * mark_airbnb_blocked(): "done". Super admins only.
-- Website bookings made before this migration count as handled, so going
-- live does not sound the alarm for every stay already taken.
-- ============================================================================

alter table bookings
  add column if not exists airbnb_block_done_at timestamptz,
  add column if not exists airbnb_block_done_by uuid references profiles(id) on delete set null;

comment on column bookings.airbnb_block_done_at is
  'When staff confirmed the dates of this website booking are blocked on Airbnb.';

update bookings
   set airbnb_block_done_at = now()
 where website_ref is not null and airbnb_block_done_at is null;

create or replace function pending_airbnb_blocks()
returns table (
  booking_id uuid,
  booking_number text,
  unit_id uuid,
  unit_label text,
  guest_name text,
  check_in date,
  check_out date,
  status booking_status,
  booked_at timestamptz
)
language sql
stable
security definer
set search_path = public, pms
as $$
  select b.id, b.booking_number, u.id, p.name || ' · ' || u.unit_number,
         g.full_name, b.check_in, b.check_out, b.status, b.created_at
    from bookings b
    join units u on u.id = b.unit_id
    join properties p on p.id = u.property_id
    left join guests g on g.id = b.guest_id
   where pms.my_role() = 'super_admin'
     and b.website_ref is not null
     and b.airbnb_block_done_at is null
     and b.status in ('tentative','confirmed','checked_in')
     and b.check_out > (now() at time zone 'Asia/Dubai')::date
     and u.airbnb_ical_url is not null
   order by b.created_at;
$$;

create or replace function mark_airbnb_blocked(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pms
as $$
begin
  if pms.my_role() is distinct from 'super_admin' then
    raise exception 'Only a super admin can do this' using errcode = 'insufficient_privilege';
  end if;
  update bookings
     set airbnb_block_done_at = now(), airbnb_block_done_by = auth.uid()
   where id = p_booking_id and website_ref is not null and airbnb_block_done_at is null;
end;
$$;

revoke all on function pending_airbnb_blocks() from public, anon;
revoke all on function mark_airbnb_blocked(uuid) from public, anon;
grant execute on function pending_airbnb_blocks() to authenticated;
grant execute on function mark_airbnb_blocked(uuid) to authenticated;
