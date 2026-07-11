import { describe, expect, test } from "bun:test";
import { app } from "../src/server.ts";
import {
  archiveListing,
  filterArchivedListings,
  getUserArchivedActiveListings,
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

function boardPanelHtml(fullHtml: string): string {
  const start = fullHtml.indexOf('class="board-scope__panel board-scope__panel--board"');
  if (start < 0) return fullHtml;
  const hiddenStart = fullHtml.indexOf('class="board-scope__panel board-scope__panel--hidden"', start);
  if (hiddenStart < 0) return fullHtml.slice(start);
  return fullHtml.slice(start, hiddenStart);
}

function hiddenPanelHtml(fullHtml: string): string {
  const start = fullHtml.indexOf('class="board-scope__panel board-scope__panel--hidden"');
  if (start < 0) return "";
  const end = fullHtml.indexOf("</div>", fullHtml.indexOf("feed-tabs--hidden", start));
  return end > start ? fullHtml.slice(start, end) : fullHtml.slice(start);
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

  test("getUserArchivedActiveListings returns archived active listings", async () => {
    const creator = await devAs("DbHiddenCreator");
    const viewer = await devAs("DbHiddenViewer");
    const title = `Db hidden ${Date.now()}`;
    const listingId = await postListing(creator, title);
    archiveListing("DbHiddenViewer", listingId);

    const hidden = getUserArchivedActiveListings("DbHiddenViewer", "give");
    expect(hidden.some((l) => l.id === listingId)).toBe(true);
    expect(getUserArchivedActiveListings("DbHiddenViewer", "get").some((l) => l.id === listingId)).toBe(false);
  });

  test("archived listing hidden from browse feed", async () => {
    const creator = await devAs("ArchiveCreator");
    const viewer = await devAs("ArchiveViewer");
    const title = `Hidden item ${Date.now()}`;
    const listingId = await postListing(creator, title);

    const before = await app.request(`${base}/`, { headers: { cookie: viewer } });
    expect(boardPanelHtml(await before.text())).toContain(title);

    archiveListing("ArchiveViewer", listingId);
    const after = await app.request(`${base}/`, { headers: { cookie: viewer } });
    expect(boardPanelHtml(await after.text())).not.toContain(title);
  });

  test("hidden feed shows archived listings with restore", async () => {
    const creator = await devAs("HiddenFeedCreator");
    const viewer = await devAs("HiddenFeedViewer");
    const title = `Hidden feed item ${Date.now()}`;
    const listingId = await postListing(creator, title);

    archiveListing("HiddenFeedViewer", listingId);

    const board = await app.request(`${base}/`, { headers: { cookie: viewer } });
    const html = await board.text();
    expect(boardPanelHtml(html)).not.toContain(title);

    const hidden = await app.request(`${base}/?hidden=1`, { headers: { cookie: viewer } });
    const hiddenHtml = await hidden.text();
    expect(hiddenHtml).toContain(title);
    expect(hiddenHtml).toContain('id="scope-hidden"');
    expect(hiddenHtml).toContain("listing-restore");
    expect(hiddenHtml).toContain(`action="/l/${listingId}/unarchive"`);
    expect(hiddenHtml).toContain("Restore");
  });

  test("browse has Board and Hidden toggle", async () => {
    const viewer = await devAs("ToggleViewer");
    const board = await app.request(`${base}/`, { headers: { cookie: viewer } });
    const html = await board.text();
    expect(html).toContain('for="scope-board"');
    expect(html).toContain('for="scope-hidden"');
    expect(html).toContain("board-scope");
  });

  test("unarchive restores listing to browse", async () => {
    const creator = await devAs("UnarchiveCreator");
    const viewer = await devAs("UnarchiveViewer");
    const title = `Restore me ${Date.now()}`;
    const listingId = await postListing(creator, title);

    archiveListing("UnarchiveViewer", listingId);
    const hidden = await app.request(`${base}/`, { headers: { cookie: viewer } });
    expect(boardPanelHtml(await hidden.text())).not.toContain(title);

    unarchiveListing("UnarchiveViewer", listingId);
    const restored = await app.request(`${base}/`, { headers: { cookie: viewer } });
    expect(boardPanelHtml(await restored.text())).toContain(title);
  });

  test("POST archive route hides listing via JSON fetch", async () => {
    const creator = await devAs("RouteArchiveCreator");
    const viewer = await devAs("RouteArchiveViewer");
    const title = `Route archive ${Date.now()}`;
    const listingId = await postListing(creator, title);

    const archive = await app.request(`${base}/l/${listingId}/archive`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        ...csrfHeaders(base),
        cookie: viewer,
        referer: `${base}/`,
      },
    });
    expect(archive.status).toBe(200);
    const body = await archive.json();
    expect(body).toEqual({ ok: true, id: listingId });

    const board = await app.request(`${base}/`, { headers: { cookie: viewer } });
    expect(boardPanelHtml(await board.text())).not.toContain(title);
  });

  test("POST unarchive route restores via JSON fetch", async () => {
    const creator = await devAs("JsonUnarchiveCreator");
    const viewer = await devAs("JsonUnarchiveViewer");
    const title = `Json restore ${Date.now()}`;
    const listingId = await postListing(creator, title);

    archiveListing("JsonUnarchiveViewer", listingId);

    const res = await app.request(`${base}/l/${listingId}/unarchive`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        ...csrfHeaders(base),
        cookie: viewer,
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: listingId });

    const board = await app.request(`${base}/`, { headers: { cookie: viewer } });
    expect(boardPanelHtml(await board.text())).toContain(title);
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

  test("/me/archived redirects to hidden browse tab", async () => {
    const creator = await devAs("ArchivedRedirectCreator");
    const viewer = await devAs("ArchivedRedirectViewer");
    const title = `Archived redirect ${Date.now()}`;
    const listingId = await postListing(creator, title);

    archiveListing("ArchivedRedirectViewer", listingId);

    const page = await app.request(`${base}/me/archived`, {
      headers: { cookie: viewer },
      redirect: "manual",
    });
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("/?hidden=1");
  });

  test("profile page links to hidden browse tab", async () => {
    const viewer = await devAs("ProfileNavViewer");
    const me = await app.request(`${base}/me`, { headers: { cookie: viewer } });
    const html = await me.text();
    expect(html).toContain('href="/me" class="is-active"');
    expect(html).toContain('href="/?hidden=1"');
    expect(html).not.toContain('id="archived"');
  });
});
