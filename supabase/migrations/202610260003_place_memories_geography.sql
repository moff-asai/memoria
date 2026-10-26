begin;
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
do $$ begin
 if (select extnamespace::regnamespace::text from pg_extension where extname='postgis') <> 'extensions' then
   raise exception 'Existing PostGIS is outside extensions. Review its schema before applying this migration.';
 end if;
end $$;
alter table public.place_memories add column position extensions.geography(point,4326)
 generated always as (extensions.st_setsrid(extensions.st_makepoint(longitude, latitude),4326)::extensions.geography) stored;
create index place_memory_geography on public.place_memories using gist(position) where deleted_at is null;
create function public.nearby_place_memories(query_latitude double precision, query_longitude double precision)
returns setof public.place_memories language sql stable security invoker set search_path = '' as $$
 select p.* from public.place_memories p
 where query_latitude between -90 and 90 and query_longitude between -180 and 180
   and p.deleted_at is null
   and extensions.st_dwithin(p.position,
     extensions.st_setsrid(extensions.st_makepoint(query_longitude, query_latitude),4326)::extensions.geography,50)
 order by extensions.st_distance(p.position,
     extensions.st_setsrid(extensions.st_makepoint(query_longitude, query_latitude),4326)::extensions.geography), p.id
 limit 24;
$$;
revoke all on function public.nearby_place_memories(double precision,double precision) from public, anon, authenticated;
grant execute on function public.nearby_place_memories(double precision,double precision) to service_role;
commit;
