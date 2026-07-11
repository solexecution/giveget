import { describe, expect, test } from "bun:test";
import { app } from "../src/server.ts";
import { csrfHeaders, signup } from "./helpers.ts";
import { createUser } from "../src/db";
import { generateToken } from "../src/session";

const base = "http://localhost";

async function devAs(nickname: string): Promise<string> {
  const res = await app.request(`${base}/dev-as/${nickname}`, { redirect: "manual" });
  if (res.status === 302) {
    const c = res.headers.getSetCookie().find((x) => x.startsWith("gg_sid="));
    return c?.split(";")[0] ?? "";
  }
  const token = generateToken();
  createUser(nickname, token, "unknown", "test");
  return `gg_sid=${token}`;
}

describe("regression flows", () => {
  test("create listing", async () => {
    const cookie = await devAs("RegUser_A");
    const res = await app.request(`${base}/new`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...csrfHeaders(base),
        cookie,
      },
      body: new URLSearchParams({
        type: "give",
        category: "tools",
        title: "Regression hammer",
        description: "For testing only",
        exchange_hint: "nothing",
      }).toString(),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/#l-\d+/);

    const board = await app.request(`${base}/`, { headers: { cookie } });
    expect(await board.text()).toContain("Regression hammer");
  });

  test("claim listing thread opens for creator", async () => {
    const creator = await devAs("RegUser_B");
    const create = await app.request(`${base}/new`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...csrfHeaders(base),
        cookie: creator,
      },
      body: new URLSearchParams({
        type: "give",
        category: "food",
        title: "Regression apples",
        description: "Fresh",
        exchange_hint: "",
      }).toString(),
      redirect: "manual",
    });
    const loc = create.headers.get("location") ?? "";
    const id = loc.match(/#l-(\d+)/)?.[1];
    expect(id).toBeTruthy();

    const claimer = await devAs("RegUser_C");
    const claim = await app.request(`${base}/l/${id}/claim`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...csrfHeaders(base),
        cookie: claimer,
      },
      body: "message=I+can+pick+up+today",
      redirect: "manual",
    });
    expect(claim.status).toBe(302);
    const threadUrl = claim.headers.get("location");
    expect(threadUrl).toMatch(/^\/c\/\d+$/);

    const thread = await app.request(`${base}${threadUrl}`, { headers: { cookie: creator } });
    expect(thread.status).toBe(200);
    const html = await thread.text();
    expect(html).toContain("Regression apples");
    expect(html).toContain("Agree");
  });

  test("about redirect opens modal hash", async () => {
    const { cookie } = await signup(app, base, "AboutUser2");
    const res = await app.request(`${base}/about`, { headers: { cookie }, redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/#about");
    const home = await app.request(`${base}/`, { headers: { cookie } });
    const html = await home.text();
    expect(html).toContain('id="about"');
    expect(html).toContain("How GiveGet works");
    expect(html).toContain('class="gg-modal__close"');
  });

  test("login page prefills nickname query", async () => {
    createUser("Maros", generateToken(), "unknown", "test");
    const res = await app.request(`${base}/login?nick=maros`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('value="Maros"');
  });
});
