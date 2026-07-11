// Reproduce: signup -> GET listing -> POST claim and inspect responses
const BASE = "http://localhost:3000";

async function run() {
  // 1. signup
  const r1 = await fetch(BASE + "/signup", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: BASE,
    },
    body: "nickname=DebugUser",
    redirect: "manual",
  });
  const setCookie = r1.headers.get("set-cookie");
  console.log("1) signup:", r1.status, "Location:", r1.headers.get("location"));
  console.log("   set-cookie:", setCookie?.slice(0, 80));

  // Extract gg_sid
  const m = setCookie?.match(/gg_sid=([^;]+)/);
  const cookie = m ? `gg_sid=${m[1]}` : "";
  console.log("   cookie header to reuse:", cookie.slice(0, 30) + "...");

  // 2. GET /l/2 with cookie
  const r2 = await fetch(BASE + "/l/2", {
    headers: { cookie },
  });
  const body2 = await r2.text();
  console.log("2) GET /l/2:", r2.status, "len:", body2.length);
  console.log("   has /l/2/claim form:", body2.includes('action="/l/2/claim"'));
  console.log("   has /signup form:", body2.includes('action="/signup"'));
  console.log("   nav 'sign out' present:", body2.includes("sign out"));

  // 3. POST /l/2/claim
  const r3 = await fetch(BASE + "/l/2/claim", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: BASE,
      cookie,
    },
    body: "message=" + encodeURIComponent("Hello — debug claim"),
    redirect: "manual",
  });
  console.log("3) POST /l/2/claim:", r3.status, "Location:", r3.headers.get("location"));
  console.log("   set-cookie:", r3.headers.get("set-cookie"));
  const body3 = await r3.text();
  console.log("   body preview:", body3.slice(0, 200));
}

run().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
