import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import properties from "../routes/properties.js";

type Row = Record<string, any>;

// Small in-memory stand-in for the Supabase query builder used by the property list.
class PropertyQuery {
  private checks: Array<(row: Row) => boolean> = [];
  private sortBy?: { column: string; ascending: boolean };

  constructor(private rows: Row[]) {}

  select() { return this; }
  eq(column: string, value: unknown) { this.checks.push((row) => row[column] === value); return this; }
  lte(column: string, value: number) { this.checks.push((row) => row[column] <= value); return this; }
  gte(column: string, value: number) { this.checks.push((row) => row[column] >= value); return this; }
  ilike(column: string, pattern: string) {
    const text = pattern.replaceAll("%", "").toLowerCase();
    this.checks.push((row) => String(row[column]).toLowerCase().includes(text));
    return this;
  }
  not(column: string, operator: string, list: string) {
    assert.equal(operator, "in");
    const values = list.slice(1, -1).split(",");
    this.checks.push((row) => !values.includes(row[column]));
    return this;
  }
  order(column: string, options: { ascending: boolean }) {
    this.sortBy = { column, ascending: options.ascending };
    return this;
  }

  then(resolve: (value: any) => unknown, reject: (reason: unknown) => unknown) {
    const data = this.rows.filter((row) => this.checks.every((check) => check(row)));
    if (this.sortBy) {
      const { column, ascending } = this.sortBy;
      data.sort((a, b) => (ascending ? a[column] - b[column] : b[column] - a[column]));
    }
    return Promise.resolve({ data, error: null }).then(resolve, reject);
  }
}

// Same rule as the booked_property_ids database function: pending and confirmed
// bookings block [check_in, check_out). The real function is tested in supabase/tests.
function bookedPropertyIds(bookings: Row[], checkIn: string, checkOut: string) {
  return [...new Set(bookings
    .filter((booking) => ["pending", "confirmed"].includes(booking.status))
    .filter((booking) => booking.check_in < checkOut && checkIn < booking.check_out)
    .map((booking) => booking.property_id))];
}

function property(id: string, overrides: Row = {}) {
  return {
    property_id: id,
    user_id: "owner-test",
    title: `Stay ${id}`,
    description: "Test stay",
    location: "Oslo",
    kind: "apartment",
    max_guests: 2,
    price_per_night: 200,
    created_at: "2099-01-01T00:00:00Z",
    ...overrides,
  };
}

function booking(propertyId: string, status: string, checkIn = "2099-01-10", checkOut = "2099-01-12") {
  return { property_id: propertyId, status, check_in: checkIn, check_out: checkOut };
}

// No signed-in user: availability search is public.
function makeApp(rows: Row[], bookings: Row[] = []) {
  const rpcCalls: Row[] = [];
  const client = {
    from: () => new PropertyQuery(rows),
    rpc: async (name: string, args: Row) => {
      rpcCalls.push({ name, ...args });
      return { data: bookedPropertyIds(bookings, args.p_check_in, args.p_check_out), error: null };
    },
  };
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("supabase", client as any);
    c.set("user", null);
    await next();
  });
  app.route("/properties", properties);
  return { app, rpcCalls };
}

async function listIds(app: Hono, path: string) {
  const response = await app.request(path);
  assert.equal(response.status, 200);
  return ((await response.json()) as Row[]).map((row) => row.property_id);
}

test("without dates the property search works as before", async () => {
  const rows = [
    property("a", { location: "Oslo", price_per_night: 300, max_guests: 4 }),
    property("b", { location: "Oslo", price_per_night: 150, max_guests: 2 }),
    property("c", { location: "Bergen", price_per_night: 120, max_guests: 4 }),
  ];
  const { app, rpcCalls } = makeApp(rows, [booking("a", "pending")]);

  assert.deepEqual(await listIds(app, "/properties"), ["a", "b", "c"]);
  assert.deepEqual(await listIds(app, "/properties?location=oslo&sort=asc"), ["b", "a"]);
  assert.deepEqual(await listIds(app, "/properties?maxprice=200&maxguests=3"), ["c"]);
  assert.equal(rpcCalls.length, 0);
});

test("dates hide properties with an overlapping pending or confirmed booking", async () => {
  const rows = [property("free"), property("pending"), property("confirmed"), property("cancelled"), property("adjacent")];
  const bookings = [
    booking("pending", "pending"),
    booking("confirmed", "confirmed"),
    booking("cancelled", "cancelled"),
    booking("adjacent", "confirmed", "2099-01-12", "2099-01-14"),
  ];
  const { app, rpcCalls } = makeApp(rows, bookings);

  assert.deepEqual(
    await listIds(app, "/properties?checkin=2099-01-10&checkout=2099-01-12"),
    ["free", "cancelled", "adjacent"],
  );
  assert.deepEqual(rpcCalls, [{ name: "booked_property_ids", p_check_in: "2099-01-10", p_check_out: "2099-01-12" }]);
});

test("dates work together with location, price, guests, sorting and kind", async () => {
  const rows = [
    property("cheap", { price_per_night: 150, max_guests: 4 }),
    property("pricey", { price_per_night: 400, max_guests: 4 }),
    property("booked", { price_per_night: 120, max_guests: 4 }),
    property("small", { price_per_night: 130, max_guests: 1 }),
    property("villa", { kind: "villa", price_per_night: 140, max_guests: 4 }),
    property("bergen", { location: "Bergen", price_per_night: 110, max_guests: 4 }),
  ];
  const { app } = makeApp(rows, [booking("booked", "pending")]);
  const dates = "checkin=2099-01-10&checkout=2099-01-12";

  assert.deepEqual(
    await listIds(app, `/properties?location=oslo&maxprice=300&maxguests=2&sort=desc&${dates}`),
    ["cheap", "villa"],
  );
  assert.deepEqual(await listIds(app, `/properties/kind/apartment?location=oslo&maxguests=2&sort=asc&${dates}`), ["cheap", "pricey"]);
});

test("incomplete, reversed, past or invalid dates return 400", async () => {
  const { app, rpcCalls } = makeApp([property("a")]);
  const invalid = [
    "checkin=2099-01-10",
    "checkout=2099-01-12",
    "checkin=2099-01-12&checkout=2099-01-12",
    "checkin=2099-01-12&checkout=2099-01-10",
    "checkin=2000-01-10&checkout=2000-01-12",
    "checkin=2099-02-30&checkout=2099-03-02",
    "checkin=10-01-2099&checkout=12-01-2099",
    "checkin=&checkout=",
  ];

  for (const query of invalid) {
    const response = await app.request(`/properties?${query}`);
    assert.equal(response.status, 400, query);
    const kindResponse = await app.request(`/properties/kind/villa?${query}`);
    assert.equal(kindResponse.status, 400, query);
  }
  assert.equal(rpcCalls.length, 0);
});
