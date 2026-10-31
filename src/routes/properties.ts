import { Hono } from "hono";

import {
  propertyOptionalValidator,
  propertyIdParamValidator,
  propertyListQueryValidator,
  propertyParamValidator,
  propertyValidator,
} from "../validators/propertyValidator.js";
import {
  createProperty,
  deletePropertyById,
  getProperties,
  getPropertiesByKind,
  getPropertyById,
  updatePropertyById,
} from "../database/properties.js";
import { requireAuth } from "../middleware/auth.js";

import type { User } from "@supabase/supabase-js";
import type { Property } from "../types/property.js";

const properties = new Hono({ strict: false });

properties.get("/", propertyListQueryValidator, async (c) => {
  const sb = c.get("supabase");
  const filters = c.req.valid("query");
  try {
    const properties = await getProperties(sb, {
      maxPrice: filters.maxprice,
      location: filters.location,
      maxGuests: filters.maxguests,
      sort: filters.sort,
    });
    return c.json(properties);
  } catch (e) {
    console.error("Error fetching properties from database", e);
    return c.json({ error: "Could not fetch properties" }, 500);
  }
});

// GET: properties either properties/kind/villa/ | properties/kind/appartment/
// If not neither of those 400
// Filter properties based on the kind
// Extra add all previous search filtering from GET: properties
properties.get("/kind/:kind", propertyParamValidator, propertyListQueryValidator, async (c) => {
  const kind = c.req.valid("param").kind;
  const sb = c.get("supabase");
  const filters = c.req.valid("query");
  try {
    const properties = await getPropertiesByKind(sb, kind, {
      maxPrice: filters.maxprice,
      location: filters.location,
      maxGuests: filters.maxguests,
      sort: filters.sort,
    });
    return c.json(properties);
  } catch (e) {
    console.error("Error fetching properties from database", e);
    return c.json({ error: "Could not fetch properties" }, 500);
  }
});

// individuell GET hämta en Property om den finns baserat på ID annars null 404
properties.get("/:id", propertyIdParamValidator, async (c) => {
  const propertyId = c.req.valid("param").id;
  const sb = c.get("supabase");
  try {
    const property = await getPropertyById(sb, propertyId);
    if (!property) {
      return c.json({ error: "Property not found" }, 404);
    }
    return c.json(property);
  } catch (e) {
    console.error("Error fetching property from database", e);
    return c.json({ error: "Could not fetch property" }, 500);
  }
});

// "Skpande" av en Propery POST genom en JSON body använd Postman eller thunderclient för detta
properties.post("/", requireAuth, propertyValidator, async (c) => {
  const propertyBody = c.req.valid("json");
  const sb = c.get("supabase");
  const user = c.get("user") as User;
  try {
    const property = await createProperty(sb, {
      ...propertyBody,
      user_id: user.id,
    });
    return c.json(property, 201);
  } catch (e) {
    console.error("Error creating property in database", e);
    return c.json({ error: "Could not create property" }, 500);
  }
});

// Extra: "Updaterande" av en Property PUT/PATCH (för patch kolla Partial types)
// om den finns tänk en blandning mellan GET + POST
properties.patch("/:id", requireAuth, propertyIdParamValidator, propertyOptionalValidator, async (c) => {
  const propertyId = c.req.valid("param").id;
  const propertyBody: Partial<Property> = c.req.valid("json");
  const sb = c.get("supabase");
  const user = c.get("user");
  try {
    const existingProperty = await getPropertyById(sb, propertyId);
    if (!existingProperty) {
      return c.json({ error: "Property not found" }, 404);
    }
    if (existingProperty.user_id !== user?.id) {
      return c.json({ error: "You do not own this property" }, 403);
    }

    const property = await updatePropertyById(sb, propertyId, propertyBody);
    return c.json(property);
  } catch (e) {
    console.error("Error updating property in database", e);
    return c.json({ error: "Could not update property" }, 500);
  }
});

// Extra: "bortagning" av en Property DELETE om den finns tänk en GET som sedan tar bort 200/204
properties.delete("/:id", requireAuth, propertyIdParamValidator, async (c) => {
  const propertyId = c.req.valid("param").id;
  const sb = c.get("supabase");
  const user = c.get("user");
  try {
    const existingProperty = await getPropertyById(sb, propertyId);
    if (!existingProperty) {
      return c.json({ error: "Property not found" }, 404);
    }
    if (existingProperty.user_id !== user?.id) {
      return c.json({ error: "You do not own this property" }, 403);
    }

    await deletePropertyById(sb, propertyId);
    return c.body(null, 204);
  } catch (e) {
    console.error("Error deleting property from database", e);
    return c.json({ error: "Could not delete property" }, 500);
  }
});
export default properties;
