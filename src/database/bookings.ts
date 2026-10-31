import type { PostgrestSingleResponse } from "@supabase/supabase-js";

import type { Booking, NewBooking } from "../types/booking.js";
import type { BasicSupabaseClient } from "../types/supabase.js";

const TABLE_NAME = "bookings";

const SELECT_QUERY =
  "booking_id, property_id, user_id, guest_name, guest_email, check_in, check_out, guests, status, total_price, created_at";
const QUERY_ID = "booking_id";
const QUERY_PROPERTY_ID = "property_id";

export async function getBookingsByPropertyId(
  sb: BasicSupabaseClient,
  propertyId: string,
): Promise<Booking[]> {
  const { error, data } = await sb
    .from(TABLE_NAME)
    .select(SELECT_QUERY)
    .eq(QUERY_PROPERTY_ID, propertyId)
    .order("check_in");

  if (!error) {
    return data;
  }
  throw error;
}

export async function createBooking(
  sb: BasicSupabaseClient,
  bookingBody: NewBooking,
): Promise<Booking> {
  const { error, data }: PostgrestSingleResponse<Booking> = await sb
    .from(TABLE_NAME)
    .insert(bookingBody)
    .select(SELECT_QUERY)
    .single();

  if (!error) {
    return data;
  }
  throw error;
}

export async function updateBooking(
  sb: BasicSupabaseClient,
  propertyId: string,
  bookingId: string,
  booking: Partial<Pick<Booking, "guest_name" | "guest_email" | "check_in" | "check_out" | "guests" | "total_price">>,
): Promise<Booking> {
  const { error, data }: PostgrestSingleResponse<Booking> = await sb
    .from(TABLE_NAME)
    .update(booking)
    .eq(QUERY_ID, bookingId)
    .eq(QUERY_PROPERTY_ID, propertyId)
    .select(SELECT_QUERY)
    .single();

  if (!error) {
    return data;
  }
  throw error;
}

export async function getBookingOwner(
  sb: BasicSupabaseClient,
  propertyId: string,
  bookingId: string,
): Promise<Pick<Booking, "booking_id" | "property_id" | "user_id" | "check_in" | "check_out" | "guests"> | null> {
  const { error, data } = await sb
    .from(TABLE_NAME)
    .select("booking_id, property_id, user_id, check_in, check_out, guests")
    .eq(QUERY_ID, bookingId)
    .eq(QUERY_PROPERTY_ID, propertyId)
    .maybeSingle();

  if (!error) {
    return data;
  }
  throw error;
}

export async function deleteBooking(
  sb: BasicSupabaseClient,
  propertyId: string,
  bookingId: string,
) {
  const { error }: PostgrestSingleResponse<Booking> = await sb
    .from(TABLE_NAME)
    .delete()
    .eq(QUERY_ID, bookingId)
    .eq(QUERY_PROPERTY_ID, propertyId)
    .select()
    .single();

  if (!error) {
    return;
  }
  throw error;
}
