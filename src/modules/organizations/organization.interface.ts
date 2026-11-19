import type { z } from "zod";
import type {
  addMemberSchema,
  createOrganizationSchema,
  listMembersQuerySchema,
  updateMemberSchema,
  updateOrganizationSchema,
} from "./organization.validation.js";

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type UpdateMemberInput = z.infer<typeof updateMemberSchema>;
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;
