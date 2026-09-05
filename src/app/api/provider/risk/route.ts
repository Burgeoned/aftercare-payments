import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { isStaff, STAFF_COOKIE } from "@/lib/staff";

import { STATEMENTS } from "@/lib/domain/fixtures";
import { summariseRisk } from "@/lib/domain/risk";
import { allPayments, lookupFailuresByDay } from "@/lib/domain/store";
import {
  activeRouting,
  addToBlocklist,
  HyperswitchError,
  listBlocklist,
  removeFromBlocklist,
  toggleBlocklistGuard,
  type BlocklistKind,
  type BlocklistListKind,
} from "@/lib/hyperswitch/client";

/**
 * Risk signals, and the state of the one control that actually blocks a card.
 *
 * The signals come from this application's own ledger. The blocklist comes from
 * Hyperswitch, live, because a risk screen that reports a control it has not
 * checked is worse than one that reports nothing: it tells an operator they are
 * protected without knowing whether they are.
 *
 * Same stated boundary as the rest of the provider surface: not authenticated.
 * See docs/SCOPE.md item 10.
 */

export const dynamic = "force-dynamic";

/**
 * Two unions, because the API uses two vocabularies. `fingerprint` is what you
 * block; `payment_method` is what you list. Querying the list with the blocking
 * name returns 400.
 */
const LIST_KINDS: readonly BlocklistListKind[] = [
  "card_bin",
  "extended_card_bin",
  "payment_method",
];

const BLOCK_KINDS: readonly BlocklistKind[] = ["card_bin", "extended_card_bin", "fingerprint"];

function isKind(value: unknown): value is BlocklistKind {
  return typeof value === "string" && BLOCK_KINDS.includes(value as BlocklistKind);
}

export async function GET(): Promise<NextResponse> {
  if (!isStaff((await cookies()).get(STAFF_COOKIE)?.value)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  const payments = await allPayments();

  /**
   * Reported separately from the ledger signals. If Hyperswitch cannot be
   * reached, the risk numbers are still true and should still be shown; it is
   * the blocklist that is unknown, and saying so is the point.
   */
  let blocklist: { kind: string; entries: unknown[] }[] | null = null;
  let blocklistError: string | null = null;

  try {
    blocklist = await Promise.all(
      LIST_KINDS.map(async (kind) => ({ kind, entries: [...(await listBlocklist(kind))] })),
    );
  } catch (error) {
    blocklistError =
      error instanceof HyperswitchError
        ? `${error.message}`
        : error instanceof Error
          ? error.message
          : "unknown error";
  }

  /**
   * Read live, like the blocklist. `DOMAIN.md` section 7 argues routing is a
   * reason to use an orchestration layer, so the argument should point at
   * something running rather than at a paragraph.
   */
  let routing: unknown[] | null = null;
  try {
    routing = [...(await activeRouting())];
  } catch (error) {
    console.warn("could not read routing configuration", error);
  }

  return NextResponse.json({
    risk: summariseRisk(STATEMENTS, payments),
    routing,
    lookupFailures: await lookupFailuresByDay(),
    blocklist,
    blocklistError,
  });
}

interface MutateBody {
  readonly action?: unknown;
  readonly type?: unknown;
  readonly data?: unknown;
  readonly enabled?: unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  /**
   * Staff only. This endpoint changes state at the processor, and it was
   * reachable by anyone on the internet until D-030. A deferral describes
   * something not built; that was something exposed.
   */
  if (!isStaff((await cookies()).get(STAFF_COOKIE)?.value)) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }

  let body: MutateBody;
  try {
    body = (await request.json()) as MutateBody;
  } catch {
    return NextResponse.json({ error: "malformed_request" }, { status: 400 });
  }

  try {
    if (body.action === "toggle") {
      if (typeof body.enabled !== "boolean") {
        return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
      }
      return NextResponse.json({ result: await toggleBlocklistGuard(body.enabled) });
    }

    if (body.action === "block" || body.action === "unblock") {
      if (!isKind(body.type) || typeof body.data !== "string" || body.data.trim() === "") {
        return NextResponse.json(
          { error: "type must be card_bin, extended_card_bin or fingerprint, with data" },
          { status: 400 },
        );
      }

      const value = body.data.trim();
      const result =
        body.action === "block"
          ? await addToBlocklist(body.type, value)
          : await removeFromBlocklist(body.type, value);

      return NextResponse.json({ result });
    }

    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (error) {
    if (error instanceof HyperswitchError) {
      console.error("blocklist call failed", error.httpStatus, error.body);
      return NextResponse.json(
        { error: "processor_rejected", message: error.message, detail: error.body },
        { status: error.httpStatus === 0 ? 503 : 502 },
      );
    }
    throw error;
  }
}
