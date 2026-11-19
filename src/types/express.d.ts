import type { OrganizationContext } from "../middlewares/organization.middleware.js";
import type { AuthUser } from "../modules/auth/auth.interface.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware. */
      user?: AuthUser;
      /** Set by the `requireOrganization` middleware. */
      organization?: OrganizationContext;
    }
  }
}

export {};
