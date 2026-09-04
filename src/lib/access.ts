import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { serverEnv } from "./env";

/**
 * Guest access grants, issued after a successful statement lookup.
 *
 * Stateless by necessity, not by preference. The first version held grants in a
 * Map in module scope, which failed immediately: Next instantiates a module
 * separately per layer, so the grant written by the lookup route handler was
 * invisible to the statement page in the same process on the same machine. See
 * docs/DECISIONS.md D-013.
 *
 * A signed token carries its own claim, so it is correct across module
 * instances, across serverless instances, and across a redeploy. The tradeoff
 * is that it cannot be revoked before it expires, which is why the window is
 * thirty minutes and the token grants exactly one thing: the right to view one
 * statement.
 */

const TTL_MS = 30 * 60 * 1000;

export const ACCESS_COOKIE = "aftercare_access";
export const ACCESS_TTL_SECONDS = TTL_MS / 1000;

function sign(payload: string): string {
  return createHmac("sha256", serverEnv().sessionSecret).update(payload).digest("base64url");
}

export function grantAccess(statementId: string): string {
  const payload = `${statementId}.${Date.now() + TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Returns the statement the token grants access to, or null.
 *
 * The signature is checked before the expiry is read, because the expiry is
 * attacker-supplied until the signature says otherwise.
 */
export function resolveAccess(token: string | undefined): string | null {
  if (token === undefined) return null;

  const separator = token.lastIndexOf(".");
  if (separator === -1) return null;

  const payload = token.slice(0, separator);
  const provided = Buffer.from(token.slice(separator + 1));
  const expected = Buffer.from(sign(payload));

  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  const boundary = payload.lastIndexOf(".");
  if (boundary === -1) return null;

  const expiresAt = Number(payload.slice(boundary + 1));
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return null;

  return payload.slice(0, boundary);
}
