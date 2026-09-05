import "server-only";

import { serverEnv } from "@/lib/env";
import type { Cents, Currency, PaymentStatus } from "@/lib/domain/types";

/**
 * Thin server-side client for the Hyperswitch API.
 *
 * Deliberately not a full SDK wrapper. It covers the three calls this prototype
 * makes and nothing else, because every additional guessed field is a claim
 * about an API contract that has not been verified.
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
