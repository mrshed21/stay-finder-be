import type { PostgrestSingleResponse } from "@supabase/supabase-js";

import { sb } from "../lib/supabase.js";

import type { Booking, NewBooking, BookingValidKey } from "../types/booking.js";
import type { BasicSupabaseClient } from "../types/supabase.js";

const TABLE_NAME = "bookings";

const SELECT_QUERY_LIST: BookingValidKey[] = [
  "booking_id",
  "property_id",
  "guest_name",
  "guest_email",
  "check_in",
  "check_out",
  "guests",
  "status",
  "created_at",
];

const SELECT_QUERY = SELECT_QUERY_LIST.join(", ");
const QUERY_ID = "booking_id";
const QUERY_PROPERTY_ID = "property_id";

export async function getBookingsByPropertyId(
  propertyId: string,
): Promise<Booking[]> {
  const { error, data } = await sb
    .from(TABLE_NAME)
    .select(SELECT_QUERY)
    .eq(QUERY_PROPERTY_ID, propertyId)
    .order("check_in");

  if (!error) {
    return data as any as Booking[];
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
  propertyId: string,
  bookingId: string,
  booking: Partial<Booking>,
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

export async function deleteBooking(propertyId: string, bookingId: string) {
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
