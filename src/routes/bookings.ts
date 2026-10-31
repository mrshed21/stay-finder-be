import { Hono, type Context } from "hono";
import type { PostgrestError } from "@supabase/supabase-js";

import {
  bookingOptionalValidator,
  bookingValidator,
} from "../validators/bookingValidator.js";
import {
  createBooking,
  deleteBooking,
  getBookingOwner,
  getBookingsByPropertyId,
  updateBooking,
} from "../database/bookings.js";
import { requireAuth } from "../middleware/auth.js";
import { getPropertyById } from "../database/properties.js";

const bookings = new Hono({ strict: false });

function databaseErrorStatus(error: unknown): number {
  const code = (error as PostgrestError | undefined)?.code;

  if (code === "23503" || code === "PGRST116") return 404;
  if (code === "42501") return 403;
  if (code === "22P02" || code === "23514" || code === "22007") return 400;
  return 500;
}

function databaseErrorResponse(c: Context, error: unknown) {
  const status = databaseErrorStatus(error) as 400 | 403 | 404 | 500;
  const messages: Record<400 | 403 | 404 | 500, string> = {
    400: "Booking data is invalid",
    403: "You are not allowed to change this booking",
    404: "Booking or property not found",
    500: "Could not complete the booking request",
  };

  return c.json({ error: messages[status] }, status);
}

// RLS returns only bookings the signed-in guest or property owner may see.
bookings.get("/properties/:propertyId", requireAuth, async (c) => {
  const propertyId = c.req.param("propertyId")!;
  const sb = c.get("supabase");

  try {
    const property = await getPropertyById(sb, propertyId);
    if (!property) {
      return c.json({ error: "Property not found" }, 404);
    }

    const propertyBookings = await getBookingsByPropertyId(sb, propertyId);
    return c.json(propertyBookings);
  } catch (error) {
    return databaseErrorResponse(c, error);
  }
});

// property_id and user_id always come from the URL and authenticated session.
bookings.post("/properties/:propertyId", requireAuth, bookingValidator, async (c) => {
  const propertyId = c.req.param("propertyId")!;
  const bookingBody = c.req.valid("json");
  const sb = c.get("supabase");
  const user = c.get("user");

  try {
    const booking = await createBooking(sb, {
      ...bookingBody,
      property_id: propertyId,
      user_id: user!.id,
      status: "pending",
    });
    return c.json(booking, 201);
  } catch (error) {
    return databaseErrorResponse(c, error);
  }
});

// Guests may update their own booking details. RLS enforces the same ownership rule.
bookings.patch(
  "/properties/:propertyId/:bookingId",
  requireAuth,
  bookingOptionalValidator,
  async (c) => {
    const propertyId = c.req.param("propertyId")!;
    const bookingId = c.req.param("bookingId")!;
    const bookingBody = c.req.valid("json");
    const sb = c.get("supabase");
    const user = c.get("user");

    try {
      const existingBooking = await getBookingOwner(sb, propertyId, bookingId);
      if (!existingBooking) {
        return c.json({ error: "Booking not found" }, 404);
      }
      if (existingBooking.user_id !== user!.id) {
        return c.json({ error: "You do not own this booking" }, 403);
      }

      const checkIn = bookingBody.check_in ?? existingBooking.check_in;
      const checkOut = bookingBody.check_out ?? existingBooking.check_out;
      if (checkIn >= checkOut) {
        return c.json({ error: "Check out must be after check in" }, 400);
      }

      const booking = await updateBooking(sb, propertyId, bookingId, bookingBody);
      return c.json(booking);
    } catch (error) {
      return databaseErrorResponse(c, error);
    }
  },
);

bookings.delete("/properties/:propertyId/:bookingId", requireAuth, async (c) => {
  const propertyId = c.req.param("propertyId")!;
  const bookingId = c.req.param("bookingId")!;
  const sb = c.get("supabase");
  const user = c.get("user");

  try {
    const existingBooking = await getBookingOwner(sb, propertyId, bookingId);
    if (!existingBooking) {
      return c.json({ error: "Booking not found" }, 404);
    }
    if (existingBooking.user_id !== user!.id) {
      return c.json({ error: "You do not own this booking" }, 403);
    }

    await deleteBooking(sb, propertyId, bookingId);
    return c.body(null, 204);
  } catch (error) {
    return databaseErrorResponse(c, error);
  }
});

export default bookings;
