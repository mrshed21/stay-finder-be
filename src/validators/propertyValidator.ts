import * as z from "zod";
import { zValidator } from "@hono/zod-validator";
import { getValidatorError } from "../utils/validation.js";
import type { PropertyKind } from "../types/property.js";

const propertySchema = z.object({
  title: z.string().trim().min(2, "Title must be at least 2 characters"),
  description: z.string().trim().min(3, "Description must be at least 3 characters"),
  max_guests: z.number().int().min(1, "Max guests must be at least 1").max(2147483647),
  price_per_night: z
    .number()
    .finite()
    .min(100, "Price per night must be at least 100")
    .max(99999999.99, "Price per night is too high"),
  location: z.string().trim().min(2, "Location must be at least 2 characters"),
  kind: z.enum<PropertyKind[]>(
    ["apartment", "villa"],
    `Must be one of "apartment", "villa"`,
  ),
});

const propertyOptionalSchema = propertySchema
  .partial()
  .refine((property) => Object.keys(property).length > 0, "Provide at least one property field");

const propertyIdParamSchema = z.object({
  id: z.uuid("Property ID must be a UUID"),
});

const propertyListQuerySchema = z.object({
  location: z.string().trim().min(1).max(100).optional(),
  maxprice: z.coerce.number().finite().nonnegative().optional(),
  maxguests: z.coerce.number().int().min(1).optional(),
  sort: z.enum(["asc", "desc"]).optional(),
});

const propertyParamSchema = z.object({
  kind: z.enum<PropertyKind[]>(
    ["apartment", "villa"],
    `Param must be one of "apartment", "villa"`,
  ),
});

export const propertyValidator = zValidator(
  "json",
  propertySchema,
  (result, c) => {
    if (!result.success) {
      return c.json(getValidatorError(result.error), 400);
    }
  },
);

export const propertyOptionalValidator = zValidator(
  "json",
  propertyOptionalSchema,
  (result, c) => {
    if (!result.success) {
      return c.json(getValidatorError(result.error), 400);
    }
  },
);

export const propertyParamValidator = zValidator(
  "param",
  propertyParamSchema,
  (result, c) => {
    if (!result.success) {
      return c.json(getValidatorError(result.error), 400);
    }
  },
);

export const propertyIdParamValidator = zValidator(
  "param",
  propertyIdParamSchema,
  (result, c) => {
    if (!result.success) {
      return c.json(getValidatorError(result.error), 400);
    }
  },
);

export const propertyListQueryValidator = zValidator(
  "query",
  propertyListQuerySchema,
  (result, c) => {
    if (!result.success) {
      return c.json(getValidatorError(result.error), 400);
    }
  },
);
