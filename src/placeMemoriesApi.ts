import { ensureAnonymousUser, privateLocationClient, savePrivateLocation } from "./privateLocationApi"
import type { LocationSample } from "./privateLocation"

export type PlaceMemory = { id: string; title: string; latitude: number; longitude: number;
  photos: string[]; createdAt: string; owned: boolean }
export type DraftPhoto = { id: string; blob: Blob; url: string }
export type PlaceDraft = { id: string; title: string; location: LocationSample; photos: DraftPhoto[] }
const BUCKET = "place-memory-photos"

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await privateLocationClient().functions.invoke("place-memories", { body })
  if (error) {
    const response = "context" in error ? error.context : null
    if (response instanceof Response) {
      const payload = await response.json().catch(() => null)
      if (typeof payload?.error === "string") throw new Error(payload.error)
    }
    throw new Error("場所に残す機能に接続できません。匿名認証・専用API・DBの設定を確認してください。")
  }
  if (data?.error) throw new Error(data.error)
  return data as T
}
export async function preparePlaces() {
  const id = await ensureAnonymousUser()
  await invoke({ action: "status" })
  return id
}
export async function findNearby(location: LocationSample): Promise<PlaceMemory[]> {
  const user = await ensureAnonymousUser()
  await savePrivateLocation(user, location)
  const result = await invoke<{ memories: PlaceMemory[] }>({ action: "nearby", ...location })
  return result.memories
}
export async function publishPlace(draft: PlaceDraft) {
  const user = await preparePlaces()
  const paths: string[] = []
  for (const photo of draft.photos) {
    const path = `${user}/${draft.id}/${photo.id}.jpg`
    const { error } = await privateLocationClient().storage.from(BUCKET).upload(path, photo.blob,
      { contentType: "image/jpeg", upsert: false, cacheControl: "60" })
    // Retrying a confirmed upload does not overwrite published objects.
    if (error) {
      const { data: existing } = await privateLocationClient().storage.from(BUCKET).list(`${user}/${draft.id}`, { limit: 11 })
      const stored = existing?.find(file => file.name === `${photo.id}.jpg`)
      if (!stored || Number(stored.metadata?.size) !== photo.blob.size || stored.metadata?.mimetype !== "image/jpeg") {
        throw new Error("写真をアップロードできませんでした。写真を残したまま再試行できます。")
      }
    }
    paths.push(path)
  }
  await savePrivateLocation(user, draft.location)
  const result = await invoke<{ memory: PlaceMemory }>({ action: "publish", id: draft.id,
    title: draft.title, photo_paths: paths, ...draft.location })
  return result.memory
}
export async function deletePlace(id: string) { await invoke({ action: "delete", id }) }
export async function renamePlace(id: string, title: string) { await invoke({ action: "rename", id, title }) }

// RLS and private Storage both restrict this view to the signed-in owner.
// No current location or Edge Function call is needed to browse one's own posts.
export async function findOwnMemories(page = 0, pageSize = 9): Promise<{ memories: PlaceMemory[]; hasMore: boolean }> {
  const owner = await ensureAnonymousUser()
  const db = privateLocationClient()
  const { data, error } = await db.from("place_memories")
    .select("id,owner_id,title,latitude,longitude,photo_paths,created_at")
    .eq("owner_id", owner).is("deleted_at", null)
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize)
  if (error) throw new Error("自分の思い出を読み込めませんでした。接続とDB設定を確認してください。")
  const { validPhotos } = await import("../supabase/functions/place-memories/validation")
  const memories = await Promise.all((data ?? []).slice(0, pageSize).map(async row => {
    const paths = validPhotos(row.photo_paths, owner, row.id)
    const { data: signed, error: photoError } = await db.storage.from(BUCKET).createSignedUrls(paths, 60)
    if (photoError || !signed || signed.some(photo => !photo.signedUrl || photo.error)) throw new Error("写真を読み込めませんでした。もう一度更新してください。")
    return { id: row.id, title: row.title, latitude: row.latitude, longitude: row.longitude,
      photos: signed.map(photo => photo.signedUrl!), createdAt: row.created_at, owned: true }
  }))
  return { memories, hasMore: (data?.length ?? 0) > pageSize }
}
