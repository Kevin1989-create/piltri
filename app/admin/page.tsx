"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { NavBar } from "@/components/ui/NavBar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

interface Status {
  totalCities: number;
  countries: number;
  freshCities: number;
  staleCities: number;
  cacheTtlDays: number;
  landAreaChecked: number;
  landAreaFound: number;
  wikidataChecked: number;
  wikidataFound: number;
  overpassChecked: number;
  overpassFound: number;
}

interface WarmResult {
  total: number;
  alreadyFresh: number;
  attempted: number;
  warmed: number;
  failed: number;
  failedCities: string[];
  remaining: number;
  stoppedReason: "exhausted" | "limit" | "deadline";
}

interface BackfillLandAreaResult {
  total: number;
  alreadyChecked: number;
  attempted: number;
  found: number;
  notFound: number;
  failed: number;
  remaining: number;
  stoppedReason: "exhausted" | "deadline";
}

// Same shape as BackfillLandAreaResult - kept as its own type rather than
// reused, since the two backfills are unrelated and a shared type would
// just be a coincidence waiting to drift.
type BackfillWikidataPopulationResult = BackfillLandAreaResult;

// No "notFound" bucket here (unlike the 2 backfills above) - see
// backfillOverpassAmenities.ts's own doc comment for why "found" means
// something slightly different for this one (the combined Overpass call
// itself succeeded, not that every individual flag/count came back
// positive).
interface BackfillOverpassAmenitiesResult {
  total: number;
  alreadyChecked: number;
  attempted: number;
  found: number;
  failed: number;
  remaining: number;
  stoppedReason: "exhausted" | "deadline";
}

/** Back-office status page: how much of the city shortlist currently has
 *  real, fresh data cached, plus manual triggers for the same warm/clear
 *  actions the scheduled cron job (vercel.json → /api/cron/warm-cache-tick)
 *  runs automatically once a day. Password-gated via a single shared
 *  ADMIN_PASSWORD (see lib/adminAuth.ts) — deliberately simple, since this
 *  only ever exposes coverage stats and a "refresh" trigger, nothing about
 *  real users. */
export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null); // null = still checking
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"warm" | "sweep" | "clear" | "landArea" | "wikidataPopulation" | "overpassAmenities" | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [sweepProgress, setSweepProgress] = useState<{ warmed: number; failed: number } | null>(null);
  const [landAreaProgress, setLandAreaProgress] = useState<{ found: number; notFound: number; failed: number } | null>(null);
  const [wikidataProgress, setWikidataProgress] = useState<{ found: number; notFound: number; failed: number } | null>(null);
  const [overpassProgress, setOverpassProgress] = useState<{ found: number; failed: number } | null>(null);
  // A plain ref, not state - flipping it doesn't need a re-render, it's
  // only read at the top of runSweep's loop between calls to decide
  // whether to keep going, same pattern as an AbortController but simpler
  // for "let the current call finish, then stop" rather than truly
  // cancelling an in-flight request.
  const stopRequested = useRef(false);
  const stopLandAreaRequested = useRef(false);
  const stopWikidataRequested = useRef(false);
  const stopOverpassRequested = useRef(false);

  async function loadStatus() {
    const res = await fetch("/api/admin/status");
    if (res.status === 401) {
      setAuthed(false);
      return;
    }
    setAuthed(true);
    setStatus(await res.json());
  }

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoginError(null);
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setLoginError(body.error ?? "Login failed.");
      return;
    }
    setPassword("");
    await loadStatus();
  }

  async function callWarmOnce(): Promise<WarmResult> {
    const res = await fetch("/api/admin/warm-cache", { method: "POST" });
    return res.json();
  }

  async function triggerWarmOnce() {
    setBusy("warm");
    setLastResult(null);
    try {
      const body = await callWarmOnce();
      setLastResult(
        `Warmed ${body.warmed}/${body.attempted} (${body.alreadyFresh} already fresh, ${body.failed} failed, ${body.remaining} still remaining, stopped: ${body.stoppedReason}).`
      );
      await loadStatus();
    } catch {
      setLastResult("Request failed — see server logs.");
    } finally {
      setBusy(null);
    }
  }

  /** "Warm everything stale" — a single server call can never safely run
   *  long enough to sweep the whole ~6,300-city shortlist (Vercel kills any
   *  serverless invocation well before that; see warmCache's doc comment),
   *  so this drives the sweep from here instead: call the same
   *  deadline-bounded endpoint repeatedly until it reports nothing left,
   *  or until "Stop" is clicked. */
  async function triggerFullSweep() {
    setBusy("sweep");
    setLastResult(null);
    stopRequested.current = false;
    let totalWarmed = 0;
    let totalFailed = 0;
    setSweepProgress({ warmed: 0, failed: 0 });

    try {
      while (!stopRequested.current) {
        const body = await callWarmOnce();
        totalWarmed += body.warmed;
        totalFailed += body.failed;
        setSweepProgress({ warmed: totalWarmed, failed: totalFailed });
        await loadStatus();
        if (body.remaining <= 0) {
          setLastResult(`Full sweep complete — warmed ${totalWarmed}, ${totalFailed} failed.`);
          break;
        }
      }
      if (stopRequested.current) {
        setLastResult(`Stopped — warmed ${totalWarmed} this run, ${totalFailed} failed. Resume any time.`);
      }
    } catch {
      setLastResult(`Request failed after warming ${totalWarmed} this run — see server logs.`);
    } finally {
      setBusy(null);
      setSweepProgress(null);
    }
  }

  /** Land area backfill — same repeat-until-done pattern as the cache
   *  sweep above, but Nominatim's strict 1 request/second usage policy
   *  (vs. Overpass's tolerance for gentle concurrency) means each call
   *  only gets through ~40 cities, not hundreds - a full ~6,300-city pass
   *  is genuinely dozens of calls / well over an hour of wall-clock time,
   *  not a quick sweep. Safe to stop and resume any time - nothing here
   *  is lost, cities.osm_land_area_checked_at just tracks what's already
   *  been attempted. */
  async function triggerLandAreaBackfill() {
    setBusy("landArea");
    setLastResult(null);
    stopLandAreaRequested.current = false;
    let totalFound = 0;
    let totalNotFound = 0;
    let totalFailed = 0;
    setLandAreaProgress({ found: 0, notFound: 0, failed: 0 });

    try {
      while (!stopLandAreaRequested.current) {
        const res = await fetch("/api/admin/backfill-land-area", { method: "POST" });
        const body: BackfillLandAreaResult = await res.json();
        totalFound += body.found;
        totalNotFound += body.notFound;
        totalFailed += body.failed;
        setLandAreaProgress({ found: totalFound, notFound: totalNotFound, failed: totalFailed });
        await loadStatus();
        if (body.remaining <= 0) {
          setLastResult(`Land area backfill complete — ${totalFound} found, ${totalNotFound} had no OSM boundary, ${totalFailed} failed.`);
          break;
        }
      }
      if (stopLandAreaRequested.current) {
        setLastResult(`Stopped — ${totalFound} found, ${totalNotFound} not found this run. Resume any time.`);
      }
    } catch {
      setLastResult(`Request failed after ${totalFound} found this run — see server logs.`);
    } finally {
      setBusy(null);
      setLandAreaProgress(null);
    }
  }

  /** Wikidata population/area backfill - same repeat-until-done pattern as
   *  the land-area backfill above, replacing the live per-search Wikidata
   *  call (see aggregate.ts) with a one-time paced sweep of the shortlist,
   *  since Wikidata's query service has real, demonstrated reliability
   *  problems at request time (see backfillWikidataPopulation.ts's doc
   *  comment). Safe to stop and resume any time - cities.wikidata_checked_at
   *  just tracks what's already been attempted. */
  async function triggerWikidataBackfill() {
    setBusy("wikidataPopulation");
    setLastResult(null);
    stopWikidataRequested.current = false;
    let totalFound = 0;
    let totalNotFound = 0;
    let totalFailed = 0;
    setWikidataProgress({ found: 0, notFound: 0, failed: 0 });

    try {
      while (!stopWikidataRequested.current) {
        const res = await fetch("/api/admin/backfill-wikidata-population", { method: "POST" });
        const body: BackfillWikidataPopulationResult = await res.json();
        totalFound += body.found;
        totalNotFound += body.notFound;
        totalFailed += body.failed;
        setWikidataProgress({ found: totalFound, notFound: totalNotFound, failed: totalFailed });
        await loadStatus();
        if (body.remaining <= 0) {
          setLastResult(`Wikidata population backfill complete — ${totalFound} found, ${totalNotFound} had no Wikidata match, ${totalFailed} failed.`);
          break;
        }
      }
      if (stopWikidataRequested.current) {
        setLastResult(`Stopped — ${totalFound} found, ${totalNotFound} not found this run. Resume any time.`);
      }
    } catch {
      setLastResult(`Request failed after ${totalFound} found this run — see server logs.`);
    } finally {
      setBusy(null);
      setWikidataProgress(null);
    }
  }

  /** Overpass amenities backfill (transport/education presence, beach/
   *  mountain/forest distance, density counts) - same repeat-until-done
   *  pattern as the 2 backfills above, replacing the live per-search
   *  Overpass call (see aggregate.ts) with a one-time paced sweep of the
   *  shortlist. Safe to stop and resume any time - cities.overpass_checked_at
   *  just tracks what's already been attempted. */
  async function triggerOverpassBackfill() {
    setBusy("overpassAmenities");
    setLastResult(null);
    stopOverpassRequested.current = false;
    let totalFound = 0;
    let totalFailed = 0;
    setOverpassProgress({ found: 0, failed: 0 });

    try {
      while (!stopOverpassRequested.current) {
        const res = await fetch("/api/admin/backfill-overpass-amenities", { method: "POST" });
        const body: BackfillOverpassAmenitiesResult = await res.json();
        totalFound += body.found;
        totalFailed += body.failed;
        setOverpassProgress({ found: totalFound, failed: totalFailed });
        await loadStatus();
        if (body.remaining <= 0) {
          setLastResult(`Overpass amenities backfill complete — ${totalFound} found, ${totalFailed} failed.`);
          break;
        }
      }
      if (stopOverpassRequested.current) {
        setLastResult(`Stopped — ${totalFound} found this run, ${totalFailed} failed. Resume any time.`);
      }
    } catch {
      setLastResult(`Request failed after ${totalFound} found this run — see server logs.`);
    } finally {
      setBusy(null);
      setOverpassProgress(null);
    }
  }

  async function triggerClear() {
    if (!confirm("Clear every cached city score? Nothing is lost (it's all re-derivable), but the site will read slower until re-warmed.")) {
      return;
    }
    setBusy("clear");
    setLastResult(null);
    try {
      const res = await fetch("/api/admin/clear-cache", { method: "POST" });
      const body = await res.json();
      setLastResult(`Cleared ${body.cleared} cached rows.`);
      await loadStatus();
    } catch {
      setLastResult("Request failed — see server logs.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="min-h-screen flex flex-col">
      <NavBar logoSide="left" border={false} />

      <div className="flex-1 flex flex-col items-center px-6 py-10">
        <div className="w-full max-w-lg">
          <h1 className="font-serif text-2xl text-ink-900 mb-1">Back office</h1>
          <p className="text-sm text-ink-500 mb-6">City data coverage &amp; cache maintenance.</p>

          {authed === null && <p className="text-sm text-ink-500">Loading…</p>}

          {authed === false && (
            <Card className="p-6">
              <form onSubmit={handleLogin} className="flex flex-col gap-3">
                <label className="text-sm text-ink-700">
                  Password
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoFocus
                    className="mt-1 w-full rounded-pill border border-surface-border bg-surface px-4 py-2 text-sm text-ink-900 focus:outline-none focus:border-piltri-amber"
                  />
                </label>
                {loginError && <p className="text-xs text-score-weak">{loginError}</p>}
                <Button type="submit" className="w-full">
                  Sign in
                </Button>
              </form>
            </Card>
          )}

          {authed === true && status && (
            <>
              <Card className="p-6">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="font-serif text-2xl text-piltri-amber tabular-nums">{status.freshCities}</p>
                    <p className="text-ink-500 text-xs mt-0.5">Fresh (of {status.totalCities})</p>
                  </div>
                  <div>
                    <p className="font-serif text-2xl text-ink-900 tabular-nums">{status.staleCities}</p>
                    <p className="text-ink-500 text-xs mt-0.5">Stale / not yet warmed</p>
                  </div>
                  <div>
                    <p className="font-serif text-2xl text-ink-900 tabular-nums">{status.countries}</p>
                    <p className="text-ink-500 text-xs mt-0.5">Countries covered</p>
                  </div>
                  <div>
                    <p className="font-serif text-2xl text-ink-900 tabular-nums">{status.cacheTtlDays}d</p>
                    <p className="text-ink-500 text-xs mt-0.5">Cache freshness window</p>
                  </div>
                  <div>
                    <p className="font-serif text-2xl text-ink-900 tabular-nums">{status.landAreaFound}</p>
                    <p className="text-ink-500 text-xs mt-0.5">City land area found (OSM)</p>
                  </div>
                  <div>
                    <p className="font-serif text-2xl text-ink-900 tabular-nums">
                      {status.landAreaChecked}/{status.totalCities}
                    </p>
                    <p className="text-ink-500 text-xs mt-0.5">Land area backfill checked</p>
                  </div>
                  <div>
                    <p className="font-serif text-2xl text-ink-900 tabular-nums">{status.wikidataFound}</p>
                    <p className="text-ink-500 text-xs mt-0.5">City population found (Wikidata)</p>
                  </div>
                  <div>
                    <p className="font-serif text-2xl text-ink-900 tabular-nums">
                      {status.wikidataChecked}/{status.totalCities}
                    </p>
                    <p className="text-ink-500 text-xs mt-0.5">Wikidata backfill checked</p>
                  </div>
                  <div>
                    <p className="font-serif text-2xl text-ink-900 tabular-nums">{status.overpassFound}</p>
                    <p className="text-ink-500 text-xs mt-0.5">Overpass amenities found</p>
                  </div>
                  <div>
                    <p className="font-serif text-2xl text-ink-900 tabular-nums">
                      {status.overpassChecked}/{status.totalCities}
                    </p>
                    <p className="text-ink-500 text-xs mt-0.5">Overpass backfill checked</p>
                  </div>
                </div>
              </Card>

              <div className="mt-4 flex flex-col gap-2.5">
                <Button onClick={triggerWarmOnce} disabled={busy !== null} className="w-full">
                  {busy === "warm" ? "Warming…" : "Warm one batch now (same as the daily cron tick)"}
                </Button>
                {busy === "sweep" ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      stopRequested.current = true;
                    }}
                    className="w-full"
                  >
                    Stop sweep{sweepProgress ? ` (${sweepProgress.warmed} warmed so far)` : ""}
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={triggerFullSweep} disabled={busy !== null} className="w-full">
                    Warm everything stale (full sweep — runs several batches, can take a while)
                  </Button>
                )}
                {busy === "landArea" ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      stopLandAreaRequested.current = true;
                    }}
                    className="w-full"
                  >
                    Stop backfill{landAreaProgress ? ` (${landAreaProgress.found} found so far)` : ""}
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={triggerLandAreaBackfill} disabled={busy !== null} className="w-full">
                    Backfill city land area (OSM) — one-time, paced at 1/sec, can take a while
                  </Button>
                )}
                {busy === "wikidataPopulation" ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      stopWikidataRequested.current = true;
                    }}
                    className="w-full"
                  >
                    Stop backfill{wikidataProgress ? ` (${wikidataProgress.found} found so far)` : ""}
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={triggerWikidataBackfill} disabled={busy !== null} className="w-full">
                    Backfill city population (Wikidata) — one-time, paced, can take a while
                  </Button>
                )}
                {busy === "overpassAmenities" ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      stopOverpassRequested.current = true;
                    }}
                    className="w-full"
                  >
                    Stop backfill{overpassProgress ? ` (${overpassProgress.found} found so far)` : ""}
                  </Button>
                ) : (
                  <Button variant="secondary" onClick={triggerOverpassBackfill} disabled={busy !== null} className="w-full">
                    Backfill Overpass amenities (transport/schools/beach/etc.) — one-time, paced, can take a while
                  </Button>
                )}
                <Button variant="ghost" onClick={triggerClear} disabled={busy !== null} className="w-full">
                  {busy === "clear" ? "Clearing…" : "Clear entire cache"}
                </Button>
                <Link href="/admin/resources">
                  <Button variant="secondary" className="w-full">
                    Manage Resources links
                  </Button>
                </Link>
              </div>

              {lastResult && <p className="mt-4 text-sm text-ink-700">{lastResult}</p>}

              <p className="mt-8 text-xs text-ink-300">
                A scheduled job warms a batch automatically once a day (vercel.json) — this page is for checking coverage
                and triggering a run manually, not something you need to visit regularly.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
