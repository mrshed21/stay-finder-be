import * as z from "zod";
import { zValidator } from "@hono/zod-validator";
import { getValidatorError } from "../utils/validation.js";

function isValidDate(value: string): boolean {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

const bookingFields = {
  guest_name: z.string().trim().min(2, "Guest name must be at least 2 characters"),
  guest_email: z.email("Enter a valid email address"),
  check_in: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Check in must use YYYY-MM-DD")
    .refine(isValidDate, "Check in must be a valid calendar date"),
  check_out: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Check out must use YYYY-MM-DD")
    .refine(isValidDate, "Check out must be a valid calendar date"),
  guests: z.number().int().min(1, "At least one guest is required"),
};

const dateOrder = {
  message: "Check out must be after check in",
  path: ["check_out"],
};

const bookingSchema = z.object(bookingFields).refine(
  (data) => data.check_in < data.check_out,
  dateOrder,
);

const bookingOptionalSchema = z.object(bookingFields)
  .strict()
  .partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one booking field is required",
  })
  .refine(
    (data) => !data.check_in || !data.check_out || data.check_in < data.check_out,
    dateOrder,
  );

export const bookingValidator = zValidator(
  "json",
  bookingSchema,
  (result, c) => {
    if (!result.success) {
      return c.json(getValidatorError(result.error), 400);
    }
  },
);

export const bookingOptionalValidator = zValidator(
  "json",
  bookingOptionalSchema,
  (result, c) => {
    if (!result.success) {
      return c.json(getValidatorError(result.error), 400);
    }
  },
);
