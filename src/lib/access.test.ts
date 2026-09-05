import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The access token is the only thing standing between a statement reference and
 * somebody else's medical bill, so the tests that matter are the ones that try
 * to forge one.
 */

beforeAll(() => {
  process.env["HYPERSWITCH_API_KEY"] = "snd_test";
  process.env["HYPERSWITCH_BASE_URL"] = "https://sandbox.hyperswitch.io";
  process.env["HYPERSWITCH_PROFILE_ID"] = "pro_test";
  process.env["HYPERSWITCH_WEBHOOK_SECRET"] = "whsec_test";
  process.env["AFTERCARE_SESSION_SECRET"] = "a".repeat(64);
  process.env["AFTERCARE_STAFF_PASSWORD"] = "test-console-password";
  process.env["NEXT_PUBLIC_APP_URL"] = "http://localhost:3000";
});

const { grantAccess, resolveAccess } = await import("./access");

describe("access tokens", () => {
  it("round trips the statement it was issued for", () => {
    expect(resolveAccess(grantAccess("stmt_4021"))).toBe("stmt_4021");
  });

  it("rejects a token whose statement id was swapped", () => {
    const token = grantAccess("stmt_4021");
    const forged = token.replace("stmt_4021", "stmt_3994");

    // The statement id is inside the signed payload, so editing it invalidates
    // the signature. Without this, one lookup would open every statement.
    expect(resolveAccess(forged)).toBeNull();
  });

  it("rejects a token whose expiry was pushed out", () => {
    const token = grantAccess("stmt_4021");
    const [id, expiry, signature] = token.split(".");
    const extended = `${id}.${Number(expiry) + 86_400_000}.${signature}`;

    expect(resolveAccess(extended)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = grantAccess("stmt_4021");
    expect(resolveAccess(`${token}x`)).toBeNull();
    expect(resolveAccess(token.slice(0, -1))).toBeNull();
  });

  it("rejects an expired token", () => {
    const token = grantAccess("stmt_4021");

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 31 * 60 * 1000);
    expect(resolveAccess(token)).toBeNull();
    vi.useRealTimers();
  });

  it("rejects malformed input without throwing", () => {
    expect(resolveAccess(undefined)).toBeNull();
    expect(resolveAccess("")).toBeNull();
    expect(resolveAccess("not-a-token")).toBeNull();
    expect(resolveAccess("stmt_4021.notanumber.signature")).toBeNull();
  });
});
