import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { logger } from "hono/logger";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  countSignupsByIpLast24h,
  createUser,
  expireOldListings,
  getUserByNickname,
  nicknameExists,
  RATE_LIMITS,
  touchUserDevice,
} from "./db";
import {
  clearSessionCookie,
  generateToken,
  getClientIp,
  getCurrentUser,
  getTheme,
  getUserAgent,
  HttpError,
  setSessionCookie,
  setTheme,
  toggleTheme,
} from "./session";
import { errorPage, esc, html, layout } from "./views";
import { photoExists, photoPath } from "./images";

import { browseRoute, newListingRoutes, listingDetailRoute } from "./routes/listings";
import { claimRoutes } from "./routes/claims";
import { profileRoutes } from "./routes/profile";
import { coordRoutes } from "./routes/coord";

const app = new Hono();

app.use("*", logger());
app.use("*", csrf());

// Update last_ip / last_user_agent / last_seen_at on every authenticated request.
// Pure write-through; doesn't gate the request.
app.use("*", async (c, next) => {
  await next();
  const u = getCurrentUser(c);
  if (u) {
    try { touchUserDevice(u.nickname, getClientIp(c), getUserAgent(c)); } catch {}
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

app.get("/about", (c) => {
  const user = getCurrentUser(c);
  const body = html`
    <article class="gg-article">
      <h2>How GiveGet works</h2>
      <p>
        GiveGet is a barter platform for Town Ranch. You post things you want to <strong>give</strong>
        (something you have, a service you can do) or things you want to <strong>get</strong>
        (something you need). The exchange happens between neighbours, in person, without money
        passing through this page.
      </p>
      <h3>The give/get tally</h3>
      <p>
        Every time you give something, your <strong>Given</strong> count goes up by one.
        Every time you receive, your <strong>Received</strong> count goes up by one. Both
        counts are visible on your profile and on every listing you create. Anyone in Town Ranch
        can see them.
      </p>
      <p>
        There are no points, no money, no spendable tokens — just a count of times you
        showed up for the community. The point is to keep things in motion, not to keep
        score.
      </p>
      <h3>Trust</h3>
      <p>
        New members are <em>unvouched</em>. A Town Ranch coordinator vouches you after meeting
        you. Vouching is the trust signal. The tally tells you who's active; the vouch tells
        you who's known.
      </p>
      <h3>What you don't need</h3>
      <p>
        No Google account. No WhatsApp. No phone number unless you choose to add one.
        No email unless you choose to add one. No real name. Just a nickname.
      </p>
    </article>
  `;
  return c.html(layout({ title: "How it works", user, body, theme: getTheme(c), activeNav: "about" }));
});

// --- Auth ---

app.post("/signup", async (c) => {
  const form = await c.req.formData();
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

  if (nicknameExists(nickname)) {
    return c.html(
      errorPage({
        user: null,
        status: 409,
        message: `"${nickname}" is taken. Try another.`,
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

app.post("/logout", (c) => {
  clearSessionCookie(c);
  return c.redirect("/");
});

app.post("/toggle-theme", (c) => {
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
    return c.html(
      errorPage({ user, status: err.status, message: err.message, theme }),
      err.status as 400 | 401 | 403 | 404 | 500
    );
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

export default {
  port,
  fetch: app.fetch,
};
