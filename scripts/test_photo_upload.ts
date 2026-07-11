import sharp from "sharp";
import { Database } from "bun:sqlite";

const BASE = "http://localhost:3000";

const db = new Database("data/giveget.db");
// Use Anna (vouched, hasn't been posting today) so we don't bump into the 5/day rate limit.
const u = db.query("SELECT session_token FROM users WHERE nickname='Anna'").get() as { session_token: string };
const cookie = `gg_sid=${u.session_token}`;

// Build a 3000x2000 "photo": random RGB noise + a smooth gradient overlay.
// Random noise gives realistic JPEG entropy; gradient gives a recognizable
// shape so we can eyeball the resize.
const W = 3000;
const H = 2000;
const raw = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const gx = x / W;
    const gy = y / H;
    raw[i]     = Math.min(255, Math.floor(220 * gx + Math.random() * 35));     // R rises L→R
    raw[i + 1] = Math.min(255, Math.floor(180 * (1 - gy) + Math.random() * 35)); // G falls T→B
    raw[i + 2] = Math.min(255, Math.floor(160 * Math.abs(gx - gy) + Math.random() * 35));
  }
}

const jpegBuf = await sharp(raw, { raw: { width: W, height: H, channels: 3 } })
  .jpeg({ quality: 90 })
  .toBuffer();

const meta = await sharp(jpegBuf).metadata();
console.log("input photo:", meta.width, "x", meta.height, "·", jpegBuf.byteLength, "bytes");

const fd = new FormData();
fd.set("type", "give");
fd.set("category", "furniture");
fd.set("title", "Old armchair — needs new home");
fd.set("description", "Solid oak, brown corduroy. Come pick it up — door 14. (test listing, real-size photo)");
fd.set("photos", new Blob([jpegBuf], { type: "image/jpeg" }), "armchair.jpg");

const r = await fetch(BASE + "/new", {
  method: "POST",
  headers: { cookie, origin: BASE },
  body: fd,
  redirect: "manual",
});
console.log("POST /new:", r.status, "loc:", r.headers.get("location"));

const m = r.headers.get("location")?.match(/\/l\/(\d+)/);
const listingId = m ? Number(m[1]) : null;
if (!listingId) { console.error("no listing id"); process.exit(1); }

const photos = db.query("SELECT path FROM listing_photos WHERE listing_id=?").all(listingId);
console.log("photo rows:", JSON.stringify(photos));

if (photos.length > 0) {
  const ph = photos[0] as { path: string };
  const rp = await fetch(`${BASE}/photo/${ph.path}`);
  const bytes = Number(rp.headers.get("content-length"));
  const buf = Buffer.from(await rp.arrayBuffer());
  const out = await sharp(buf).metadata();
  console.log("served photo:", out.width, "x", out.height, "·", bytes, "bytes");
}

console.log("listing url: " + BASE + "/l/" + listingId);
