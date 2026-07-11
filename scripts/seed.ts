/**
 * Wipe and seed myVillage with realistic example data.
 *   bun run scripts/seed.ts
 *
 * After this you can log in as ANY nickname below by visiting the home page
 * and entering it. (Nicknames in this seed don't have passwords or sessions;
 * the signup form will refuse them because they're "taken." To impersonate
 * one, set its session_token to a known value and add a cookie manually —
 * or just create a new test nickname and watch the seeded data from the
 * outside.)
 */
import { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";

const db = new Database("./data/giveget.db");
db.exec("PRAGMA foreign_keys = ON;");

const tok = () => randomBytes(32).toString("hex");
const now = () => Math.floor(Date.now() / 1000);
const minsAgo = (m: number) => now() - m * 60;
const hoursAgo = (h: number) => now() - h * 3600;
const daysAgo = (d: number) => now() - d * 86400;

console.log("Wiping existing data...");
db.exec(`
  DELETE FROM messages;
  DELETE FROM goodwill_grants;
  DELETE FROM claims;
  DELETE FROM listing_photos;
  DELETE FROM listings;
  DELETE FROM users;
  DELETE FROM sqlite_sequence;
`);

// ---------- Users ----------

interface SeedUser {
  nickname: string;
  coord: boolean;
  vouched: boolean;
  given: number;
  received: number;
  bio: string | null;
  joinedDaysAgo: number;
}

const users: SeedUser[] = [
  { nickname: "Maros",        coord: true,  vouched: true,  given: 0, received: 0, joinedDaysAgo: 45, bio: "Village coordinator. New here? Knock on door 14." },
  { nickname: "Maria_baker",  coord: false, vouched: true,  given: 2, received: 0, joinedDaysAgo: 40, bio: "Bake too much most weekends. Eggs from our chickens." },
  { nickname: "Pavel",        coord: false, vouched: true,  given: 1, received: 0, joinedDaysAgo: 38, bio: null },
  { nickname: "Eva_jardin",   coord: false, vouched: true,  given: 1, received: 1, joinedDaysAgo: 35, bio: "Garden behind the church. Plenty most of the year." },
  { nickname: "Jan",          coord: false, vouched: true,  given: 0, received: 1, joinedDaysAgo: 30, bio: null },
  { nickname: "Anna",         coord: false, vouched: true,  given: 2, received: 0, joinedDaysAgo: 28, bio: null },
  { nickname: "Lucia",        coord: false, vouched: true,  given: 1, received: 0, joinedDaysAgo: 25, bio: "Music teacher, retired. Spanish too." },
  { nickname: "Mateo",        coord: false, vouched: true,  given: 1, received: 0, joinedDaysAgo: 22, bio: null },
  { nickname: "Sofia",        coord: false, vouched: false, given: 0, received: 0, joinedDaysAgo: 5,  bio: null },
  { nickname: "Pedro",        coord: false, vouched: false, given: 0, received: 4, joinedDaysAgo: 18, bio: null },
];

const insUser = db.prepare(`
  INSERT INTO users (nickname, session_token, is_coordinator, is_vouched, vouched_by, vouched_at, given_count, received_count, bio, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
for (const u of users) {
  insUser.run(
    u.nickname,
    tok(),
    u.coord ? 1 : 0,
    u.vouched ? 1 : 0,
    u.vouched ? "Maros" : null,
    u.vouched ? daysAgo(u.joinedDaysAgo - 1) : null,
    u.given,
    u.received,
    u.bio,
    daysAgo(u.joinedDaysAgo)
  );
}
console.log(`✓ ${users.length} users`);

// ---------- Active listings ----------

interface SeedListing {
  type: "give" | "get";
  category: "tools" | "food" | "clothing" | "furniture" | "materials" | "services" | "knowledge";
  title: string;
  description: string;
  creator: string;
  daysAgo: number;
}

const active: SeedListing[] = [
  // Maria_baker — eggs and bread
  { type: "give", category: "food", title: "Fresh eggs every Sunday", description: "12 eggs ready every Sunday morning. Pick up before 11. Bring a box.", creator: "Maria_baker", daysAgo: 3 },
  { type: "give", category: "food", title: "Surplus sourdough — 2 loaves today", description: "Baked too many this morning. Two loaves to give away. Come by today.", creator: "Maria_baker", daysAgo: 0 },

  // Pavel — tools
  { type: "give", category: "tools", title: "Cordless drill, can lend", description: "Bosch 18V, two batteries, set of bits. Lend for a day or two.", creator: "Pavel", daysAgo: 5 },
  { type: "give", category: "tools", title: "Ladder, 4m extension, can lend", description: "Aluminium, sturdy. I can carry it over for short jobs.", creator: "Pavel", daysAgo: 8 },

  // Eva_jardin — garden surplus
  { type: "give", category: "food", title: "Lemons from the tree", description: "Tree is dropping more than we can use. Pick what you can carry. Sunny side of the house, gate is open.", creator: "Eva_jardin", daysAgo: 2 },
  { type: "give", category: "food", title: "Plátanos — surprise crop", description: "Small but sweet. About 20 left. First come.", creator: "Eva_jardin", daysAgo: 1 },

  // Lucia — lessons
  { type: "give", category: "knowledge", title: "Spanish lessons — beginner kids", description: "I can take a small group once a week, Tuesdays after school. Free.", creator: "Lucia", daysAgo: 6 },
  { type: "give", category: "knowledge", title: "Piano lessons in exchange for vegetables", description: "30-min lessons, kids 6-12. I'd love some seasonal produce in return — not required.", creator: "Lucia", daysAgo: 4 },

  // Mateo — materials
  { type: "give", category: "materials", title: "Walnut wood — planks 40cm", description: "From a tree we took down last year. Seasoned. About 30 planks left.", creator: "Mateo", daysAgo: 10 },

  // Anna — kid stuff
  { type: "give", category: "clothing", title: "Baby clothes 0-12 months, free", description: "Boy clothes mostly. Two bags, all washed. Take what you need.", creator: "Anna", daysAgo: 1 },
  { type: "give", category: "furniture", title: "Wooden high chair, good shape", description: "Used by both my kids, still solid. Pickup from our house.", creator: "Anna", daysAgo: 7 },

  // Requests
  { type: "get", category: "tools", title: "Need a ladder for one afternoon", description: "Light bulb on a high ceiling. Can return same day.", creator: "Jan", daysAgo: 0 },
  { type: "get", category: "food", title: "Tomato seedlings — any variety", description: "Planting next week. Even a few would help.", creator: "Sofia", daysAgo: 1 },
  { type: "get", category: "services", title: "Help moving a fridge on Saturday", description: "About 100m, two people enough. Will provide beer and lunch.", creator: "Pedro", daysAgo: 0 },
  { type: "get", category: "services", title: "Dog-sitter for Bori, Sat-Sun", description: "Golden retriever, very well behaved, sleeps a lot. Anywhere in the village works.", creator: "Eva_jardin", daysAgo: 2 },
];

const insListing = db.prepare(`
  INSERT INTO listings (type, category, title, description, creator_nickname, status, created_at, expires_at)
  VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
`);
const SECS_PER_DAY = 86400;
for (const l of active) {
  const created = daysAgo(l.daysAgo);
  const expires = created + (l.type === "give" ? 30 : 14) * SECS_PER_DAY;
  insListing.run(l.type, l.category, l.title, l.description, l.creator, created, expires);
}
console.log(`✓ ${active.length} active listings`);

// ---------- Completed exchanges ----------

interface SeedCompletedExchange {
  category: SeedListing["category"];
  title: string;
  description: string;
  creator: string;     // giver in an offer
  claimant: string;    // receiver in an offer
  doneDaysAgo: number;
  messages: { from: "creator" | "claimant"; text: string }[];
}

const completed: SeedCompletedExchange[] = [
  {
    category: "food", title: "Eggs — 12 for Pedro", description: "Sunday batch.",
    creator: "Maria_baker", claimant: "Pedro", doneDaysAgo: 20,
    messages: [
      { from: "claimant", text: "Hi Maria, can I take the eggs this Sunday?" },
      { from: "creator", text: "Yes, come by 9am." },
    ],
  },
  {
    category: "materials", title: "Walnut planks — for Pedro's shelf", description: "5 planks.",
    creator: "Mateo", claimant: "Pedro", doneDaysAgo: 15,
    messages: [
      { from: "claimant", text: "Could I get a few of those walnut planks?" },
      { from: "creator", text: "Sure, how many do you need? Come by Saturday." },
    ],
  },
  {
    category: "clothing", title: "Coat — for Pedro's son", description: "Kids size 6.",
    creator: "Anna", claimant: "Pedro", doneDaysAgo: 12,
    messages: [
      { from: "claimant", text: "Is the kids coat still there?" },
      { from: "creator", text: "Yes! Pop by anytime." },
    ],
  },
  {
    category: "knowledge", title: "Spanish lesson — Pedro's daughter", description: "Trial session.",
    creator: "Lucia", claimant: "Pedro", doneDaysAgo: 8,
    messages: [
      { from: "claimant", text: "She'd love to try. Tuesdays still works?" },
      { from: "creator", text: "Yes — 4pm at my place." },
    ],
  },
  {
    category: "tools", title: "Drill loan — for Eva_jardin", description: "Two days.",
    creator: "Pavel", claimant: "Eva_jardin", doneDaysAgo: 22,
    messages: [
      { from: "claimant", text: "Could I borrow the drill this weekend?" },
      { from: "creator", text: "Of course, I'll drop it by Friday." },
    ],
  },
  {
    category: "food", title: "Sourdough — for Jan", description: "Loaf.",
    creator: "Maria_baker", claimant: "Jan", doneDaysAgo: 17,
    messages: [
      { from: "claimant", text: "If there's a loaf to spare I'd love one." },
      { from: "creator", text: "Set one aside for you." },
    ],
  },
];

const insCompletedListing = db.prepare(`
  INSERT INTO listings (type, category, title, description, creator_nickname, status, created_at, expires_at)
  VALUES ('give', ?, ?, ?, ?, 'completed', ?, ?)
`);
const insClaim = db.prepare(`
  INSERT INTO claims (listing_id, claimant_nickname, status, creator_agreed, claimant_agreed, creator_confirmed, claimant_confirmed, agreed_at, completed_at, created_at)
  VALUES (?, ?, 'completed', 1, 1, 1, 1, ?, ?, ?)
`);
const insMsg = db.prepare(`
  INSERT INTO messages (claim_id, sender_nickname, content, created_at)
  VALUES (?, ?, ?, ?)
`);

for (const e of completed) {
  const listingCreated = daysAgo(e.doneDaysAgo + 2);
  const expires = listingCreated + 30 * SECS_PER_DAY;
  const res = insCompletedListing.get(e.category, e.title, e.description, e.creator, listingCreated, expires) as any;
  // bun:sqlite prepare().get returns the last row; for INSERT without RETURNING, query last_insert_rowid
  const listingId = (db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id;

  const claimCreated = listingCreated + 3600;
  const agreed = daysAgo(e.doneDaysAgo) - 7200;
  const done = daysAgo(e.doneDaysAgo);
  insClaim.run(listingId, e.claimant, agreed, done, claimCreated);
  const claimId = (db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id;

  let t = claimCreated;
  for (const m of e.messages) {
    insMsg.run(claimId, m.from === "creator" ? e.creator : e.claimant, m.text, t);
    t += 1800;
  }
}
console.log(`✓ ${completed.length} completed exchanges`);

// ---------- Goodwill grants ----------

const insGoodwill = db.prepare(`
  INSERT INTO goodwill_grants (coordinator_nickname, recipient_nickname, reason, created_at)
  VALUES (?, ?, ?, ?)
`);
insGoodwill.run("Maros", "Anna", "Hosted children's clothing swap day at the school", daysAgo(6));
insGoodwill.run("Maros", "Eva_jardin", "Organized the harvest weekend at the orchard", daysAgo(10));
console.log("✓ 2 goodwill grants");

// ---------- Done ----------

console.log("\n--- final tallies ---");
for (const u of db.query("SELECT nickname, given_count, received_count, is_vouched FROM users ORDER BY nickname").all() as any[]) {
  console.log(`  ${u.nickname.padEnd(15)} G=${u.given_count} R=${u.received_count} ${u.is_vouched ? "✓ vouched" : "  new"}`);
}
console.log("\n✓ Seed complete. Reload http://localhost:3000 to see it.");
