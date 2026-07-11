import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  countSignupsByIpLast24h,
  createUser,
  expireOldListings,
  getUserByNickname,
  findExistingNicknameIgnoreCase,
  nicknameExists,
  RATE_LIMITS,
  setSessionToken,
  touchUserDevice,
} from "./db";
import {
  clearSessionCookie,
  ensureCsrfToken,
  generateToken,
  getClientIp,
  getCurrentUser,
  getTheme,
  getUserAgent,
  HttpError,
  setSessionCookie,
  setTheme,
  toggleTheme,
  touchSessionCookie,
  verifyCsrfToken,
} from "./session";
import { errorPage, esc, html, layout, loggedInCard, loginCard, raw } from "./views";
import { photoExists, photoPath } from "./images";

import { browseRoute, newListingRoutes, listingDetailRoute } from "./routes/listings";
import { claimRoutes } from "./routes/claims";
import { profileRoutes } from "./routes/profile";
import { coordRoutes } from "./routes/coord";
import { deviceAuthRoutes } from "./routes/device-auth";
import { getCoordNavVisible } from "./device-auth";

const app = new Hono();

function requestHost(c: { req: { header: (n: string) => string | undefined; url: string } }): string | null {
  try {
    return new URL(c.req.url).host;
  } catch {
    return null;
  }
}

function hostMatchesRequest(c: { req: { header: (n: string) => string | undefined; url: string } }): boolean {
  const host = c.req.header("host");
  const reqHost = requestHost(c);
  return !!host && !!reqHost && host === reqHost;
}

function sameOriginReferer(c: { req: { header: (n: string) => string | undefined; url: string } }): boolean {
  const referer = c.req.header("referer");
  if (!referer) return false;
  try {
    return new URL(referer).origin === new URL(c.req.url).origin;
  } catch {
    return false;
  }
}

function formPostAllowed(c: { req: { header: (n: string) => string | undefined; url: string; method: string } }): boolean {
  const site = c.req.header("sec-fetch-site");
  // "none" appears on some mobile PWA form posts when Origin/Referer are stripped.
  if (site === "same-origin" || site === "same-site" || (site === "none" && hostMatchesRequest(c))) return true;
  const origin = c.req.header("origin");
  if (origin) {
    try {
      return origin === new URL(c.req.url).origin;
    } catch {
      return false;
    }
  }
  return sameOriginReferer(c);
}

function authFormAllowed(
  c: { req: { header: (n: string) => string | undefined; url: string; method: string } },
  form: FormData
): boolean {
  if (formPostAllowed(c)) return true;
  return verifyCsrfToken(c, String(form.get("_csrf") ?? ""));
}

const formContentTypeRe = /^\b(application\/x-www-form-urlencoded|multipart\/form-data|text\/plain)\b/i;

app.use("*", logger());
app.use("*", async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD") {
    const ct = c.req.header("content-type") || "text/plain";
    if (formContentTypeRe.test(ct) && !formPostAllowed(c)) {
      throw new HTTPException(403, { res: new Response("Forbidden", { status: 403 }) });
    }
  }
  await next();
});

// Update last_ip / last_user_agent / last_seen_at on every authenticated request.
// Pure write-through; doesn't gate the request. Refresh persistent session cookies.
app.use("*", async (c, next) => {
  await next();
  const u = getCurrentUser(c);
  if (u) {
    try { touchUserDevice(u.nickname, getClientIp(c), getUserAgent(c)); } catch {}
    touchSessionCookie(c);
  }
});

// --- Static assets ---

const PUBLIC_DIR = join("public");
const staticCache = new Map<string, { body: string | Buffer; type: string }>();

function readPublicCached(rel: string, type: string): string | Buffer {
  if (process.env.NODE_ENV !== "production") staticCache.delete(rel);
  const hit = staticCache.get(rel);
  if (hit) return hit.body;
  const body = readFileSync(join(PUBLIC_DIR, rel));
  staticCache.set(rel, { body, type });
  return body;
}

function servePublic(rel: string, type: string, cacheSecs = 86400) {
  return (c: { header: (k: string, v: string) => void; body: (b: string | Buffer) => Response }) => {
    c.header("content-type", type);
    c.header("cache-control", `public, max-age=${cacheSecs}`);
    return c.body(readPublicCached(rel, type));
  };
}

app.get("/app.css", servePublic("app.css", "text/css; charset=utf-8"));
app.get("/card-swipe.js", servePublic("card-swipe.js", "application/javascript; charset=utf-8", 0));
app.get("/manifest.webmanifest", servePublic("manifest.webmanifest", "application/manifest+json"));
app.get("/sw.js", servePublic("sw.js", "application/javascript; charset=utf-8", 0));
app.get("/icon.svg", servePublic("icon.svg", "image/svg+xml"));

app.get("/photo/:name", (c) => {
  const name = c.req.param("name");
  if (!photoExists(name)) return c.notFound();
  const buf = readFileSync(photoPath(name));
  c.header("content-type", "image/jpeg");
  c.header("cache-control", "public, max-age=604800");
  return c.body(buf);
});

// --- Static pages ---

app.get("/about", (c) => c.redirect("/#about"));

// --- Auth ---

app.post("/signup", async (c) => {
  const form = await c.req.formData();
  if (!authFormAllowed(c, form)) {
    throw new HTTPException(403, { res: new Response("Forbidden", { status: 403 }) });
  }
  const nickname = String(form.get("nickname") ?? "").trim();

  if (!/^[A-Za-z0-9_]{3,30}$/.test(nickname)) {
    return c.html(
      errorPage({
        user: null,
        status: 400,
        message:
          "Nickname must be 3-30 characters, letters, numbers, or underscore only.",
        theme: getTheme(c),
      }),
      400
    );
  }

  const existingNick = findExistingNicknameIgnoreCase(nickname);
  if (existingNick) {
    const hint =
      process.env.DEV_LOGIN === "1"
        ? raw(
            html`<p class="gg-error__hint">Demo account? <a href="/dev-as/${esc(existingNick)}">Sign in as ${esc(existingNick)}</a> or <a href="/login?nick=${esc(existingNick)}">use password</a></p>`
          )
        : raw(
            html`<p class="gg-error__hint">Already joined? <a href="/login?nick=${esc(existingNick)}">Sign in with your password</a>${existingNick !== nickname ? html` — stored as <strong>${esc(existingNick)}</strong>` : ""}</p>`
          );
    const message = nicknameExists(nickname)
      ? `"${nickname}" is taken. Try another.`
      : `"${nickname}" matches an existing nickname.`;
    return c.html(
      errorPage({
        user: null,
        status: 409,
        message,
        hint,
        theme: getTheme(c),
      }),
      409
    );
  }

  // IP-based signup rate limit. Skipped when no proxy/header is present (dev).
  const ip = getClientIp(c);
  if (ip !== "unknown" && countSignupsByIpLast24h(ip) >= RATE_LIMITS.signups_per_ip_per_day) {
    return c.html(
      errorPage({
        user: null,
        status: 429,
        message: `Too many signups from your network in the last 24 hours. Wait a bit or ask a coordinator to help.`,
        theme: getTheme(c),
      }),
      429
    );
  }

  const token = generateToken();
  createUser(nickname, token, ip, getUserAgent(c));
  setSessionCookie(c, token);
  return c.redirect("/?welcome=1");
});

app.get("/login", (c) => {
  const user = getCurrentUser(c);
  if (user) {
    return c.html(
      layout({
        title: "Sign in",
        user,
        body: loggedInCard(user),
        theme: getTheme(c),
      })
    );
  }
  const nickQ = String(c.req.query("nick") ?? "").trim();
  const prefill = nickQ ? findExistingNicknameIgnoreCase(nickQ) ?? nickQ : undefined;
  const csrf = ensureCsrfToken(c);
  return c.html(
    layout({ title: "Sign in", user: null, body: loginCard(prefill, csrf), theme: getTheme(c) })
  );
});

app.post("/login", async (c) => {
  const form = await c.req.formData();
  if (!authFormAllowed(c, form)) {
    throw new HTTPException(403, { res: new Response("Forbidden", { status: 403 }) });
  }
  const nicknameInput = String(form.get("nickname") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const rememberRaw = form.get("remember");
  const remember = rememberRaw == null ? true : rememberRaw === "1";

  const nickname = findExistingNicknameIgnoreCase(nicknameInput);
  if (!nickname) {
    return c.html(
      errorPage({
        user: null,
        status: 401,
        message: "No account with that nickname.",
        hint: raw(html`<p class="gg-error__hint"><a href="/">Join Town Ranch</a> with a new nickname.</p>`),
        theme: getTheme(c),
      }),
      401
    );
  }

  const user = getUserByNickname(nickname)!;
  if (!user.password_hash) {
    return c.html(
      errorPage({
        user: null,
        status: 401,
        message: `"${nickname}" has no password yet.`,
        hint: raw(
          html`<p class="gg-error__hint">While logged in on another device, open Profile and set a password. New here? <a href="/">Pick a different nickname</a>.</p>`
        ),
        theme: getTheme(c),
      }),
      401
    );
  }

  const ok = await Bun.password.verify(password, user.password_hash);
  if (!ok) {
    return c.html(
      errorPage({
        user: null,
        status: 401,
        message: "Wrong password.",
        hint: raw(html`<p class="gg-error__hint"><a href="/login">Try again</a></p>`),
        theme: getTheme(c),
      }),
      401
    );
  }

  const token = generateToken();
  setSessionToken(nickname, token);
  setSessionCookie(c, token, remember);
  return c.redirect("/");
});

app.post("/logout", async (c) => {
  const form = await c.req.formData().catch(() => new FormData());
  if (!authFormAllowed(c, form)) {
    throw new HTTPException(403, { res: new Response("Forbidden", { status: 403 }) });
  }
  clearSessionCookie(c);
  return c.redirect("/");
});

app.get("/toggle-theme", (c) => {
  const current = getTheme(c);
  setTheme(c, toggleTheme(current));
  const back = c.req.header("referer") ?? "/";
  return c.redirect(back);
});

// Dev-only: sign in as an existing user without a login form. Used to switch
// between seeded users when testing the full flow. Disabled unless DEV_LOGIN=1.
if (process.env.DEV_LOGIN === "1") {
  app.get("/dev-as/:nick", (c) => {
    const nick = c.req.param("nick");
    const u = getUserByNickname(nick);
    if (!u) return c.text(`no such user: ${nick}`, 404);
    setSessionCookie(c, u.session_token);
    return c.redirect("/");
  });
}

// --- Feature routes ---

app.route("/", browseRoute);
app.route("/", newListingRoutes);
app.route("/", listingDetailRoute);
app.route("/", claimRoutes);
app.route("/", profileRoutes);
app.route("/", deviceAuthRoutes);
app.route("/", coordRoutes);

// --- 404 + error handling ---

app.notFound((c) => {
  const user = getCurrentUser(c);
  return c.html(
    errorPage({ user, status: 404, message: "Page not found.", theme: getTheme(c) }),
    404
  );
});

app.onError((err, c) => {
  const user = getCurrentUser(c);
  const theme = getTheme(c);
  if (err instanceof HttpError) {
    const hint =
      err.status === 403 && err.message.includes("/auth/device")
        ? raw(html`<p class="gg-error__hint"><a href="/auth/device">Unlock with passkey</a></p>`)
        : undefined;
    return c.html(
      errorPage({ user, status: err.status, message: err.message, hint, theme }),
      err.status as 400 | 401 | 403 | 404 | 500
    );
  }
  if (err instanceof HTTPException) {
    const status = err.status;
    const message = status === 403 ? "Invalid or missing CSRF token." : err.message;
    return c.html(errorPage({ user, status, message, theme }), status as 400 | 401 | 403 | 404 | 500);
  }
  console.error("[unhandled]", err);
  return c.html(
    errorPage({ user, status: 500, message: "Something went wrong.", theme }),
    500
  );
});

// --- Boot ---

// Expire listings opportunistically at startup. The cron job in jobs/expire.ts
// also runs this on a schedule in production.
expireOldListings();

const port = Number(process.env.PORT ?? 3000);

console.log(`GiveGet v0 listening on http://localhost:${port}`);

export { app };

export default {
  port,
  fetch: app.fetch,
};
