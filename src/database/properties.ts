import type { PostgrestSingleResponse } from "@supabase/supabase-js";

import type { BasicSupabaseClient } from "../types/supabase.js";
import type { NewProperty, Property, PropertyKind } from "../types/property.js";

const TABLE_NAME = "properties";

const SELECT_QUERY =
  "property_id, title, description, location, price_per_night, max_guests, kind, created_at, user_id";
const QUERY_ID = "property_id";
const QUERY_KIND = "kind";

function selectProperties(sb: BasicSupabaseClient) {
  return sb.from(TABLE_NAME).select(SELECT_QUERY);
}

type PropertyListQuery = ReturnType<typeof selectProperties>;

type PropertyListFilter = Partial<{
  maxPrice: number;
  location: string;
  maxGuests: number;
  sort: "asc" | "desc";
  checkIn: string;
  checkOut: string;
}>;

// VG7: ids of properties with a pending or confirmed booking in [checkIn, checkOut).
// RLS hides other guests' bookings, so a database function finds them. It returns
// property ids only, never booking details.
async function getBookedPropertyIds(
  sb: BasicSupabaseClient,
  filters: PropertyListFilter,
): Promise<string[]> {
  if (!filters.checkIn || !filters.checkOut) {
    return [];
  }

  const { error, data } = await sb.rpc("booked_property_ids", {
    p_check_in: filters.checkIn,
    p_check_out: filters.checkOut,
  });

  if (!error) {
    return data;
  }
  throw error;
}

function buildPropertiesFilter(
  query: PropertyListQuery,
  filters: PropertyListFilter,
  bookedPropertyIds: string[],
) {
  if (bookedPropertyIds.length > 0) {
    query = query.not("property_id", "in", `(${bookedPropertyIds.join(",")})`);
  }

  if (filters.maxPrice !== undefined) {
    query = query.lte("price_per_night", filters.maxPrice);
  }

  if (filters.maxGuests !== undefined) {
    query = query.gte("max_guests", filters.maxGuests);
  }

  if (filters.location) {
    query = query.ilike("location", `%${filters.location}%`);
  }

  if (filters.sort) {
    query = query.order("price_per_night", {
      ascending: filters.sort === "asc",
    });
  }

  return query;
}

export async function getProperties(
  sb: BasicSupabaseClient,
  filters: PropertyListFilter,
): Promise<Property[]> {
  const bookedPropertyIds = await getBookedPropertyIds(sb, filters);
  const query = buildPropertiesFilter(selectProperties(sb), filters, bookedPropertyIds);

  const { error, data } = await query;

  if (!error) {
    return data;
  }
  throw error;
}

export async function getPropertiesByKind(
  sb: BasicSupabaseClient,
  kind: PropertyKind,
  filters: PropertyListFilter,
): Promise<Property[]> {
  const bookedPropertyIds = await getBookedPropertyIds(sb, filters);
  const query = buildPropertiesFilter(
    selectProperties(sb).eq(QUERY_KIND, kind),
    filters,
    bookedPropertyIds,
  );

  const { error, data } = await query;

  if (!error) {
    return data;
  }
  throw error;
}

export async function getPropertyById(
  sb: BasicSupabaseClient,
  propertyId: string,
): Promise<Property | null> {
  const { error, data }: PostgrestSingleResponse<Property> = await sb
    .from(TABLE_NAME)
    .select(SELECT_QUERY)
    .eq(QUERY_ID, propertyId)
    .single();

  if (error?.code === "PGRST116") {
    return null;
  }

  if (!error) {
    return data;
  }
  throw error;
}

export async function createProperty(sb: BasicSupabaseClient, propertyBody: NewProperty) {
  const { error, data }: PostgrestSingleResponse<Property> = await sb
    .from(TABLE_NAME)
    .insert(propertyBody)
    .select(SELECT_QUERY)
    .single();

  if (!error) {
    return data;
  }
  throw error;
}

export async function updatePropertyById(
  sb: BasicSupabaseClient,
  propertyId: string,
  property: Partial<Property>,
): Promise<Property> {
  const { error, data }: PostgrestSingleResponse<Property> = await sb
    .from(TABLE_NAME)
    .update(property)
    .eq(QUERY_ID, propertyId)
    .select()
    .single();

  if (!error) {
    return data;
  }
  throw error;
}

export async function deletePropertyById(sb: BasicSupabaseClient, propertyId: string) {
  const { error }: PostgrestSingleResponse<Property> = await sb
    .from(TABLE_NAME)
    .delete()
    .eq(QUERY_ID, propertyId)
    .select()
    .single();

  if (!error) {
    return;
  }
  throw error;
}
