import "server-only";

import { serverEnv } from "@/lib/env";
import type { Cents, Currency, PaymentStatus } from "@/lib/domain/types";

/**
 * Thin server-side client for the Hyperswitch API.
 *
 * Deliberately not a full SDK wrapper. It covers the calls this prototype makes
 * and nothing else, because every additional guessed field is a claim about an
 * API contract that has not been verified. The blocklist shapes at the bottom
 * were taken from the documented curl examples rather than inferred.
 *
 * Auth is the `api-key` header carrying the secret key. The merchant account is
 * inferred from the key, so it is never sent explicitly. Confirmed against the
 * Hyperswitch API reference.
 */

const PAYMENTS_PATH = "/payments";
const REFUNDS_PATH = "/refunds";

export interface CreatePaymentInput {
  readonly amount: Cents;
  readonly currency: Currency;
  /**
   * Opaque. Shown to the patient on a bank statement, so it must be
   * recognizable, and it must never name a procedure or service line. See
   * docs/DESIGN.md section 10.
   */
  readonly description: string;
  /** Opaque statement reference. Never a clinical identifier. */
  readonly statementRef: string;
  /**
   * What the patient sees on their bank statement. Provider group name only:
   * no department, no service line, no procedure. Max 22 characters. See
   * docs/DESIGN.md section 10.
   */
  readonly statementDescriptor: string;
  readonly returnUrl: string;
}

export interface HyperswitchPayment {
  readonly payment_id: string;
  readonly status: PaymentStatus;
  readonly client_secret: string | null;
  readonly amount: number;
  readonly currency: string;
  readonly profile_id?: string;
  /**
   * The processor's own clock. Confirmed present on a live sandbox response
   * alongside `created`, `modified_at` and `expires_on`.
   *
   * It matters because `updated` is the field a webhook later carries for the
   * same payment, so recording it here means ordering compares two readings of
   * one clock. Recording our own wall clock instead made every webhook look
   * stale, which is exactly the bug this field exists to prevent.
   */
  readonly updated?: string;
  readonly created?: string;
  /**
   * When the payment stops being confirmable. Confirmed present on a live
   * sandbox response; roughly fifteen minutes after creation. Reusing an
   * intent past this point hands the browser a client secret that will be
   * refused at confirmation.
   */
  readonly expires_on?: string;
}

export class HyperswitchError extends Error {
  constructor(
    override readonly message: string,
    readonly httpStatus: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "HyperswitchError";
  }
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const env = serverEnv();
  const url = `${env.hyperswitchBaseUrl}${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "api-key": env.hyperswitchApiKey,
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch (cause) {
    // Network-level failure. Distinguished from a rejection by the processor,
    // because the two call for different patient-facing messages.
    throw new HyperswitchError(
      `Could not reach Hyperswitch at ${url}`,
      0,
      cause instanceof Error ? cause.message : String(cause),
    );
  }

  const text = await response.text();

  if (!response.ok) {
    throw new HyperswitchError(
      `Hyperswitch returned ${response.status} for ${path}`,
      response.status,
      text,
    );
  }

  return JSON.parse(text) as T;
}

/**
 * Creates a payment intent.
 *
 * `capture_method` is automatic by design. Manual capture across payer
 * adjudication does not work, because a card authorization expires long before
 * a payer responds. See docs/DOMAIN.md section 2.
 */
export async function createPayment(
  input: CreatePaymentInput,
): Promise<HyperswitchPayment> {
  const env = serverEnv();

  return call<HyperswitchPayment>(PAYMENTS_PATH, {
    method: "POST",
    body: JSON.stringify({
      amount: input.amount,
      currency: input.currency,
      profile_id: env.hyperswitchProfileId,
      capture_method: "automatic",
      confirm: false,
      description: input.description,
      /**
       * The field that actually reaches a bank statement. `description` does
       * not: it is an internal annotation, and the receipt told the patient
       * their statement would read NORTHGATE HEALTH while nothing sent it.
       *
       * Confirmed against the Hyperswitch source: `statement_descriptor_name`,
       * max 22 characters for the concatenated descriptor. The source marks it
       * for deprecation in favour of `billing_descriptor`, whose struct shape
       * is defined in another crate and was not confirmed, so the documented
       * field that works today is used rather than a guess at its successor.
       * See docs/DECISIONS.md D-031.
       */
      statement_descriptor_name: input.statementDescriptor,
      return_url: input.returnUrl,
      // Opaque by construction. A clinical identifier here would put PHI in a
      // third-party system. See docs/DESIGN.md section 10.
      metadata: { statement_ref: input.statementRef },
    }),
  });
}

export async function getPayment(paymentId: string): Promise<HyperswitchPayment> {
  return call<HyperswitchPayment>(`${PAYMENTS_PATH}/${paymentId}`, { method: "GET" });
}

export interface CreateRefundInput {
  readonly paymentId: string;
  readonly amount: Cents;
  readonly reason: string;
}

export interface HyperswitchRefund {
  readonly refund_id: string;
  readonly payment_id: string;
  readonly status: string;
  readonly amount: number;
}

/**
 * Refunds reference a payment id, which is what constrains the destination to
 * the original tender. That is what keeps health account funds returning to the
 * health account, an IRS constraint rather than a payments convention. See
 * docs/DOMAIN.md section 5.
 */
export async function createRefund(input: CreateRefundInput): Promise<HyperswitchRefund> {
  return call<HyperswitchRefund>(REFUNDS_PATH, {
    method: "POST",
    body: JSON.stringify({
      payment_id: input.paymentId,
      amount: input.amount,
      reason: input.reason,
    }),
  });
}

// ---------------------------------------------------------------------------
// Blocklist
// ---------------------------------------------------------------------------

/**
 * The card testing control.
 *
 * A payment page reachable by a statement reference is a card testing target:
 * an attacker with a list of stolen card numbers needs somewhere cheap to
 * discover which ones still work, and a public checkout that accepts any card
 * for a small amount is exactly that. The reference is printed on paper, so it
 * is not a secret.
 *
 * Configured by API rather than in the dashboard, which `HANDOFF.md` step 7
 * originally got wrong. There is no separate card-testing guard: the blocklist
 * toggle is it.
 */
/**
 * What you can block. Used as `type` on create and delete.
 */
export type BlocklistKind = "fingerprint" | "card_bin" | "extended_card_bin";

/**
 * What you can list. Deliberately a different union.
 *
 * The same concept is named twice by this API: a stored instrument is
 * `fingerprint` when you block it and `payment_method` when you list it.
 * Querying the list with `fingerprint` returns 400, and the error is the only
 * place the full set is documented:
 *
 *   unknown variant `fingerprint`, expected one of `payment_method`,
 *   `card_bin`, `extended_card_bin`, `generic_card_bin`
 *
 * `generic_card_bin` appears in that message and in no documentation page found
 * for this, which is why it is listed here and not used: an endpoint accepting a
 * value is not the same as knowing what it means.
 */
export type BlocklistListKind =
  | "payment_method"
  | "card_bin"
  | "extended_card_bin"
  | "generic_card_bin";

export interface BlocklistEntry {
  readonly fingerprint_id?: string;
  readonly data_kind?: string;
  readonly created_at?: string;
}

interface BlocklistPage {
  readonly count?: number;
  readonly total_count?: number;
  readonly data?: BlocklistEntry[];
}

/** Enables or disables the guard for the merchant account. */
export async function toggleBlocklistGuard(enabled: boolean): Promise<unknown> {
  return call<unknown>(`/blocklist/toggle?status=${enabled ? "true" : "false"}`, {
    method: "POST",
  });
}

export async function listBlocklist(kind: BlocklistListKind): Promise<BlocklistEntry[]> {
  const result = await call<BlocklistEntry[] | BlocklistPage>(
    `/blocklist?data_kind=${encodeURIComponent(kind)}`,
    { method: "GET" },
  );
  // The live account answers `{count, total_count, data}`. A bare array is
  // accepted too rather than assuming the wrapper is permanent.
  return Array.isArray(result) ? result : (result.data ?? []);
}

export async function addToBlocklist(type: BlocklistKind, data: string): Promise<unknown> {
  return call<unknown>("/blocklist", {
    method: "POST",
    body: JSON.stringify({ type, data }),
  });
}

export async function removeFromBlocklist(type: BlocklistKind, data: string): Promise<unknown> {
  return call<unknown>("/blocklist", {
    method: "DELETE",
    body: JSON.stringify({ type, data }),
  });
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

export interface RoutingAlgorithm {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly description?: string;
  readonly profile_id?: string;
  readonly created_at?: number;
}

/**
 * The routing algorithms active on this profile.
 *
 * Read rather than assumed, for the same reason the blocklist is: a claim about
 * orchestration that nobody checked is decoration. `DOMAIN.md` section 7 argues
 * that routing is a reason to use an orchestration layer at all, so the
 * argument should be able to point at something running.
 */
export async function activeRouting(): Promise<RoutingAlgorithm[]> {
  const result = await call<RoutingAlgorithm[] | { data?: RoutingAlgorithm[] }>("/routing/active", {
    method: "GET",
  });
  return Array.isArray(result) ? result : (result.data ?? []);
}
