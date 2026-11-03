-- VG2: prevent overlapping bookings for the same property.
--
-- A stay covers the nights in the half-open range [check_in, check_out).
-- Jan 10-12 and Jan 12-14 do not overlap: one guest checks out the day the next checks in.
-- Pending and confirmed bookings block their dates. Cancelled bookings do not.
--
-- PostgreSQL checks this constraint on every insert and update, for every row,
-- so it works for all users (RLS does not hide rows from it) and for
-- concurrent requests: the second overlapping write fails with SQLSTATE 23P01.
-- An update is compared with the other bookings only, never with its own old row.
--
-- Safe to run more than once. Existing triggers and RLS policies are not changed.

begin;

-- btree_gist lets one GiST index compare property_id with = and the dates with &&.
create extension if not exists btree_gist with schema extensions;

-- Stop before changing anything if active bookings already overlap.
-- The whole migration is then rolled back. No booking rows are changed or deleted.
do $$
declare
  v_conflicts text;
begin
  select string_agg(format('%s overlaps %s', a.booking_id, b.booking_id), '; ')
    into v_conflicts
    from public.bookings as a
    join public.bookings as b
      on b.property_id = a.property_id
     and b.booking_id > a.booking_id
     and daterange(b.check_in, b.check_out, '[)') && daterange(a.check_in, a.check_out, '[)')
    where a.status in ('pending', 'confirmed')
      and b.status in ('pending', 'confirmed');

  if v_conflicts is not null then
    raise exception using
      errcode = '23P01',
      message = 'Existing bookings overlap. Resolve them manually before adding bookings_no_overlap.',
      detail = v_conflicts;
  end if;
end;
$$;

alter table public.bookings drop constraint if exists bookings_no_overlap;
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    property_id with =,
    daterange(check_in, check_out, '[)') with &&
  )
  where (status in ('pending', 'confirmed'));

commit;
