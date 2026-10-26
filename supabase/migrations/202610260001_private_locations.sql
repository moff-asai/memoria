-- Private latest location, isolated from the public memories API.
-- Apply through the project's SQL Editor using an administrator account.
begin;
create table public.private_locations (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision not null check (accuracy_m between 0 and 100000),
  captured_at timestamptz not null,
  updated_at timestamptz not null default now()
);
alter table public.private_locations enable row level security;
alter table public.private_locations force row level security;
revoke all on table public.private_locations from public, anon, authenticated;
grant select, insert, update, delete on table public.private_locations to authenticated;

create policy own_location_read on public.private_locations for select to authenticated
  using ((select auth.uid()) = user_id);
create policy own_location_insert on public.private_locations for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy own_location_update on public.private_locations for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy own_location_delete on public.private_locations for delete to authenticated
  using ((select auth.uid()) = user_id);

create function public.stamp_private_location() returns trigger language plpgsql
  set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.stamp_private_location() from public;
create trigger stamp_private_location before update on public.private_locations
  for each row execute function public.stamp_private_location();
commit;
