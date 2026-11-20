import { randomBytes, timingSafeEqual } from "node:crypto";
import type { CookieOptions, RequestHandler } from "express";
import { Passport } from "passport";
import { Strategy as GoogleStrategy, type GoogleCallbackParameters, type VerifyCallback } from "passport-google-oauth20";
import type { StateStore } from "passport-oauth2";
import { authService } from "../modules/auth/auth.service.js";
import type { PublicUser } from "../modules/users/user.interface.js";
import { AppError } from "../utils/app-error.js";
import { readCookie } from "../utils/cookies.js";
import { env, isProduction } from "./env.js";

/**
 * Google OAuth 2.0 redirect flow (Passport + passport-google-oauth20).
 *
 *   GET /auth/google           → redirect to Google's consent screen
 *   GET /auth/google/callback  → Google redirects back with `code` + `state`
 *
 * A browser can sign in with Google without any frontend, so the flow can be
 * demonstrated from the API alone. It complements the ID-token flow
 * (POST /auth/google) and ends in exactly the same sign-in:
 *
 *  - Passport exchanges the code for tokens server-to-server, using the client
 *    secret. Passport's profile is NOT used: the `id_token` from Google's token
 *    response goes through `verifyGoogleIdToken` (signature, issuer, audience,
 *    verified email) and the safe account-linking rules of
 *    `authService.findOrCreateGoogleUser`, like POST /auth/google.
 *  - No server sessions (they do not survive serverless): the CSRF `state` and
 *    the PKCE code verifier live in a short-lived HTTP-only cookie that is only
 *    sent to the /auth/google routes. The JWT session is issued afterwards by
 *    the auth controller.
 */

export const GOOGLE_OAUTH_STATE_COOKIE = "googleOAuthState";
const STATE_TTL_MS = 10 * 60 * 1000;
const GOOGLE_SCOPES = ["openid", "email", "profile"];
const INVALID_STATE = "Google sign-in expired or was started elsewhere. Please start again";

const stateCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  // Lax: the cookie must come back on Google's top-level redirect to us.
  sameSite: "lax",
  path: "/api/v1/auth/google",
};

/** Callback URL registered in GCP; defaults to BACKEND_URL + the callback route. */
export const googleCallbackUrl =
  env.GOOGLE_CALLBACK_URL ?? new URL("/api/v1/auth/google/callback", env.BACKEND_URL).toString();

const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/**
 * Cookie-backed state store. passport-oauth2 picks the call shape by the
 * method's arity, so `store` deliberately takes 5 parameters (PKCE variant).
 */
const cookieStateStore = {
  store(
    req: { res?: { cookie: (name: string, value: string, options: CookieOptions) => unknown } },
    verifier: string,
    _state: unknown,
    _meta: unknown,
    callback: (err: Error | null, state?: string) => void,
  ): void {
    // base64url never contains ".", so "<state>.<verifier>" splits safely.
    const state = randomBytes(32).toString("base64url");
    req.res?.cookie(GOOGLE_OAUTH_STATE_COOKIE, `${state}.${verifier}`, { ...stateCookieOptions, maxAge: STATE_TTL_MS });
    callback(null, state);
  },

  verify(
    req: Parameters<typeof readCookie>[0],
    providedState: unknown,
    callback: (err: Error | null, verifier: string | false, info?: { message: string }) => void,
  ): void {
    const stored = readCookie(req, GOOGLE_OAUTH_STATE_COOKIE);
    // One-time use: the state is cleared whatever the outcome.
    req.res?.clearCookie(GOOGLE_OAUTH_STATE_COOKIE, stateCookieOptions);

    const [state, verifier] = stored?.split(".") ?? [];
    if (!state || !verifier || typeof providedState !== "string" || !safeEqual(state, providedState)) {
      callback(null, false, { message: INVALID_STATE });
      return;
    }
    callback(null, verifier);
  },
};

/** Passport verify callback: the ID token is verified and the user found, linked or created. */
const verifyGoogleSignIn = (
  _accessToken: string,
  _refreshToken: string,
  params: GoogleCallbackParameters,
  _profile: unknown,
  done: VerifyCallback,
): void => {
  if (!params.id_token) {
    done(AppError.unauthorized("Google did not return an ID token"));
    return;
  }
  authService.findOrCreateGoogleUser(params.id_token).then(
    (user) => done(null, user),
    (error: unknown) => done(error),
  );
};

// A dedicated Passport instance: no global state, no sessions.
const googlePassport = new Passport();

const isConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  googlePassport.use(
    "google",
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackURL: googleCallbackUrl,
        scope: GOOGLE_SCOPES,
        pkce: true,
        // Typed for the 2–4 argument store shapes only; see cookieStateStore.
        store: cookieStateStore as unknown as StateStore,
        // The identity comes from the verified ID token, not the userinfo profile.
        skipUserProfile: true,
      },
      verifyGoogleSignIn,
    ),
  );
}

/** The redirect flow needs the client secret; the ID-token flow only needs the client ID. */
const assertConfigured = () => {
  if (!isConfigured) {
    throw new AppError(503, "Google OAuth redirect login is not configured on this server");
  }
};

/** GET /auth/google – redirects the browser to Google (and sets the state cookie). */
export const startGoogleOAuth: RequestHandler = (req, res, next) => {
  assertConfigured();
  const redirectToGoogle = googlePassport.authenticate("google", {
    session: false,
    prompt: "select_account",
  }) as RequestHandler;
  redirectToGoogle(req, res, next);
};

/**
 * GET /auth/google/callback – checks `state`, exchanges the code, verifies the
 * ID token and stores the signed-in user on `res.locals.googleUser` for the
 * controller. Every failure becomes a standard JSON error.
 */
export const completeGoogleOAuth: RequestHandler = (req, res, next) => {
  assertConfigured();
  const query = req.query as Record<string, unknown>;
  if (typeof query.error === "string") {
    // The user cancelled or Google refused; clear the pending state.
    res.clearCookie(GOOGLE_OAUTH_STATE_COOKIE, stateCookieOptions);
    throw AppError.unauthorized("Google sign-in was cancelled or denied");
  }
  if (typeof query.code !== "string" || query.code.length === 0) {
    // Without this check Passport would silently start a NEW sign-in.
    throw AppError.badRequest("Missing authorization code from Google");
  }

  const handleGoogleResult = googlePassport.authenticate(
    "google",
    { session: false },
    (error: unknown, user: PublicUser | false, info: { message?: string } | undefined) => {
      if (error instanceof AppError) {
        // From verifyGoogleSignIn: invalid ID token, admin account, conflict, …
        next(error);
        return;
      }
      if (error) {
        // Google rejected the code exchange (bad, expired or reused code).
        next(AppError.unauthorized("Google sign-in failed. Please start again"));
        return;
      }
      if (!user) {
        next(AppError.unauthorized(info?.message || INVALID_STATE));
        return;
      }
      res.locals.googleUser = user;
      next();
    },
  ) as RequestHandler;
  handleGoogleResult(req, res, next);
};
