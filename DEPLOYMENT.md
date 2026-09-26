# Deployment

Piltri runs on free tiers only: Vercel (site + CDN), Supabase (Resources
links table + public dataset bucket), GitHub Actions (monthly data refresh).

## Supabase

1. SQL Editor -> run `lib/supabase/schema.sql` (creates the Resources links
   table).
2. Storage -> New bucket `piltri-data`, **public**.
3. Project Settings -> API: copy the project URL
   (`NEXT_PUBLIC_SUPABASE_URL`) and the `service_role` key
   (`SUPABASE_SERVICE_ROLE_KEY` - server/pipeline only, never client-side).

## Data

`npm run pipeline` (locally or via the GitHub workflow) builds and publishes
the dataset - see `pipeline/README.md`. The site can't build until at least
one dataset has been published.

## Vercel

1. Import the GitHub repo (framework preset: Next.js).
2. Environment variables: `NEXT_PUBLIC_SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`.
3. Every push to `main` deploys. The build (`prebuild`) downloads the
   current dataset from Supabase and serves it as static files.
4. Settings -> Git -> Deploy Hooks: create one for branch `main`; store its
   URL as the GitHub secret `VERCEL_DEPLOY_HOOK_URL` so the monthly data
   refresh redeploys the site.

## GitHub Actions secrets

`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`VERCEL_DEPLOY_HOOK_URL` (Settings -> Secrets and variables -> Actions).
The workflow `.github/workflows/refresh-dataset.yml` runs monthly and can be
started by hand from the Actions tab.

## Domain

`piltri.me` - DNS at Hostinger: apex A record to Vercel, `www` CNAME to
Vercel's per-project target. Configured under Vercel -> Settings -> Domains.

## Rollback

- Code: redeploy an earlier deployment from the Vercel dashboard.
- Data: the previous dataset version is kept in the bucket; re-upload its
  manifest as `v<schema>/manifest.json` (or run
  `npm run pipeline:publish <version>` for a locally built one) and redeploy.
