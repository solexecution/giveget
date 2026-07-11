import { Database } from "bun:sqlite";

const nickname = process.argv[2];
if (!nickname) {
  console.error("usage: bun run scripts/promote.ts <nickname>");
  process.exit(1);
}

const db = new Database("./data/giveget.db");
db.run("UPDATE users SET is_coordinator = 1, is_vouched = 1, vouched_by = nickname WHERE nickname = ?", [nickname]);
const row = db.query("SELECT nickname, is_coordinator, is_vouched FROM users WHERE nickname = ?").get(nickname);
console.log("promoted:", row);
