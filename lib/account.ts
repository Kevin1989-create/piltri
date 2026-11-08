"use client";

/**
 * Accounts (2026-11-08, owner: "a personal account ... on which all the
 * likes would be displayed"): Supabase Auth, signing in with a link sent
 * by email (no password), and the saved places and spots kept in the
 * account (table `saved_items`, supabase/saved-items.sql - each person can
 * only read and change their own rows).
 *
 * The browser keeps its own copy (lib/savedPlaces.ts, lib/spots.ts), so
 * pages stay instant; this keeps the two in step:
 *  - the first time someone signs in on a browser, what it already saved
 *    joins the account;
 *  - after that the account is the truth - signing in on a new device
 *    brings everything there;
 *  - while signed in, each save or removal goes to the account at once;
 *  - signing out clears this browser's copy (it's in the account).
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY; without
 * them the site works as before, saving in the browser only.
 */
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { SAVED_OP, savedPlaces, writePlaces, placeItem, type SavedItem, type SavedOp, type SavedPlace } from "@/lib/savedPlaces";
import { allSavedSpots, spotItem, writeSpots, type SavedSpot } from "@/lib/spots";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const accountsConfigured = Boolean(URL_ && ANON);

/** Where the session lives in the browser - also what tells a page,
 *  cheaply, that someone may be signed in. */
export const AUTH_STORAGE_KEY = "piltri:auth";
/** Which account this browser's copy was last merged with. */
const SYNCED_KEY = "piltri:synced-user";

let client: SupabaseClient | null = null;
export function accountClient(): SupabaseClient | null {
  if (!accountsConfigured || typeof window === "undefined") return null;
  client ??= createClient(URL_!, ANON!, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit", storageKey: AUTH_STORAGE_KEY },
  });
  return client;
}

type Row = {
  item_key: string;
  kind: "place" | "spot";
  place_id: string;
  name: string | null;
  country: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
};

const toRow = (item: SavedItem) => ({
  item_key: item.key,
  kind: item.kind,
  place_id: item.placeId,
  name: item.name,
  country: item.country,
  lat: item.lat,
  lng: item.lng,
  created_at: item.savedAt,
});

function localItems(): SavedItem[] {
  return [...savedPlaces().map(placeItem), ...allSavedSpots().map(spotItem)];
}

/** This browser's copy, from the account's rows. */
function writeLocal(rows: Row[]): void {
  const places: SavedPlace[] = rows
    .filter((r) => r.kind === "place")
    .map((r) => ({ id: r.place_id, name: r.name ?? r.place_id, country: r.country ?? "", lat: r.lat, lng: r.lng, savedAt: r.created_at }));
  const spots: SavedSpot[] = rows
    .filter((r) => r.kind === "spot" && r.lat != null && r.lng != null)
    .map((r) => ({ placeId: r.place_id, lat: r.lat!, lng: r.lng!, name: r.name, savedAt: r.created_at }));
  places.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  writePlaces(places);
  writeSpots(spots);
}

let syncing: Promise<void> | null = null;
async function sync(user: User): Promise<void> {
  const supabase = accountClient();
  if (!supabase) return;
  const { data, error } = await supabase.from("saved_items").select("item_key, kind, place_id, name, country, lat, lng, created_at");
  if (error) throw error;
  let rows = (data ?? []) as Row[];
  // First time on this browser for this account: what it saved joins.
  if (window.localStorage.getItem(SYNCED_KEY) !== user.id) {
    const have = new Set(rows.map((r) => r.item_key));
    const extra = localItems().filter((item) => !have.has(item.key)).map(toRow);
    if (extra.length) {
      const { error: upErr } = await supabase.from("saved_items").upsert(extra, { onConflict: "user_id,item_key", ignoreDuplicates: true });
      if (upErr) throw upErr;
      rows = [...rows, ...(extra as Row[])];
    }
    window.localStorage.setItem(SYNCED_KEY, user.id);
  }
  writeLocal(rows);
}

/** Keeps this browser's saves and the signed-in account in step - once
 *  per page; the app's root mounts it (AccountSync). */
let started = false;
export function startAccountSync(): void {
  const supabase = accountClient();
  if (!supabase || started) return;
  started = true;
  let user: User | null = null;
  supabase.auth.onAuthStateChange((event, session) => {
    const next = session?.user ?? null;
    if (event === "SIGNED_OUT") {
      user = null;
      window.localStorage.removeItem(SYNCED_KEY);
      writePlaces([]);
      writeSpots([]);
      return;
    }
    if (next && (event === "SIGNED_IN" || event === "INITIAL_SESSION") && next.id !== user?.id) {
      user = next;
      syncing = sync(next).catch(() => {}).finally(() => (syncing = null));
    }
  });
  window.addEventListener(SAVED_OP, (e) => {
    if (!user) return;
    const { op, item } = (e as CustomEvent<SavedOp>).detail;
    const after = syncing ?? Promise.resolve();
    after.then(async () => {
      if (op === "add") await supabase.from("saved_items").upsert(toRow(item), { onConflict: "user_id,item_key" });
      else await supabase.from("saved_items").delete().eq("item_key", item.key);
    });
  });
}

/** The signed-in person, as it changes (null when signed out). */
export function useAccount(): { configured: boolean; user: User | null; ready: boolean } {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!accountsConfigured);
  useEffect(() => {
    const supabase = accountClient();
    if (!supabase) return;
    startAccountSync();
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  return { configured: accountsConfigured, user, ready };
}

/** Emails a sign-in link that comes back to the Saved page. Null when
 *  sent, else what went wrong, in words. */
export async function sendSignInLink(email: string): Promise<string | null> {
  const supabase = accountClient();
  if (!supabase) return "Accounts aren't switched on yet.";
  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/saved` } });
  if (!error) return null;
  return /rate|too many/i.test(error.message) ? "Too many links sent just now - try again in a few minutes." : error.message;
}

export async function signOut(): Promise<void> {
  await accountClient()?.auth.signOut();
}

/** Deletes the account and everything saved in it, for good
 *  (app/api/account/delete). Null when done, else what went wrong. */
export async function deleteAccount(): Promise<string | null> {
  const supabase = accountClient();
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  if (!supabase || !token) return "Not signed in.";
  const res = await fetch("/api/account/delete", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
  if (!res?.ok) return "Couldn't delete the account just now - please try again.";
  await supabase.auth.signOut();
  return null;
}
