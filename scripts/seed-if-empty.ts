/**
 * Seed demo data on first boot when the database has no users.
 * Safe to run on every start — no-op when users already exist.
 */
import { db } from "../src/db";

const row = db.query("SELECT COUNT(*) AS n FROM users").get() as { n: number };

if (row.n === 0) {
  console.log("[bootstrap] Empty database — seeding demo data...");
  const proc = Bun.spawn(["bun", "run", "scripts/seed.ts"], {
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) process.exit(code);
} else {
  console.log("[bootstrap] Database ready");
}
