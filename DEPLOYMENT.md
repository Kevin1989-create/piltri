# Deployment guide — Phase 6

Everything in this file requires your accounts/payment details, so these are
"You (with Claude's guidance)" steps from the checklist. Follow in order.

## 1. Provision Supabase (finishes step 4.2)

1. Open your Supabase project (created in step 1.6).
2. Go to **SQL Editor** → paste the contents of `lib/supabase/schema.sql` → run it.
3. Go to **Project Settings → API** and copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret — never expose client-side)

## 2. Get a Mapbox token (finishes step 3.1 for Mapbox)

1. Open your Mapbox account (created in step 1.7).
2. **Account → Tokens** → copy your default public token → `NEXT_PUBLIC_MAPBOX_TOKEN`.
3. **Set up the usage alert now** (checklist "Ongoing — Mapbox usage monitoring"):
   Account → Billing → Usage alerts → set an alert at 80% of the 50,000
   free monthly map loads.

## 3. Push the code to GitHub

```bash
cd piltri
git init
git add .
git commit -m "Piltri Explore — initial build"
git branch -M main
git remote add origin <your GitHub repo URL from step 1.8>
git push -u origin main
```

## 4. Deploy on Vercel (step 6.3)

1. In the Vercel dashboard (account created in step 1.5): **Add New → Project** → import the GitHub repo.
2. Framework preset: Next.js (auto-detected).
3. Add environment variables (Settings → Environment Variables) — copy every
   key from `.env.example`, using the real values from steps 1 and 2 above.
   Also set `CRON_SECRET` and `ADMIN_PASSWORD` (see HANDOFF.md's "Scheduled
   warming" section — needed for the daily cache-warming cron job and the
   `/admin` back-office page to work).
4. Click **Deploy**. Vercel will build and give you a `*.vercel.app` URL —
   confirm the Home, Explore, and results pages all load before continuing.

## 5. Connect piltri.me (step 6.4)

1. In the Vercel project: **Settings → Domains → Add** → enter `piltri.me`.
2. Vercel will show DNS records to add. At your domain registrar (where you
   registered piltri.me in step 1.2), add either:
   - **Recommended:** change nameservers to Vercel's, or
   - Add the **A record** (`76.76.21.21`) and **CNAME** for `www` that Vercel provides.
3. DNS propagation can take a few minutes to a few hours. Vercel's Domains
   page shows a green checkmark once it's verified and SSL is issued.

## 6. Soft launch checklist (6.1, 6.5, 6.6)

- Test Explore with 5–10 real cities across different continents — check
  for API failures or odd scores.
- Check the Mapbox usage dashboard after week 1 and week 2.
- Confirm the daily cron (`/api/cron/warm-cache-tick`, see HANDOFF.md) is
  actually running — Vercel's dashboard (Settings → Cron Jobs) shows recent
  invocations and their status.
- Share the piltri.me link with a small group before any public
  announcement, and log feedback/bugs against `KNOWN-ISSUES.md`.

## Rollback / fallback

If Mapbox usage approaches the free-tier limit before caching absorbs
enough traffic, `lib/data-sources/mapbox.ts` can be swapped for
OpenStreetMap + Leaflet.js (no credit card, fully free) — the checklist's
noted fallback. The `MapView` component is the only place that imports
`mapbox-gl`, so this is a contained change.
