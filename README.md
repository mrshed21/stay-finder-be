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

For a **new, empty** Supabase project, review and apply `supabase/stayfinder_schema.sql`, then apply `supabase/migrations/20261031000000_vg_booking_rules.sql`. Do not apply the fresh schema file to a project that already has these tables. The migration adds booking-rule triggers; it does not create or reset tables. Auth email confirmation is configured in Supabase Auth.

Start the API on port 3000:

```sh
npm run dev
```

Check the TypeScript build and focused mocked booking tests:

```sh
npm run build
node dist/test/bookings.test.js
```

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
| `POST /bookings/properties/:propertyId` | Create a booking | `201`, `400`, `401`, `404` |
| `PATCH /bookings/properties/:propertyId/:bookingId` | Edit the guest's future booking | `200`, `400`, `401`, `403`, `404` |
| `DELETE /bookings/properties/:propertyId/:bookingId` | Delete the guest's future booking | `204`, `400`, `401`, `403`, `404` |

Booking requests use the session cookie. Booking ownership and database rules are also enforced by Supabase RLS and the migration triggers. The server calculates `total_price`; do not send it as trusted input.

The included `requests.http` file contains example calls. Use only disposable test records for create/update/delete requests.

## Implemented assignment criteria

Backend work supports G1–G16 and the selected VG1, VG3, VG5 and VG6 criteria. VG2 (overlap prevention), VG4 (role-based status transitions), and VG7 (availability search) are not implemented. The migration must be present in the target Supabase project for database-level VG enforcement.
