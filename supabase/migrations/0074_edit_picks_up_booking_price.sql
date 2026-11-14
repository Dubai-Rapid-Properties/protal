-- ============================================================================
-- D|R|P PMS - 0074 Editing a draft picks up a booking's corrected price
--
-- A booking's ledger lines are held by the draft that carries them, so a
-- price corrected on the booking after the draft was made did not reach it
-- on Edit. The edit now frees the lines, brings them up to date with their
-- bookings (post_completed_bookings), then rebuilds the statement.
-- ============================================================================

create or replace function revise_owner_statement(
  p_statement_id    uuid,
  p_period_start    date,
  p_period_end      date,
  p_fee_pct         numeric default null,
  p_fee_vat         boolean default true,
  p_other_items     jsonb default '[]'::jsonb,
  p_other_charges   jsonb default '[]'::jsonb,
  p_booking_adjustments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_old owner_statements%rowtype;
  v_new uuid;
begin
  if not pms.is_staff() and auth.uid() is not null then
    raise exception 'Only staff can edit statements' using errcode = 'insufficient_privilege';
  end if;

  select * into v_old from owner_statements where id = p_statement_id for update;
  if not found then
    raise exception 'Statement not found' using errcode = 'no_data_found';
  end if;
  if v_old.status <> 'draft' or v_old.submitted_at is not null then
    raise exception 'Only a draft that is not waiting for approval can be edited'
      using errcode = 'check_violation';
  end if;

  -- Free its ledger lines and remove it; the new one takes them again.
  update ledger_entries set statement_id = null where statement_id = p_statement_id;
  delete from owner_statements where id = p_statement_id;
  -- Freed, its stays' lines follow their bookings again: a price put right
  -- since the draft was made reaches the ledger before it is rebuilt (0074).
  perform post_completed_bookings(p_period_end);

  perform set_config('pms.keep_statement_number', v_old.statement_number, true);
  v_new := generate_owner_statement(
    v_old.owner_id, p_period_start, p_period_end, p_fee_pct, p_fee_vat,
    p_other_items, p_other_charges, p_booking_adjustments
  );
  perform set_config('pms.keep_statement_number', '', true);

  -- Still the same draft: who made it, when, and the approver's last note.
  update owner_statements
     set created_by  = v_old.created_by,
         created_at  = v_old.created_at,
         return_note = v_old.return_note
   where id = v_new;

  return v_new;
end;
$$;

revoke all on function revise_owner_statement(uuid, date, date, numeric, boolean, jsonb, jsonb, jsonb) from public, anon;
grant execute on function revise_owner_statement(uuid, date, date, numeric, boolean, jsonb, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';
