import { createClient } from "npm:@supabase/supabase-js@2.118.0"
import { InputError, PHOTO_BUCKET, MAX_PHOTO_BYTES, validId, validLocation, validPhotos, validTitle } from "./validation.ts"

const url = Deno.env.get("SUPABASE_URL")!
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const origins = new Set((Deno.env.get("MEMORIA_ALLOWED_ORIGINS") ?? "http://127.0.0.1:3000,http://localhost:3000").split(",").map(x => x.trim()).filter(Boolean))

type Place = { id: string; owner_id: string; title: string; latitude: number; longitude: number; photo_paths: string[]; created_at: string; deleted_at: string | null }
Deno.serve(async (request) => {
  const origin = request.headers.get("origin")
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin" })
  if (origin && origins.has(origin)) headers.set("Access-Control-Allow-Origin", origin)
  headers.set("Access-Control-Allow-Headers", "authorization, apikey, content-type, x-client-info")
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS")
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers })
  if (origin && !origins.has(origin)) return reply({ error: "この接続元は許可されていません。" }, 403)
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers })
  if (request.method !== "POST") return reply({ error: "POSTを使用してください。" }, 405)
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1]
  if (!token) return reply({ error: "匿名認証が必要です。" }, 401)
  const auth = await db.auth.getUser(token).catch(() => null)
  const user = auth?.data.user
  if (!auth || auth.error || !user) return reply({ error: "匿名認証を確認できません。" }, 401)
  try {
    const reader = request.body?.getReader()
    if (!reader) throw new InputError("入力を確認してください。")
    const decoder = new TextDecoder()
    let text = "", bytes = 0
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > 12000) { await reader.cancel(); return reply({ error: "リクエストが大きすぎます。" }, 413) }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    const body = JSON.parse(text) as Record<string, unknown>
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new InputError("入力を確認してください。")
    const owner = user.id
    const sign = async (row: Place) => {
      // Validate persisted paths again: never sign another user's storage object.
      const paths = validPhotos(row.photo_paths, row.owner_id, row.id)
      const { data, error } = await db.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 60)
      if (error || !data || data.some(x => !x.signedUrl)) throw new Error("storage")
      return { id: row.id, title: row.title, latitude: row.latitude, longitude: row.longitude,
        photos: data.map(x => x.signedUrl), createdAt: row.created_at, owned: row.owner_id === owner }
    }
    if (body.action === "status") {
      const { error } = await db.from("place_memories").select("id", { head: true }).limit(0)
      if (error) return reply({ error: "場所に残す機能は準備中です。DB設定が必要です。" }, 503)
      const { data: bucket } = await db.storage.getBucket(PHOTO_BUCKET)
      if (!bucket || bucket.public) return reply({ error: "写真の非公開ストレージ設定を確認してください。" }, 503)
      const { error: geographyError } = await db.rpc("nearby_place_memories", { query_latitude: 0, query_longitude: 0 })
      if (geographyError) return reply({ error: "場所に残す機能は準備中です。位置検索の設定が必要です。" }, 503)
      return reply({ ready: true })
    }
    if (body.action === "nearby") {
      const location = validLocation(body)
      const { data, error } = await db.rpc("nearby_place_memories", { query_latitude: location.latitude, query_longitude: location.longitude })
      if (error) return reply({ error: "周辺の思い出を読み込めません。DBの位置検索設定を確認してください。" }, 503)
      const memories = await Promise.all((data as Place[]).map(sign))
      return reply({ memories })
    }
    if (body.action === "publish") {
      const id = validId(body.id)
      const title = validTitle(body.title)
      const paths = validPhotos(body.photo_paths, owner, id)
      const { data: existing } = await db.from("place_memories").select("*").eq("id", id).eq("owner_id", owner).maybeSingle()
      if (existing) {
        if (existing.deleted_at || JSON.stringify(existing.photo_paths) !== JSON.stringify(paths)) throw new InputError("この公開操作は再利用できません。")
        return reply({ memory: await sign(existing) })
      }
      const location = validLocation(body, true)
      const { data: files, error: listError } = await db.storage.from(PHOTO_BUCKET).list(`${owner}/${id}`, { limit: 11 })
      if (listError || !files) throw new InputError("アップロードした写真を確認できません。")
      if (!paths.every(path => files.some(file => file.name === path.split("/")[2] &&
        Number(file.metadata?.size) > 0 && Number(file.metadata?.size) <= MAX_PHOTO_BYTES && file.metadata?.mimetype === "image/jpeg"))) {
        throw new InputError("写真の形式・容量を確認できません。")
      }
      const { data: row, error } = await db.from("place_memories").insert({ id, owner_id: owner, title, ...location, photo_paths: paths }).select().single()
      if (error) throw new Error("insert")
      return reply({ memory: await sign(row) })
    }
    if (body.action === "rename" || body.action === "delete") {
      const id = validId(body.id)
      const { data: row, error } = await db.from("place_memories").select("*").eq("id", id).eq("owner_id", owner).maybeSingle()
      if (error || !row) return reply({ error: "自分が残した思い出だけを変更できます。" }, 404)
      if (body.action === "rename") {
        const title = validTitle(body.title)
        const { error } = await db.from("place_memories").update({ title }).eq("id", id).eq("owner_id", owner).is("deleted_at", null)
        if (error) throw new Error("update")
        return reply({ title })
      }
      const paths = validPhotos(row.photo_paths, owner, id)
      const { error: hideError } = await db.from("place_memories").update({ deleted_at: new Date().toISOString() }).eq("id", id).eq("owner_id", owner)
      if (hideError) throw new Error("hide")
      const { error: removeError } = await db.storage.from(PHOTO_BUCKET).remove(paths)
      if (removeError) return reply({ error: "思い出は非表示にしました。写真の削除を再試行してください。" }, 503)
      const { error: deleteError } = await db.from("place_memories").delete().eq("id", id).eq("owner_id", owner)
      if (deleteError) throw new Error("delete")
      return reply({ deleted: true })
    }
    throw new InputError("操作を確認できません。")
  } catch (error) {
    if (error instanceof InputError) return reply({ error: error.message }, 400)
    if (error instanceof SyntaxError) return reply({ error: "入力形式を確認してください。" }, 400)
    // Never log request bodies, tokens, coordinates or photo paths.
    return reply({ error: "安全に処理を完了できませんでした。時間をおいて再度お試しください。" }, 503)
  }
})
