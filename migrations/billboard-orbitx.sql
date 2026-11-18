-- ORBITX billboards: $1 for 7 days, paid in ORBITX, 100% burned
-- (billboard-orbitx-* ops, 2026-11-18).
-- Apply to Supabase (project blue-chair) BEFORE the billboards push
-- goes live, or ORBITX billboard buys degrade: the booking upsert
-- errors on the missing `image` column and the placement is only
-- recorded on the serving instance (the burn still happened — no
-- refund), and image uploads fail outright on the missing bucket.
--
-- The Neon path adds the column itself (ensureSchema in api/city.js);
-- this file is the Supabase equivalent. Safe to run twice.
--
-- No new table: ORBITX orders reuse the ad_orders ledger
-- (meta.kind = 'orbitx-week', meta.image = the ad image URL), and the
-- placement reuses the bookings table, exactly like the SOL ads.

alter table public.bookings
  add column if not exists image text not null default '';

-- Ad image storage, mirroring the `radio` bucket: the API (service
-- role) issues signed upload URLs; the browser uploads directly; the
-- game loads the image from the public URL. 5 MB cap, jpg/png/webp/gif
-- only — enforced by the API, not the bucket.
insert into storage.buckets (id, name, public)
values ('billboard-ads', 'billboard-ads', true)
on conflict (id) do nothing;

drop policy if exists "billboard-ads public read" on storage.objects;
create policy "billboard-ads public read" on storage.objects
  for select using (bucket_id = 'billboard-ads');
