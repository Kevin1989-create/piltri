-- Piltri — Supabase schema.
--
-- The database only holds the hand-curated Resources links (edited in
-- /admin/resources). Every city/country figure comes from the offline
-- dataset (pipeline/), published to the public Storage bucket "piltri-data"
-- and served by the site as static files - no tables involved. Saved pins
-- live in the visitor's own browser (lib/savedPins.ts).

create extension if not exists "uuid-ossp";

create table if not exists country_resource_links (
  id uuid primary key default uuid_generate_v4(),
  country_code text not null,
  category text not null check (category in ('home', 'immigration', 'health', 'jobs')),
  title text not null,
  url text not null,
  created_at timestamptz not null default now()
);

create index if not exists country_resource_links_country_idx on country_resource_links (country_code);

alter table country_resource_links enable row level security;

create policy "public read country_resource_links" on country_resource_links for select using (true);
create policy "service role writes country_resource_links" on country_resource_links for insert with check (auth.role() = 'service_role');
create policy "service role updates country_resource_links" on country_resource_links for update using (auth.role() = 'service_role');
create policy "service role deletes country_resource_links" on country_resource_links for delete using (auth.role() = 'service_role');

-- Storage: a PUBLIC bucket named "piltri-data" (Storage -> New bucket ->
-- Public). The pipeline uploads to it with the service role key.

-- One-off cleanup for databases created before 2026-09-26, when city data
-- was aggregated live and cached in tables. Nothing reads these any more;
-- run this yourself if you want them gone (it permanently deletes them):
--
--   drop table if exists saved_pins;
--   drop table if exists city_scores;
--   drop table if exists cities;
