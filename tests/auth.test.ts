import { afterAll, describe, expect, test } from "bun:test";
import { app } from "../src/server.ts";
import {
  cookieFrom,
  csrfHeaders,
  loginWithPassword,
  signup,
} from "./helpers.ts";
import { setPasswordHash } from "../src/db";
import { SESSION_REMEMBER_MAX_AGE } from "../src/session.ts";

const base = "http://localhost";

function cookieMaxAge(setCookie: string): number | null {
  const m = setCookie.match(/Max-Age=(\d+)/i);
  return m ? Number(m[1]) : null;
}

describe("auth", () => {
  test("anonymous home shows signup", async () => {
    const res = await app.request(`${base}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Join Town Ranch");
    expect(html).toContain('action="/signup"');
    expect(html).toContain('href="/login"');
  });

  test("signup creates session", async () => {
    const { res, cookie } = await signup(app, base, "TestUser_Auth1");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?welcome=1");
    expect(cookie).toMatch(/^gg_sid=/);

    const home = await app.request(`${base}/`, { headers: { cookie } });
    expect(await home.text()).toContain("Town Ranch board");
  });

  test("duplicate signup returns 409 with login hint", async () => {
    await signup(app, base, "TestUser_Auth2");
    const { res } = await signup(app, base, "TestUser_Auth2");
    expect(res.status).toBe(409);
    const html = await res.text();
    expect(html).toContain("/login");
  });

  test("login with password works after set", async () => {
    const nick = "TestUser_Auth3";
    await signup(app, base, nick);
    const hash = await Bun.password.hash("secret123", { algorithm: "bcrypt", cost: 4 });
    setPasswordHash(nick, hash);

    const { res, cookie } = await loginWithPassword(app, base, nick, "secret123");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(cookie).toMatch(/^gg_sid=/);

    const home = await app.request(`${base}/`, { headers: { cookie } });
    expect(await home.text()).toContain("Town Ranch board");
  });

  test("login fails without password set", async () => {
    const nick = "TestUser_Auth4";
    await signup(app, base, nick);
    const { res } = await loginWithPassword(app, base, nick, "anything");
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("no password yet");
  });

  test("login fails with wrong password", async () => {
    const nick = "TestUser_Auth5";
    await signup(app, base, nick);
    const hash = await Bun.password.hash("rightpass", { algorithm: "bcrypt", cost: 4 });
    setPasswordHash(nick, hash);
    const { res } = await loginWithPassword(app, base, nick, "wrongpass");
    expect(res.status).toBe(401);
    expect(await res.text()).toContain("Wrong password");
  });

  test("login with remember me sets one-year cookie", async () => {
    const nick = "TestUser_AuthRemember";
    await signup(app, base, nick);
    const hash = await Bun.password.hash("secret123", { algorithm: "bcrypt", cost: 4 });
    setPasswordHash(nick, hash);

    const res = await app.request(`${base}/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...csrfHeaders(base),
      },
      body: `nickname=${encodeURIComponent(nick)}&password=secret123&remember=1`,
      redirect: "manual",
    });
    expect(res.status).toBe(302);

    const cookies = res.headers.getSetCookie();
    const sid = cookies.find((c) => c.startsWith("gg_sid=")) ?? "";
    const remember = cookies.find((c) => c.startsWith("gg_remember=")) ?? "";
    expect(cookieMaxAge(sid)).toBe(SESSION_REMEMBER_MAX_AGE);
    expect(cookieMaxAge(remember)).toBe(SESSION_REMEMBER_MAX_AGE);
    expect(sid.toLowerCase()).toContain("httponly");
    expect(sid.toLowerCase()).toContain("samesite=lax");
  });

  test("login without remember me omits max-age", async () => {
    const nick = "TestUser_AuthSession";
    await signup(app, base, nick);
    const hash = await Bun.password.hash("secret123", { algorithm: "bcrypt", cost: 4 });
    setPasswordHash(nick, hash);

    const res = await app.request(`${base}/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...csrfHeaders(base),
      },
      body: `nickname=${encodeURIComponent(nick)}&password=secret123&remember=0`,
      redirect: "manual",
    });
    expect(res.status).toBe(302);

    const sid = res.headers.getSetCookie().find((c) => c.startsWith("gg_sid=")) ?? "";
    expect(cookieMaxAge(sid)).toBeNull();
    const remember = res.headers.getSetCookie().find((c) => c.startsWith("gg_remember=")) ?? "";
    expect(remember === "" || cookieMaxAge(remember) === 0).toBe(true);
  });

  test("logged-in GET /login shows session card not form", async () => {
    const nick = "TestUser_AuthLoggedIn";
    const { cookie } = await signup(app, base, nick);
    const res = await app.request(`${base}/login`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Already signed in");
    expect(html).toContain(`Signed in as <strong>${nick}</strong>`);
    expect(html).toContain("Continue to board");
    expect(html).not.toContain('action="/login"');
  });

  test("dev-as works when DEV_LOGIN=1", async () => {
    const res = await app.request(`${base}/dev-as/Maros`, { redirect: "manual" });
    expect(res.status).toBe(404);
  });

  test("logout redirects and clears cookie header", async () => {
    const { cookie } = await signup(app, base, "TestUser_Auth6");
    const res = await app.request(`${base}/logout`, {
      method: "POST",
      headers: { ...csrfHeaders(base), cookie },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const cleared = res.headers.getSetCookie().join("; ");
    expect(cleared).toMatch(/gg_sid=/);
    expect(cleared.toLowerCase()).toMatch(/max-age=0|expires=/);
  });
});

afterAll(() => {
  // preload temp dir cleaned by OS
});
