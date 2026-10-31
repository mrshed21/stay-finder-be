-- Booking ownership remains protected by the existing RLS policies.
-- This trigger enforces capacity, past-date rules, immutable booking fields,
-- and the stored server-side total for direct API and Supabase writes.
-- SECURITY DEFINER lets a guest lock/read a public property row without needing
-- an owner-only property UPDATE policy. The fixed empty search_path and
-- schema-qualified table names keep that elevated read narrow and predictable.

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
      raise exception using
        errcode = '42501',
        message = 'Booking status cannot be changed';
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

drop trigger if exists stayfinder_booking_rules on public.bookings;
create trigger stayfinder_booking_rules
before insert or update or delete on public.bookings
for each row execute function public.enforce_stayfinder_booking_rules();

-- Trigger execution does not require callers to invoke this function directly.
revoke all privileges on function public.enforce_stayfinder_booking_rules()
  from public, anon, authenticated;

create or replace function public.prevent_property_capacity_below_active_bookings()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_today date := (pg_catalog.now() at time zone 'UTC')::date;
begin
  if new.max_guests < old.max_guests and exists (
    select 1
      from public.bookings as b
      where b.property_id = old.property_id
        and b.guests > new.max_guests
        and b.status <> 'cancelled'
        and b.check_out > v_today
  ) then
    raise exception using
      errcode = '23514',
      message = 'Property capacity is below an active booking''s guest count';
  end if;

  return new;
end;
$$;

drop trigger if exists stayfinder_property_capacity_rules on public.properties;
create trigger stayfinder_property_capacity_rules
before update of max_guests on public.properties
for each row execute function public.prevent_property_capacity_below_active_bookings();

commit;
