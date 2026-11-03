import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";

import bookings from "../routes/bookings.js";

type Row = Record<string, any>;
type MemoryTables = { properties: Row[]; bookings: Row[] };

const ACTIVE_STATUSES = ["pending", "confirmed"];

// Same rule as the bookings_no_overlap constraint: active stays on one property
// may not share a night. Dates are half-open [check_in, check_out).
// The real check runs in PostgreSQL; supabase/tests covers it there.
function overlapsActiveBooking(rows: Row[], candidate: Row, ignore?: Row) {
  return ACTIVE_STATUSES.includes(candidate.status) && rows.some((row) =>
    row !== ignore
    && row.property_id === candidate.property_id
    && ACTIVE_STATUSES.includes(row.status)
    && candidate.check_in < row.check_out
    && row.check_in < candidate.check_out,
  );
}

const overlapError = {
  data: null,
  error: { code: "23P01", message: 'conflicting key value violates exclusion constraint "bookings_no_overlap"' },
};

class MemoryQuery {
  private action: "select" | "insert" | "update" | "delete" = "select";
  private values: Row = {};
  private filters: Array<[string, unknown]> = [];
  private columns = "*";

  constructor(private tables: MemoryTables, private table: keyof MemoryTables) {}

  select(columns = "*") {
    this.columns = columns;
    return this;
  }

  insert(values: Row) {
    this.action = "insert";
    this.values = values;
    return this;
  }

  update(values: Row) {
    this.action = "update";
    this.values = values;
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  order() {
    return this;
  }

  single() {
    return this.run(true);
  }

  maybeSingle() {
    return this.run(false, true);
  }

  then(resolve: (value: any) => unknown, reject: (reason: unknown) => unknown) {
    return this.run().then(resolve, reject);
  }

  private async run(single = false, maybeSingle = false): Promise<any> {
    const rows = this.tables[this.table];
    let matching = rows.filter((row) =>
      this.filters.every(([column, value]) => row[column] === value),
    );

    if (this.action === "insert") {
      const inserted = { ...this.values, booking_id: "booking-test", created_at: "2099-01-01T00:00:00Z" };
      if (this.table === "bookings" && overlapsActiveBooking(rows, inserted)) return overlapError;
      rows.push(inserted);
      matching = [inserted];
    } else if (this.action === "update") {
      if (this.table === "bookings"
        && matching.some((row) => overlapsActiveBooking(rows, { ...row, ...this.values }, row))) {
        return overlapError;
      }
      matching.forEach((row) => Object.assign(row, this.values));
    } else if (this.action === "delete") {
      matching.forEach((row) => rows.splice(rows.indexOf(row), 1));
    }

    const selected = matching.map((row) => {
      if (this.columns === "*") return { ...row };
      return Object.fromEntries(this.columns.split(",").map((column) => {
        const key = column.trim();
        return [key, row[key]];
      }));
    });

    if (single) {
      return selected.length
        ? { data: selected[0], error: null }
        : { data: null, error: { code: "PGRST116" } };
    }
    if (maybeSingle) return { data: selected[0] ?? null, error: null };
    return { data: selected, error: null };
  }
}

function makeApp(options: {
  userId?: string | null; // null = signed out
  properties?: Row[];
  bookings?: Row[];
} = {}) {
  const tables: MemoryTables = {
    properties: options.properties ?? [{
      property_id: "property-test",
      user_id: "owner-test",
      title: "Test stay",
      max_guests: 2,
      price_per_night: 125.5,
    }],
    bookings: options.bookings ?? [],
  };
  const client = {
    from: (table: keyof MemoryTables) => new MemoryQuery(tables, table),
  };
  const app = new Hono();

  app.use("*", async (c, next) => {
    c.set("supabase", client as any);
    c.set("user", options.userId === null ? null : { id: options.userId ?? "guest-test" } as any);
    await next();
  });
  app.route("/bookings", bookings);
  return { app, tables };
}

function bookingBody(overrides: Row = {}) {
  return {
    guest_name: "Test Guest",
    guest_email: "guest@example.test",
    check_in: "2099-01-10",
    check_out: "2099-01-12",
    guests: 1,
    ...overrides,
  };
}

function requestJson(app: Hono, path: string, method: string, body?: Row) {
  return app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("booking validation returns 400 for invalid details", async () => {
  const invalid = [
    { guest_email: "not-an-email" },
    { guests: 0 },
    { check_out: "2099-01-10" },
    { check_in: "2099-02-30" },
  ];

  for (const change of invalid) {
    const { app, tables } = makeApp();
    const response = await requestJson(
      app,
      "/bookings/properties/property-test",
      "POST",
      bookingBody(change),
    );
    assert.equal(response.status, 400);
    assert.equal(tables.bookings.length, 0);
  }
});

test("capacity and past check-in failures leave bookings unchanged", async () => {
  for (const change of [
    { guests: 3 },
    { check_in: "2000-01-01", check_out: "2000-01-03" },
  ]) {
    const { app, tables } = makeApp();
    const response = await requestJson(
      app,
      "/bookings/properties/property-test",
      "POST",
      bookingBody(change),
    );
    assert.equal(response.status, 400);
    assert.equal(tables.bookings.length, 0);
  }
});

test("server calculates price and ignores supplied price, owner and status", async () => {
  const { app, tables } = makeApp();
  const response = await requestJson(
    app,
    "/bookings/properties/property-test",
    "POST",
    bookingBody({
      guests: 2,
      total_price: 1,
      user_id: "other-user",
      status: "confirmed",
    }),
  );
  const result = await response.json() as Row;

  assert.equal(response.status, 201);
  assert.equal(result.total_price, 251);
  assert.equal(result.user_id, "guest-test");
  assert.equal(result.property_id, "property-test");
  assert.equal(result.status, "pending");
  assert.equal(tables.bookings[0].total_price, 251);
});

test("booking status cannot be changed through the API", async () => {
  const booking = {
    booking_id: "booking-test",
    property_id: "property-test",
    user_id: "guest-test",
    guest_name: "Test Guest",
    guest_email: "guest@example.test",
    check_in: "2099-01-10",
    check_out: "2099-01-12",
    guests: 1,
    total_price: 251,
    status: "pending",
  };
  const { app, tables } = makeApp({ bookings: [{ ...booking }] });
  const before = { ...tables.bookings[0] };

  const response = await requestJson(
    app,
    "/bookings/properties/property-test/booking-test",
    "PATCH",
    { status: "confirmed" },
  );

  assert.equal(response.status, 400);
  assert.deepEqual(tables.bookings[0], before);
});

test("guest edits reprice changed dates, but failed edits and past deletions do not change data", async () => {
  const booking = {
    booking_id: "booking-test",
    property_id: "property-test",
    user_id: "guest-test",
    guest_name: "Test Guest",
    guest_email: "guest@example.test",
    check_in: "2099-01-10",
    check_out: "2099-01-12",
    guests: 1,
    total_price: 251,
    status: "pending",
  };
  const { app, tables } = makeApp({ bookings: [{ ...booking }] });

  const capacityResponse = await requestJson(
    app,
    "/bookings/properties/property-test/booking-test",
    "PATCH",
    { guests: 3 },
  );
  assert.equal(capacityResponse.status, 400);
  assert.equal(tables.bookings[0].guests, 1);

  const dateResponse = await requestJson(
    app,
    "/bookings/properties/property-test/booking-test",
    "PATCH",
    { check_out: "2099-01-13" },
  );
  assert.equal(dateResponse.status, 200);
  assert.equal(tables.bookings[0].total_price, 376.5);

  const futureBookingApp = makeApp({ bookings: [{ ...booking }] });
  const beforePastEdit = { ...futureBookingApp.tables.bookings[0] };
  const pastCheckInEdit = await requestJson(
    futureBookingApp.app,
    "/bookings/properties/property-test/booking-test",
    "PATCH",
    { check_in: "2000-01-01", check_out: "2000-01-03" },
  );
  assert.equal(pastCheckInEdit.status, 400);
  assert.deepEqual(futureBookingApp.tables.bookings[0], beforePastEdit);

  const pastBooking = { ...booking, check_in: "2000-01-01", check_out: "2000-01-03" };
  const pastApp = makeApp({ bookings: [{ ...pastBooking }] });
  const beforeDelete = { ...pastApp.tables.bookings[0] };
  const pastUpdate = await requestJson(
    pastApp.app,
    "/bookings/properties/property-test/booking-test",
    "PATCH",
    { guest_name: "Changed" },
  );
  assert.equal(pastUpdate.status, 400);
  assert.deepEqual(pastApp.tables.bookings[0], beforeDelete);

  const deleteResponse = await requestJson(
    pastApp.app,
    "/bookings/properties/property-test/booking-test",
    "DELETE",
  );
  assert.equal(deleteResponse.status, 400);
  assert.deepEqual(pastApp.tables.bookings[0], beforeDelete);
});

test("property owner cannot patch or delete a guest's booking", async () => {
  const booking = {
    booking_id: "booking-test",
    property_id: "property-test",
    user_id: "guest-test",
    guest_name: "Test Guest",
    guest_email: "guest@example.test",
    check_in: "2099-01-10",
    check_out: "2099-01-12",
    guests: 1,
    total_price: 251,
    status: "pending",
  };
  const { app, tables } = makeApp({ userId: "owner-test", bookings: [{ ...booking }] });
  const before = { ...tables.bookings[0] };

  const patchResponse = await requestJson(
    app,
    "/bookings/properties/property-test/booking-test",
    "PATCH",
    { guest_name: "Changed" },
  );

  assert.equal(patchResponse.status, 403);
  assert.deepEqual(tables.bookings[0], before);

  const deleteResponse = await requestJson(
    app,
    "/bookings/properties/property-test/booking-test",
    "DELETE",
  );

  assert.equal(deleteResponse.status, 403);
  assert.deepEqual(tables.bookings[0], before);
});

test("a property price change does not alter an existing booking total", async () => {
  const booking = {
    booking_id: "booking-test",
    property_id: "property-test",
    user_id: "guest-test",
    guest_name: "Test Guest",
    guest_email: "guest@example.test",
    check_in: "2099-01-10",
    check_out: "2099-01-12",
    guests: 1,
    total_price: 251,
    status: "pending",
  };
  const { app, tables } = makeApp({ bookings: [{ ...booking }] });
  tables.properties[0].price_per_night = 999;

  const response = await requestJson(
    app,
    "/bookings/properties/property-test/booking-test",
    "PATCH",
    { guest_name: "Updated guest name" },
  );

  assert.equal(response.status, 200);
  assert.equal(tables.bookings[0].total_price, 251);
});

// VG2: overlapping bookings. The database constraint returns 23P01; the API answers 409.
function storedBooking(overrides: Row = {}) {
  return {
    booking_id: "booking-other",
    property_id: "property-test",
    user_id: "other-guest",
    guest_name: "Other Guest",
    guest_email: "other@example.test",
    check_in: "2099-01-10",
    check_out: "2099-01-12",
    guests: 1,
    total_price: 251,
    status: "pending",
    ...overrides,
  };
}

test("overlapping dates return 409 and do not create a booking", async () => {
  const overlapping = [
    { check_in: "2099-01-10", check_out: "2099-01-12" }, // exact duplicate
    { check_in: "2099-01-11", check_out: "2099-01-13" }, // partial overlap
    { check_in: "2099-01-09", check_out: "2099-01-13" }, // covers the whole stay
  ];

  for (const dates of overlapping) {
    for (const status of ["pending", "confirmed"]) {
      const { app, tables } = makeApp({ bookings: [storedBooking({ status })] });
      const response = await requestJson(
        app,
        "/bookings/properties/property-test",
        "POST",
        bookingBody(dates),
      );

      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: "These dates are already booked" });
      assert.equal(tables.bookings.length, 1);
    }
  }
});

test("adjacent dates, other properties and cancelled bookings do not block a booking", async () => {
  const cases = [
    { existing: storedBooking(), path: "property-test", dates: { check_in: "2099-01-12", check_out: "2099-01-14" } },
    { existing: storedBooking(), path: "property-test", dates: { check_in: "2099-01-08", check_out: "2099-01-10" } },
    { existing: storedBooking(), path: "property-other", dates: { check_in: "2099-01-10", check_out: "2099-01-12" } },
    { existing: storedBooking({ status: "cancelled" }), path: "property-test", dates: { check_in: "2099-01-10", check_out: "2099-01-12" } },
  ];

  for (const { existing, path, dates } of cases) {
    const { app, tables } = makeApp({
      properties: [
        { property_id: "property-test", user_id: "owner-test", max_guests: 2, price_per_night: 125.5 },
        { property_id: "property-other", user_id: "owner-test", max_guests: 2, price_per_night: 125.5 },
      ],
      bookings: [existing],
    });
    const response = await requestJson(app, `/bookings/properties/${path}`, "POST", bookingBody(dates));

    assert.equal(response.status, 201);
    assert.equal(tables.bookings.length, 2);
  }
});

test("booking edits return 409 on a conflict but may keep or move their own dates", async () => {
  const mine = storedBooking({
    booking_id: "booking-test",
    user_id: "guest-test",
    guest_name: "Test Guest",
    guest_email: "guest@example.test",
  });
  const next = storedBooking({ check_in: "2099-01-12", check_out: "2099-01-14" });
  const { app, tables } = makeApp({ bookings: [{ ...mine }, { ...next }] });
  const path = "/bookings/properties/property-test/booking-test";
  const before = { ...tables.bookings[0] };

  const conflict = await requestJson(app, path, "PATCH", { check_out: "2099-01-13" });
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), { error: "These dates are already booked" });
  assert.deepEqual(tables.bookings[0], before);

  // The frontend sends the unchanged dates with every edit. They must not clash with the booking itself.
  const sameDates = await requestJson(app, path, "PATCH", {
    guest_name: "Renamed Guest",
    check_in: "2099-01-10",
    check_out: "2099-01-12",
  });
  assert.equal(sameDates.status, 200);
  assert.equal(tables.bookings[0].guest_name, "Renamed Guest");
  assert.equal(tables.bookings[0].total_price, 251);

  const moved = await requestJson(app, path, "PATCH", { check_in: "2099-01-09" });
  assert.equal(moved.status, 200);
  assert.equal(tables.bookings[0].check_in, "2099-01-09");
  assert.equal(tables.bookings[0].total_price, 376.5);
});

// VG4: the property owner confirms or rejects (cancels) a pending booking.
const statusPath = "/bookings/properties/property-test/booking-test/status";

function guestBooking(overrides: Row = {}) {
  return storedBooking({
    booking_id: "booking-test",
    user_id: "guest-test",
    guest_name: "Test Guest",
    guest_email: "guest@example.test",
    ...overrides,
  });
}

test("the property owner can confirm or reject a pending booking", async () => {
  for (const status of ["confirmed", "cancelled"]) {
    const { app, tables } = makeApp({ userId: "owner-test", bookings: [guestBooking()] });
    const before = { ...tables.bookings[0] };

    const response = await requestJson(app, statusPath, "PATCH", { status });
    const result = await response.json() as Row;

    assert.equal(response.status, 200);
    assert.equal(result.status, status);
    assert.deepEqual(tables.bookings[0], { ...before, status });
  }
});

test("guests, other users and signed-out requests cannot change a booking status", async () => {
  for (const userId of ["guest-test", "other-user", null]) {
    const { app, tables } = makeApp({ userId, bookings: [guestBooking()] });
    const before = { ...tables.bookings[0] };

    const response = await requestJson(app, statusPath, "PATCH", { status: "confirmed" });

    assert.equal(response.status, userId === null ? 401 : 403);
    assert.deepEqual(tables.bookings[0], before);
  }
});

test("confirmed, cancelled and past bookings cannot be confirmed or rejected again", async () => {
  const cases = [
    { booking: guestBooking({ status: "confirmed" }), error: "Only pending bookings can be confirmed or rejected" },
    { booking: guestBooking({ status: "cancelled" }), error: "Only pending bookings can be confirmed or rejected" },
    { booking: guestBooking({ check_in: "2000-01-01", check_out: "2000-01-03" }), error: "This booking can no longer be changed or cancelled" },
  ];

  for (const { booking, error } of cases) {
    for (const status of ["confirmed", "cancelled"]) {
      const { app, tables } = makeApp({ userId: "owner-test", bookings: [{ ...booking }] });
      const before = { ...tables.bookings[0] };

      const response = await requestJson(app, statusPath, "PATCH", { status });

      assert.equal(response.status, 400);
      assert.deepEqual(await response.json(), { error });
      assert.deepEqual(tables.bookings[0], before);
    }
  }
});

test("the status endpoint accepts only confirmed or cancelled, and no other booking fields", async () => {
  const invalid = [
    { status: "pending" },
    { status: "approved" },
    {},
    { status: "confirmed", guest_name: "Changed by owner" },
    { status: "confirmed", check_out: "2099-01-20" },
    { status: "confirmed", total_price: 1 },
  ];

  for (const body of invalid) {
    const { app, tables } = makeApp({ userId: "owner-test", bookings: [guestBooking()] });
    const before = { ...tables.bookings[0] };

    const response = await requestJson(app, statusPath, "PATCH", body);

    assert.equal(response.status, 400);
    assert.deepEqual(tables.bookings[0], before);
  }
});

test("a rejected booking frees its dates, while a confirmed one keeps blocking them (VG2)", async () => {
  const rejected = makeApp({ userId: "owner-test", bookings: [guestBooking()] });
  const blocked = await requestJson(rejected.app, "/bookings/properties/property-test", "POST", bookingBody());
  assert.equal(blocked.status, 409);

  const reject = await requestJson(rejected.app, statusPath, "PATCH", { status: "cancelled" });
  assert.equal(reject.status, 200);
  const rebooked = await requestJson(rejected.app, "/bookings/properties/property-test", "POST", bookingBody());
  assert.equal(rebooked.status, 201);

  const confirmed = makeApp({ userId: "owner-test", bookings: [guestBooking()] });
  const confirm = await requestJson(confirmed.app, statusPath, "PATCH", { status: "confirmed" });
  assert.equal(confirm.status, 200);
  const stillBlocked = await requestJson(confirmed.app, "/bookings/properties/property-test", "POST", bookingBody());
  assert.equal(stillBlocked.status, 409);
});
