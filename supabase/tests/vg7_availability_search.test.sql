-- VG7 database tests: availability search with booked_property_ids().
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

-- The same question the API asks: which stays are free for these dates?
create or replace function pg_temp.free_stays(p_check_in date, p_check_out date) returns text
language sql as $$
  select string_agg(p.title, ', ' order by p.title)
    from public.properties as p
    where p.property_id not in (select public.booked_property_ids(p_check_in, p_check_out));
$$;

begin;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'guest@example.test'),
  ('33333333-3333-3333-3333-333333333333', 'other@example.test');

insert into public.properties (property_id, user_id, title, description, location, kind, max_guests, price_per_night) values
  ('a0000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Pending stay', 'Local test stay', 'Oslo', 'apartment', 2, 100),
  ('a0000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Confirmed stay', 'Local test stay', 'Oslo', 'apartment', 2, 100),
  ('a0000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'Cancelled stay', 'Local test stay', 'Oslo', 'apartment', 2, 100),
  ('a0000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'Free stay', 'Local test stay', 'Oslo', 'apartment', 2, 100),
  ('a0000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'Adjacent stay', 'Local test stay', 'Oslo', 'apartment', 2, 100);

-- New bookings are always pending.
insert into public.bookings (property_id, user_id, guest_name, guest_email, check_in, check_out, guests) values
  ('a0000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Private Guest', 'guest@example.test', '2099-01-10', '2099-01-12', 1),
  ('a0000000-0000-0000-0000-000000000005', '22222222-2222-2222-2222-222222222222', 'Private Guest', 'guest@example.test', '2099-01-12', '2099-01-14', 1);

-- Confirmed and cancelled rows, inserted with triggers off (superuser only).
set local session_replication_role = replica;
insert into public.bookings (property_id, user_id, guest_name, guest_email, check_in, check_out, guests, status, total_price) values
  ('a0000000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'Private Guest', 'guest@example.test', '2099-01-10', '2099-01-12', 1, 'confirmed', 200),
  ('a0000000-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222', 'Private Guest', 'guest@example.test', '2099-01-10', '2099-01-12', 1, 'cancelled', 200);
set local session_replication_role = origin;

-- The function only returns property ids and runs with a fixed, empty search path.
call pg_temp.expect('the function returns property ids only',
  pg_temp.query_text($$select pg_get_function_result('public.booked_property_ids(date, date)'::regprocedure)$$), 'SETOF uuid');
call pg_temp.expect('the function is security definer with an empty search path',
  pg_temp.query_text($$select prosecdef || ' ' || array_to_string(proconfig, ',') from pg_proc
    where oid = 'public.booked_property_ids(date, date)'::regprocedure$$), 'true search_path=""');

-- A signed-out visitor
set local role anon;
call pg_temp.expect('a visitor cannot read bookings directly',
  pg_temp.try_sql('select guest_name from public.bookings'), '42501');
call pg_temp.expect('Jan 10-12: pending and confirmed stays are hidden; cancelled and adjacent are free',
  pg_temp.free_stays('2099-01-10', '2099-01-12'), 'Adjacent stay, Cancelled stay, Free stay');
call pg_temp.expect('Jan 11-13: the adjacent stay now overlaps on the 12th',
  pg_temp.free_stays('2099-01-11', '2099-01-13'), 'Cancelled stay, Free stay');
call pg_temp.expect('Jan 12-14: stays that check out on the 12th are free',
  pg_temp.free_stays('2099-01-12', '2099-01-14'), 'Cancelled stay, Confirmed stay, Free stay, Pending stay');
call pg_temp.expect('dates with no bookings: every stay is free',
  pg_temp.free_stays('2099-06-01', '2099-06-05'), 'Adjacent stay, Cancelled stay, Confirmed stay, Free stay, Pending stay');
call pg_temp.expect('a missing date returns no ids',
  pg_temp.query_text($$select count(*) from public.booked_property_ids(null, '2099-01-12')$$), '0');
reset role;

-- A signed-in user who sees none of these bookings through RLS gets the same answer.
set local role authenticated;
set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
call pg_temp.expect('another user sees none of the bookings',
  pg_temp.query_text('select count(*) from public.bookings'), '0');
call pg_temp.expect('but availability still uses every active booking',
  pg_temp.free_stays('2099-01-10', '2099-01-12'), 'Adjacent stay, Cancelled stay, Free stay');
reset role;

rollback;

\echo 'VG7 database tests passed.'
