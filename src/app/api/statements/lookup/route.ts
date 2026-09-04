import { NextResponse } from "next/server";

import { lookupStatement } from "@/lib/domain/lookup";
import { ACCESS_COOKIE, ACCESS_TTL_SECONDS, grantAccess } from "@/lib/access";

/**
 * Guest statement lookup.
 *
 * POST rather than the `GET /api/statements/:ref` that docs/DESIGN.md section 13
 * originally specified. A GET carrying a date of birth puts it in the URL, and
 * a URL is recorded in browser history, in the Referer header of every
 * subsequent request, and in the access log of every proxy in between. For a
 * date of birth attached to a medical bill that is the wrong place for it. See
 * docs/DECISIONS.md D-012.
 *
 * A successful lookup returns an httpOnly access cookie so the statement page
 * can render without the date of birth travelling again.
 */

export const dynamic = "force-dynamic";

interface LookupBody {
  readonly ref?: unknown;
  readonly dateOfBirth?: unknown;
}

export async function POST(request: Request): Promise<NextResponse> {
  let body: LookupBody;
  try {
    body = (await request.json()) as LookupBody;
  } catch {
    return NextResponse.json(
      { error: "malformed_request", message: "Expected a JSON body." },
      { status: 400 },
    );
  }

  if (typeof body.ref !== "string" || typeof body.dateOfBirth !== "string") {
    return NextResponse.json(
      {
        error: "malformed_request",
        message: "Both a statement reference and a date of birth are required.",
      },
      { status: 400 },
    );
  }

  const result = await lookupStatement(body.ref, body.dateOfBirth);

  if (!result.ok) {
    // One message for a missing reference and for a wrong date of birth. See
    // the note in lookup.ts: distinguishing them makes this an oracle for which
    // statement references exist.
    return NextResponse.json(
      {
        error: "not_found",
        message:
          "No statement matches that reference and date of birth. " +
          "Check both against your printed statement.",
      },
      { status: 404 },
    );
  }

  const { statement, patientDisplayName, balance } = result.value;

  let accessToken: string;
  try {
    accessToken = grantAccess(statement.id);
  } catch (error) {
    // A missing signing secret is a deployment fault, not a patient fault. It
    // fails loudly here rather than handing out an unsigned cookie.
    return NextResponse.json(
      {
        error: "configuration",
        message: error instanceof Error ? error.message : "Environment is incomplete",
      },
      { status: 500 },
    );
  }

  const response = NextResponse.json({
    ref: statement.ref,
    patientDisplayName,
    remaining: balance.remaining,
    status: balance.status,
  });

  response.cookies.set({
    name: ACCESS_COOKIE,
    value: accessToken,
    httpOnly: true,
    sameSite: "lax",
    // Set on Vercel, absent under `next dev` over plain http.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ACCESS_TTL_SECONDS,
  });

  return response;
}
