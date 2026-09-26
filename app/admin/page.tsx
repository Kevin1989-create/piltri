"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NavBar } from "@/components/ui/NavBar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { DatasetManifest } from "@/lib/dataset/schema";

interface Status {
  dataset: DatasetManifest | null;
  error?: string;
}

/** Back-office page: which precomputed dataset the site is serving, plus
 *  the Resources link editor. Every city's data is computed offline by
 *  the pipeline (pipeline/README.md) and published as static files - there
 *  is no per-city cache, warm-up job or backfill left to manage here.
 *  Password-gated via ADMIN_PASSWORD (lib/adminAuth.ts). */
export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

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

  const d = status?.dataset;

  return (
    <main className="min-h-screen flex flex-col">
      <NavBar logoSide="left" border={false} />

      <div className="flex-1 flex flex-col items-center px-6 py-10">
        <div className="w-full max-w-lg">
          <h1 className="font-serif text-2xl text-ink-900 mb-1">Back office</h1>
          <p className="text-sm text-ink-500 mb-6">Dataset status &amp; Resources links.</p>

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
                {d ? (
                  <>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="font-serif text-2xl text-piltri-amber tabular-nums">{d.cityCount.toLocaleString()}</p>
                        <p className="text-ink-500 text-xs mt-0.5">Cities with full data</p>
                      </div>
                      <div>
                        <p className="font-serif text-2xl text-ink-900 tabular-nums">{d.countryCount}</p>
                        <p className="text-ink-500 text-xs mt-0.5">Countries</p>
                      </div>
                      <div>
                        <p className="font-serif text-lg text-ink-900">{new Date(d.generatedAt).toLocaleDateString()}</p>
                        <p className="text-ink-500 text-xs mt-0.5">Dataset built</p>
                      </div>
                      <div>
                        <p className="font-serif text-lg text-ink-900 break-all">{d.version}</p>
                        <p className="text-ink-500 text-xs mt-0.5">Version</p>
                      </div>
                    </div>
                    <div className="mt-5 border-t border-surface-border pt-4">
                      <p className="text-xs font-semibold text-ink-700 mb-2">Sources</p>
                      <dl className="text-xs text-ink-500 space-y-1.5">
                        {Object.entries(d.sources).map(([key, value]) => (
                          <div key={key}>
                            <dt className="inline font-medium text-ink-700 capitalize">{key}: </dt>
                            <dd className="inline">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-score-weak">Dataset unavailable: {status.error ?? "unknown error"}</p>
                )}
              </Card>

              <div className="mt-4 flex flex-col gap-2.5">
                <Link href="/admin/resources">
                  <Button variant="secondary" className="w-full">
                    Manage Resources links
                  </Button>
                </Link>
              </div>

              <p className="mt-8 text-xs text-ink-300">
                To refresh the data, run the offline pipeline (<code>npm run pipeline</code>) - it rebuilds every city from free bulk
                sources and publishes the new dataset. See pipeline/README.md.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
