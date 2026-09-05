import { NextResponse } from "next/server";

import { signIn, STAFF_COOKIE, STAFF_TTL_SECONDS } from "@/lib/staff";

/** Exchanges the staff password for a signed session cookie. */
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  let body: { password?: unknown };
  try {
    body = (await request.json()) as { password?: unknown };
  } catch {
    return NextResponse.json({ error: "malformed_request" }, { status: 400 });
  }

  const token = typeof body.password === "string" ? signIn(body.password) : null;

  if (token === null) {
    // One message, no distinction between absent and wrong. Nothing here should
    // help someone work out how close they are.
    return NextResponse.json({ error: "rejected" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: STAFF_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: STAFF_TTL_SECONDS,
  });
  return response;
}
