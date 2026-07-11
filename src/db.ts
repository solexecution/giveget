import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.GIVEGET_DB ?? "./data/giveget.db";
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  nickname TEXT PRIMARY KEY
    CHECK(length(nickname) BETWEEN 3 AND 30 AND nickname GLOB '[A-Za-z0-9_]*'),
  password_hash TEXT,
  session_token TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  bio TEXT,
  is_coordinator INTEGER NOT NULL DEFAULT 0,
  is_vouched INTEGER NOT NULL DEFAULT 0,
  vouched_by TEXT REFERENCES users(nickname),
  vouched_at INTEGER,
  given_count INTEGER NOT NULL DEFAULT 0,
  received_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('give','get')),
  category TEXT NOT NULL CHECK(category IN ('tools','food','clothing','furniture','materials','services','knowledge')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
  description TEXT NOT NULL CHECK(length(description) <= 1000),
  creator_nickname TEXT NOT NULL REFERENCES users(nickname),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','agreed','completed','expired','deleted')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS listing_photos (
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (listing_id, sort_order)
);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  claimant_nickname TEXT NOT NULL REFERENCES users(nickname),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','agreed','completed','disputed','rejected')),
  creator_agreed INTEGER NOT NULL DEFAULT 0,
  claimant_agreed INTEGER NOT NULL DEFAULT 0,
  creator_confirmed INTEGER NOT NULL DEFAULT 0,
  claimant_confirmed INTEGER NOT NULL DEFAULT 0,
  agreed_at INTEGER,
  completed_at INTEGER,
  disputed_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (listing_id, claimant_nickname)
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  sender_nickname TEXT NOT NULL REFERENCES users(nickname),
  content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 2000),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS goodwill_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coordinator_nickname TEXT NOT NULL REFERENCES users(nickname),
  recipient_nickname TEXT NOT NULL REFERENCES users(nickname),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listings_status_type ON listings(status, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listings_creator    ON listings(creator_nickname);
CREATE INDEX IF NOT EXISTS idx_claims_listing      ON claims(listing_id);
CREATE INDEX IF NOT EXISTS idx_claims_claimant     ON claims(claimant_nickname);
CREATE INDEX IF NOT EXISTS idx_messages_claim      ON messages(claim_id, created_at);
`);

// Migration: add exchange_hint to listings (the reciprocity prompt). Idempotent.
{
  const cols = db.query<{ name: string }, []>("PRAGMA table_info('listings')").all();
  if (!cols.some((c) => c.name === "exchange_hint")) {
    db.exec("ALTER TABLE listings ADD COLUMN exchange_hint TEXT");
  }
}

// Migration: device + IP capture on users for basic spam protection. Idempotent.
{
  const cols = db.query<{ name: string }, []>("PRAGMA table_info('users')").all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has("signup_ip"))         db.exec("ALTER TABLE users ADD COLUMN signup_ip TEXT");
  if (!names.has("signup_user_agent")) db.exec("ALTER TABLE users ADD COLUMN signup_user_agent TEXT");
  if (!names.has("last_ip"))           db.exec("ALTER TABLE users ADD COLUMN last_ip TEXT");
  if (!names.has("last_user_agent"))   db.exec("ALTER TABLE users ADD COLUMN last_user_agent TEXT");
  if (!names.has("last_seen_at"))       db.exec("ALTER TABLE users ADD COLUMN last_seen_at INTEGER");
  if (!names.has("last_board_seen_at")) db.exec("ALTER TABLE users ADD COLUMN last_board_seen_at INTEGER");
  db.exec("CREATE INDEX IF NOT EXISTS idx_users_signup_ip ON users(signup_ip)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_users_last_ip   ON users(last_ip)");
}

// Migration: per-user archived (hidden) listings on browse. Idempotent.
db.exec(`
CREATE TABLE IF NOT EXISTS archived_listings (
  nickname TEXT NOT NULL REFERENCES users(nickname) ON DELETE CASCADE,
  listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  archived_at INTEGER NOT NULL,
  PRIMARY KEY (nickname, listing_id)
);
CREATE INDEX IF NOT EXISTS idx_archived_listings_nickname ON archived_listings(nickname);
`);

// Migration: WebAuthn passkeys for admin device auth. Idempotent.
db.exec(`
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  credential_id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL REFERENCES users(nickname) ON DELETE CASCADE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  device_label TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webauthn_nickname ON webauthn_credentials(nickname);
`);

export interface WebAuthnCredential {
  credential_id: string;
  nickname: string;
  public_key: Buffer;
  counter: number;
  device_label: string | null;
  created_at: number;
}

export const CATEGORIES = [
  { key: "tools", label: "Tools" },
  { key: "food", label: "Food" },
  { key: "clothing", label: "Clothing & Household" },
  { key: "furniture", label: "Furniture & Appliances" },
  { key: "materials", label: "Materials" },
  { key: "services", label: "Services" },
  { key: "knowledge", label: "Knowledge" },
] as const;

export type CategoryKey = (typeof CATEGORIES)[number]["key"];
export type ListingType = "give" | "get";
export type ListingStatus = "active" | "agreed" | "completed" | "expired" | "deleted";
export type ClaimStatus = "pending" | "agreed" | "completed" | "disputed" | "rejected";

export interface User {
  nickname: string;
  password_hash: string | null;
  session_token: string;
  phone: string | null;
  email: string | null;
  bio: string | null;
  is_coordinator: number;
  is_vouched: number;
  vouched_by: string | null;
  vouched_at: number | null;
  given_count: number;
  received_count: number;
  created_at: number;
  signup_ip: string | null;
  signup_user_agent: string | null;
  last_ip: string | null;
  last_user_agent: string | null;
  last_seen_at: number | null;
  last_board_seen_at: number | null;
}

export interface ArchivedListingRow {
  nickname: string;
  listing_id: number;
  archived_at: number;
}

export interface Listing {
  id: number;
  type: ListingType;
  category: CategoryKey;
  title: string;
  description: string;
  exchange_hint: string | null;
  creator_nickname: string;
  status: ListingStatus;
  created_at: number;
  expires_at: number;
}

export interface Claim {
  id: number;
  listing_id: number;
  claimant_nickname: string;
  status: ClaimStatus;
  creator_agreed: number;
  claimant_agreed: number;
  creator_confirmed: number;
  claimant_confirmed: number;
  agreed_at: number | null;
  completed_at: number | null;
  disputed_at: number | null;
  created_at: number;
}

export interface Message {
  id: number;
  claim_id: number;
  sender_nickname: string;
  content: string;
  created_at: number;
}

export function now(): number {
  return Math.floor(Date.now() / 1000);
}

// ---------- Users ----------

const stmtUserByNickname = db.query<User, [string]>(
  "SELECT * FROM users WHERE nickname = ?"
);
const stmtUserBySession = db.query<User, [string]>(
  "SELECT * FROM users WHERE session_token = ?"
);
const stmtNicknameExists = db.query<{ n: number }, [string]>(
  "SELECT 1 AS n FROM users WHERE nickname = ?"
);
const stmtCreateUser = db.query<unknown, [string, string, number, string | null, string | null, string | null, string | null, number]>(
  `INSERT INTO users (nickname, session_token, created_at, signup_ip, signup_user_agent, last_ip, last_user_agent, last_seen_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
const stmtUpdateOptionalFields = db.query<unknown, [string | null, string | null, string | null, string]>(
  "UPDATE users SET phone = ?, email = ?, bio = ? WHERE nickname = ?"
);
const stmtSetPasswordHash = db.query<unknown, [string, string]>(
  "UPDATE users SET password_hash = ? WHERE nickname = ?"
);
const stmtVouch = db.query<unknown, [string, number, string]>(
  "UPDATE users SET is_vouched = 1, vouched_by = ?, vouched_at = ? WHERE nickname = ?"
);
const stmtUnvouch = db.query<unknown, [string]>(
  "UPDATE users SET is_vouched = 0, vouched_by = NULL, vouched_at = NULL WHERE nickname = ?"
);
const stmtIncGiven = db.query<unknown, [string]>(
  "UPDATE users SET given_count = given_count + 1 WHERE nickname = ?"
);
const stmtIncReceived = db.query<unknown, [string]>(
  "UPDATE users SET received_count = received_count + 1 WHERE nickname = ?"
);
const stmtAllUsers = db.query<User, []>(
  "SELECT * FROM users ORDER BY created_at DESC"
);

export function getUserByNickname(nickname: string): User | null {
  return stmtUserByNickname.get(nickname) ?? null;
}

export function getUserBySession(token: string): User | null {
  return stmtUserBySession.get(token) ?? null;
}

export function nicknameExists(nickname: string): boolean {
  return stmtNicknameExists.get(nickname) != null;
}

/** Same nickname ignoring case — catches maros vs Maros confusion. */
export function findExistingNicknameIgnoreCase(nickname: string): string | null {
  const row = db
    .query("SELECT nickname FROM users WHERE lower(nickname) = lower(?)")
    .get(nickname) as { nickname: string } | null;
  return row?.nickname ?? null;
}

export function createUser(
  nickname: string,
  sessionToken: string,
  ip: string | null = null,
  userAgent: string | null = null
): void {
  const ts = now();
  stmtCreateUser.run(nickname, sessionToken, ts, ip, userAgent, ip, userAgent, ts);
}

const stmtTouchUserDevice = db.query<unknown, [string, string, number, string]>(
  "UPDATE users SET last_ip = ?, last_user_agent = ?, last_seen_at = ? WHERE nickname = ?"
);
export function touchUserDevice(nickname: string, ip: string, userAgent: string): void {
  stmtTouchUserDevice.run(ip, userAgent, now(), nickname);
}

const stmtCountSignupsByIp = db.query<{ n: number }, [string]>(
  "SELECT COUNT(*) AS n FROM users WHERE signup_ip = ? AND created_at > unixepoch() - 86400"
);
export function countSignupsByIpLast24h(ip: string): number {
  return stmtCountSignupsByIp.get(ip)?.n ?? 0;
}

const stmtUsersBySignupIp = db.query<User, [string]>(
  "SELECT * FROM users WHERE signup_ip = ? ORDER BY created_at DESC"
);
export function usersBySignupIp(ip: string): User[] {
  return stmtUsersBySignupIp.all(ip);
}

// For coordinator audit: groups of accounts sharing any IP (signup or last).
const stmtIpClusters = db.query<{ ip: string; n: number; nicknames: string }, []>(
  `SELECT ip, COUNT(*) AS n, GROUP_CONCAT(nickname) AS nicknames
   FROM (
     SELECT nickname, signup_ip AS ip FROM users WHERE signup_ip IS NOT NULL AND signup_ip != 'unknown'
     UNION
     SELECT nickname, last_ip AS ip   FROM users WHERE last_ip   IS NOT NULL AND last_ip   != 'unknown'
   )
   GROUP BY ip
   HAVING n > 1
   ORDER BY n DESC, ip`
);
export function ipClusters(): { ip: string; n: number; nicknames: string }[] {
  return stmtIpClusters.all();
}

export function updateOptionalFields(
  nickname: string,
  phone: string | null,
  email: string | null,
  bio: string | null
): void {
  stmtUpdateOptionalFields.run(phone, email, bio, nickname);
}

export function setPasswordHash(nickname: string, hash: string): void {
  stmtSetPasswordHash.run(hash, nickname);
}

export function setSessionToken(nickname: string, token: string): void {
  db.query("UPDATE users SET session_token = ? WHERE nickname = ?").run(token, nickname);
}

export function vouchUser(target: string, voucher: string): void {
  stmtVouch.run(voucher, now(), target);
}

export function unvouchUser(target: string): void {
  stmtUnvouch.run(target);
}

export function allUsers(): User[] {
  return stmtAllUsers.all();
}

// ---------- Listings ----------

const stmtCreateListing = db.query<{ id: number }, [ListingType, CategoryKey, string, string, string | null, string, number, number]>(
  `INSERT INTO listings (type, category, title, description, exchange_hint, creator_nickname, created_at, expires_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
);
const stmtListingById = db.query<Listing, [number]>(
  "SELECT * FROM listings WHERE id = ?"
);
const stmtActiveListings = db.query<Listing, [ListingType]>(
  `SELECT * FROM listings
   WHERE status = 'active' AND type = ? AND expires_at > unixepoch()
   ORDER BY created_at DESC LIMIT 200`
);
const stmtActiveListingsByCategory = db.query<Listing, [ListingType, CategoryKey]>(
  `SELECT * FROM listings
   WHERE status = 'active' AND type = ? AND category = ? AND expires_at > unixepoch()
   ORDER BY created_at DESC LIMIT 200`
);
const stmtListingsByCreator = db.query<Listing, [string]>(
  "SELECT * FROM listings WHERE creator_nickname = ? ORDER BY created_at DESC"
);
const stmtUpdateListingStatus = db.query<unknown, [ListingStatus, number]>(
  "UPDATE listings SET status = ? WHERE id = ?"
);
const stmtAddPhoto = db.query<unknown, [number, string, number]>(
  "INSERT INTO listing_photos (listing_id, path, sort_order) VALUES (?, ?, ?)"
);
const stmtPhotosByListing = db.query<{ path: string }, [number]>(
  "SELECT path FROM listing_photos WHERE listing_id = ? ORDER BY sort_order"
);
const stmtExpireOld = db.query<unknown, []>(
  "UPDATE listings SET status = 'expired' WHERE status = 'active' AND expires_at <= unixepoch()"
);

const GIVE_DAYS = 30;
const GET_DAYS = 14;
const SECS_PER_DAY = 86400;

export function createListing(
  type: ListingType,
  category: CategoryKey,
  title: string,
  description: string,
  exchangeHint: string | null,
  creator: string
): number {
  const created = now();
  const expires = created + (type === "give" ? GIVE_DAYS : GET_DAYS) * SECS_PER_DAY;
  const row = stmtCreateListing.get(type, category, title, description, exchangeHint, creator, created, expires);
  return row!.id;
}

export function getListingById(id: number): Listing | null {
  return stmtListingById.get(id) ?? null;
}

export function getActiveListings(type: ListingType, category?: CategoryKey): Listing[] {
  return category
    ? stmtActiveListingsByCategory.all(type, category)
    : stmtActiveListings.all(type);
}

const stmtArchivedIds = db.query<{ listing_id: number }, [string]>(
  "SELECT listing_id FROM archived_listings WHERE nickname = ?"
);
const stmtArchiveListing = db.query<unknown, [string, number, number]>(
  "INSERT OR IGNORE INTO archived_listings (nickname, listing_id, archived_at) VALUES (?, ?, ?)"
);
const stmtUnarchiveListing = db.query<unknown, [string, number]>(
  "DELETE FROM archived_listings WHERE nickname = ? AND listing_id = ?"
);
const stmtArchivedRows = db.query<ArchivedListingRow, [string]>(
  "SELECT * FROM archived_listings WHERE nickname = ? ORDER BY archived_at DESC"
);
const stmtMarkBoardSeen = db.query<unknown, [number, string]>(
  "UPDATE users SET last_board_seen_at = ? WHERE nickname = ?"
);

export function getArchivedListingIds(nickname: string): number[] {
  return stmtArchivedIds.all(nickname).map((r) => r.listing_id);
}

export function archiveListing(nickname: string, listingId: number): void {
  stmtArchiveListing.run(nickname, listingId, now());
}

export function unarchiveListing(nickname: string, listingId: number): void {
  stmtUnarchiveListing.run(nickname, listingId);
}

export function getArchivedListingsForUser(nickname: string): ArchivedListingRow[] {
  return stmtArchivedRows.all(nickname);
}

export function markBoardSeen(nickname: string): void {
  stmtMarkBoardSeen.run(now(), nickname);
}

/** Test/admin helper — set when the user last opened the browse board. */
export function setLastBoardSeenAt(nickname: string, ts: number | null): void {
  db.query("UPDATE users SET last_board_seen_at = ? WHERE nickname = ?").run(ts, nickname);
}

export function filterArchivedListings(listings: Listing[], archivedIds: ReadonlySet<number>): Listing[] {
  return listings.filter((l) => !archivedIds.has(l.id));
}

export function isListingNewSinceLastVisit(createdAt: number, lastBoardSeenAt: number | null): boolean {
  if (lastBoardSeenAt == null) return false;
  return createdAt > lastBoardSeenAt;
}

export function getListingsByCreator(nickname: string): Listing[] {
  return stmtListingsByCreator.all(nickname);
}

export function setListingStatus(id: number, status: ListingStatus): void {
  stmtUpdateListingStatus.run(status, id);
}

const stmtUpdateListingFields = db.query<unknown, [string, string, string | null, number]>(
  "UPDATE listings SET title = ?, description = ?, exchange_hint = ? WHERE id = ?"
);

export function updateListingFields(
  id: number,
  title: string,
  description: string,
  exchangeHint: string | null
): void {
  stmtUpdateListingFields.run(title, description, exchangeHint, id);
}

export function addPhotoToListing(listingId: number, path: string, sortOrder: number): void {
  stmtAddPhoto.run(listingId, path, sortOrder);
}

export function getPhotosForListing(listingId: number): string[] {
  return stmtPhotosByListing.all(listingId).map((r) => r.path);
}

export function expireOldListings(): void {
  stmtExpireOld.run();
}

// ---------- Claims ----------

const stmtCreateClaim = db.query<{ id: number }, [number, string, number]>(
  `INSERT INTO claims (listing_id, claimant_nickname, created_at) VALUES (?, ?, ?) RETURNING id`
);
const stmtClaimById = db.query<Claim, [number]>(
  "SELECT * FROM claims WHERE id = ?"
);
const stmtClaimsForListing = db.query<Claim, [number]>(
  "SELECT * FROM claims WHERE listing_id = ? ORDER BY created_at"
);
const stmtClaimByListingAndClaimant = db.query<Claim, [number, string]>(
  "SELECT * FROM claims WHERE listing_id = ? AND claimant_nickname = ?"
);
const stmtClaimsForUser = db.query<Claim, [string]>(
  `SELECT * FROM claims WHERE claimant_nickname = ? ORDER BY created_at DESC`
);
const stmtClaimsOnMyListings = db.query<Claim, [string]>(
  `SELECT c.* FROM claims c
   JOIN listings l ON c.listing_id = l.id
   WHERE l.creator_nickname = ?
   ORDER BY c.created_at DESC`
);
const stmtSetCreatorAgreed = db.query<unknown, [number]>(
  "UPDATE claims SET creator_agreed = 1 WHERE id = ?"
);
const stmtSetClaimantAgreed = db.query<unknown, [number]>(
  "UPDATE claims SET claimant_agreed = 1 WHERE id = ?"
);
const stmtMarkAgreed = db.query<unknown, [number, number]>(
  "UPDATE claims SET status = 'agreed', agreed_at = ? WHERE id = ?"
);
const stmtSetCreatorConfirmed = db.query<unknown, [number]>(
  "UPDATE claims SET creator_confirmed = 1 WHERE id = ?"
);
const stmtSetClaimantConfirmed = db.query<unknown, [number]>(
  "UPDATE claims SET claimant_confirmed = 1 WHERE id = ?"
);
const stmtMarkCompleted = db.query<unknown, [number, number]>(
  "UPDATE claims SET status = 'completed', completed_at = ? WHERE id = ?"
);
const stmtMarkDisputed = db.query<unknown, [number, number]>(
  "UPDATE claims SET status = 'disputed', disputed_at = ? WHERE id = ?"
);
const stmtMarkRejected = db.query<unknown, [number]>(
  "UPDATE claims SET status = 'rejected' WHERE id = ?"
);

export function createClaim(listingId: number, claimant: string): number {
  const row = stmtCreateClaim.get(listingId, claimant, now());
  return row!.id;
}

export function getClaimById(id: number): Claim | null {
  return stmtClaimById.get(id) ?? null;
}

export function getClaimsForListing(listingId: number): Claim[] {
  return stmtClaimsForListing.all(listingId);
}

export function getClaimByListingAndClaimant(listingId: number, claimant: string): Claim | null {
  return stmtClaimByListingAndClaimant.get(listingId, claimant) ?? null;
}

export function getClaimsForUser(nickname: string): Claim[] {
  return stmtClaimsForUser.all(nickname);
}

export function getClaimsOnMyListings(nickname: string): Claim[] {
  return stmtClaimsOnMyListings.all(nickname);
}

/**
 * Records that one side agreed. If both sides now agree, promotes the claim
 * to status 'agreed'. Returns true if status flipped to agreed by this call.
 */
export function recordAgreement(claimId: number, by: "creator" | "claimant"): boolean {
  const tx = db.transaction(() => {
    if (by === "creator") stmtSetCreatorAgreed.run(claimId);
    else stmtSetClaimantAgreed.run(claimId);
    const fresh = getClaimById(claimId);
    if (!fresh) return false;
    if (fresh.creator_agreed && fresh.claimant_agreed && fresh.status === "pending") {
      stmtMarkAgreed.run(now(), claimId);
      return true;
    }
    return false;
  });
  return tx();
}

/**
 * Records that one side confirmed exchange. If both sides now confirmed,
 * completes the exchange (tally update + status flip). Returns true if completed.
 */
export function recordConfirmation(claimId: number, by: "creator" | "claimant"): boolean {
  const tx = db.transaction(() => {
    if (by === "creator") stmtSetCreatorConfirmed.run(claimId);
    else stmtSetClaimantConfirmed.run(claimId);
    const fresh = getClaimById(claimId);
    if (!fresh) return false;
    if (fresh.creator_confirmed && fresh.claimant_confirmed && fresh.status === "agreed") {
      _completeExchangeInner(claimId);
      return true;
    }
    return false;
  });
  return tx();
}

export function markDisputed(claimId: number): void {
  stmtMarkDisputed.run(now(), claimId);
}

export function markRejected(claimId: number): void {
  stmtMarkRejected.run(claimId);
}

/**
 * Internal: must run inside an existing transaction. Increments both parties'
 * tallies, marks the claim completed, marks the listing completed.
 */
function _completeExchangeInner(claimId: number): void {
  const claim = getClaimById(claimId);
  if (!claim) throw new Error("claim not found");
  const listing = getListingById(claim.listing_id);
  if (!listing) throw new Error("listing not found");

  // For a 'give' listing: creator gives, claimant receives.
  // For a 'get' listing: claimant gives, creator receives.
  const giver = listing.type === "give" ? listing.creator_nickname : claim.claimant_nickname;
  const receiver = listing.type === "give" ? claim.claimant_nickname : listing.creator_nickname;

  stmtIncGiven.run(giver);
  stmtIncReceived.run(receiver);
  stmtMarkCompleted.run(now(), claimId);
  setListingStatus(listing.id, "completed");
}

// ---------- Messages ----------

const stmtAddMessage = db.query<unknown, [number, string, string, number]>(
  "INSERT INTO messages (claim_id, sender_nickname, content, created_at) VALUES (?, ?, ?, ?)"
);
const stmtMessagesForClaim = db.query<Message, [number]>(
  "SELECT * FROM messages WHERE claim_id = ? ORDER BY created_at"
);

export function addMessage(claimId: number, sender: string, content: string): void {
  stmtAddMessage.run(claimId, sender, content, now());
}

export function getMessagesForClaim(claimId: number): Message[] {
  return stmtMessagesForClaim.all(claimId);
}

// ---------- Goodwill grants ----------

const stmtGrantGoodwill = db.query<unknown, [string, string, string, number]>(
  "INSERT INTO goodwill_grants (coordinator_nickname, recipient_nickname, reason, created_at) VALUES (?, ?, ?, ?)"
);

export function grantGoodwill(coordinator: string, recipient: string, reason: string): void {
  const tx = db.transaction(() => {
    stmtGrantGoodwill.run(coordinator, recipient, reason, now());
    stmtIncGiven.run(recipient);
  });
  tx();
}

// ---------- WebAuthn credentials ----------

const stmtWebAuthnByNick = db.query<WebAuthnCredential, [string]>(
  "SELECT credential_id, nickname, public_key, counter, device_label, created_at FROM webauthn_credentials WHERE nickname = ? ORDER BY created_at DESC"
);
const stmtWebAuthnById = db.query<WebAuthnCredential, [string]>(
  "SELECT credential_id, nickname, public_key, counter, device_label, created_at FROM webauthn_credentials WHERE credential_id = ?"
);
const stmtWebAuthnCount = db.query<{ n: number }, [string]>(
  "SELECT COUNT(*) AS n FROM webauthn_credentials WHERE nickname = ?"
);

export function getWebAuthnCredentials(nickname: string): WebAuthnCredential[] {
  return stmtWebAuthnByNick.all(nickname);
}

export function getWebAuthnCredentialById(credentialId: string): WebAuthnCredential | null {
  return stmtWebAuthnById.get(credentialId) ?? null;
}

export function countWebAuthnCredentials(nickname: string): number {
  return stmtWebAuthnCount.get(nickname)?.n ?? 0;
}

export function saveWebAuthnCredential(opts: {
  credentialId: string;
  nickname: string;
  publicKey: Buffer;
  counter: number;
  deviceLabel?: string;
}): void {
  db.query(
    "INSERT INTO webauthn_credentials (credential_id, nickname, public_key, counter, device_label, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    opts.credentialId,
    opts.nickname,
    opts.publicKey,
    opts.counter,
    opts.deviceLabel ?? null,
    now()
  );
}

export function updateWebAuthnCounter(credentialId: string, counter: number): void {
  db.query("UPDATE webauthn_credentials SET counter = ? WHERE credential_id = ?").run(counter, credentialId);
}

// ---------- Rate limits ----------

const stmtCountListingsDay = db.query<{ n: number }, [string]>(
  "SELECT COUNT(*) AS n FROM listings WHERE creator_nickname = ? AND created_at > unixepoch() - 86400"
);
const stmtCountClaimsDay = db.query<{ n: number }, [string]>(
  "SELECT COUNT(*) AS n FROM claims WHERE claimant_nickname = ? AND created_at > unixepoch() - 86400"
);
const stmtCountMessagesDay = db.query<{ n: number }, [string]>(
  "SELECT COUNT(*) AS n FROM messages WHERE sender_nickname = ? AND created_at > unixepoch() - 86400"
);

export function countListingsLast24h(nickname: string): number {
  return stmtCountListingsDay.get(nickname)?.n ?? 0;
}
export function countClaimsLast24h(nickname: string): number {
  return stmtCountClaimsDay.get(nickname)?.n ?? 0;
}
export function countMessagesLast24h(nickname: string): number {
  return stmtCountMessagesDay.get(nickname)?.n ?? 0;
}

export const RATE_LIMITS = {
  listings_per_day: 5,
  claims_per_day: 20,
  messages_per_day: 100,
  signups_per_ip_per_day: 3,
};

// ---------- Coordinator audit queries ----------

export interface ImbalanceRow {
  nickname: string;
  given_count: number;
  received_count: number;
  is_vouched: number;
}

const stmtImbalanceFlags = db.query<ImbalanceRow, []>(
  `SELECT nickname, given_count, received_count, is_vouched
   FROM users
   WHERE received_count > given_count + 3 AND is_vouched = 0
   ORDER BY (received_count - given_count) DESC`
);

export function getImbalanceFlags(): ImbalanceRow[] {
  return stmtImbalanceFlags.all();
}
