import { describe, expect, test } from "bun:test";
import { app } from "../src/server.ts";
import { csrfHeaders, signup } from "./helpers.ts";
import { generateToken } from "../src/session";
import { createUser } from "../src/db";

const base = "http://localhost";
const suffix = Date.now().toString(36).slice(-5);

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

async function postListing(
  cookie: string,
  opts: { type: "give" | "get"; title: string; category?: string; description?: string }
): Promise<number> {
  const res = await app.request(`${base}/new`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...csrfHeaders(base),
      cookie,
    },
    body: new URLSearchParams({
      type: opts.type,
      category: opts.category ?? "tools",
      title: opts.title,
      description: opts.description ?? "Automated test listing",
      exchange_hint: "a thank-you note",
    }).toString(),
    redirect: "manual",
  });
  const loc = res.headers.get("location") ?? "";
  const id = Number(loc.match(/#l-(\d+)/)?.[1]);
  if (!Number.isInteger(id)) throw new Error(`postListing failed: ${res.status} ${loc}`);
  return id;
}

function boardPanelHtml(fullHtml: string): string {
  const start = fullHtml.indexOf('class="board-scope__panel board-scope__panel--board"');
  const hiddenStart = fullHtml.indexOf('class="board-scope__panel board-scope__panel--hidden"', start);
  return hiddenStart > start ? fullHtml.slice(start, hiddenStart) : fullHtml;
}

describe("multi-user FE flows", () => {
  const userA = `MUserA_${suffix}`;
  const userB = `MUserB_${suffix}`;
  const userC = `MUserC_${suffix}`;

  test("User A creates Give and Get listings via POST /new", async () => {
    const cookieA = await devAs(userA);
    const giveTitle = `Give drill ${suffix}`;
    const getTitle = `Get seedlings ${suffix}`;

    const giveId = await postListing(cookieA, { type: "give", title: giveTitle });
    const getId = await postListing(cookieA, { type: "get", title: getTitle, category: "food" });

    const board = await app.request(`${base}/`, { headers: { cookie: cookieA } });
    const html = await board.text();
    expect(html).toContain(giveTitle);
    expect(html).toContain(getTitle);
    expect(html).toContain(`id="l-${giveId}"`);
    expect(html).toContain(`id="l-${getId}"`);
    expect(html).toContain('id="new-listing"');
    expect(html).toContain("Post listing");
  });

  test("User B views board, claims Give listing (react), thread opens", async () => {
    const cookieA = await devAs(`${userA}_claim`);
    const cookieB = await devAs(userB);
    const giveTitle = `Claim target ${suffix}`;
    const giveId = await postListing(cookieA, { type: "give", title: giveTitle });

    const boardB = await app.request(`${base}/`, { headers: { cookie: cookieB } });
    const boardHtml = await boardB.text();
    expect(boardHtml).toContain(giveTitle);
    expect(boardHtml).toContain(`id="l-${giveId}"`);
    expect(boardHtml).toContain("I&#39;ll take it");

    const claim = await app.request(`${base}/l/${giveId}/claim`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...csrfHeaders(base),
        cookie: cookieB,
      },
      body: "message=I+can+pick+up+tomorrow",
      redirect: "manual",
    });
    expect(claim.status).toBe(302);
    const threadUrl = claim.headers.get("location")!;
    expect(threadUrl).toMatch(/^\/c\/\d+$/);

    const thread = await app.request(`${base}${threadUrl}`, { headers: { cookie: cookieA } });
    const threadHtml = await thread.text();
    expect(threadHtml).toContain(giveTitle);
    expect(threadHtml).toContain("Agree");
    expect(threadHtml).toContain("pick up tomorrow");
  });

  test("User A cannot claim own listing; sees claims list instead", async () => {
    const cookieA = await devAs(`${userA}_self`);
    const cookieB = await devAs(`${userB}_self`);
    const title = `Self claim test ${suffix}`;
    const giveId = await postListing(cookieA, { type: "give", title });

    await app.request(`${base}/l/${giveId}/claim`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...csrfHeaders(base),
        cookie: cookieB,
      },
      body: "message=Interested",
      redirect: "manual",
    });

    const board = await app.request(`${base}/`, { headers: { cookie: cookieA } });
    const html = await board.text();
    expect(html).not.toContain(`action="/l/${giveId}/claim"`);
    expect(html).toContain("Claims");

    const selfClaim = await app.request(`${base}/l/${giveId}/claim`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...csrfHeaders(base),
        cookie: cookieA,
      },
      body: "message=self",
      redirect: "manual",
    });
    expect(selfClaim.status).toBe(400);
  });

  test("Comment and Agree in claim thread (/c/:id)", async () => {
    const cookieA = await devAs(`${userA}_thread`);
    const cookieB = await devAs(`${userB}_thread`);
    const giveId = await postListing(cookieA, { type: "give", title: `Thread test ${suffix}` });

    const claim = await app.request(`${base}/l/${giveId}/claim`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...csrfHeaders(base),
        cookie: cookieB,
      },
      body: "message=Initial+claim+message",
      redirect: "manual",
    });
    const claimId = Number(claim.headers.get("location")!.match(/\/c\/(\d+)/)?.[1]);

    await app.request(`${base}/c/${claimId}/message`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...csrfHeaders(base),
        cookie: cookieA,
      },
      body: "message=See+you+at+3pm",
      redirect: "manual",
    });

    await app.request(`${base}/c/${claimId}/agree`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...csrfHeaders(base), cookie: cookieB },
      redirect: "manual",
    });
    await app.request(`${base}/c/${claimId}/agree`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...csrfHeaders(base), cookie: cookieA },
      redirect: "manual",
    });

    const thread = await app.request(`${base}/c/${claimId}`, { headers: { cookie: cookieA } });
    const html = await thread.text();
    expect(html).toContain("See you at 3pm");
    expect(html).toContain("Confirm exchanged");
  });

  test("User B hides listing (archive), Hidden tab, restore", async () => {
    const cookieA = await devAs(`${userA}_hide`);
    const cookieB = await devAs(`${userB}_hide`);
    const title = `Hide me ${suffix}`;
    const giveId = await postListing(cookieA, { type: "give", title });

    const archive = await app.request(`${base}/l/${giveId}/archive`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        ...csrfHeaders(base),
        cookie: cookieB,
        referer: `${base}/`,
      },
    });
    expect(archive.status).toBe(200);

    const board = await app.request(`${base}/`, { headers: { cookie: cookieB } });
    expect(boardPanelHtml(await board.text())).not.toContain(title);

    const hidden = await app.request(`${base}/?hidden=1`, { headers: { cookie: cookieB } });
    const hiddenHtml = await hidden.text();
    expect(hiddenHtml).toContain(title);
    expect(hiddenHtml).toContain("Restore");

    await app.request(`${base}/l/${giveId}/unarchive`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        ...csrfHeaders(base),
        cookie: cookieB,
      },
    });
    const restored = await app.request(`${base}/`, { headers: { cookie: cookieB } });
    expect(boardPanelHtml(await restored.text())).toContain(title);
  });

  test("User cannot archive own listing", async () => {
    const cookieA = await devAs(`${userA}_ownhide`);
    const giveId = await postListing(cookieA, { type: "give", title: `Own hide ${suffix}` });

    const res = await app.request(`${base}/l/${giveId}/archive`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...csrfHeaders(base),
        cookie: cookieA,
      },
      redirect: "manual",
    });
    expect(res.status).toBe(400);
  });

  test("User C claims Get listing with I can help", async () => {
    const cookieA = await devAs(`${userA}_get`);
    const cookieC = await devAs(userC);
    const getId = await postListing(cookieA, {
      type: "get",
      title: `Need help ${suffix}`,
      category: "services",
    });

    const detail = await app.request(`${base}/`, { headers: { cookie: cookieC } });
    expect(await detail.text()).toContain("I can help");

    const claim = await app.request(`${base}/l/${getId}/claim`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...csrfHeaders(base),
        cookie: cookieC,
      },
      body: "message=Happy+to+help",
      redirect: "manual",
    });
    expect(claim.status).toBe(302);
  });

  test("Duplicate nickname and empty form error states", async () => {
    const dupNick = `DupUser_${suffix}`;
    await signup(app, base, dupNick);
    const dup = await signup(app, base, dupNick);
    expect(dup.res.status).toBe(409);

    const cookie = await devAs(`${userC}_empty`);
    const empty = await app.request(`${base}/new`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...csrfHeaders(base),
        cookie,
      },
      body: new URLSearchParams({ type: "give", category: "tools", title: "", description: "" }).toString(),
      redirect: "manual",
    });
    expect(empty.status).toBe(400);
  });
});
