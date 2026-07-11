/**
 * Set password for an existing user (coordinator recovery / bootstrap).
 *   bun run scripts/set-password.ts Maros 'your-password'
 */
import { getUserByNickname, setPasswordHash } from "../src/db";

const nickname = process.argv[2];
const password = process.argv[3];

if (!nickname || !password) {
  console.error("Usage: bun run scripts/set-password.ts <nickname> <password>");
  process.exit(1);
}
if (password.length < 6 || password.length > 200) {
  console.error("Password must be 6-200 characters.");
  process.exit(1);
}

const user = getUserByNickname(nickname);
if (!user) {
  console.error(`No user: ${nickname}`);
  process.exit(1);
}

const hash = await Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
setPasswordHash(nickname, hash);
console.log(`Password set for ${nickname}. Sign in at /login`);
