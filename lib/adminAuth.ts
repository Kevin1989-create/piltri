import { NextRequest } from "next/server";

const ADMIN_COOKIE = "piltri_admin";

/** True if this request is authorised to hit an /api/admin/* route —
 *  either the browser cookie the /admin back-office page's login sets, or
 *  a bare `Authorization: Bearer <ADMIN_PASSWORD>` header (for curl/scripts,
 *  and what the /admin page itself sends so its own fetches don't depend on
 *  cookie behaviour). Both compare against the same ADMIN_PASSWORD env var,
 *  so there's exactly one password to manage. If ADMIN_PASSWORD isn't set
 *  at all, every request is rejected — safer than accidentally leaving
 *  these routes open by omission. */
export function isAdminRequest(req: NextRequest): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;

  const bearer = req.headers.get("authorization");
  if (bearer === `Bearer ${expected}`) return true;

  const cookie = req.cookies.get(ADMIN_COOKIE)?.value;
  return cookie === expected;
}

/** True if this request is Vercel Cron's own scheduled call to
 *  /api/cron/warm-cache-tick — Vercel automatically sends
 *  `Authorization: Bearer <CRON_SECRET>` on every cron invocation once
 *  CRON_SECRET is set in the project's env vars (see vercel.json). Also
 *  accepts an admin request (cookie/ADMIN_PASSWORD bearer), so the
 *  /admin page's "warm now" button can call the exact same endpoint a
 *  scheduled tick uses, rather than duplicating the chunking logic. */
export function isCronOrAdminRequest(req: NextRequest): boolean {
  const expectedCron = process.env.CRON_SECRET;
  const bearer = req.headers.get("authorization");
  if (expectedCron && bearer === `Bearer ${expectedCron}`) return true;
  return isAdminRequest(req);
}

export const ADMIN_COOKIE_NAME = ADMIN_COOKIE;
