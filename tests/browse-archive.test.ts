import { describe, expect, test } from "bun:test";
import { app } from "../src/server.ts";
import {
  archiveListing,
  createListing,
  filterArchivedListings,
  isListingNewSinceLastVisit,
  now,
  setLastBoardSeenAt,
  unarchiveListing,
} from "../src/db";
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

async function postListing(cookie: string, title: string, creator = "ArchiveCreator"): Promise<number> {
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
      title,
      description: "Test listing",
      exchange_hint: "",
    }).toString(),
    redirect: "manual",
  });
  const loc = res.headers.get("location") ?? "";
  const id = Number(loc.match(/#l-(\d+)/)?.[1]);
  if (!Number.isInteger(id)) throw new Error(`create failed: ${res.status} ${loc}`);
  return id;
}

describe("browse archive + new border logic", () => {
  test("isListingNewSinceLastVisit", () => {
    expect(isListingNewSinceLastVisit(100, null)).toBe(false);
    expect(isListingNewSinceLastVisit(100, 50)).toBe(true);
    expect(isListingNewSinceLastVisit(50, 100)).toBe(false);
    expect(isListingNewSinceLastVisit(100, 100)).toBe(false);
  });

  test("filterArchivedListings removes archived ids", () => {
    const listings = [
      { id: 1, type: "give" as const, category: "tools" as const, title: "a", description: "", exchange_hint: null, creator_nickname: "x", status: "active" as const, created_at: 1, expires_at: 9 },
      { id: 2, type: "get" as const, category: "food" as const, title: "b", description: "", exchange_hint: null, creator_nickname: "x", status: "active" as const, created_at: 2, expires_at: 9 },
    ];
    const filtered = filterArchivedListings(listings, new Set([2]));
    expect(filtered.map((l) => l.id)).toEqual([1]);
  });

  test("archived listing hidden from browse feed", async () => {
    const creator = await devAs("ArchiveCreator");
    const viewer = await devAs("ArchiveViewer");
    const title = `Hidden item ${Date.now()}`;
    await postListing(creator, title);

    const before = await app.request(`${base}/`, { headers: { cookie: viewer } });
    expect(await before.text()).toContain(title);

    const board = await app.request(`${base}/`, { headers: { cookie: viewer } });
    const html = await board.text();
    const idMatch = html.match(new RegExp(`href="#l-(\\d+)"[^>]*>${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    const listingId = Number(idMatch?.[1]);
    expect(listingId).toBeGreaterThan(0);

    archiveListing("ArchiveViewer", listingId);
    const after = await app.request(`${base}/`, { headers: { cookie: viewer } });
    expect(await after.text()).not.toContain(title);
  });

  test("unarchive restores listing to browse", async () => {
    const creator = await devAs("UnarchiveCreator");
    const viewer = await devAs("UnarchiveViewer");
    const title = `Restore me ${Date.now()}`;
    const listingId = await postListing(creator, title);

    archiveListing("UnarchiveViewer", listingId);
    const hidden = await app.request(`${base}/`, { headers: { cookie: viewer } });
    expect(await hidden.text()).not.toContain(title);

    unarchiveListing("UnarchiveViewer", listingId);
    const restored = await app.request(`${base}/`, { headers: { cookie: viewer } });
    expect(await restored.text()).toContain(title);
  });

  test("POST archive route hides listing", async () => {
    const creator = await devAs("RouteArchiveCreator");
    const viewer = await devAs("RouteArchiveViewer");
    const title = `Route archive ${Date.now()}`;
    const listingId = await postListing(creator, title);

    const archive = await app.request(`${base}/l/${listingId}/archive`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...csrfHeaders(base),
        cookie: viewer,
        referer: `${base}/`,
      },
      redirect: "manual",
    });
    expect(archive.status).toBe(302);

    const board = await app.request(`${base}/`, { headers: { cookie: viewer } });
    expect(await board.text()).not.toContain(title);
  });

  test("new border shown for listings since last board visit", async () => {
    const viewer = await devAs("NewBorderViewer");
    const creator = await devAs("NewBorderCreator");

    setLastBoardSeenAt("NewBorderViewer", now() - 3600);

    const title = `Fresh listing ${Date.now()}`;
    await postListing(creator, title, "NewBorderCreator");

    const board = await app.request(`${base}/`, { headers: { cookie: viewer } });
    const html = await board.text();
    expect(html).toContain(title);
    expect(html).toContain("listing-card--new");
    expect(html).toContain("listing-card__new-badge");
  });

  test("no new border on first browse visit", async () => {
    const viewer = await devAs("FirstVisitViewer");
    const creator = await devAs("FirstVisitCreator");
    setLastBoardSeenAt("FirstVisitViewer", null);

    const title = `First visit ${Date.now()}`;
    await postListing(creator, title, "FirstVisitCreator");

    const board = await app.request(`${base}/`, { headers: { cookie: viewer } });
    const html = await board.text();
    expect(html).toContain(title);
    const newCards = html.match(/listing-card--new/g) ?? [];
    expect(newCards.length).toBe(0);
  });
});
