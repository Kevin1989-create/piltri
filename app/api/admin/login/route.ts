import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE_NAME } from "@/lib/adminAuth";

/**
 * POST /api/admin/login { password } — checks against ADMIN_PASSWORD and,
 * if it matches, sets the httpOnly cookie lib/adminAuth.ts's
 * isAdminRequest checks on every other /api/admin/* route. The /admin
 * page's login form calls this once; the browser then sends the cookie
 * automatically on every later fetch to an admin API route, no need to
 * thread the password through client-side state.
 */
export async function POST(req: NextRequest) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: "ADMIN_PASSWORD is not configured on the server." }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const password = body?.password;
  if (typeof password !== "string" || password !== expected) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
