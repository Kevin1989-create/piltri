-- Accounts' saved places and spots (2026-11-08, owner: "a personal
-- account ... on which all the likes would be displayed").
-- Run once in the Supabase dashboard: SQL Editor > New query > paste > Run.
-- Each row belongs to one signed-in person; row-level security lets a
-- person read, add and remove only their own rows (the site uses the
-- public anon key, so these rules are what protect them).

create table if not exists public.saved_items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- "place:olivet-fr" or "spot:47.87434,1.88991" - one row per saved thing.
  item_key text not null,
  kind text not null check (kind in ('place', 'spot')),
  -- The city page the place is, or the spot was saved on.
  place_id text not null,
  name text,
  country text,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now(),
  primary key (user_id, item_key)
);

alter table public.saved_items enable row level security;

drop policy if exists "Read own saved items" on public.saved_items;
create policy "Read own saved items" on public.saved_items
  for select using (auth.uid() = user_id);

drop policy if exists "Add own saved items" on public.saved_items;
create policy "Add own saved items" on public.saved_items
  for insert with check (auth.uid() = user_id);

drop policy if exists "Update own saved items" on public.saved_items;
create policy "Update own saved items" on public.saved_items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Remove own saved items" on public.saved_items;
create policy "Remove own saved items" on public.saved_items
  for delete using (auth.uid() = user_id);
