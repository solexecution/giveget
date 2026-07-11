/**
 * Expire old listings. Run via cron (e.g. once an hour).
 *   bun run expire
 */
import { expireOldListings } from "../db";

expireOldListings();
console.log(`[expire] ${new Date().toISOString()} expired old listings`);
process.exit(0);
