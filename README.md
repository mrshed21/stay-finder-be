# StayFinder Backend

Hono and TypeScript API for StayFinder. Supabase Auth handles accounts and sessions; Supabase Postgres stores properties and bookings.

## Local setup

Use Node.js and npm. From this directory:

```sh
npm ci
```

Create a local `.env` file with these variable names:

```dotenv
SUPABASE_URL=
SUPABASE_KEY=
FRONTEND_URL=http://localhost:3001
```

Use the Supabase project URL and its anon/publishable key for `SUPABASE_KEY`. Do not use a service-role key. Keep `.env` local and do not commit it.

For a **new, empty** Supabase project, review and apply `supabase/stayfinder_schema.sql`, then apply the files in `supabase/migrations` in filename order. Do not apply the fresh schema file to a project that already has these tables. The migrations add booking rules and the availability search function; they do not create or reset tables. Auth email confirmation is configured in Supabase Auth.

For an **existing** project, apply only the migrations it does not have yet, in filename order:

- `20261031000000_vg_booking_rules.sql` (booking rules). It adds the booking and property triggers for capacity, past dates and the server-side price. It does not change any rows.
- `20261103000000_vg2_booking_overlap.sql` (VG2). It stops without changing anything if existing bookings already overlap.
- `20261103120000_vg4_booking_status.sql` (VG4). It replaces the booking trigger function and adds the owner status policy. It does not change any rows.
- `20261104000000_vg7_availability_search.sql` (VG7). It adds the `booked_property_ids` search function. It does not change any rows.

Start the API on port 3000:

```sh
npm run dev
```

Check the TypeScript build and the mocked API tests for bookings and properties:

```sh
npm run build
node dist/test/bookings.test.js
node dist/test/properties.test.js
```

### Database tests

`supabase/tests/vg2_booking_overlap.test.sql` checks the real overlap constraint in PostgreSQL, including two requests at the same time. `supabase/tests/vg4_booking_status.test.sql` checks owner confirm/reject with RLS as the owner, the guest and another user. `supabase/tests/vg7_availability_search.test.sql` checks availability search as a signed-out visitor and as a user who cannot see the bookings. Run them only on an **empty local test database**, never on the hosted project; it refuses to run if it finds data. `local_supabase_stub.sql` adds the small part of Supabase (roles, `auth.users`, `auth.uid()`) that a plain PostgreSQL needs. The PostgreSQL `bin` folder must be on `PATH`. Example with a temporary local server on port 54330:

```sh
initdb -D ../stayfinder-pg-test -U postgres -A trust
pg_ctl -D ../stayfinder-pg-test -o "-p 54330 -c listen_addresses=localhost" -l ../stayfinder-pg-test/log start
createdb -h localhost -p 54330 -U postgres stayfinder_test
psql -X -h localhost -p 54330 -U postgres -d stayfinder_test -v ON_ERROR_STOP=1 -q \
  -f supabase/tests/local_supabase_stub.sql \
  -f supabase/stayfinder_schema.sql \
  -f supabase/migrations/20261031000000_vg_booking_rules.sql \
  -f supabase/migrations/20261103000000_vg2_booking_overlap.sql \
  -f supabase/migrations/20261103120000_vg4_booking_status.sql \
  -f supabase/migrations/20261104000000_vg7_availability_search.sql \
  -f supabase/tests/vg2_booking_overlap.test.sql \
  -f supabase/tests/vg4_booking_status.test.sql \
  -f supabase/tests/vg7_availability_search.test.sql
pg_ctl -D ../stayfinder-pg-test stop
```

Each check prints `PASS`; each file ends with `VG2 database tests passed.`, `VG4 database tests passed.` or `VG7 database tests passed.` and the run stops at the first `FAIL`. Delete the `../stayfinder-pg-test` folder afterwards. It sits outside the repository so it is never committed.

## Main API routes

All routes start at `http://localhost:3000`.

| Method and path | Purpose | Common responses |
| --- | --- | --- |
| `POST /auth/register` | Create an account | `201`, `400` invalid input |
| `POST /auth/login` | Sign in and set session cookies | `200`, `400` invalid input, `401` invalid credentials |
| `POST /auth/logout` | Clear the local session | `200` |
| `GET /auth/me` | Return the signed-in user | `200`, `401` |
| `GET /properties/` | Public property list | `200`, `400` invalid filters, `500` server/database error |
| `GET /properties/?location=Oslo&maxprice=250&maxguests=2&sort=asc` | Filter and sort properties | `200`, `400` invalid filters |
| `GET /properties/?checkin=2099-01-10&checkout=2099-01-12` | Only properties free for those nights (VG7). Works with the filters above and on `/properties/kind/:kind` | `200`, `400` missing, reversed, past or invalid dates |
| `GET /properties/:id` | Public property details | `200`, `400` invalid UUID, `404` missing property |
| `POST /properties/` | Create a property | `201`, `400`, `401` |
| `PATCH /properties/:id` | Update an owned property | `200`, `400`, `401`, `403`, `404` |
| `DELETE /properties/:id` | Delete an owned property | `204`, `401`, `403`, `404` |
| `GET /bookings/properties/:propertyId` | List bookings visible to the signed-in guest/property owner | `200`, `401`, `404` |
| `POST /bookings/properties/:propertyId` | Create a booking | `201`, `400`, `401`, `404`, `409` dates already booked |
| `PATCH /bookings/properties/:propertyId/:bookingId` | Edit the guest's future booking | `200`, `400`, `401`, `403`, `404`, `409` dates already booked |
| `DELETE /bookings/properties/:propertyId/:bookingId` | Delete the guest's future booking | `204`, `400`, `401`, `403`, `404` |
| `PATCH /bookings/properties/:propertyId/:bookingId/status` | Property owner confirms or rejects a pending booking: `{"status": "confirmed"}` or `{"status": "cancelled"}` | `200`, `400` invalid status or not pending, `401`, `403` not the owner, `404` |

Booking requests use the session cookie. Booking ownership and database rules are also enforced by Supabase RLS and the migration triggers. The server calculates `total_price`; do not send it as trusted input.

The included `requests.http` file and `StayFinder.postman_collection.json` contain example calls. Use only disposable test records for create/update/delete requests.

## VG2: no overlapping bookings

Two pending or confirmed bookings for the same property may not share a night. A stay covers `[check_in, check_out)`, so Jan 10–12 and Jan 12–14 are allowed, while Jan 10–12 and Jan 11–13 are not. Cancelled bookings do not block dates, and editing a booking is only compared with the property's other bookings.

The rule lives in PostgreSQL as the exclusion constraint `bookings_no_overlap` (`btree_gist` with `daterange`). The database checks every row, including bookings that RLS hides from the current user, and concurrent requests cannot both succeed. When it rejects a write (`23P01`), `POST` and `PATCH` return `409` with `{"error": "These dates are already booked"}`. The API never returns the database error details, because they contain the other booking's dates.

## VG4: owner confirms or rejects bookings

New bookings are `pending`. The owner of the property can confirm (`pending` → `confirmed`) or reject (`pending` → `cancelled`) them with `PATCH /bookings/properties/:propertyId/:bookingId/status`. A rejected booking frees its dates (VG2). Any other status value, or a booking that is no longer pending or has passed its check-in date, returns `400`. Guests and other users get `403`, and signed-out requests get `401`. There is no separate role system: "owner" means the user who owns the property.

The database enforces the same rule for direct Supabase requests. An RLS policy lets property owners update bookings on their own properties. The booking trigger then allows that update only when it changes the status, only from `pending`, and only to `confirmed` or `cancelled`. An owner cannot change guest details, dates, price or ownership. All other booking edits still require the booking's guest, and guests still edit and delete their own bookings as before.

## VG7: availability search

`GET /properties/?checkin=YYYY-MM-DD&checkout=YYYY-MM-DD` returns only properties that are free for those nights. It also works on `/properties/kind/:kind` and together with location, price, guests and sorting. Without dates the search works as before. Both dates are required together, check-out must be after check-in, and check-in cannot be in the past; otherwise the API returns `400`.

A property is not free when a `pending` or `confirmed` booking overlaps `[checkin, checkout)`, the same rule as VG2. Cancelled bookings and stays that end on the check-in day do not block it. RLS hides other guests' bookings, so the API cannot decide this from the bookings it can read. Instead it calls the database function `booked_property_ids(check_in, check_out)`. The function runs with its owner's rights, returns only property ids, and never returns guest names, emails or booking details. Anyone may call it, signed in or not.

## Implemented assignment criteria

Backend work supports G1–G16 and the selected VG1, VG2, VG3, VG4, VG5, VG6 and VG7 criteria. All migrations must be present in the target Supabase project for database-level VG enforcement.
