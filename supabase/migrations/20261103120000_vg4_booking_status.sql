-- VG4: the property owner confirms or rejects a pending booking.
--
-- pending -> confirmed  (Confirm)
-- pending -> cancelled  (Reject; VG2 then frees the dates)
--
-- 1. A new RLS policy lets property owners UPDATE bookings on their own properties.
-- 2. The booking trigger limits what that policy allows: the owner may change the
--    status only, from pending only, and nothing else in the same update.
--    Every other booking edit still requires the booking's own guest.
--
-- Unchanged: guest edit/delete rights, ownership checks, capacity, past-date rules,
-- server-side price (VG1, VG3, VG5, VG6) and the overlap constraint (VG2).
-- Safe to run more than once.

begin;

create or replace function public.enforce_stayfinder_booking_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (pg_catalog.now() at time zone 'UTC')::date;
  v_property_max_guests integer;
  v_price_per_night numeric;
begin
  if tg_op = 'DELETE' then
    -- Preserve the property's existing ON DELETE CASCADE behavior for owners.
    -- A direct booking delete is still blocked after check-in.
    if old.check_in < v_today and pg_catalog.pg_trigger_depth() = 1 then
      raise exception using
        errcode = '23514',
        message = 'Booking check-in date has passed';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if old.check_in < v_today then
      raise exception using
        errcode = '23514',
        message = 'Booking check-in date has passed';
    end if;

    if new.booking_id is distinct from old.booking_id
      or new.user_id is distinct from old.user_id
      or new.property_id is distinct from old.property_id then
      raise exception using
        errcode = '42501',
        message = 'Booking ownership and property cannot be changed';
    end if;

    if new.status is distinct from old.status then
      -- VG4: only pending -> confirmed or pending -> cancelled.
      if old.status <> 'pending' or new.status not in ('confirmed', 'cancelled') then
        raise exception using
          errcode = '23514',
          message = 'Only pending bookings can be confirmed or cancelled';
      end if;

      -- VG4: only the owner of the booked property may decide.
      if not exists (
        select 1
          from public.properties as p
          where p.property_id = old.property_id
            and p.user_id = auth.uid()
      ) then
        raise exception using
          errcode = '42501',
          message = 'Only the property owner can confirm or cancel a booking';
      end if;

      -- VG4: a status change may not change anything else.
      if new.guest_name is distinct from old.guest_name
        or new.guest_email is distinct from old.guest_email
        or new.check_in is distinct from old.check_in
        or new.check_out is distinct from old.check_out
        or new.guests is distinct from old.guests
        or new.total_price is distinct from old.total_price
        or new.created_at is distinct from old.created_at then
        raise exception using
          errcode = '42501',
          message = 'A status change cannot change other booking fields';
      end if;

      return new;
    end if;

    -- VG4: the owner's UPDATE policy is for status only. Other edits stay with the guest.
    -- (No signed-in user means a trusted database admin, as before.)
    if auth.uid() is not null and auth.uid() is distinct from old.user_id then
      raise exception using
        errcode = '42501',
        message = 'Only the guest can change booking details';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending';
  end if;

  if new.check_in < v_today then
    raise exception using
      errcode = '23514',
      message = 'Booking check-in date is in the past';
  end if;

  select p.max_guests, p.price_per_night
    into v_property_max_guests, v_price_per_night
    from public.properties as p
    where p.property_id = new.property_id
    for share;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Booking property does not exist';
  end if;

  if new.guests > v_property_max_guests then
    raise exception using
      errcode = '23514',
      message = 'Booking guests exceed the property''s maximum';
  end if;

  if tg_op = 'INSERT' then
    new.total_price := pg_catalog.round(
      v_price_per_night * (new.check_out - new.check_in),
      2
    );
  elsif new.check_in is distinct from old.check_in
    or new.check_out is distinct from old.check_out then
    -- Editing the stay dates reprices it using the property's current nightly price.
    new.total_price := pg_catalog.round(
      v_price_per_night * (new.check_out - new.check_in),
      2
    );
  else
    -- Ignore direct attempts to change the stored price without changing dates.
    new.total_price := old.total_price;
  end if;

  return new;
end;
$$;

-- Trigger execution does not require callers to invoke this function directly.
revoke all privileges on function public.enforce_stayfinder_booking_rules()
  from public, anon, authenticated;

drop policy if exists "Property owners can update booking status" on public.bookings;
create policy "Property owners can update booking status"
on public.bookings for update
to authenticated
using (
  exists (
    select 1 from public.properties
    where properties.property_id = bookings.property_id
      and properties.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.properties
    where properties.property_id = bookings.property_id
      and properties.user_id = auth.uid()
  )
);

commit;
