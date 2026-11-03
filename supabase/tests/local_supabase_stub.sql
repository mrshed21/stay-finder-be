-- LOCAL TESTS ONLY. Never run this file on the hosted Supabase project.
-- Adds the small part of Supabase that the StayFinder schema needs, so the schema,
-- migrations and database tests can run on a plain, empty local PostgreSQL database.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end;
$$;

create schema auth;
create schema extensions;

create table auth.users (
  id uuid primary key,
  email text
);

-- Supabase reads the signed-in user's id from the request JWT.
-- The tests set request.jwt.claim.sub to act as a user.
create function auth.uid() returns uuid
language sql stable
as $$ select nullif(pg_catalog.current_setting('request.jwt.claim.sub', true), '')::uuid $$;

grant usage on schema auth, extensions to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
