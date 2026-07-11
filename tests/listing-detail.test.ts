import { describe, expect, test } from "bun:test";
import { app } from "../src/server.ts";
import { csrfHeaders } from "./helpers.ts";
import { generateToken } from "../src/session";
import { createUser } from "../src/db";

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

describe("listing detail rendering", () => {
  test("exchange hint renders as styled text, not escaped HTML", async () => {
    const creator = await devAs("ExchangeHintCreator");
    const viewer = await devAs("ExchangeHintViewer");

    const res = await app.request(`${base}/new`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...csrfHeaders(base),
        cookie: creator,
      },
      body: new URLSearchParams({
        type: "give",
        category: "tools",
        title: "Exchange test item",
        description: "Testing exchange hint display",
        exchange_hint: "9k",
      }).toString(),
      redirect: "manual",
    });
    const loc = res.headers.get("location") ?? "";
    const listingId = Number(loc.match(/#l-(\d+)/)?.[1]);
    expect(listingId).toBeGreaterThan(0);

    const board = await app.request(`${base}/`, { headers: { cookie: viewer } });
    const html = await board.text();
    expect(html).toContain('class="listing-detail__exchange">9k</p>');
    expect(html).not.toContain("&lt;p class=&quot;listing-detail__exchange&quot;&gt;");
  });

  test("new listing form uses category dropdown", async () => {
    const viewer = await devAs("CategoryDropdownViewer");
    const board = await app.request(`${base}/`, { headers: { cookie: viewer } });
    const html = await board.text();
    expect(html).toContain('class="gg-dropdown"');
    expect(html).toContain('class="gg-dropdown__trigger"');
    expect(html).not.toContain("gg-chip-grid");
  });
});
