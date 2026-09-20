"use client";

import { useEffect, useState } from "react";
import { NavBar } from "@/components/ui/NavBar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

interface Status {
  totalCities: number;
  countries: number;
  freshCities: number;
  staleCities: number;
  cacheTtlDays: number;
}

interface WarmResult {
  total: number;
  alreadyFresh: number;
  attempted: number;
  warmed: number;
  failed: number;
  failedCities: string[];
  remaining: number;
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
  const [busy, setBusy] = useState<"warm" | "clear" | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);

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

  async function triggerWarm(limit?: number) {
    setBusy("warm");
    setLastResult(null);
    try {
      const qs = limit != null ? `?limit=${limit}` : "";
      const res = await fetch(`/api/admin/warm-cache${qs}`, { method: "POST" });
      const body: WarmResult = await res.json();
      setLastResult(
        `Warmed ${body.warmed}/${body.attempted} (${body.alreadyFresh} already fresh, ${body.failed} failed, ${body.remaining} still remaining).`
      );
      await loadStatus();
    } catch {
      setLastResult("Request failed — see server logs.");
    } finally {
      setBusy(null);
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
                </div>
              </Card>

              <div className="mt-4 flex flex-col gap-2.5">
                <Button onClick={() => triggerWarm(80)} disabled={busy !== null} className="w-full">
                  {busy === "warm" ? "Warming…" : "Warm next 80 (same as the daily cron tick)"}
                </Button>
                <Button variant="secondary" onClick={() => triggerWarm()} disabled={busy !== null} className="w-full">
                  {busy === "warm" ? "Warming…" : "Warm everything stale (full sweep — can take a while)"}
                </Button>
                <Button variant="ghost" onClick={triggerClear} disabled={busy !== null} className="w-full">
                  {busy === "clear" ? "Clearing…" : "Clear entire cache"}
                </Button>
              </div>

              {lastResult && <p className="mt-4 text-sm text-ink-700">{lastResult}</p>}

              <p className="mt-8 text-xs text-ink-300">
                A scheduled job warms up to 80 cities automatically once a day (vercel.json) — this page is for checking
                coverage and triggering a run manually, not something you need to visit regularly.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
