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

For a **new, empty** Supabase project, review and apply `supabase/stayfinder_schema.sql`, then apply the files in `supabase/migrations` in filename order. Do not apply the fresh schema file to a project that already has these tables. The migrations add booking rules; they do not create or reset tables. Auth email confirmation is configured in Supabase Auth.

For an **existing** project that already has the first migration, apply only `supabase/migrations/20261103000000_vg2_booking_overlap.sql` (VG2). It stops without changing anything if existing bookings already overlap.

Start the API on port 3000:

```sh
npm run dev
```

Check the TypeScript build and focused mocked booking tests:

```sh
npm run build
node dist/test/bookings.test.js
```

### Database tests

`supabase/tests/vg2_booking_overlap.test.sql` checks the real overlap constraint in PostgreSQL, including two requests at the same time. Run it only on an **empty local test database**, never on the hosted project; it refuses to run if it finds data. `local_supabase_stub.sql` adds the small part of Supabase (roles, `auth.users`, `auth.uid()`) that a plain PostgreSQL needs. The PostgreSQL `bin` folder must be on `PATH`. Example with a temporary local server on port 54330:

```sh
initdb -D ../stayfinder-pg-test -U postgres -A trust
pg_ctl -D ../stayfinder-pg-test -o "-p 54330 -c listen_addresses=localhost" -l ../stayfinder-pg-test/log start
createdb -h localhost -p 54330 -U postgres stayfinder_test
psql -X -h localhost -p 54330 -U postgres -d stayfinder_test -v ON_ERROR_STOP=1 -q \
  -f supabase/tests/local_supabase_stub.sql \
  -f supabase/stayfinder_schema.sql \
  -f supabase/migrations/20261031000000_vg_booking_rules.sql \
  -f supabase/migrations/20261103000000_vg2_booking_overlap.sql \
  -f supabase/tests/vg2_booking_overlap.test.sql
pg_ctl -D ../stayfinder-pg-test stop
```

Each check prints `PASS`; the script ends with `VG2 database tests passed.` and stops at the first `FAIL`. Delete the `../stayfinder-pg-test` folder afterwards. It sits outside the repository so it is never committed.

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
| `GET /properties/:id` | Public property details | `200`, `400` invalid UUID, `404` missing property |
| `POST /properties/` | Create a property | `201`, `400`, `401` |
| `PATCH /properties/:id` | Update an owned property | `200`, `400`, `401`, `403`, `404` |
| `DELETE /properties/:id` | Delete an owned property | `204`, `401`, `403`, `404` |
| `GET /bookings/properties/:propertyId` | List bookings visible to the signed-in guest/property owner | `200`, `401`, `404` |
| `POST /bookings/properties/:propertyId` | Create a booking | `201`, `400`, `401`, `404`, `409` dates already booked |
| `PATCH /bookings/properties/:propertyId/:bookingId` | Edit the guest's future booking | `200`, `400`, `401`, `403`, `404`, `409` dates already booked |
| `DELETE /bookings/properties/:propertyId/:bookingId` | Delete the guest's future booking | `204`, `400`, `401`, `403`, `404` |

Booking requests use the session cookie. Booking ownership and database rules are also enforced by Supabase RLS and the migration triggers. The server calculates `total_price`; do not send it as trusted input.

The included `requests.http` file and `StayFinder.postman_collection.json` contain example calls. Use only disposable test records for create/update/delete requests.

## VG2: no overlapping bookings

Two pending or confirmed bookings for the same property may not share a night. A stay covers `[check_in, check_out)`, so Jan 10–12 and Jan 12–14 are allowed, while Jan 10–12 and Jan 11–13 are not. Cancelled bookings do not block dates, and editing a booking is only compared with the property's other bookings.

The rule lives in PostgreSQL as the exclusion constraint `bookings_no_overlap` (`btree_gist` with `daterange`). The database checks every row, including bookings that RLS hides from the current user, and concurrent requests cannot both succeed. When it rejects a write (`23P01`), `POST` and `PATCH` return `409` with `{"error": "These dates are already booked"}`. The API never returns the database error details, because they contain the other booking's dates.

## Implemented assignment criteria

Backend work supports G1–G16 and the selected VG1, VG2, VG3, VG5 and VG6 criteria. VG4 (role-based status transitions) and VG7 (availability search) are not implemented. Both migrations must be present in the target Supabase project for database-level VG enforcement.
