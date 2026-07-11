/**
 * Apply ADMIN_BOOTSTRAP_PASSWORD to coordinator account(s) when unset.
 * Runs on every boot — no-op once password exists.
 *
 * Set on Railway: ADMIN_BOOTSTRAP_PASSWORD=yourpass
 * Optional: ADMIN_NICKNAMES=Maros (default in device-auth)
 */
import { getUserByNickname, setPasswordHash } from "../src/db";

const pw = process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim();
if (!pw) process.exit(0);

if (pw.length < 6 || pw.length > 200) {
  console.error("[bootstrap] ADMIN_BOOTSTRAP_PASSWORD must be 6-200 characters.");
  process.exit(1);
}

const nicks = (process.env.ADMIN_NICKNAMES ?? "Maros")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const hash = await Bun.password.hash(pw, { algorithm: "bcrypt", cost: 10 });

for (const nick of nicks) {
  const user = getUserByNickname(nick);
  if (!user) continue;
  const force = process.env.ADMIN_BOOTSTRAP_FORCE === "1";
  if (user.password_hash && !force) {
    console.log(`[bootstrap] ${nick} already has a password — skipping.`);
    continue;
  }
  setPasswordHash(nick, hash);
  console.log(`[bootstrap] Password ${force ? "reset" : "set"} for ${nick} from ADMIN_BOOTSTRAP_PASSWORD.`);
}
