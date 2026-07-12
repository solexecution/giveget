/**
 * HTTP smoke test for production/local GiveGet.
 * Usage: bun scripts/smoke-test.ts [baseUrl]
 */
const base = process.argv[2] ?? "http://localhost:3000";

type Check = { name: string; pass: boolean; detail?: string };

const checks: Check[] = [];
function check(name: string, pass: boolean, detail = "") {
  checks.push({ name, pass, detail });
}

function cookieFrom(res: Response): string {
  const set = res.headers.getSetCookie?.() ?? [];
  const sid = set.find((c) => c.startsWith("gg_sid="));
  return sid ? sid.split(";")[0]! : "";
}

async function get(path: string, cookie = "") {
  return fetch(`${base}${path}`, {
    headers: cookie ? { cookie } : {},
    redirect: "manual",
  });
}

async function post(path: string, body: Record<string, string>, cookie = "", referer?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    Origin: base,
    "Sec-Fetch-Site": "same-origin",
  };
  if (cookie) headers.cookie = cookie;
  if (referer) headers.referer = referer;
  return fetch(`${base}${path}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(body).toString(),
    redirect: "manual",
  });
}

async function loginOrSignup(nick: string, password?: string): Promise<string> {
  if (password) {
    const res = await post("/login", { nickname: nick, password, remember: "0" }, "", `${base}/login`);
    let cookie = cookieFrom(res);
    if (res.status === 302 && cookie) return cookie;
  }
  const signupRes = await post("/signup", { nickname: nick }, "", `${base}/`);
  return cookieFrom(signupRes);
}

async function main() {
  // 1. Logged out home
  const homeAnon = await (await get("/")).text();
  check("logged-out signup form", homeAnon.includes('name="nickname"'));
  check("logged-out login link", homeAnon.includes('href="/login"'));
  check("logged-out no header user", !homeAnon.includes("gg-header__user"));

  // 2. Login page
  const loginPage = await (await get("/login")).text();
  check("login form", loginPage.includes('name="password"'));
  check("remember me", loginPage.includes('name="remember"'));

  // Wrong password
  const wrongPw = await post("/login", { nickname: "Maros", password: "wrong", remember: "0" }, "", `${base}/login`);
  const wrongBody = await wrongPw.text();
  check("wrong password error", wrongBody.includes("Wrong password") || wrongBody.includes("401"));

  // 3. Login (Maros on prod, signup fallback on local)
  const cookie = await loginOrSignup("Maros", "090909");
  if (!cookie) throw new Error("Could not obtain session cookie");
  const board = await (await get("/", cookie)).text();
  check("session established", board.includes("Town Ranch board") || board.includes("gg-header__actions"));
  check("header profile link", /<a class="gg-header__user"[^>]*>\w+<\/a>/.test(board));
  check("no escaped header html", !board.includes("&lt;a class=&quot;gg-header__user&quot;"));
  check("board scope toggle", board.includes("scope-board"));
  check("give/get tabs", board.includes("feed-tabs"));
  check("new listing modal hash", board.includes('id="new-listing"'));
  check("category filter", board.includes("cat-blade") || board.includes("gg-dropdown"));
  check("listing cards", board.includes("listing-card"));
  check("hide from feed desktop", board.includes("listing-card__archive-btn") || board.includes("Hide from feed"));

  // 5. Profile
  const profile = await (await get("/me", cookie)).text();
  check("profile identity", profile.includes("Maros"));
  check("profile archived link", profile.includes("/?hidden=1") || profile.includes("Hidden from browse"));

  // 6. Hidden tab
  const hidden = await (await get("/?hidden=1", cookie)).text();
  check("hidden tab", hidden.includes("scope-hidden") || hidden.includes("Hidden"));

  // 7. About modal
  check("about modal", board.includes('id="about"'));

  // 8. Theme toggle
  const themeRes = await get("/toggle-theme", cookie);
  const themeCookie = cookieFrom(themeRes) || cookie;
  const afterTheme = await (await get("/", themeCookie)).text();
  const themeMatch = afterTheme.match(/data-theme="(light|dark)"/);
  check("theme attribute", !!themeMatch);

  // 9. Account menu items
  check("account menu profile", board.includes("Your profile"));
  check("account menu hidden", board.includes("Hidden from browse"));
  check("account menu sign out", board.includes('action="/logout"'));

  const css = await (await get("/app.css")).text();
  check(
    "mobile hide CSS",
    css.includes("listing-card__archive-btn") && css.includes("max-width: 720px") && css.includes("display: none"),
  );

  const passed = checks.filter((c) => c.pass).length;
  console.log(`\nSmoke test: ${base}`);
  for (const c of checks) {
    console.log(`${c.pass ? "PASS" : "FAIL"} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  console.log(`\n${passed}/${checks.length} passed`);
  if (passed < checks.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
