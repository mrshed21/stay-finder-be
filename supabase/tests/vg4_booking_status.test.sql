-- VG4 database tests: the property owner confirms or rejects pending bookings.
-- LOCAL TEST DATABASE ONLY. See "Database tests" in README.md for the commands.
-- Run after: local_supabase_stub.sql, stayfinder_schema.sql and every migration.
-- Each check prints PASS. The first failure stops the script with FAIL.
-- Everything runs in one transaction that is rolled back at the end.

\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

-- Refuse to run on a database that already has data, e.g. the hosted project.
do $$
begin
  if exists (select 1 from auth.users)
    or exists (select 1 from public.properties)
    or exists (select 1 from public.bookings) then
    raise exception 'Refusing to run: use an empty local test database';
  end if;
end;
$$;

-- Runs one statement and returns 'ok' or the SQLSTATE it failed with.
create or replace function pg_temp.try_sql(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

-- Runs a query and returns its single value as text.
create or replace function pg_temp.query_text(p_sql text) returns text
language plpgsql as $$
declare
  v_result text;
begin
  execute p_sql into v_result;
  return v_result;
end;
$$;

create or replace procedure pg_temp.expect(p_label text, p_actual text, p_expected text)
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL %: expected %, got %', p_label, p_expected, p_actual;
  end if;
  raise notice 'PASS %', p_label;
end;
$$;

begin;

-- Owner 1111 owns the stay. Guest 2222 has four pending bookings. User 3333 is someone else.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'guest@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'other@example.test');

insert into public.properties (property_id, user_id, title, description, location, kind, max_guests, price_per_night) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Test stay', 'Local test stay', 'Oslo', 'apartment', 2, 100);

insert into public.bookings (booking_id, property_id, user_id, guest_name, guest_email, check_in, check_out, guests) values
  ('b0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'Test Guest', 'guest@example.test', '2099-01-10', '2099-01-12', 1),
  ('b0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'Test Guest', 'guest@example.test', '2099-01-20', '2099-01-22', 1),
  ('b0000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'Test Guest', 'guest@example.test', '2099-02-01', '2099-02-03', 1),
  ('b0000000-0000-0000-0000-000000000004', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'Test Guest', 'guest@example.test', '2099-03-01', '2099-03-03', 1);

-- From here on, act as signed-in users so RLS applies.
set local role authenticated;

-- The property owner
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
call pg_temp.expect('owner confirms a pending booking',
  pg_temp.try_sql($$update public.bookings set status = 'confirmed' where booking_id = 'b0000000-0000-0000-0000-000000000001'$$), 'ok');
call pg_temp.expect('owner rejects a pending booking',
  pg_temp.try_sql($$update public.bookings set status = 'cancelled' where booking_id = 'b0000000-0000-0000-0000-000000000002'$$), 'ok');
call pg_temp.expect('the new statuses are saved',
  pg_temp.query_text($$select string_agg(status, ',' order by booking_id) from public.bookings
    where booking_id in ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002')$$), 'confirmed,cancelled');

call pg_temp.expect('a confirmed booking cannot be changed again',
  pg_temp.try_sql($$update public.bookings set status = 'cancelled' where booking_id = 'b0000000-0000-0000-0000-000000000001'$$), '23514');
call pg_temp.expect('a cancelled booking cannot be confirmed',
  pg_temp.try_sql($$update public.bookings set status = 'confirmed' where booking_id = 'b0000000-0000-0000-0000-000000000002'$$), '23514');
call pg_temp.expect('a booking cannot go back to pending',
  pg_temp.try_sql($$update public.bookings set status = 'pending' where booking_id = 'b0000000-0000-0000-0000-000000000001'$$), '23514');

call pg_temp.expect('owner cannot change the guest name',
  pg_temp.try_sql($$update public.bookings set guest_name = 'Changed by owner' where booking_id = 'b0000000-0000-0000-0000-000000000003'$$), '42501');
call pg_temp.expect('owner cannot change the dates',
  pg_temp.try_sql($$update public.bookings set check_out = '2099-02-04' where booking_id = 'b0000000-0000-0000-0000-000000000003'$$), '42501');
call pg_temp.expect('owner cannot change the price',
  pg_temp.try_sql($$update public.bookings set total_price = 1 where booking_id = 'b0000000-0000-0000-0000-000000000003'$$), '42501');
call pg_temp.expect('owner cannot change details together with the status',
  pg_temp.try_sql($$update public.bookings set status = 'confirmed', guests = 2 where booking_id = 'b0000000-0000-0000-0000-000000000003'$$), '42501');
call pg_temp.expect('owner cannot change created_at while confirming',
  pg_temp.try_sql($$update public.bookings set status = 'confirmed', created_at = '2000-01-01T00:00:00Z' where booking_id = 'b0000000-0000-0000-0000-000000000003'$$), '42501');
call pg_temp.expect('owner cannot move the booking to another user',
  pg_temp.try_sql($$update public.bookings set user_id = '11111111-1111-1111-1111-111111111111' where booking_id = 'b0000000-0000-0000-0000-000000000003'$$), '42501');
call pg_temp.expect('owner still cannot delete a guest''s booking',
  pg_temp.query_text($$with deleted as (delete from public.bookings where booking_id = 'b0000000-0000-0000-0000-000000000003' returning 1)
    select count(*) from deleted$$), '0');

-- The guest
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
call pg_temp.expect('guest cannot confirm their own booking',
  pg_temp.try_sql($$update public.bookings set status = 'confirmed' where booking_id = 'b0000000-0000-0000-0000-000000000003'$$), '42501');
call pg_temp.expect('guest can still edit their booking',
  pg_temp.try_sql($$update public.bookings set guest_name = 'Renamed Guest', check_out = '2099-02-04' where booking_id = 'b0000000-0000-0000-0000-000000000003'$$), 'ok');
call pg_temp.expect('guest edit is saved and repriced',
  pg_temp.query_text($$select guest_name || ' ' || check_out || ' ' || total_price || ' ' || status
    from public.bookings where booking_id = 'b0000000-0000-0000-0000-000000000003'$$), 'Renamed Guest 2099-02-04 300.00 pending');
call pg_temp.expect('guest can still delete their booking',
  pg_temp.query_text($$with deleted as (delete from public.bookings where booking_id = 'b0000000-0000-0000-0000-000000000004' returning 1)
    select count(*) from deleted$$), '1');

-- Someone else: RLS hides the booking, so nothing is updated.
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
call pg_temp.expect('another user cannot change the status',
  pg_temp.query_text($$with changed as (update public.bookings set status = 'confirmed'
    where booking_id = 'b0000000-0000-0000-0000-000000000003' returning 1) select count(*) from changed$$), '0');

reset role;
call pg_temp.expect('the booking is still pending',
  pg_temp.query_text($$select status from public.bookings where booking_id = 'b0000000-0000-0000-0000-000000000003'$$), 'pending');

-- VG2 still applies: cancelled dates are free, confirmed dates stay blocked.
call pg_temp.expect('a rejected booking frees its dates',
  pg_temp.try_sql($$insert into public.bookings (property_id, user_id, guest_name, guest_email, check_in, check_out, guests)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'Other Guest', 'other@example.test', '2099-01-20', '2099-01-22', 1)$$), 'ok');
call pg_temp.expect('a confirmed booking still blocks its dates',
  pg_temp.try_sql($$insert into public.bookings (property_id, user_id, guest_name, guest_email, check_in, check_out, guests)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'Other Guest', 'other@example.test', '2099-01-11', '2099-01-13', 1)$$), '23P01');

-- A booking whose check-in has passed cannot be confirmed. Inserted with triggers off (superuser only).
set local session_replication_role = replica;
insert into public.bookings (booking_id, property_id, user_id, guest_name, guest_email, check_in, check_out, guests, status, total_price)
values ('b0000000-0000-0000-0000-000000000005', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'Test Guest', 'guest@example.test', '2000-01-01', '2000-01-03', 1, 'pending', 200);
set local session_replication_role = origin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
call pg_temp.expect('owner cannot confirm a booking whose check-in has passed',
  pg_temp.try_sql($$update public.bookings set status = 'confirmed' where booking_id = 'b0000000-0000-0000-0000-000000000005'$$), '23514');
reset role;

rollback;

\echo 'VG4 database tests passed.'
