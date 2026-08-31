import { NextResponse } from "next/server";

import { cents } from "@/lib/domain/types";
import { createPayment, HyperswitchError } from "@/lib/hyperswitch/client";
import { serverEnv } from "@/lib/env";

/**
 * Creates a payment intent and returns the client secret for the browser SDK.
 *
 * Build step 2 only: the amount is fixed here. Step 4 replaces it with the
 * server-derived remaining balance on a statement. The amount is never taken
 * from the request body, at either stage. A client-supplied amount on a medical
 * bill is a trivially exploitable underpayment.
 */

// The route touches secrets and must never be statically evaluated at build.
export const dynamic = "force-dynamic";

const SMOKE_TEST_AMOUNT = cents(100);
const SMOKE_TEST_REF = "SMOKE-0001";

export async function POST(): Promise<NextResponse> {
  let env;
  try {
    env = serverEnv();
  } catch (error) {
    return NextResponse.json(
      {
        error: "configuration",
        message: error instanceof Error ? error.message : "Environment is incomplete",
      },
      { status: 500 },
    );
  }

  try {
    const payment = await createPayment({
      amount: SMOKE_TEST_AMOUNT,
      currency: "USD",
      // Recognizable on a bank statement, and free of clinical detail.
      description: `Patient responsibility, statement ${SMOKE_TEST_REF}`,
      statementRef: SMOKE_TEST_REF,
      returnUrl: `${env.appUrl}/pay/return`,
    });

    if (payment.client_secret === null) {
      return NextResponse.json(
        { error: "no_client_secret", message: "Hyperswitch returned no client secret" },
        { status: 502 },
      );
    }

    return NextResponse.json({
      paymentId: payment.payment_id,
      clientSecret: payment.client_secret,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
    });
  } catch (error) {
    if (error instanceof HyperswitchError) {
      // Surface the processor's own message in the prototype. A production
      // build would map this to a patient-safe string and log the raw body.
      return NextResponse.json(
        { error: "processor", message: error.message, detail: error.body },
        { status: error.httpStatus === 0 ? 503 : 502 },
      );
    }
    throw error;
  }
}
