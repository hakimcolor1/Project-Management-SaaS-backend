import { createHash } from "node:crypto";
import oauth from "oauth";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { GoogleProfile } from "../src/config/google.js";
import { prisma, resetDatabase } from "./helpers/db.js";
import { createUser } from "./helpers/factories.js";

// This file runs with a configured Google OAuth client (the env is read when
// the app is imported, so it is set before any import runs).
const { verifyGoogleIdToken } = vi.hoisted(() => {
  process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
  return { verifyGoogleIdToken: vi.fn<(idToken: string) => Promise<GoogleProfile>>() };
});
// Google's signature check is the library's job (see the ID-token tests);
// here we control what a *verified* token contains.
vi.mock("../src/config/google.js", () => ({ verifyGoogleIdToken }));

const { default: app } = await import("../src/app.js");

const START = "/api/v1/auth/google";
const CALLBACK = "/api/v1/auth/google/callback";
const CALLBACK_URL = "http://localhost:5000/api/v1/auth/google/callback";
const STATE_COOKIE = "googleOAuthState";
const ID_TOKEN = "google-issued-id-token";

const profile: GoogleProfile = {
  googleId: "google-sub-123",
  email: "jane.redirect@example.com",
  name: "Jane Redirect",
  avatar: "https://lh3.googleusercontent.com/a/jane",
};

type TokenCallback = (err: unknown, accessToken?: string, refreshToken?: string, results?: object) => void;

/** Stubs only the server-to-server code exchange with Google's token endpoint. */
// passport-oauth2 calls getOAuthAccessToken(code, params, callback); the typings
// only allow one overload here, hence the rest arguments.
const mockTokenExchange = (outcome: { results?: object; error?: unknown }) =>
  vi.spyOn(oauth.OAuth2.prototype, "getOAuthAccessToken").mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as TokenCallback;
    if (outcome.error) callback(outcome.error);
    else callback(null, "google-access-token", "", outcome.results ?? {});
  });

const getCookies = (res: request.Response): string[] => {
  const header = res.headers["set-cookie"] as string[] | string | undefined;
  return Array.isArray(header) ? header : header ? [header] : [];
};

const findCookie = (res: request.Response, name: string) => getCookies(res).find((c) => c.startsWith(`${name}=`));

/** Starts the flow like a browser would and returns what Google would receive. */
const startFlow = async () => {
  const res = await request(app).get(START);
  expect(res.status).toBe(302);
  const location = new URL(res.headers.location as string);
  const stateCookie = findCookie(res, STATE_COOKIE);
  expect(stateCookie).toBeDefined();
  const cookieValue = decodeURIComponent(stateCookie!.split(";")[0]!.slice(STATE_COOKIE.length + 1));
  const [cookieState, verifier] = cookieValue.split(".");
  return { res, location, stateCookie: stateCookie!, cookieState, verifier, state: location.searchParams.get("state")! };
};

beforeEach(async () => {
  await resetDatabase();
  verifyGoogleIdToken.mockReset();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /auth/google (start)", () => {
  it("redirects to Google with client id, callback, scopes, state and a PKCE S256 challenge", async () => {
    const { location, stateCookie, cookieState, verifier, state } = await startFlow();

    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(location.searchParams)).toMatchObject({
      client_id: "test-client-id.apps.googleusercontent.com",
      redirect_uri: CALLBACK_URL,
      response_type: "code",
      scope: "openid email profile",
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    // The challenge sent to Google is derived from the verifier kept in the cookie.
    expect(state).toMatch(/^[\w-]{43}$/);
    expect(cookieState).toBe(state);
    expect(location.searchParams.get("code_challenge")).toBe(
      createHash("sha256").update(verifier!).digest("base64url"),
    );
    // The client secret never reaches the browser.
    expect(location.toString()).not.toContain("test-client-secret");

    expect(stateCookie).toMatch(/HttpOnly/i);
    expect(stateCookie).toMatch(/SameSite=Lax/i);
    expect(stateCookie).toMatch(/Path=\/api\/v1\/auth\/google/);
    expect(stateCookie).toMatch(/Max-Age=600/);
  });

  it("uses a fresh state for every attempt", async () => {
    const first = await startFlow();
    const second = await startFlow();
    expect(first.state).not.toBe(second.state);
    expect(first.verifier).not.toBe(second.verifier);
  });
});

describe("GET /auth/google/callback", () => {
  it("exchanges the code with the PKCE verifier, verifies the ID token and signs the user in", async () => {
    const exchange = mockTokenExchange({ results: { id_token: ID_TOKEN, token_type: "Bearer" } });
    verifyGoogleIdToken.mockResolvedValue(profile);
    const { stateCookie, state, verifier } = await startFlow();

    const res = await request(app)
      .get(CALLBACK)
      .query({ code: "auth-code-from-google", state })
      .set("Cookie", stateCookie.split(";")[0]!);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Google login successful");
    expect(res.body.data.user).toMatchObject({
      email: profile.email,
      name: profile.name,
      role: "TEAM_OWNER",
      emailVerified: true,
    });
    expect(res.body.data.user).not.toHaveProperty("password");
    expect(res.body.data.user).not.toHaveProperty("googleId");

    // Code exchange: server-to-server, with the verifier from the cookie.
    expect(exchange).toHaveBeenCalledOnce();
    const [code, params] = exchange.mock.calls[0]!;
    expect(code).toBe("auth-code-from-google");
    expect(params).toMatchObject({
      grant_type: "authorization_code",
      redirect_uri: CALLBACK_URL,
      code_verifier: verifier,
    });
    // The identity comes from the verified ID token, not from Passport's profile.
    expect(verifyGoogleIdToken).toHaveBeenCalledWith(ID_TOKEN);

    // Session cookies set, one-time state cleared.
    expect(findCookie(res, "accessToken")).toMatch(/HttpOnly/i);
    expect(findCookie(res, "refreshToken")).toMatch(/HttpOnly/i);
    expect(findCookie(res, STATE_COOKIE)).toMatch(/Expires=Thu, 01 Jan 1970/);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: profile.email } });
    expect(stored).toMatchObject({ googleId: profile.googleId, password: null, role: "TEAM_OWNER" });
    expect(await prisma.refreshToken.count({ where: { userId: stored.id } })).toBe(1);

    // The issued access token works on protected routes.
    const me = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${res.body.data.accessToken as string}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(profile.email);
  });

  it("applies the same account-linking rules as POST /auth/google (admins refused)", async () => {
    const admin = await createUser({ role: "SUPER_ADMIN", email: "admin.redirect@example.com" });
    mockTokenExchange({ results: { id_token: ID_TOKEN } });
    verifyGoogleIdToken.mockResolvedValue({ ...profile, email: admin.email });
    const { stateCookie, state } = await startFlow();

    const res = await request(app).get(CALLBACK).query({ code: "c", state }).set("Cookie", stateCookie.split(";")[0]!);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      success: false,
      message: "Google login is not available for administrator accounts",
      errors: [],
    });
    expect(await prisma.refreshToken.count()).toBe(0);
  });

  it("rejects a callback without the state cookie (CSRF / login fixation)", async () => {
    const exchange = mockTokenExchange({ results: { id_token: ID_TOKEN } });
    const { state } = await startFlow();

    const res = await request(app).get(CALLBACK).query({ code: "c", state });

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Google sign-in expired or was started elsewhere. Please start again");
    expect(exchange).not.toHaveBeenCalled();
    expect(await prisma.user.count()).toBe(0);
  });

  it("rejects a state that does not match the cookie", async () => {
    const exchange = mockTokenExchange({ results: { id_token: ID_TOKEN } });
    const { stateCookie } = await startFlow();
    const other = await startFlow();

    const res = await request(app)
      .get(CALLBACK)
      .query({ code: "c", state: other.state })
      .set("Cookie", stateCookie.split(";")[0]!);

    expect(res.status).toBe(401);
    expect(exchange).not.toHaveBeenCalled();
  });

  it("reports a cancelled consent screen without calling Google", async () => {
    const exchange = mockTokenExchange({ results: { id_token: ID_TOKEN } });
    const { stateCookie, state } = await startFlow();

    const res = await request(app)
      .get(CALLBACK)
      .query({ error: "access_denied", state })
      .set("Cookie", stateCookie.split(";")[0]!);

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Google sign-in was cancelled or denied");
    expect(findCookie(res, STATE_COOKIE)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(exchange).not.toHaveBeenCalled();
  });

  it("returns 400 when Google sent no code (instead of silently starting a new sign-in)", async () => {
    const res = await request(app).get(CALLBACK);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: "Missing authorization code from Google", errors: [] });
    expect(res.headers.location).toBeUndefined();
  });

  it("returns 401 when Google rejects the code exchange", async () => {
    mockTokenExchange({ error: { statusCode: 400, data: '{"error":"invalid_grant"}' } });
    const { stateCookie, state } = await startFlow();

    const res = await request(app).get(CALLBACK).query({ code: "used", state }).set("Cookie", stateCookie.split(";")[0]!);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, message: "Google sign-in failed. Please start again", errors: [] });
    expect(verifyGoogleIdToken).not.toHaveBeenCalled();
  });

  it("returns 401 when Google's token response has no ID token", async () => {
    mockTokenExchange({ results: { access_token: "only-access" } });
    const { stateCookie, state } = await startFlow();

    const res = await request(app).get(CALLBACK).query({ code: "c", state }).set("Cookie", stateCookie.split(";")[0]!);

    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Google did not return an ID token");
    expect(await prisma.user.count()).toBe(0);
  });
});
