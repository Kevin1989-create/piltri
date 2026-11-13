import type { Metadata } from "next";
import { NavBar } from "@/components/ui/NavBar";
import { BackLink } from "@/components/ui/BackLink";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Piltri keeps about you, and why.",
};

/** The privacy notice (2026-11-08, with accounts: emails and saved places
 *  are personal data). Plain words; the owner reviews it before launch. */
export default function PrivacyPage() {
  return (
    <main className="min-h-dvh flex flex-col bg-surface-muted">
      <NavBar />
      <div className="px-4 sm:px-6 pt-6 sm:pt-8 pb-16">
        <article className="max-w-2xl mx-auto text-sm leading-relaxed text-ink-700">
          <BackLink />
          <h1 className="font-serif text-3xl sm:text-4xl text-ink-900 mt-2">Privacy</h1>
          <p className="mt-1 text-ink-500">What Piltri keeps about you, and why - in plain words.</p>

          <h2 className="mt-8 font-serif text-xl text-ink-900">Without an account</h2>
          <p className="mt-2">
            Nothing about you leaves your device. The places and spots you save, and your settings (units, score weighting), are kept in your
            browser&apos;s own storage. Clearing your browser&apos;s data removes them.
          </p>

          <h2 className="mt-8 font-serif text-xl text-ink-900">With an account</h2>
          <p className="mt-2">
            We keep your email address - to send you sign-in links and to know it&apos;s you - and the places and spots you save, so they follow
            you to any device. That&apos;s all. We don&apos;t send newsletters or marketing, we don&apos;t sell or share your data, and there&apos;s no
            advertising or tracking on Piltri.
          </p>
          <p className="mt-2">
            Your account and saved places are stored with Supabase, the database service Piltri runs on; only you can read or change your saved
            places.
          </p>

          <h2 className="mt-8 font-serif text-xl text-ink-900">Deleting it</h2>
          <p className="mt-2">
            You can delete your account at any time from the Saved page (&quot;Delete my account&quot;): your email and everything you saved are
            removed for good, at once.
          </p>

          <h2 className="mt-8 font-serif text-xl text-ink-900">Services your browser uses</h2>
          <p className="mt-2">
            The maps are drawn from OpenFreeMap&apos;s tiles, which your browser downloads as you look around. When you ask for a journey by road,
            its two ends are sent to the OpenStreetMap community&apos;s routing service. When you search an address on a city&apos;s map, what you
            type is sent to Photon, Komoot&apos;s search over OpenStreetMap, along with the area of that city - not your account, and not where you
            are. The site is hosted by Vercel, and the figures about each place by Cloudflare; both keep the usual short-lived server logs.
          </p>
        </article>
      </div>
    </main>
  );
}
