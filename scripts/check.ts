import { Database } from "bun:sqlite";
const db = new Database("./data/giveget.db");

console.log("--- users ---");
for (const u of db.query("SELECT nickname, given_count, received_count, is_vouched, is_coordinator FROM users").all() as any[]) {
  console.log(u);
}

console.log("\n--- listings ---");
for (const l of db.query("SELECT id, type, title, status FROM listings").all() as any[]) {
  console.log(l);
}

console.log("\n--- claims ---");
for (const c of db.query("SELECT id, listing_id, claimant_nickname, status, creator_agreed, claimant_agreed, creator_confirmed, claimant_confirmed FROM claims").all() as any[]) {
  console.log(c);
}

console.log("\n--- messages ---");
for (const m of db.query("SELECT id, claim_id, sender_nickname, substr(content, 1, 60) AS preview FROM messages").all() as any[]) {
  console.log(m);
}
