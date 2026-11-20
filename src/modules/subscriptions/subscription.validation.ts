import { z } from "zod";
import { NON_EMPTY_BODY_MESSAGE, nonEmptyBody, uuidSchema } from "../../utils/validation.js";

// GET /plans and GET /subscriptions/current take no input. Plan management
// (PATCH /admin/plans/:planId, SUPER_ADMIN only) is validated here because
// plans belong to the subscription domain; the admin router mounts it.

export const planIdParamsSchema = z.object({ planId: uuidSchema("plan ID") });

const limitSchema = z.number().int().min(1).max(100_000);

/** `null` limits mean "unlimited"; `null` durationDays means "never expires" (FREE). */
export const updatePlanSchema = z
  .strictObject({
    price: z
      .string()
      .regex(/^\d{1,8}(\.\d{1,2})?$/, "Price must be a decimal string such as \"1500.00\"")
      .optional(),
    durationDays: z.number().int().min(1).max(3650).nullable().optional(),
    maxMembers: limitSchema.optional(),
    maxProjects: limitSchema.nullable().optional(),
    maxTasksPerProject: limitSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine(nonEmptyBody, { message: NON_EMPTY_BODY_MESSAGE });
