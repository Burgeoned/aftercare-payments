/**
 * Environment configuration, validated once at module load.
 *
 * Hand-rolled rather than pulled from a schema library. The surface is six
 * variables and the failure mode we care about is "a required key is missing at
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
    "NEXT_PUBLIC_APP_URL",
  ]);

  cached = {
    hyperswitchApiKey: v["HYPERSWITCH_API_KEY"]!,
    hyperswitchBaseUrl: v["HYPERSWITCH_BASE_URL"]!.replace(/\/+$/, ""),
    hyperswitchProfileId: v["HYPERSWITCH_PROFILE_ID"]!,
    hyperswitchWebhookSecret: v["HYPERSWITCH_WEBHOOK_SECRET"]!,
    appUrl: v["NEXT_PUBLIC_APP_URL"]!.replace(/\/+$/, ""),
  };

  return cached;
}

/**
 * The publishable key is inlined into the client bundle by Next.js at build
 * time, so it is read directly rather than through the validator. It is not a
 * secret: it authenticates the browser to Hyperswitch and is designed to be
 * public.
 */
export const publishableKey: string =
  process.env["NEXT_PUBLIC_HYPERSWITCH_PUBLISHABLE_KEY"] ?? "";
