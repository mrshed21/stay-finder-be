import * as z from "zod";
import { zValidator } from "@hono/zod-validator";
import { getValidatorError } from "../utils/validation.js";
import { isValidDate } from "./bookingValidator.js";
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

// VG7: optional stay dates, YYYY-MM-DD.
const searchDate = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must use YYYY-MM-DD")
  .refine(isValidDate, "Dates must be valid calendar dates");

const propertyListQuerySchema = z.object({
  location: z.string().trim().min(1).max(100).optional(),
  maxprice: z.coerce.number().finite().nonnegative().optional(),
  maxguests: z.coerce.number().int().min(1).optional(),
  sort: z.enum(["asc", "desc"]).optional(),
  checkin: searchDate.optional(),
  checkout: searchDate.optional(),
})
  .refine((query) => !query.checkin === !query.checkout, {
    message: "Give both checkin and checkout",
    path: ["checkout"],
  })
  .refine((query) => !query.checkin || !query.checkout || query.checkin < query.checkout, {
    message: "Check out must be after check in",
    path: ["checkout"],
  })
  .refine((query) => !query.checkin || query.checkin >= new Date().toISOString().slice(0, 10), {
    message: "Check in cannot be in the past",
    path: ["checkin"],
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
