import type { OrganizationContext } from "../middlewares/organization.middleware.js";
import type { AuthUser } from "../modules/auth/auth.interface.js";

declare global {
  namespace Express {
    /**
     * `req.user` (declared by @types/passport as `user?: User`) is the user
     * set by the `authenticate` middleware. Passport itself never sets it
     * here: the Google flow runs without sessions.
     */
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends AuthUser {}

    interface Request {
      /** Set by the `requireOrganization` middleware. */
      organization?: OrganizationContext;
    }
  }
}

export {};
