/**
 * Environment configuration, validated once at module load.
 *
 * Hand-rolled rather than pulled from a schema library. The surface is small
 * and the failure mode we care about is "a required key is missing at
 * deploy time", which does not justify a dependency.
 *
 * Server variables are read lazily through `serverEnv()` so that importing this
 * module from a client component does not throw. Next.js would strip the values
 * anyway, but failing loudly at the boundary is better than failing subtly.
 */

class MissingEnvError extends Error {
  constructor(names: readonly string[]) {
    super(
      `Missing required environment variable(s): ${names.join(", ")}. ` +
        `Copy .env.example to .env.local and fill it in.`,
    );
    this.name = "MissingEnvError";
  }
}

function require_(names: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const missing: string[] = [];

  for (const name of names) {
    const value = process.env[name];
    if (value === undefined || value.trim() === "" || value.includes("xxxxxxxx")) {
      missing.push(name);
    } else {
      out[name] = value.trim();
    }
  }

  if (missing.length > 0) throw new MissingEnvError(missing);
  return out;
}

export interface ServerEnv {
  readonly hyperswitchApiKey: string;
  readonly hyperswitchBaseUrl: string;
  readonly hyperswitchProfileId: string;
  readonly hyperswitchWebhookSecret: string;
  /**
   * Signs guest statement access cookies. Separate from the webhook secret on
   * purpose: a key that authenticates a processor should not also mint session
   * tokens, because compromising either one should not hand over the other.
   */
  readonly sessionSecret: string;
  readonly appUrl: string;
}

let cached: ServerEnv | null = null;

/**
 * Throws if a required server variable is absent. Call from route handlers, not
 * at module scope, so a missing variable surfaces as a request error with a
 * readable message rather than a build failure with a stack trace.
 */
export function serverEnv(): ServerEnv {
  if (cached !== null) return cached;

  const v = require_([
    "HYPERSWITCH_API_KEY",
    "HYPERSWITCH_BASE_URL",
    "HYPERSWITCH_PROFILE_ID",
    "HYPERSWITCH_WEBHOOK_SECRET",
    "AFTERCARE_SESSION_SECRET",
    "NEXT_PUBLIC_APP_URL",
  ]);

  cached = {
    hyperswitchApiKey: v["HYPERSWITCH_API_KEY"]!,
    hyperswitchBaseUrl: v["HYPERSWITCH_BASE_URL"]!.replace(/\/+$/, ""),
    hyperswitchProfileId: v["HYPERSWITCH_PROFILE_ID"]!,
    hyperswitchWebhookSecret: v["HYPERSWITCH_WEBHOOK_SECRET"]!,
    sessionSecret: v["AFTERCARE_SESSION_SECRET"]!,
    appUrl: v["NEXT_PUBLIC_APP_URL"]!.replace(/\/+$/, ""),
  };

  return cached;
}

export interface StoreEnv {
  readonly redisUrl: string;
  readonly redisToken: string;
}

let cachedStore: StoreEnv | null = null;

/**
 * Validated separately from `serverEnv` on purpose. The payment log and the
 * Hyperswitch credentials are different concerns, and a missing Redis
 * configuration should break the ledger rather than the whole application.
 *
 * The names are the Vercel Upstash integration's own, which are `KV_` prefixed
 * for historical reasons rather than `UPSTASH_`. Reading what the integration
 * writes means the values rotate with it. Copying them into differently named
 * variables would work exactly until the first token rotation, and then fail
 * with credentials that look present and correct.
 *
 * `KV_REST_API_READ_ONLY_TOKEN` is deliberately not used: this store appends.
 * `KV_URL` and `REDIS_URL` are TCP connection strings for a socket client, and
 * this is the REST client, which suits a serverless caller that cannot hold a
 * connection open between invocations.
 */
export interface StaffEnv {
  readonly password: string;
}

let cachedStaff: StaffEnv | null = null;

/**
 * Validated separately, for the reason `storeEnv` is.
 *
 * This was folded into `serverEnv` and it took production down: the provider
 * console's password became a precondition for statement lookup, checkout and
 * webhook ingestion, none of which need it. A missing console password should
 * break the console. It should not make Hyperswitch retry a payment webhook for
 * 24 hours against a 500. See docs/DECISIONS.md D-032.
 */
export function staffEnv(): StaffEnv {
  if (cachedStaff !== null) return cachedStaff;
  const v = require_(["AFTERCARE_STAFF_PASSWORD"]);
  cachedStaff = { password: v["AFTERCARE_STAFF_PASSWORD"]! };
  return cachedStaff;
}

export function storeEnv(): StoreEnv {
  if (cachedStore !== null) return cachedStore;

  const v = require_(["KV_REST_API_URL", "KV_REST_API_TOKEN"]);

  cachedStore = {
    redisUrl: v["KV_REST_API_URL"]!,
    redisToken: v["KV_REST_API_TOKEN"]!,
  };

  return cachedStore;
}

/**
 * The publishable key is inlined into the client bundle by Next.js at build
 * time, so it is read directly rather than through the validator. It is not a
 * secret: it authenticates the browser to Hyperswitch and is designed to be
 * public.
 */
export const publishableKey: string =
  process.env["NEXT_PUBLIC_HYPERSWITCH_PUBLISHABLE_KEY"] ?? "";
