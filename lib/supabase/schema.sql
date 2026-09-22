-- Piltri — Supabase schema (Phase 4.2)
-- Run this in the Supabase SQL editor after provisioning the project (step 1.6 / 6.3).

create extension if not exists "uuid-ossp";

-- One row per known city (seed + search index).
create table if not exists cities (
  id uuid primary key default uuid_generate_v4(),
  slug text unique not null,           -- e.g. "lisbon-pt"
  city_name text not null,
  region text,
  country text not null,
  country_code text not null,
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now(),
  -- City land area computed from a real OSM/Nominatim administrative
  -- boundary polygon (geodesic area, see lib/data-sources/nominatim.ts
  -- getCityLandAreaKm2) - preferred over Wikidata's stated area, which is
  -- a single manually-entered number with no geometry behind it. Lives
  -- here, not in city_scores, because a city's boundary essentially never
  -- changes - unlike population/GDP/etc. it doesn't need re-fetching on
  -- city_scores' 30-day TTL, and Nominatim's 1 request/second usage-policy
  -- limit makes it impractical to fetch live during normal aggregation
  -- anyway (see lib/aggregation/backfillLandArea.ts). Null until the
  -- one-time backfill (POST /api/admin/backfill-land-area, or the "Backfill
  -- land area" button on /admin) reaches this city; also null (rather than
  -- never revisited) when Nominatim genuinely has no polygon for it -
  -- osm_land_area_checked_at is what distinguishes "not attempted yet"
  -- from "attempted, no boundary found" so a resumed backfill doesn't keep
  -- re-querying cities with a real, checked, negative result.
  osm_land_area_km2 double precision,
  osm_land_area_checked_at timestamptz
);

create extension if not exists pg_trgm;
create index if not exists cities_name_trgm_idx on cities using gin (city_name gin_trgm_ops);

-- Cached aggregate Explore scores per city (Phase 4.5 caching layer).
-- The aggregation layer re-fetches from source APIs only when a row is
-- missing or older than CACHE_TTL_DAYS.
create table if not exists city_scores (
  city_id uuid primary key references cities(id) on delete cascade,
  data jsonb not null,               -- full CityExploreData payload (lib/types.ts)
  piltri_score numeric not null,
  section_scores jsonb not null,     -- { demographics, economy, realEstate, safetyStability, climate, liveability }
  last_updated timestamptz not null default now()
);

create index if not exists city_scores_last_updated_idx on city_scores (last_updated);

-- Saved pinned locations ("Save this location" button in Pin mode).
-- user_id is nullable pre-auth; wire to Supabase Auth once accounts ship.
create table if not exists saved_pins (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid,
  city_id uuid references cities(id) on delete set null,
  lat double precision not null,
  lng double precision not null,
  neighbourhood_name text,
  data jsonb not null,               -- full PinnedLocationData payload
  created_at timestamptz not null default now()
);

-- Row Level Security — open read on cities/scores (public data), locked
-- writes to the service role (aggregation layer runs server-side only).
alter table cities enable row level security;
alter table city_scores enable row level security;
alter table saved_pins enable row level security;

create policy "public read cities" on cities for select using (true);
create policy "public read city_scores" on city_scores for select using (true);

create policy "service role writes cities" on cities for insert with check (auth.role() = 'service_role');
create policy "service role updates cities" on cities for update using (auth.role() = 'service_role');
create policy "service role writes city_scores" on city_scores for insert with check (auth.role() = 'service_role');
create policy "service role updates city_scores" on city_scores for update using (auth.role() = 'service_role');

-- Saved pins: anyone can insert (pre-auth save button), only service role reads all.
create policy "anyone can save a pin" on saved_pins for insert with check (true);
create policy "service role reads pins" on saved_pins for select using (auth.role() = 'service_role');
