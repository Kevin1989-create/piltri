"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { NavBar } from "@/components/ui/NavBar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { RESOURCE_LINK_CATEGORIES, RESOURCE_LINK_CATEGORY_LABELS, type ResourceLinkCategory } from "@/lib/types";

interface LinkRow {
  id: string;
  category: ResourceLinkCategory;
  title: string;
  url: string;
}

// Soft nudge, not a hard block (see lib/types.ts's ResourceLinkCategory
// doc comment) - the product decision is "a handful of genuinely useful
// links per country," not an enforced ceiling worth rejecting requests
// over.
const SOFT_LIMIT_PER_COUNTRY = 10;

/** Back-office page for curating Resources links (see
 *  lib/types.ts ResourceLinkCategory) - one country at a time: type a
 *  code, see what's there, add or remove. Deliberately simple (no bulk
 *  import, no country picker beyond a plain text code) since this list is
 *  meant to stay small and hand-curated, not grow into a real directory
 *  admin tool. */
export default function AdminResourcesPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);

  const [countryCode, setCountryCode] = useState("");
  const [links, setLinks] = useState<LinkRow[] | null>(null);
  const [loadingLinks, setLoadingLinks] = useState(false);

  const [category, setCategory] = useState<ResourceLinkCategory>("home");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetch("/api/admin/status").then((res) => setAuthed(res.status !== 401));
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
    setAuthed(true);
  }

  async function loadLinks(code: string) {
    if (code.length !== 2) {
      setLinks(null);
      return;
    }
    setLoadingLinks(true);
    try {
      const res = await fetch(`/api/admin/resource-links?countryCode=${code}`);
      const body = await res.json();
      setLinks(res.ok ? body.links : null);
    } finally {
      setLoadingLinks(false);
    }
  }

  function handleCountryChange(value: string) {
    const code = value.trim().toUpperCase().slice(0, 2);
    setCountryCode(code);
    loadLinks(code);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (countryCode.length !== 2) {
      setFormError("Enter a 2-letter country code first (e.g. GB, FR, US).");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/resource-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ countryCode, category, title, url }),
      });
      const body = await res.json();
      if (!res.ok) {
        setFormError(body.error ?? "Failed to add link.");
        return;
      }
      setTitle("");
      setUrl("");
      await loadLinks(countryCode);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    await fetch(`/api/admin/resource-links?id=${id}`, { method: "DELETE" });
    await loadLinks(countryCode);
  }

  return (
    <main className="min-h-screen flex flex-col">
      <NavBar logoSide="left" border={false} />

      <div className="flex-1 flex flex-col items-center px-6 py-10">
        <div className="w-full max-w-lg">
          <Link href="/admin" className="text-sm text-ink-500 hover:text-piltri-amber">
            ← Back office
          </Link>
          <h1 className="font-serif text-2xl text-ink-900 mt-1 mb-1">Resources</h1>
          <p className="text-sm text-ink-500 mb-6">Curated external links per country (Property, Visa and Immigration, Health System, Jobs).</p>

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

          {authed === true && (
            <>
              <Card className="p-6">
                <label className="text-sm text-ink-700">
                  Country code
                  <input
                    type="text"
                    value={countryCode}
                    onChange={(e) => handleCountryChange(e.target.value)}
                    placeholder="e.g. GB, FR, US"
                    maxLength={2}
                    className="mt-1 w-full rounded-pill border border-surface-border bg-surface px-4 py-2 text-sm text-ink-900 uppercase focus:outline-none focus:border-piltri-amber"
                  />
                </label>

                {countryCode.length === 2 && (
                  <form onSubmit={handleAdd} className="mt-4 flex flex-col gap-3">
                    <div className="flex gap-2">
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value as ResourceLinkCategory)}
                        className="rounded-pill border border-surface-border bg-surface px-3 py-2 text-sm text-ink-900 focus:outline-none focus:border-piltri-amber"
                      >
                        {RESOURCE_LINK_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {RESOURCE_LINK_CATEGORY_LABELS[c]}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Title (e.g. UK Visas and Immigration)"
                        className="flex-1 min-w-0 rounded-pill border border-surface-border bg-surface px-4 py-2 text-sm text-ink-900 focus:outline-none focus:border-piltri-amber"
                      />
                    </div>
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full rounded-pill border border-surface-border bg-surface px-4 py-2 text-sm text-ink-900 focus:outline-none focus:border-piltri-amber"
                    />
                    {formError && <p className="text-xs text-score-weak">{formError}</p>}
                    {links && links.length >= SOFT_LIMIT_PER_COUNTRY && (
                      <p className="text-xs text-ink-500">
                        {countryCode} already has {links.length} links — Resources is meant to stay small and curated, consider whether
                        this one earns its place.
                      </p>
                    )}
                    <Button type="submit" disabled={submitting} className="w-full">
                      {submitting ? "Adding…" : "Add link"}
                    </Button>
                  </form>
                )}
              </Card>

              {countryCode.length === 2 && (
                <div className="mt-4">
                  {loadingLinks && <p className="text-sm text-ink-500">Loading…</p>}
                  {!loadingLinks && links && links.length === 0 && (
                    <p className="text-sm text-ink-500">No links for {countryCode} yet.</p>
                  )}
                  {!loadingLinks &&
                    links &&
                    RESOURCE_LINK_CATEGORIES.map((c) => {
                      const rows = links.filter((l) => l.category === c);
                      if (rows.length === 0) return null;
                      return (
                        <div key={c} className="mb-4">
                          <p className="text-xs uppercase tracking-wide text-ink-500 mb-1.5">{RESOURCE_LINK_CATEGORY_LABELS[c]}</p>
                          <div className="flex flex-col gap-1.5">
                            {rows.map((row) => (
                              <div key={row.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-muted px-3 py-2">
                                <div className="min-w-0">
                                  <p className="text-sm text-ink-900 truncate">{row.title}</p>
                                  <p className="text-xs text-ink-500 truncate">{row.url}</p>
                                </div>
                                <button
                                  onClick={() => handleDelete(row.id)}
                                  className="flex-shrink-0 text-xs text-score-weak hover:underline"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}
