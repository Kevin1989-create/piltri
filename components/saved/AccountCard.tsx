"use client";

import { useState } from "react";
import Link from "next/link";
import { deleteAccount, sendSignInLink, signOut, useAccount } from "@/lib/account";

/** Signing in on the Saved page (2026-11-08): an email, a link sent to it,
 *  and the saved places follow the account to any device. Signed in: who,
 *  and signing out. Nothing at all until accounts are switched on. */
export function AccountCard() {
  const { configured, user, ready } = useAccount();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  if (!configured || !ready) return null;

  if (user) {
    return (
      <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-surface-border bg-surface px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-piltri-amber-tint font-serif text-sm text-piltri-amber-dark">
          {(user.email ?? "?").slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-ink-900">{user.email}</p>
          <p className="text-[11px] text-ink-500">Your account - what you save follows you to any device.</p>
        </div>
        <button type="button" onClick={() => signOut()} className="rounded-pill border border-surface-border px-3 py-1 text-xs text-ink-700 hover:border-piltri-amber-light">
          Sign out
        </button>
        <p className="w-full pl-11 text-[11px] text-ink-500">
          <Link href="/privacy" className="underline-offset-2 hover:underline">
            Privacy
          </Link>
          {" · "}
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm("Delete your account and everything saved in it? This can't be undone.")) return;
              const problem = await deleteAccount();
              if (problem) setError(problem);
            }}
            className="underline-offset-2 hover:text-score-weak hover:underline"
          >
            Delete my account
          </button>
        </p>
        {error && <p className="w-full pl-11 text-xs text-score-weak">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-card border border-surface-border bg-surface px-4 py-4">
      <p className="font-serif text-lg text-ink-900">Keep them on every device</p>
      <p className="mt-0.5 text-xs text-ink-500">
        Create your account with just your email - we send a link, no password. What this browser saved comes along.{" "}
        <Link href="/privacy" className="underline underline-offset-2 hover:text-ink-700">
          How we use your email
        </Link>
      </p>
      {state === "sent" ? (
        <p className="mt-3 rounded-lg bg-piltri-amber-tint px-3 py-2 text-sm text-ink-900">
          Check your inbox: a sign-in link is on its way to <span className="font-medium">{email}</span>.
        </p>
      ) : (
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            setState("sending");
            const problem = await sendSignInLink(email.trim());
            if (problem) {
              setError(problem);
              setState("idle");
            } else setState("sent");
          }}
        >
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="min-w-0 flex-1 rounded-pill border border-surface-border bg-surface px-4 py-2 text-sm text-ink-900 placeholder:text-ink-300 focus:border-piltri-amber focus:outline-none"
          />
          <button
            type="submit"
            disabled={state === "sending"}
            className="rounded-pill bg-piltri-amber px-4 py-2 text-sm font-medium text-white hover:bg-piltri-amber-dark disabled:opacity-60"
          >
            {state === "sending" ? "Sending…" : "Email me a sign-in link"}
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-score-weak">{error}</p>}
    </div>
  );
}
