import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

import {
  countWebAuthnCredentials,
  getWebAuthnCredentialById,
  getWebAuthnCredentials,
  saveWebAuthnCredential,
  updateWebAuthnCounter,
  type User,
  type WebAuthnCredential,
} from "./db";
import { HttpError, requireCoordinator, requireUser } from "./session";

const DEVICE_COOKIE = "gg_device";
const DEVICE_MAX_AGE_SECS = 60 * 60 * 24 * 30;

type StoredChallenge = { challenge: string; exp: number };
const pendingChallenges = new Map<string, StoredChallenge>();

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function deviceAuthEnabled(): boolean {
  return !!process.env.DEVICE_AUTH_SECRET;
}

export function adminNicknames(): string[] {
  return (process.env.ADMIN_NICKNAMES ?? "Maros")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isAdminNickname(nickname: string): boolean {
  return adminNicknames().includes(nickname);
}

export function adminDeviceAuthRequired(user: User): boolean {
  return deviceAuthEnabled() && !!user.is_coordinator && isAdminNickname(user.nickname);
}

function deviceAuthSecret(): string {
  const s = process.env.DEVICE_AUTH_SECRET;
  if (!s) throw new Error("DEVICE_AUTH_SECRET not configured");
  return s;
}

export function webauthnConfig() {
  const rpID = process.env.WEBAUTHN_RP_ID ?? "localhost";
  const origin =
    process.env.WEBAUTHN_ORIGIN ??
    (rpID === "localhost" ? "http://localhost:3000" : `https://${rpID}`);
  return { rpName: "GiveGet", rpID, origin };
}

function setChallenge(nickname: string, challenge: string): void {
  pendingChallenges.set(nickname, { challenge, exp: Date.now() + 5 * 60 * 1000 });
}

function takeChallenge(nickname: string): string | null {
  const hit = pendingChallenges.get(nickname);
  pendingChallenges.delete(nickname);
  if (!hit || hit.exp < Date.now()) return null;
  return hit.challenge;
}

function signPayload(payloadB64: string): string {
  const sig = createHmac("sha256", deviceAuthSecret()).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

function verifySignedCookie(value: string): { nickname: string; credentialId: string } | null {
  const dot = value.lastIndexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const expected = createHmac("sha256", deviceAuthSecret()).update(payloadB64).digest("base64url");
  try {
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return null;
    }
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as {
      n?: string;
      c?: string;
      exp?: number;
    };
    if (!parsed.n || !parsed.c || !parsed.exp || parsed.exp < nowSec()) return null;
    return { nickname: parsed.n, credentialId: parsed.c };
  } catch {
    return null;
  }
}

export function setDeviceCookie(c: Context, nickname: string, credentialId: string): void {
  const payload = Buffer.from(
    JSON.stringify({ n: nickname, c: credentialId, exp: nowSec() + DEVICE_MAX_AGE_SECS })
  ).toString("base64url");
  setCookie(c, DEVICE_COOKIE, signPayload(payload), {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: DEVICE_MAX_AGE_SECS,
  });
}

export function clearDeviceCookie(c: Context): void {
  deleteCookie(c, DEVICE_COOKIE, { path: "/" });
}

export function isDeviceVerified(c: Context, nickname: string): boolean {
  if (!deviceAuthEnabled()) return true;
  const raw = getCookie(c, DEVICE_COOKIE);
  if (!raw) return false;
  const parsed = verifySignedCookie(raw);
  if (!parsed || parsed.nickname !== nickname) return false;
  const cred = getWebAuthnCredentialById(parsed.credentialId);
  return cred?.nickname === nickname;
}

export function getCoordNavVisible(c: Context, user: User | null): boolean {
  if (!user?.is_coordinator) return false;
  if (!adminDeviceAuthRequired(user)) return true;
  return isDeviceVerified(c, user.nickname);
}

export function canUseCoordinatorPowers(c: Context, user: User): boolean {
  if (!user.is_coordinator) return false;
  if (!adminDeviceAuthRequired(user)) return true;
  return isDeviceVerified(c, user.nickname);
}

export function requireCoordinatorDevice(c: Context): User {
  const u = requireCoordinator(c);
  if (adminDeviceAuthRequired(u) && !isDeviceVerified(c, u.nickname)) {
    throw new HttpError(
      403,
      'This device is not verified for admin access. Open /auth/device while signed in to unlock with your passkey.'
    );
  }
  return u;
}

export function requireAdminForDeviceSetup(c: Context): User {
  const u = requireUser(c);
  if (!u.is_coordinator || !isAdminNickname(u.nickname)) {
    throw new HttpError(404, "Not found.");
  }
  if (!deviceAuthEnabled()) {
    throw new HttpError(503, "Device auth is not configured on this server.");
  }
  return u;
}

function credentialToDescriptor(c: WebAuthnCredential) {
  return {
    id: c.credential_id,
    transports: ["internal", "hybrid", "usb", "ble", "nfc"] as AuthenticatorTransport[],
  };
}

export async function createRegistrationOptions(nickname: string) {
  const { rpName, rpID } = webauthnConfig();
  const existing = getWebAuthnCredentials(nickname);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: nickname,
    userDisplayName: nickname,
    userID: new TextEncoder().encode(nickname),
    attestationType: "none",
    excludeCredentials: existing.map(credentialToDescriptor),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });
  setChallenge(nickname, options.challenge);
  return options;
}

export async function verifyRegistration(
  nickname: string,
  body: RegistrationResponseJSON,
  deviceLabel?: string
) {
  const expectedChallenge = takeChallenge(nickname);
  if (!expectedChallenge) throw new HttpError(400, "Registration expired — try again.");

  const { rpID, origin } = webauthnConfig();
  const verification = await verifyRegistrationResponse({
    response: body,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new HttpError(400, "Passkey registration failed.");
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  saveWebAuthnCredential({
    credentialId: credential.id,
    nickname,
    publicKey: Buffer.from(credential.publicKey),
    counter: credential.counter,
    deviceLabel: deviceLabel?.slice(0, 80) ?? `${credentialDeviceType}${credentialBackedUp ? " · synced" : ""}`,
  });
  return credential.id;
}

export async function createAuthenticationOptions(nickname: string) {
  const creds = getWebAuthnCredentials(nickname);
  if (creds.length === 0) throw new HttpError(400, "No passkey registered yet.");

  const { rpID } = webauthnConfig();
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map(credentialToDescriptor),
    userVerification: "preferred",
  });
  setChallenge(nickname, options.challenge);
  return options;
}

export async function verifyAuthentication(nickname: string, body: AuthenticationResponseJSON) {
  const expectedChallenge = takeChallenge(nickname);
  if (!expectedChallenge) throw new HttpError(400, "Sign-in expired — try again.");

  const credId = body.id;
  const stored = getWebAuthnCredentialById(credId);
  if (!stored || stored.nickname !== nickname) {
    throw new HttpError(400, "Unknown passkey.");
  }

  const { rpID, origin } = webauthnConfig();
  const verification = await verifyAuthenticationResponse({
    response: body,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: stored.credential_id,
      publicKey: stored.public_key,
      counter: stored.counter,
      transports: ["internal", "hybrid"],
    },
  });
  if (!verification.verified) throw new HttpError(400, "Passkey verification failed.");

  updateWebAuthnCounter(stored.credential_id, verification.authenticationInfo.newCounter);
  return stored.credential_id;
}

export function adminHasPasskeys(nickname: string): boolean {
  return countWebAuthnCredentials(nickname) > 0;
}
