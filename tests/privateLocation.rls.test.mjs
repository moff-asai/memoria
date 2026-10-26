import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { PGlite } from "@electric-sql/pglite"

const A = "00000000-0000-4000-8000-000000000001"
const B = "00000000-0000-4000-8000-000000000002"
test("PostgreSQL enforces private location ownership, validation, upsert and deletion", async (t) => {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${A}'), ('${B}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
  `)
  await db.exec(await readFile(new URL("../supabase/migrations/202610260001_private_locations.sql", import.meta.url), "utf8"))
  const asUser = async (id, sql) => {
    await db.exec("begin; set local role authenticated;")
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [id])
    try {
      const result = await db.query(sql)
      await db.exec("commit")
      return result
    } catch (error) { await db.exec("rollback"); throw error }
  }
  await t.test("anonymous public key cannot read or write locations", async () => {
    await db.exec("begin; set local role anon")
    await assert.rejects(db.query("select * from public.private_locations"), /permission denied/)
    await db.exec("rollback")
    await db.exec("begin; set local role anon")
    await assert.rejects(db.query("insert into public.private_locations(latitude,longitude,accuracy_m,captured_at) values (0.1,0.2,5,now())"), /permission denied/)
    await db.exec("rollback")
  })
  await t.test("owner can store and read their position", async () => {
    await asUser(A, "insert into public.private_locations(latitude,longitude,accuracy_m,captured_at) values (0.1,0.2,5,now())")
    const { rows } = await asUser(A, "select user_id, latitude from public.private_locations")
    assert.equal(rows.length, 1); assert.equal(rows[0].user_id, A)
  })
  await t.test("another user cannot read, update, delete or forge the owner's row", async () => {
    assert.equal((await asUser(B, "select * from public.private_locations")).rows.length, 0)
    assert.equal((await asUser(B, `update public.private_locations set latitude=1 where user_id='${A}' returning user_id`)).rows.length, 0)
    assert.equal((await asUser(B, `delete from public.private_locations where user_id='${A}' returning user_id`)).rows.length, 0)
    await assert.rejects(asUser(B, `insert into public.private_locations(user_id,latitude,longitude,accuracy_m,captured_at) values ('${A}',0,0,5,now())`), /row-level security/)
    assert.equal((await asUser(A, "select latitude from public.private_locations")).rows[0].latitude, 0.1)
  })
  await t.test("updating a location retains only the owner's latest row", async () => {
    await asUser(A, "insert into public.private_locations(latitude,longitude,accuracy_m,captured_at) values (0.3,0.4,3,now()) on conflict(user_id) do update set latitude=excluded.latitude, longitude=excluded.longitude, captured_at=excluded.captured_at")
    const { rows } = await asUser(A, "select latitude from public.private_locations")
    assert.equal(rows.length, 1); assert.equal(rows[0].latitude, 0.3)
  })
  await t.test("invalid coordinates and ownership transfers are rejected", async () => {
    await assert.rejects(asUser(A, "update public.private_locations set latitude=91"), /check constraint/)
    await assert.rejects(asUser(A, "update public.private_locations set accuracy_m='NaN'"), /check constraint/)
    await assert.rejects(asUser(A, `update public.private_locations set user_id='${B}'`), /row-level security/)
  })
  await t.test("the owner can remove their saved location", async () => {
    await asUser(A, "delete from public.private_locations")
    assert.equal((await asUser(A, "select * from public.private_locations")).rows.length, 0)
  })
})
