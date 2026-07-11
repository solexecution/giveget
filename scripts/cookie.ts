/**
 * Print the session cookie value for a seeded user.
 * Paste into browser devtools: Application → Cookies → http://localhost:3000
 * (set name = gg_sid, value = <printed token>)
 *
 *   bun run scripts/cookie.ts Maros
 */
import { Database } from "bun:sqlite";

const nickname = process.argv[2];
if (!nickname) {
  console.error("usage: bun run scripts/cookie.ts <nickname>");
  process.exit(1);
}

const db = new Database("./data/giveget.db");
const row = db.query("SELECT session_token FROM users WHERE nickname = ?").get(nickname) as { session_token: string } | null;
if (!row) {
  console.error(`No user "${nickname}". Try: Maros, Maria_baker, Pavel, Eva_jardin, Jan, Anna, Lucia, Mateo, Sofia, Pedro`);
  process.exit(1);
}

console.log(`Cookie name:  gg_sid`);
console.log(`Cookie value: ${row.session_token}`);
console.log(``);
console.log(`Browser steps:`);
console.log(`  1. Open http://localhost:3000`);
console.log(`  2. DevTools → Application → Cookies → http://localhost:3000`);
console.log(`  3. Add: name=gg_sid, value=<above>, path=/`);
console.log(`  4. Reload — you're now ${nickname}.`);
