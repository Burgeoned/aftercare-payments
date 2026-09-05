import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { serverEnv, staffEnv } from "./env";

/**
 * Staff authentication for the provider console.
 *
 * This was a stated boundary and it should not have been. `SCOPE.md` item 10
 * deferred console authentication on the grounds that a fake login is not
 * authentication, which is true, and then the console shipped to a public URL
 * with endpoints that issue refunds and toggle the merchant's fraud guard. A
 * deferral describes something not built; this was something exposed. See
 * docs/DECISIONS.md D-030.
 *
 * What this is: a shared staff password checked in constant time, exchanged for
 * an HMAC-signed httpOnly cookie. That is real authentication of a real secret,
 * not a password field that proves nothing.
 *
 * What it is not: per-user identity, an audit trail of who applied a
 * correction, or SSO against the practice's identity provider. Those remain
 * deferred, and the deferral is now honest because the door is shut.
 */

const TTL_MS = 8 * 60 * 60 * 1000;

export const STAFF_COOKIE = "aftercare_staff";
export const STAFF_TTL_SECONDS = TTL_MS / 1000;

/**
 * Domain separator, distinct from the one in access.ts. Two token families
 * signed with one key and no separator verify each other's tokens. See D-032.
 */
const DOMAIN = "aftercare.staff.v1";

function sign(payload: string): string {
  return createHmac("sha256", serverEnv().sessionSecret)
    .update(`${DOMAIN}|${payload}`)
    .digest("base64url");
}

/**
 * Compared as fixed-width digests so the comparison reveals nothing about the
 * password's length. Buffers of differing length cannot be handed to
 * `timingSafeEqual` at all, and short-circuiting on length is a length oracle:
 * bounded, but a test comment previously claimed it did not exist.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

/** Verifies the shared password. Returns a session token, or null. */
export function signIn(password: string): string | null {
  const expected = staffEnv().password;
  if (!constantTimeEquals(password, expected)) return null;

  const payload = `staff.${Date.now() + TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

export function isStaff(token: string | undefined): boolean {
  if (token === undefined) return false;

  const separator = token.lastIndexOf(".");
  if (separator === -1) return false;

  const payload = token.slice(0, separator);
  const provided = Buffer.from(token.slice(separator + 1));
  const expected = Buffer.from(sign(payload));

  if (provided.length !== expected.length) return false;
  if (!timingSafeEqual(provided, expected)) return false;

  // The separator already makes another family's token unverifiable. This is
  // the second lock: a staff payload must say so.
  if (!payload.startsWith("staff.")) return false;

  const expiresAt = Number(payload.slice(payload.lastIndexOf(".") + 1));
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}
