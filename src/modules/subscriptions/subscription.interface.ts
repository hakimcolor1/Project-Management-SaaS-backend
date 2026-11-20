import type { z } from "zod";
import type { updatePlanSchema } from "./subscription.validation.js";

export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
