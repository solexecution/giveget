import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { randomBytes } from "node:crypto";
import { getUserBySession, type User } from "./db";
import type { Theme } from "./views";

const COOKIE_NAME = "gg_sid";
const THEME_COOKIE = "gg_theme";
const ONE_YEAR_SECS = 60 * 60 * 24 * 365;

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
    deleteCookie(c, THEME_COOKIE, { path: "/" });
    return;
  }
  setCookie(c, THEME_COOKIE, theme, {
    path: "/",
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_YEAR_SECS,
  });
}

export function toggleTheme(current: Theme): Theme {
  // Binary toggle: default (undefined ≈ dark via OS) → light; light → dark; dark → light.
  return current === "light" ? "dark" : "light";
}

export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

export function getSessionToken(c: Context): string | null {
  return getCookie(c, COOKIE_NAME) ?? null;
}

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, COOKIE_NAME, token, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_YEAR_SECS,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, COOKIE_NAME, { path: "/" });
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
