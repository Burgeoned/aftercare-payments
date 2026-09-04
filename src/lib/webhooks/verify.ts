import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook signature verification.
 *
 * Pure, so it can be tested without a request. The route hands it the raw body
 * and the header, and gets back a boolean and nothing else.
 *
 * Confirmed against the Hyperswitch webhook documentation: the signature is
 * HMAC-SHA512 over the raw JSON body, keyed on the merchant's
 * `payment_response_hash_key`, delivered in `x-webhook-signature-512`. A
 * SHA-256 variant exists at `x-webhook-signature-256` for systems that cannot
 * do SHA-512; this application can, so only the 512 header is accepted.
 */

export const SIGNATURE_HEADER = "x-webhook-signature-512";

/**
 * Verifies a signature over the raw request body.
 *
 * `rawBody` must be the exact bytes received. Re-serializing parsed JSON
 * changes key order, whitespace, and number formatting, and the digest will not
 * match. This is the single most common way a webhook integration fails, and it
 * fails as "signature invalid" rather than as anything that points at the cause.
 */
export function verifySignature(
  rawBody: string,
  headerValue: string | null,
  secret: string,
): boolean {
  if (headerValue === null || headerValue.trim() === "") return false;

  const expected = createHmac("sha512", secret).update(rawBody, "utf8").digest("hex");
  const provided = headerValue.trim().toLowerCase();

  // Compared as bytes of the hex text rather than decoded, so a malformed
  // header cannot throw inside the comparison.
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");

  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Describes a signature mismatch without revealing either value.
 *
 * The docs state the algorithm and the key but not the encoding of the header,
 * and hex is the assumption this implementation makes. If that assumption is
 * wrong, every webhook fails verification with no clue as to why, so a mismatch
 * logs the shape of what arrived: a 128 character hex string is the expected
 * form, and anything else says the encoding differs rather than the secret.
 */
export function describeSignatureShape(headerValue: string | null): string {
  if (headerValue === null) return "absent";

  const value = headerValue.trim();
  const looksHex = /^[0-9a-f]+$/i.test(value);
  return `length=${value.length} hex=${looksHex} (expected length=128 hex=true)`;
}
