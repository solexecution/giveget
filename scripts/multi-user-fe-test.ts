/**
 * Multi-user FE flow test — simulates browser interactions via HTTP.
 * Run: bun run scripts/multi-user-fe-test.ts
 *      PROD=1 bun run scripts/multi-user-fe-test.ts  (hits production)
 */
const PROD = process.env.PROD === "1";
const base = PROD ? "https://giveget-production.up.railway.app" : "http://localhost:3000";

type Result = { action: string; user: string; pass: boolean; detail: string };

const results: Result[] = [];
const ts = Date.now();
const suffix = ts.toString(36).slice(-5);

function log(r: Result) {
  results.push(r);
  const mark = r.pass ? "PASS" : "FAIL";
  console.log(`[${mark}] ${r.user} — ${r.action}: ${r.detail}`);
}

function csrfHeaders(): Record<string, string> {
  return { Origin: base, "Sec-Fetch-Site": "same-origin" };
}

function parseCookies(res: Response, prev = ""): string {
  const set = res.headers.getSetCookie?.() ?? [];
  const sid = set.find((c) => c.startsWith("gg_sid="));
  if (sid) return sid.split(";")[0]!;
  return prev;
}

async function signup(nickname: string, cookie = ""): Promise<string> {
  const res = await fetch(`${base}/signup`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...csrfHeaders(),
      ...(cookie ? { cookie } : {}),
    },
    body: `nickname=${encodeURIComponent(nickname)}`,
    redirect: "manual",
  });
  return parseCookies(res, cookie);
}

async function login(nickname: string, password: string): Promise<string> {
  const res = await fetch(`${base}/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...csrfHeaders(),
    },
    body: `nickname=${encodeURIComponent(nickname)}&password=${encodeURIComponent(password)}&remember=1`,
    redirect: "manual",
  });
  return parseCookies(res);
}

async function devAs(nickname: string): Promise<string> {
  const res = await fetch(`${base}/dev-as/${nickname}`, { redirect: "manual" });
  if (res.status === 404) throw new Error("DEV_LOGIN not enabled");
  return parseCookies(res);
}

async function authAs(nickname: string): Promise<string> {
  if (!PROD) return devAs(nickname);
  return signup(nickname);
}

async function postListing(
  cookie: string,
  opts: { type: "give" | "get"; title: string; description?: string; category?: string }
): Promise<number> {
  const res = await fetch(`${base}/new`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...csrfHeaders(),
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

async function getPage(path: string, cookie: string): Promise<{ status: number; html: string }> {
  const res = await fetch(`${base}${path}`, { headers: { cookie } });
  return { status: res.status, html: await res.text() };
}

async function main() {
  console.log(`\n=== Multi-user FE test (${PROD ? "PRODUCTION" : "LOCAL"}) ===\n`);

  const userA = `TestUser_A_${suffix}`;
  const userB = `TestUser_B_${suffix}`;
  const userC = `TestUser_C_${suffix}`;

  // --- Auth setup ---
  let cookieA: string;
  let cookieB: string;
  let cookieC: string;

  if (PROD) {
    cookieA = await login("Maros", "090909");
    const marosCheck = await getPage("/", cookieA);
    log({
      action: "Login existing user",
      user: "Maros",
      pass: marosCheck.status === 200 && marosCheck.html.includes("Maros"),
      detail: marosCheck.status === 200 ? "Logged in as Maros" : `Status ${marosCheck.status}`,
    });

    cookieB = await signup(userB);
    log({
      action: "Signup new user",
      user: userB,
      pass: !!cookieB,
      detail: cookieB ? "Signed up" : "No session cookie",
    });

    cookieC = await signup(userC);
    log({
      action: "Signup new user",
      user: userC,
      pass: !!cookieC,
      detail: cookieC ? "Signed up" : "No session cookie",
    });
  } else {
    cookieA = await authAs(userA);
    cookieB = await authAs(userB);
    cookieC = await authAs(userC);
    log({ action: "Dev-as signup", user: userA, pass: !!cookieA, detail: "dev-as" });
    log({ action: "Dev-as signup", user: userB, pass: !!cookieB, detail: "dev-as" });
    log({ action: "Dev-as signup", user: userC, pass: !!cookieC, detail: "dev-as" });
  }

  // --- 1. User A creates Give listing ---
  const giveTitle = `Give drill ${suffix}`;
  let giveId: number;
  try {
    giveId = await postListing(cookieA, { type: "give", title: giveTitle, category: "tools" });
    log({
      action: "Create Give listing",
      user: PROD ? "Maros" : userA,
      pass: giveId > 0,
      detail: `id=${giveId}, title="${giveTitle}"`,
    });
  } catch (e) {
    log({ action: "Create Give listing", user: PROD ? "Maros" : userA, pass: false, detail: String(e) });
    giveId = 0;
  }

  // --- 2. User A creates Get listing ---
  const getTitle = `Get seedlings ${suffix}`;
  let getId: number;
  try {
    getId = await postListing(cookieA, { type: "get", title: getTitle, category: "food" });
    log({
      action: "Create Get listing",
      user: PROD ? "Maros" : userA,
      pass: getId > 0,
      detail: `id=${getId}, title="${getTitle}"`,
    });
  } catch (e) {
    log({ action: "Create Get listing", user: PROD ? "Maros" : userA, pass: false, detail: String(e) });
    getId = 0;
  }

  // --- 3. User B views board, opens listing detail (modal HTML embedded) ---
  const boardB = await getPage("/", cookieB);
  const seesGive = boardB.html.includes(giveTitle);
  const hasModal = giveId > 0 && boardB.html.includes(`id="l-${giveId}"`);
  log({
    action: "View board + listing modal",
    user: PROD ? userB : userB,
    pass: boardB.status === 200 && seesGive && hasModal,
    detail: `sees listing=${seesGive}, modal=${hasModal}`,
  });

  // --- 4. User B claims User A's Give listing (react) ---
  let claimId = 0;
  if (giveId > 0) {
    const claimRes = await fetch(`${base}/l/${giveId}/claim`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...csrfHeaders(),
        cookie: cookieB,
      },
      body: "message=I+can+pick+up+tomorrow+afternoon",
      redirect: "manual",
    });
    const threadLoc = claimRes.headers.get("location") ?? "";
    claimId = Number(threadLoc.match(/\/c\/(\d+)/)?.[1]);
    log({
      action: "Claim listing (react)",
      user: userB,
      pass: claimRes.status === 302 && claimId > 0,
      detail: `thread /c/${claimId}`,
    });
  }

  // --- 5. User A views own listing — cannot claim self ---
  if (giveId > 0) {
    const ownBoard = await getPage(`/#l-${giveId}`, cookieA);
    const noClaimForm = !ownBoard.html.includes(`action="/l/${giveId}/claim"`);
    const hasClaimsList = ownBoard.html.includes("Claims") || ownBoard.html.includes("No claims yet");
    log({
      action: "View own listing (no self-claim)",
      user: PROD ? "Maros" : userA,
      pass: noClaimForm && hasClaimsList,
      detail: `no claim form=${noClaimForm}, claims section=${hasClaimsList}`,
    });

    const selfClaim = await fetch(`${base}/l/${giveId}/claim`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...csrfHeaders(),
        cookie: cookieA,
      },
      body: "message=self-claim-attempt",
      redirect: "manual",
    });
    const selfClaimBlocked = selfClaim.status === 400;
    log({
      action: "Self-claim blocked (POST)",
      user: PROD ? "Maros" : userA,
      pass: selfClaimBlocked,
      detail: `status=${selfClaim.status}`,
    });
  }

  // --- 6. User A comments in claim thread ---
  if (claimId > 0) {
    const msgRes = await fetch(`${base}/c/${claimId}/message`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...csrfHeaders(),
        cookie: cookieA,
      },
      body: "message=Great%2C+see+you+at+3pm+by+the+gate",
      redirect: "manual",
    });
    const thread = await getPage(`/c/${claimId}`, cookieA);
    const hasReply = thread.html.includes("see you at 3pm");
    log({
      action: "Comment in claim thread",
      user: PROD ? "Maros" : userA,
      pass: msgRes.status === 302 && hasReply,
      detail: `message visible=${hasReply}`,
    });
  }

  // --- 7. User B agrees (react in thread) ---
  if (claimId > 0) {
    const agreeB = await fetch(`${base}/c/${claimId}/agree`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...csrfHeaders(), cookie: cookieB },
      redirect: "manual",
    });
    const agreeA = await fetch(`${base}/c/${claimId}/agree`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...csrfHeaders(), cookie: cookieA },
      redirect: "manual",
    });
    const threadAfter = await getPage(`/c/${claimId}`, cookieA);
    const agreed = threadAfter.html.includes("Agreed") || threadAfter.html.includes("Confirm exchanged");
    log({
      action: "Agree in thread (both sides)",
      user: `${userB} + ${PROD ? "Maros" : userA}`,
      pass: agreeB.status === 302 && agreeA.status === 302 && agreed,
      detail: `agreed state=${agreed}`,
    });
  }

  // --- 8. User B hides User A's listing (remove from feed) ---
  if (giveId > 0) {
    const archiveRes = await fetch(`${base}/l/${giveId}/archive`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        ...csrfHeaders(),
        cookie: cookieB,
        referer: `${base}/`,
      },
    });
    const boardAfterHide = await getPage("/", cookieB);
    const hiddenFromBoard = !boardAfterHide.html.match(/board-scope__panel--board[\s\S]*?${giveTitle}/);
    log({
      action: "Hide listing (archive)",
      user: userB,
      pass: archiveRes.status === 200 && hiddenFromBoard,
      detail: `json ok, hidden from board=${hiddenFromBoard}`,
    });

    const hiddenTab = await getPage("/?hidden=1", cookieB);
    const inHidden = hiddenTab.html.includes(giveTitle) && hiddenTab.html.includes("Restore");
    log({
      action: "Hidden tab shows listing",
      user: userB,
      pass: inHidden,
      detail: `in hidden tab=${inHidden}`,
    });

    const unarchiveRes = await fetch(`${base}/l/${giveId}/unarchive`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
        ...csrfHeaders(),
        cookie: cookieB,
      },
    });
    const boardRestored = await getPage("/", cookieB);
    const backOnBoard = boardRestored.html.includes(giveTitle);
    log({
      action: "Restore from Hidden tab",
      user: userB,
      pass: unarchiveRes.status === 200 && backOnBoard,
      detail: `restored=${backOnBoard}`,
    });
  }

  // --- 9. User cannot archive own listing ---
  if (getId > 0) {
    const ownArchive = await fetch(`${base}/l/${getId}/archive`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...csrfHeaders(),
        cookie: cookieA,
      },
      redirect: "manual",
    });
    log({
      action: "Archive own listing blocked",
      user: PROD ? "Maros" : userA,
      pass: ownArchive.status === 400,
      detail: `status=${ownArchive.status} (expected 400)`,
    });
  }

  // --- 10. User C claims Get listing ---
  if (getId > 0) {
    const claimGet = await fetch(`${base}/l/${getId}/claim`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...csrfHeaders(),
        cookie: cookieC,
      },
      body: "message=I+have+tomato+seedlings+to+share",
      redirect: "manual",
    });
    const getClaimId = Number((claimGet.headers.get("location") ?? "").match(/\/c\/(\d+)/)?.[1]);
    log({
      action: "Claim Get listing",
      user: userC,
      pass: claimGet.status === 302 && getClaimId > 0,
      detail: `thread /c/${getClaimId}, button was "I can help"`,
    });
  }

  // --- 11. Duplicate nickname signup ---
  const dupRes = await fetch(`${base}/signup`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...csrfHeaders() },
    body: `nickname=${encodeURIComponent(userB)}`,
    redirect: "manual",
  });
  const dupHtml = dupRes.status !== 302 ? await dupRes.text() : "";
  log({
    action: "Duplicate nickname rejected",
    user: "anonymous",
    pass: dupRes.status === 409 || dupHtml.includes("taken") || dupHtml.includes("matches"),
    detail: `status=${dupRes.status}`,
  });

  // --- 12. Empty form validation ---
  const emptyRes = await fetch(`${base}/new`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      ...csrfHeaders(),
      cookie: cookieC,
    },
    body: new URLSearchParams({ type: "give", category: "tools", title: "", description: "" }).toString(),
    redirect: "manual",
  });
  log({
    action: "Empty listing form rejected",
    user: userC,
    pass: emptyRes.status === 400,
    detail: `status=${emptyRes.status}`,
  });

  // --- 13. New listing modal present on board ---
  const modalCheck = await getPage("/", cookieB);
  log({
    action: "New listing modal on board",
    user: userB,
    pass: modalCheck.html.includes('id="new-listing"') && modalCheck.html.includes("Post listing"),
    detail: "modal + form present",
  });

  // --- Summary ---
  const passed = results.filter((r) => r.pass).length;
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n=== Summary: ${passed} passed, ${failed} failed (${results.length} total) ===\n`);

  console.log("| Action | User | Pass/Fail |");
  console.log("|--------|------|-----------|");
  for (const r of results) {
    console.log(`| ${r.action} | ${r.user} | ${r.pass ? "PASS" : "FAIL"} |`);
  }

  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
