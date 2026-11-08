import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * POST /api/account/delete - "Delete my account" (2026-11-08, with
 * accounts: GDPR's right to erasure). The person proves who they are with
 * their own session token (Authorization: Bearer ...); their saved items
 * and their sign-in are then removed for good. Only ever acts on the
 * token's own account.
 */
export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const admin = getSupabaseServiceClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const id = data.user.id;
  const { error: rowsError } = await admin.from("saved_items").delete().eq("user_id", id);
  if (rowsError) return NextResponse.json({ error: "Couldn't remove the saved places" }, { status: 500 });
  const { error: userError } = await admin.auth.admin.deleteUser(id);
  if (userError) return NextResponse.json({ error: "Couldn't remove the account" }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
