#!/usr/bin/env node
/**
 * Integration smoke test against the Hyperswitch sandbox.
 *
 * Answers four questions in one run, before any application code depends on
 * the answers:
 *
 *   1. Does the API key authenticate?
 *   2. Which payments path does this account expose, /payments or /v1/payments?
 *      The quickstart and the API reference disagree, so this resolves it
 *      empirically rather than by picking one.
 *   3. What is the profile id? It is returned on the payment object, which is
 *      easier than finding it in the dashboard.
 *   4. Is a connector actually attached, and which payment methods did it
 *      enable?
 *
 * Reads .env.local directly so it runs without Next.js. Prints no secrets.
 *
 * Usage: npm run smoke
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvLocal() {
  const path = resolve(process.cwd(), ".env.local");
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    fail(`No .env.local found at ${path}. Copy .env.example and fill it in.`);
  }

  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

function fail(message) {
  console.error(`\n  FAIL  ${message}\n`);
  process.exit(1);
}

function ok(label, value) {
  console.log(`  ok    ${label.padEnd(22)} ${value ?? ""}`);
}

const env = loadEnvLocal();

const apiKey = env.HYPERSWITCH_API_KEY;
const baseUrl = (env.HYPERSWITCH_BASE_URL ?? "https://sandbox.hyperswitch.io").replace(
  /\/+$/,
  "",
);

if (!apiKey || apiKey.includes("xxxxxxxx")) {
  fail("HYPERSWITCH_API_KEY is missing or still a placeholder in .env.local");
}

console.log(`\nHyperswitch smoke test against ${baseUrl}\n`);

const body = {
  amount: 100,
  currency: "USD",
  description: "Aftercare integration smoke test",
};
if (env.HYPERSWITCH_PROFILE_ID && !env.HYPERSWITCH_PROFILE_ID.includes("xxxxxxxx")) {
  body.profile_id = env.HYPERSWITCH_PROFILE_ID;
}

/** Try both documented paths and report which one this account answers on. */
async function createOn(path) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify(body),
  });
  return { path, status: res.status, text: await res.text() };
}

let created = null;
for (const path of ["/payments", "/v1/payments"]) {
  let attempt;
  try {
    attempt = await createOn(path);
  } catch (cause) {
    fail(`Could not reach ${baseUrl}${path}: ${cause.message}`);
  }

  if (attempt.status >= 200 && attempt.status < 300) {
    created = { ...attempt, json: JSON.parse(attempt.text) };
    ok("payments path", path);
    break;
  }

  if (attempt.status === 401 || attempt.status === 403) {
    fail(
      `Authentication rejected on ${path} (HTTP ${attempt.status}). ` +
        `Check that HYPERSWITCH_API_KEY is a sandbox key and was copied whole.`,
    );
  }

  console.log(`  ..    ${path} returned ${attempt.status}, trying next`);
}

if (created === null) {
  fail("Neither /payments nor /v1/payments accepted a payment creation.");
}

const p = created.json;

ok("authenticated", "api-key header accepted");
ok("payment_id", p.payment_id);
ok("status", p.status);
ok("client_secret", p.client_secret ? "returned" : "MISSING");
ok("profile_id", p.profile_id ?? "not returned on this object");

const methods = p.payment_method_types ?? p.payment_methods_enabled ?? null;
if (Array.isArray(methods) && methods.length > 0) {
  ok("payment methods", `${methods.length} enabled`);
} else {
  console.log(
    `  note  payment methods not listed on the payment object. ` +
      `Confirm in the dashboard that a connector is attached.`,
  );
}

if (!p.profile_id && (!body.profile_id || body.profile_id.includes("xxxxxxxx"))) {
  console.log(
    `\n  next  profile_id was not returned. Find it at ` +
      `Settings > Business Profiles in the dashboard and add it to .env.local.\n`,
  );
} else {
  console.log(
    `\n  next  Put this in .env.local if it is not there already:\n` +
      `        HYPERSWITCH_PROFILE_ID=${p.profile_id ?? body.profile_id}\n`,
  );
}

console.log("Smoke test passed. Credentials and connector are live.\n");
