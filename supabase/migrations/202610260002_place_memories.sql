-- Location-based shared memories. Existing private_locations is unchanged.
begin;
create table public.place_memories (
 id uuid primary key,
 owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null check (char_length(title) between 1 and 80),
 latitude double precision not null check (latitude between -90 and 90),
 longitude double precision not null check (longitude between -180 and 180),
 accuracy_m double precision not null check (accuracy_m between 0 and 50),
 captured_at timestamptz not null,
 photo_paths text[] not null check (cardinality(photo_paths) between 1 and 10 and array_position(photo_paths, null) is null),
 created_at timestamptz not null default now(),
 deleted_at timestamptz
);
create index place_memory_owner on public.place_memories(owner_id, created_at);
alter table public.place_memories enable row level security;
alter table public.place_memories force row level security;
revoke all on public.place_memories from public, anon, authenticated;
grant select on public.place_memories to authenticated;
grant update (title) on public.place_memories to authenticated;
grant all on public.place_memories to service_role;
create policy own_place_read on public.place_memories for select to authenticated
 using ((select auth.uid()) = owner_id);
create policy own_place_title on public.place_memories for update to authenticated
 using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
 values ('place-memory-photos', 'place-memory-photos', false, 3145728, array['image/jpeg']);
-- No public/visitor SELECT: only the server signs nearby photographs.
create policy place_photo_owner_insert on storage.objects for insert to authenticated
 with check (bucket_id = 'place-memory-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
   and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$');
create policy place_photo_owner_read on storage.objects for select to authenticated
 using (bucket_id = 'place-memory-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy place_photo_owner_delete on storage.objects for delete to authenticated
 using (bucket_id = 'place-memory-photos' and (storage.foldername(name))[1] = (select auth.uid())::text
   and not exists (select 1 from public.place_memories p where p.owner_id = (select auth.uid()) and p.photo_paths @> array[name]));
-- Restrictive guards also protect this bucket when older projects contain
-- permissive storage policies. They leave every other bucket unchanged.
create policy place_photo_guard_anon on storage.objects as restrictive for all to anon
 using (bucket_id <> 'place-memory-photos') with check (bucket_id <> 'place-memory-photos');
create policy place_photo_guard_read on storage.objects as restrictive for select to authenticated
 using (bucket_id <> 'place-memory-photos' or (storage.foldername(name))[1] = (select auth.uid())::text);
create policy place_photo_guard_insert on storage.objects as restrictive for insert to authenticated
 with check (bucket_id <> 'place-memory-photos' or ((storage.foldername(name))[1] = (select auth.uid())::text
   and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'));
create policy place_photo_guard_update on storage.objects as restrictive for update to authenticated
 using (bucket_id <> 'place-memory-photos') with check (bucket_id <> 'place-memory-photos');
create policy place_photo_guard_delete on storage.objects as restrictive for delete to authenticated
 using (bucket_id <> 'place-memory-photos' or ((storage.foldername(name))[1] = (select auth.uid())::text
   and not exists (select 1 from public.place_memories p where p.owner_id = (select auth.uid()) and p.photo_paths @> array[name])));
commit;
