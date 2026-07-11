const BASE = "http://localhost:3000";

// 1. Signup a fresh user
const r0 = await fetch(BASE + "/signup", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE },
  body: "nickname=RateUser",
  redirect: "manual",
});
console.log("signup:", r0.status, r0.headers.get("location"));
const setCookie = r0.headers.get("set-cookie");
const m = setCookie?.match(/gg_sid=([^;]+)/);
const cookie = m ? `gg_sid=${m[1]}` : "";

// 2. Post 6 listings, expect first 5 to succeed (302) and 6th to be 429
for (let i = 1; i <= 6; i++) {
  const fd = new FormData();
  fd.set("type", "give");
  fd.set("category", "materials");
  fd.set("title", `Test listing #${i}`);
  fd.set("description", `Rate limit test ${i}.`);
  const r = await fetch(BASE + "/new", {
    method: "POST",
    headers: { cookie, origin: BASE },
    body: fd,
    redirect: "manual",
  });
  console.log(`listing ${i}:`, r.status, "loc:", r.headers.get("location"));
  if (r.status !== 302) {
    const body = await r.text();
    const msg = body.match(/<p[^>]*>([^<]{5,200}\.)<\/p>/);
    console.log("  body msg:", msg?.[1]);
  }
}
