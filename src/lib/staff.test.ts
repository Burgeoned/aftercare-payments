import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The provider console issues refunds and toggles the merchant's fraud guard.
 * Until D-030 both endpoints were reachable by anyone on the internet, so these
 * tests are the record that the door is shut.
 */

beforeAll(() => {
  process.env["HYPERSWITCH_API_KEY"] = "snd_test";
  process.env["HYPERSWITCH_BASE_URL"] = "https://sandbox.hyperswitch.io";
  process.env["HYPERSWITCH_PROFILE_ID"] = "pro_test";
  process.env["HYPERSWITCH_WEBHOOK_SECRET"] = "whsec_test";
  process.env["AFTERCARE_SESSION_SECRET"] = "b".repeat(64);
  process.env["AFTERCARE_STAFF_PASSWORD"] = "correct-horse-battery-staple";
  process.env["NEXT_PUBLIC_APP_URL"] = "http://localhost:3000";
});

const { signIn, isStaff } = await import("./staff");

describe("provider console sign in", () => {
  it("issues a session for the right password", () => {
    const token = signIn("correct-horse-battery-staple");
    expect(token).not.toBeNull();
    expect(isStaff(token!)).toBe(true);
  });

  it("refuses a wrong password", () => {
    expect(signIn("wrong")).toBeNull();
    expect(signIn("")).toBeNull();
  });

  it("refuses a password that is merely a prefix of the real one", () => {
    // The comparison is length-checked before it is byte-compared, so a prefix
    // cannot pass and cannot leak length through timing either.
    expect(signIn("correct-horse")).toBeNull();
  });

  it("rejects a forged session", () => {
    expect(isStaff(undefined)).toBe(false);
    expect(isStaff("")).toBe(false);
    expect(isStaff("staff.99999999999999.notasignature")).toBe(false);
  });

  it("rejects a session whose expiry was pushed out", () => {
    const token = signIn("correct-horse-battery-staple")!;
    const [prefix, expiry, signature] = token.split(".");
    expect(isStaff(`${prefix}.${Number(expiry) + 86_400_000}.${signature}`)).toBe(false);
  });

  it("rejects an expired session", () => {
    const token = signIn("correct-horse-battery-staple")!;
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 9 * 60 * 60 * 1000);
    expect(isStaff(token)).toBe(false);
    vi.useRealTimers();
  });
});
