import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { getUserBySession, type User } from "./db";
import type { Theme } from "./views";

const COOKIE_NAME = "gg_sid";
const THEME_COOKIE = "gg_theme";
const REMEMBER_COOKIE = "gg_remember";
const CSRF_COOKIE = "gg_csrf";

/** Persistent login when "Remember me" is checked (default). */
export const SESSION_REMEMBER_MAX_AGE = 60 * 60 * 24 * 365;
const CSRF_MAX_AGE = 60 * 60 * 2;

export function isSecureCookie(c: Context): boolean {
  if (process.env.NODE_ENV === "production") return true;
  const proto = c.req.header("x-forwarded-proto");
  return proto === "https";
}

function cookieBase(c: Context) {
  return {
    path: "/",
    sameSite: "Lax" as const,
    secure: isSecureCookie(c),
  };
}

export function getTheme(c: Context): Theme {
  const v = getCookie(c, THEME_COOKIE);
  return v === "light" || v === "dark" ? v : undefined;
}

/**
 * Best-effort client IP. Trusts X-Forwarded-For / X-Real-IP when behind a proxy
 * (Caddy is configured to set these). Falls back to "unknown" in pure-localhost
 * dev where no proxy fronts the server.
 *
 * Note: Spoofable when traffic is NOT behind a trusted proxy. In v0 we deploy
 * behind Caddy so that's fine; in dev we tolerate "unknown".
 */
export function getClientIp(c: Context): string {
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  const real = c.req.header("x-real-ip");
  if (real) return real.trim();
  // Bun's Hono adapter doesn't expose the TCP source via Context. In dev,
  // bare localhost requests have no proxy headers and we record "unknown".
  return "unknown";
}

export function getUserAgent(c: Context): string {
  return (c.req.header("user-agent") ?? "").slice(0, 500);
}

export function setTheme(c: Context, theme: Theme): void {
  if (!theme) {
    deleteCookie(c, THEME_COOKIE, cookieBase(c));
    return;
  }
  setCookie(c, THEME_COOKIE, theme, {
    ...cookieBase(c),
    maxAge: SESSION_REMEMBER_MAX_AGE,
  });
}

export function toggleTheme(current: Theme): Theme {
  return current === "light" ? "dark" : "light";
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function getSessionToken(c: Context): string | null {
  return getCookie(c, COOKIE_NAME) ?? null;
}

export function wantsPersistentSession(c: Context): boolean {
  return getCookie(c, REMEMBER_COOKIE) === "1";
}

/**
 * remember=true (default): persistent cookie for PWA / browser restarts.
 * remember=false: session cookie cleared when the browser closes.
 */
export function setSessionCookie(c: Context, token: string, remember = true): void {
  const base = cookieBase(c);
  setCookie(c, COOKIE_NAME, token, {
    ...base,
    httpOnly: true,
    ...(remember ? { maxAge: SESSION_REMEMBER_MAX_AGE } : {}),
  });
  if (remember) {
    setCookie(c, REMEMBER_COOKIE, "1", { ...base, httpOnly: true, maxAge: SESSION_REMEMBER_MAX_AGE });
  } else {
    deleteCookie(c, REMEMBER_COOKIE, base);
  }
}

/** Extend persistent sessions on activity so mobile PWAs stay signed in. */
export function touchSessionCookie(c: Context): void {
  const token = getSessionToken(c);
  if (!token || !wantsPersistentSession(c)) return;
  setSessionCookie(c, token, true);
}

export function clearSessionCookie(c: Context): void {
  const base = cookieBase(c);
  deleteCookie(c, COOKIE_NAME, base);
  deleteCookie(c, REMEMBER_COOKIE, base);
}

export function ensureCsrfToken(c: Context): string {
  let token = getCookie(c, CSRF_COOKIE);
  if (!token) {
    token = generateToken();
    setCookie(c, CSRF_COOKIE, token, {
      ...cookieBase(c),
      httpOnly: true,
      maxAge: CSRF_MAX_AGE,
    });
  }
  return token;
}

export function verifyCsrfToken(c: Context, formToken: string): boolean {
  const cookie = getCookie(c, CSRF_COOKIE);
  return !!cookie && !!formToken && cookie === formToken;
}

export function getCurrentUser(c: Context): User | null {
  const token = getSessionToken(c);
  if (!token) return null;
  return getUserBySession(token);
}

export function requireUser(c: Context): User {
  const u = getCurrentUser(c);
  if (!u) throw new HttpError(401, "You need to pick a nickname first.");
  return u;
}

export function requireCoordinator(c: Context): User {
  const u = requireUser(c);
  if (!u.is_coordinator) throw new HttpError(403, "Coordinators only.");
  return u;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
