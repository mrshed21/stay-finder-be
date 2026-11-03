-- VG2 database tests: overlapping bookings for the same property.
-- LOCAL TEST DATABASE ONLY. See "Database tests" in README.md for the commands.
-- Run after: local_supabase_stub.sql, stayfinder_schema.sql and every migration.
-- Each check prints PASS. The first failure stops the script with FAIL.

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
-- A failed statement is rolled back on its own; the test keeps going.
create or replace function pg_temp.try_sql(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$$;

create or replace function pg_temp.try_booking(p_booking uuid, p_property uuid, p_guest uuid, p_in date, p_out date)
returns text
language sql as $$
  select pg_temp.try_sql(format(
    'insert into public.bookings (booking_id, property_id, user_id, guest_name, guest_email, check_in, check_out, guests)
     values (%L, %L, %L, ''Test Guest'', ''guest@example.test'', %L, %L, 1)',
    coalesce(p_booking, gen_random_uuid()), p_property, p_guest, p_in, p_out));
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

-- Part 1: overlap rules. Everything here is rolled back at the end.
begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'guest-a@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'guest-b@example.test'),
  ('44444444-4444-4444-4444-444444444444', 'guest-c@example.test');

insert into public.properties (property_id, user_id, title, description, location, kind, max_guests, price_per_night) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Test stay one', 'Local test stay', 'Oslo', 'apartment', 2, 100),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'Test stay two', 'Local test stay', 'Oslo', 'villa', 2, 100);

-- Guest A books stay one, Jan 10-12.
call pg_temp.expect('first booking is allowed',
  pg_temp.try_booking('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', '2099-01-10', '2099-01-12'), 'ok');

call pg_temp.expect('exact duplicate dates are rejected',
  pg_temp.try_booking(null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', '2099-01-10', '2099-01-12'), '23P01');
call pg_temp.expect('partial overlap Jan 11-13 is rejected',
  pg_temp.try_booking(null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', '2099-01-11', '2099-01-13'), '23P01');
call pg_temp.expect('partial overlap Jan 9-11 is rejected',
  pg_temp.try_booking(null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', '2099-01-09', '2099-01-11'), '23P01');
call pg_temp.expect('a stay covering the booking is rejected',
  pg_temp.try_booking(null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', '2099-01-09', '2099-01-13'), '23P01');

call pg_temp.expect('check-in on the previous check-out day is allowed (Jan 12-14)',
  pg_temp.try_booking('b1b1b1b1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', '2099-01-12', '2099-01-14'), 'ok');
call pg_temp.expect('check-out on the next check-in day is allowed (Jan 8-10)',
  pg_temp.try_booking(null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', '2099-01-08', '2099-01-10'), 'ok');
call pg_temp.expect('same dates on a different property are allowed',
  pg_temp.try_booking('b2b2b2b2-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', '2099-01-10', '2099-01-12'), 'ok');

-- The API cannot cancel bookings, so insert cancelled rows with triggers off (superuser only).
-- The exclusion constraint is still checked in this mode.
set local session_replication_role = replica;
call pg_temp.expect('a cancelled booking may overlap an active one',
  pg_temp.try_sql($$insert into public.bookings (property_id, user_id, guest_name, guest_email, check_in, check_out, guests, status)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'Cancelled Guest', 'c@example.test', '2099-01-10', '2099-01-12', 1, 'cancelled')$$), 'ok');
call pg_temp.expect('a cancelled booking on free dates is stored',
  pg_temp.try_sql($$insert into public.bookings (property_id, user_id, guest_name, guest_email, check_in, check_out, guests, status)
    values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', 'Cancelled Guest', 'c@example.test', '2099-02-01', '2099-02-05', 1, 'cancelled')$$), 'ok');
set local session_replication_role = origin;
call pg_temp.expect('cancelled bookings do not block their dates',
  pg_temp.try_booking(null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', '2099-02-01', '2099-02-05'), 'ok');

-- Updates are compared with the other bookings, never with their own old row.
call pg_temp.expect('moving a booking onto another booking is rejected',
  pg_temp.try_sql($$update public.bookings set check_in = '2099-01-11' where booking_id = 'b1b1b1b1-0000-0000-0000-000000000001'$$), '23P01');
call pg_temp.expect('updating a booking without changing its dates is allowed',
  pg_temp.try_sql($$update public.bookings set guest_name = 'Renamed Guest' where booking_id = 'a1a1a1a1-0000-0000-0000-000000000001'$$), 'ok');
call pg_temp.expect('saving a booking with its own unchanged dates is allowed',
  pg_temp.try_sql($$update public.bookings set check_in = '2099-01-10', check_out = '2099-01-12', guests = 2 where booking_id = 'a1a1a1a1-0000-0000-0000-000000000001'$$), 'ok');
call pg_temp.expect('extending a booking over its own old dates is allowed',
  pg_temp.try_sql($$update public.bookings set check_out = '2099-01-13' where booking_id = 'b2b2b2b2-0000-0000-0000-000000000001'$$), 'ok');

-- RLS hides guest A's booking from guest C, but the constraint still sees it.
set local role authenticated;
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
call pg_temp.expect('guest C cannot see the other bookings on stay one',
  pg_temp.query_text($$select count(*) from public.bookings
    where property_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' and status <> 'cancelled'$$), '0');
call pg_temp.expect('a booking hidden by RLS still blocks its dates',
  pg_temp.try_booking(null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', '2099-01-11', '2099-01-12'), '23P01');
call pg_temp.expect('the same guest can book free dates',
  pg_temp.try_booking(null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '44444444-4444-4444-4444-444444444444', '2099-03-01', '2099-03-03'), 'ok');
reset role;

-- The earlier VG booking triggers still run with the new constraint.
call pg_temp.expect('a booking with a client status and price is stored',
  pg_temp.try_sql($$insert into public.bookings (booking_id, property_id, user_id, guest_name, guest_email, check_in, check_out, guests, status, total_price)
    values ('c1c1c1c1-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Guest A', 'a@example.test', '2099-04-01', '2099-04-03', 1, 'confirmed', 1)$$), 'ok');
call pg_temp.expect('the database still sets pending status and the server price',
  pg_temp.query_text($$select status || ' ' || total_price from public.bookings where booking_id = 'c1c1c1c1-0000-0000-0000-000000000001'$$), 'pending 200.00');
call pg_temp.expect('too many guests is still rejected',
  pg_temp.try_sql($$insert into public.bookings (property_id, user_id, guest_name, guest_email, check_in, check_out, guests)
    values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Guest A', 'a@example.test', '2099-05-01', '2099-05-03', 3)$$), '23514');
call pg_temp.expect('a past check-in is still rejected',
  pg_temp.try_booking(null, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', '2000-01-01', '2000-01-03'), '23514');
call pg_temp.expect('booking status still cannot be changed',
  pg_temp.try_sql($$update public.bookings set status = 'cancelled' where booking_id = 'a1a1a1a1-0000-0000-0000-000000000001'$$), '42501');

rollback;

-- Part 2: two requests at the same time. Two extra connections (dblink) act as two API requests.
-- These rows must be committed so the other connections can see them; they are deleted at the end.
create extension if not exists dblink with schema extensions;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'guest-a@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'guest-b@example.test');
insert into public.properties (property_id, user_id, title, description, location, kind, max_guests, price_per_night) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Test stay one', 'Local test stay', 'Oslo', 'apartment', 2, 100);

select extensions.dblink_connect('vg2_a', format('host=localhost port=%s dbname=%s user=%s application_name=vg2_a',
  current_setting('port'), current_database(), current_user));
select extensions.dblink_connect('vg2_b', format('host=localhost port=%s dbname=%s user=%s application_name=vg2_b',
  current_setting('port'), current_database(), current_user));

-- Request A inserts Mar 10-12 but has not committed yet.
select extensions.dblink_exec('vg2_a', 'begin');
select extensions.dblink_exec('vg2_a', $$insert into public.bookings (property_id, user_id, guest_name, guest_email, check_in, check_out, guests)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'Guest A', 'a@example.test', '2099-03-10', '2099-03-12', 1)$$);

-- Request B tries Mar 11-13 at the same time. It cannot see A's row yet.
select extensions.dblink_send_query('vg2_b', $$insert into public.bookings (property_id, user_id, guest_name, guest_email, check_in, check_out, guests)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '33333333-3333-3333-3333-333333333333', 'Guest B', 'b@example.test', '2099-03-11', '2099-03-13', 1)$$);

-- PostgreSQL makes B wait until A's transaction ends.
do $$
begin
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists (select 1 from pg_stat_activity where application_name = 'vg2_b' and wait_event_type = 'Lock') then
      raise notice 'PASS the second request waits for the first one';
      return;
    end if;
    perform pg_sleep(0.05);
  end loop;
  raise exception 'FAIL the second request did not wait for the first one';
end;
$$;

-- A commits, so B now fails with the overlap error.
select extensions.dblink_exec('vg2_a', 'commit');
select * from extensions.dblink_get_result('vg2_b', false) as result(status text);
do $$
begin
  if position('bookings_no_overlap' in extensions.dblink_error_message('vg2_b')) = 0 then
    raise exception 'FAIL concurrent overlap: expected an overlap error, got %', extensions.dblink_error_message('vg2_b');
  end if;
  raise notice 'PASS the second overlapping request is rejected after the first commits';
end;
$$;

select extensions.dblink_disconnect('vg2_a');
select extensions.dblink_disconnect('vg2_b');

call pg_temp.expect('only one of the two concurrent bookings was saved',
  pg_temp.query_text($$select count(*) from public.bookings where property_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$), '1');

-- Clean up. Deleting the test users also deletes their test property and bookings.
delete from auth.users where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333');
call pg_temp.expect('test data is removed',
  pg_temp.query_text($$select (select count(*) from public.bookings) + (select count(*) from public.properties)$$), '0');

\echo 'VG2 database tests passed.'
