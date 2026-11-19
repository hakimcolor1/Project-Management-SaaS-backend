import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { AppError } from "../utils/app-error.js";
import { env } from "./env.js";

/**
 * Google sign-in uses the ID-token flow: the frontend obtains an ID token from
 * Google Identity Services and posts it to POST /auth/google, where it is
 * verified here with Google's official library. (No Passport/redirect flow is
 * needed for this, so GOOGLE_CLIENT_SECRET / GOOGLE_CALLBACK_URL are unused.)
 */

const GOOGLE_ISSUERS = new Set(["accounts.google.com", "https://accounts.google.com"]);

const googleClient = env.GOOGLE_CLIENT_ID ? new OAuth2Client({ clientId: env.GOOGLE_CLIENT_ID }) : null;

/** Identity taken ONLY from a verified Google ID token – never from client-sent profile data. */
export interface GoogleProfile {
  googleId: string;
  email: string;
  name: string;
  avatar: string | null;
}

export const verifyGoogleIdToken = async (idToken: string): Promise<GoogleProfile> => {
  if (!googleClient || !env.GOOGLE_CLIENT_ID) {
    throw new AppError(503, "Google login is not configured on this server");
  }

  let payload: TokenPayload | undefined;
  try {
    // Checks the signature against Google's public keys, expiry and audience.
    const ticket = await googleClient.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw AppError.unauthorized("Invalid Google ID token");
  }

  // Explicit issuer + audience checks (defence in depth).
  if (!payload || !GOOGLE_ISSUERS.has(payload.iss) || payload.aud !== env.GOOGLE_CLIENT_ID) {
    throw AppError.unauthorized("Invalid Google ID token");
  }
  if (!payload.email || payload.email_verified !== true) {
    throw AppError.unauthorized("Your Google account email is not verified");
  }

  const email = payload.email.trim().toLowerCase();
  const name = (payload.name?.trim() || email.split("@")[0] || "Google user").slice(0, 100);
  const avatar = payload.picture && payload.picture.length <= 500 ? payload.picture : null;

  return { googleId: payload.sub, email, name, avatar };
};
