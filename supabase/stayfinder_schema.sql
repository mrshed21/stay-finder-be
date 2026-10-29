-- StayFinder schema for a fresh Supabase project.
-- Review before running. This file has not been applied to any database.

create table public.properties (
  property_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) >= 2),
  description text not null check (char_length(btrim(description)) >= 3),
  location text not null check (char_length(btrim(location)) >= 2),
  kind text not null check (kind in ('apartment', 'villa')),
  max_guests integer not null check (max_guests >= 1),
  price_per_night numeric(10, 2) not null check (price_per_night >= 100),
  created_at timestamptz not null default now()
);

create table public.bookings (
  booking_id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(property_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  guest_name text not null check (char_length(btrim(guest_name)) >= 2),
  guest_email text not null check (char_length(btrim(guest_email)) > 0),
  check_in date not null,
  check_out date not null check (check_out > check_in),
  guests integer not null check (guests >= 1),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'cancelled')),
  -- VG6: nullable until the API and database calculate and require this value.
  total_price numeric(10, 2) check (total_price >= 0),
  created_at timestamptz not null default now()
);

alter table public.properties enable row level security;
alter table public.bookings enable row level security;

-- Supabase Data API permissions. RLS policies below decide which rows are allowed.
revoke all privileges on public.properties, public.bookings from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.properties to anon, authenticated;
grant insert, update, delete on public.properties to authenticated;
grant select, insert, update, delete on public.bookings to authenticated;

create policy "Everyone can read properties"
on public.properties for select
to anon, authenticated
using (true);

create policy "Users can create their own properties"
on public.properties for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Owners can update their properties"
on public.properties for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Owners can delete their properties"
on public.properties for delete
to authenticated
using (auth.uid() = user_id);

create policy "Guests and property owners can read bookings"
on public.bookings for select
to authenticated
using (
  auth.uid() = user_id
  or exists (
    select 1 from public.properties
    where properties.property_id = bookings.property_id
      and properties.user_id = auth.uid()
  )
);

create policy "Guests can create their own bookings"
on public.bookings for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Guests can update their own bookings"
on public.bookings for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Guests can delete their own bookings"
on public.bookings for delete
to authenticated
using (auth.uid() = user_id);
