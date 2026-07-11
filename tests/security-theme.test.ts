import { describe, expect, test } from "bun:test";
import { app } from "../src/server.ts";
import { csrfHeaders, signup } from "./helpers.ts";

const base = "http://localhost";

describe("csrf and theme", () => {
  test("form POST with same-origin referer passes CSRF", async () => {
    const res = await app.request(`${base}/signup`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: `${base}/`,
      },
      body: "nickname=RefererCsrfUser",
      redirect: "manual",
    });
    expect(res.status).toBe(302);
  });

  test("login POST with referer only (mobile PWA pattern)", async () => {
    await signup(app, base, "LoginRefererUser");
    const hash = await Bun.password.hash("secret123", { algorithm: "bcrypt", cost: 4 });
    const { setPasswordHash } = await import("../src/db.ts");
    setPasswordHash("LoginRefererUser", hash);

    const res = await app.request(`${base}/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        referer: `${base}/login`,
      },
      body: "nickname=LoginRefererUser&password=secret123",
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
  });

  test("bare POST without CSRF returns 403", async () => {
    const res = await app.request(`${base}/signup`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "nickname=NoCsrfUser",
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("CSRF");
  });

  test("toggle-theme sets cookie and flips data-theme", async () => {
    const before = await app.request(`${base}/`);
    expect(await before.text()).toContain('data-theme="dark"');

    const toggled = await app.request(`${base}/toggle-theme`, {
      redirect: "manual",
      headers: { referer: `${base}/` },
    });
    expect(toggled.status).toBe(302);
    const cookie = toggled.headers.getSetCookie().join("; ");
    expect(cookie).toContain("gg_theme=light");

    const after = await app.request(`${base}/`, { headers: { cookie } });
    expect(await after.text()).toContain('data-theme="light"');
  });

  test("manifest and sw are served", async () => {
    const manifest = await app.request(`${base}/manifest.webmanifest`);
    expect(manifest.status).toBe(200);
    const json = await manifest.json();
    expect(json.display).toBe("standalone");

    const sw = await app.request(`${base}/sw.js`);
    expect(sw.status).toBe(200);
    expect(await sw.text()).toContain("giveget-shell-v5");
  });
});

describe("listings gate", () => {
  test("signed-out cannot browse listings", async () => {
    const res = await app.request(`${base}/`);
    const html = await res.text();
    expect(html).not.toContain("Town Ranch board");
  });

  test("signed-in sees board", async () => {
    const { cookie } = await signup(app, base, "BrowseUser1");
    const res = await app.request(`${base}/`, { headers: { cookie } });
    expect(await res.text()).toContain("Town Ranch board");
  });
});
