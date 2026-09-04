import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { describeSignatureShape, verifySignature } from "./verify";

/**
 * An unverified webhook is not a webhook. Everything downstream of this
 * function treats its input as an instruction to move money, so these tests are
 * the boundary between the processor and anyone who found the URL.
 */

const SECRET = "whsec_test_secret_value";
const BODY = '{"event_id":"evt_1","event_type":"payment_succeeded"}';

function sign(body: string, secret = SECRET): string {
  return createHmac("sha512", secret).update(body, "utf8").digest("hex");
}

describe("verifySignature", () => {
  it("accepts a correct signature", () => {
    expect(verifySignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it("accepts an upper case hex signature", () => {
    expect(verifySignature(BODY, sign(BODY).toUpperCase(), SECRET)).toBe(true);
  });

  it("rejects a signature made with a different secret", () => {
    expect(verifySignature(BODY, sign(BODY, "whsec_wrong"), SECRET)).toBe(false);
  });

  it("rejects when the body changed by one byte", () => {
    const signature = sign(BODY);
    const tampered = BODY.replace("payment_succeeded", "payment_succeedeD");
    expect(verifySignature(tampered, signature, SECRET)).toBe(false);
  });

  it("rejects a body that was re-serialized rather than passed through raw", () => {
    /**
     * The single most common way this integration fails. Parsing and
     * re-stringifying produces equivalent JSON with different bytes, and the
     * digest is over bytes.
     */
    const reserialized = JSON.stringify(JSON.parse(BODY.replace(/"/g, '"')));
    const spacedOriginal = '{ "event_id": "evt_1", "event_type": "payment_succeeded" }';

    expect(verifySignature(spacedOriginal, sign(spacedOriginal), SECRET)).toBe(true);
    expect(verifySignature(reserialized, sign(spacedOriginal), SECRET)).toBe(false);
  });

  it("rejects an absent or empty header without throwing", () => {
    expect(verifySignature(BODY, null, SECRET)).toBe(false);
    expect(verifySignature(BODY, "", SECRET)).toBe(false);
    expect(verifySignature(BODY, "   ", SECRET)).toBe(false);
  });

  it("rejects a malformed header without throwing", () => {
    expect(verifySignature(BODY, "not-hex", SECRET)).toBe(false);
    expect(verifySignature(BODY, sign(BODY).slice(0, -1), SECRET)).toBe(false);
    expect(verifySignature(BODY, `${sign(BODY)}00`, SECRET)).toBe(false);
  });

  it("rejects an empty signature against an empty body", () => {
    // A body of "" still has a valid digest, and the empty header must not
    // shortcut to a match.
    expect(verifySignature("", "", SECRET)).toBe(false);
    expect(verifySignature("", sign(""), SECRET)).toBe(true);
  });
});

describe("describeSignatureShape", () => {
  it("describes shape without revealing the value", () => {
    const description = describeSignatureShape(sign(BODY));

    expect(description).toContain("length=128");
    expect(description).toContain("hex=true");
    expect(description).not.toContain(sign(BODY));
  });

  it("distinguishes a wrong encoding from a wrong secret", () => {
    // Base64 of a SHA-512 digest is 88 characters and not hex. If every webhook
    // fails with this shape, the encoding assumption is wrong rather than the
    // secret.
    const base64 = createHmac("sha512", SECRET).update(BODY).digest("base64");
    const description = describeSignatureShape(base64);

    expect(description).toContain("length=88");
    expect(description).toContain("hex=false");
  });

  it("reports an absent header", () => {
    expect(describeSignatureShape(null)).toBe("absent");
  });
});
