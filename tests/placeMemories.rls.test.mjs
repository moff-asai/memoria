import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { PGlite } from "@electric-sql/pglite"
const A="00000000-0000-4000-8000-000000000001", B="00000000-0000-4000-8000-000000000002", M="00000000-0000-4000-8000-000000000003", P="00000000-0000-4000-8000-000000000004"
test("place-memory and photo RLS prevents public enumeration, ownership changes and cross-user photo access", async t=>{
 const db=new PGlite();t.after(()=>db.close())
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${A}'),('${B}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
 alter table storage.objects enable row level security;grant usage on schema storage to authenticated,anon;
 grant select,insert,update,delete on storage.objects to authenticated;
 create policy legacy_broad_read on storage.objects for select to authenticated using(true);
 create policy legacy_broad_insert on storage.objects for insert to authenticated with check(true);
 create policy legacy_broad_update on storage.objects for update to authenticated using(true) with check(true);
 create policy legacy_broad_delete on storage.objects for delete to authenticated using(true);`)
 await db.exec(await readFile(new URL('../supabase/migrations/202610260002_place_memories.sql',import.meta.url),'utf8'))
 const as=async(role,user,sql)=>{
  await db.exec(`begin;set local role ${role}`)
  await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user])
  try{const result=await db.query(sql);await db.exec('commit');return result}catch(error){await db.exec('rollback');throw error}
 }
 const path=`${A}/${M}/${P}.jpg`
 await t.test('private bucket and owner-only upload',async()=>{
  assert.equal((await db.query("select public from storage.buckets")).rows[0].public,false)
  await as('authenticated',A,`insert into storage.objects(bucket_id,name) values('place-memory-photos','${path}')`)
  await assert.rejects(as('authenticated',B,`insert into storage.objects(bucket_id,name) values('place-memory-photos','${path}')`),/row-level security/)
  assert.equal((await as('authenticated',B,'select * from storage.objects')).rows.length,0)
  assert.equal((await as('authenticated',A,`update storage.objects set name='${A}/${M}/changed.jpg' returning id`)).rows.length,0)
 })
 await db.exec(`insert into public.place_memories(id,owner_id,title,latitude,longitude,accuracy_m,captured_at,photo_paths)
 values('${M}','${A}','test',0,0,5,now(),array['${path}'])`)
 await t.test('visitors cannot enumerate places or bypass the publication API',async()=>{
  await assert.rejects(as('anon','',`select * from public.place_memories`),/permission denied/)
  assert.equal((await as('authenticated',B,'select * from public.place_memories')).rows.length,0)
  await assert.rejects(as('authenticated',A,`insert into public.place_memories(id) values(gen_random_uuid())`),/permission denied/)
 })
 await t.test('only owner can rename; coordinate, owner and photo changes are denied',async()=>{
  assert.equal((await as('authenticated',B,"update public.place_memories set title='stolen' returning id")).rows.length,0)
  await as('authenticated',A,"update public.place_memories set title='renamed'")
  assert.equal((await as('authenticated',A,'select title from public.place_memories')).rows[0].title,'renamed')
  for(const change of [`owner_id='${B}'`,`latitude=1`,`photo_paths=array['other/photo.jpg']`]) await assert.rejects(as('authenticated',A,`update public.place_memories set ${change}`),/permission denied/)
 })
 await t.test('published objects cannot be removed through the upload cleanup policy',async()=>{
  assert.equal((await as('authenticated',A,`delete from storage.objects where name='${path}' returning id`)).rows.length,0)
  const orphan=`${A}/${M}/00000000-0000-4000-8000-000000000005.jpg`
  await as('authenticated',A,`insert into storage.objects(bucket_id,name) values('place-memory-photos','${orphan}')`)
  assert.equal((await as('authenticated',A,`delete from storage.objects where name='${orphan}' returning id`)).rows.length,1)
 })
})
