-- VG7: search for properties that are free between two dates.
--
-- RLS hides other guests' bookings, so the API cannot find booked properties by
-- reading the bookings table. This function runs with its owner's rights and
-- returns ONLY the ids of properties that have a pending or confirmed booking
-- overlapping the requested nights. It never returns guest names, emails,
-- booking ids, dates or any other booking data.
--
-- Dates are half-open [check_in, check_out), like VG2: a stay that ends on the
-- requested check-in day does not block it. Cancelled bookings never block.
-- No tables, policies or rows are changed. Safe to run more than once.

begin;

create or replace function public.booked_property_ids(p_check_in date, p_check_out date)
returns setof uuid
language sql
stable
strict -- missing dates return no ids
security definer
set search_path = ''
as $$
  select distinct b.property_id
    from public.bookings as b
    where b.status in ('pending', 'confirmed')
      and daterange(b.check_in, b.check_out, '[)') && daterange(p_check_in, p_check_out, '[)');
$$;

-- Anyone may search for free dates, signed in or not.
revoke all privileges on function public.booked_property_ids(date, date) from public;
grant execute on function public.booked_property_ids(date, date) to anon, authenticated;

commit;
