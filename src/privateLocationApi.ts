import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { projectId, publicAnonKey } from "../utils/supabase/info"
import { requirePublicKey } from "./supabaseConfig"
import type { LocationSample } from "./privateLocation"

let client: SupabaseClient | undefined
export function privateLocationClient() {
  client ??= createClient(`https://${projectId}.supabase.co`, requirePublicKey(publicAnonKey), {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
      storageKey: `memoria-${projectId}-session` },
  })
  return client
}

export function locationServiceError(code?: string) {
  if (code === "anonymous_provider_disabled") return "位置情報の保存は準備中です。Supabaseで匿名認証を有効にしてください。"
  if (code === "PGRST205" || code === "42P01") return "位置情報の保存は準備中です。専用テーブルの設定が必要です。"
  if (code === "42501") return "保存の許可を確認できませんでした。DBの本人限定アクセス設定を確認してください。"
  return "安全な接続を確認できなかったため保存しませんでした。通信環境を確認して再度お試しください。"
}

let anonymousRequest: Promise<string> | undefined
export function ensureAnonymousUser(): Promise<string> {
  // React page transitions and StrictMode can request the same identity together.
  anonymousRequest ??= loadAnonymousUser().finally(() => { anonymousRequest = undefined })
  return anonymousRequest
}
async function loadAnonymousUser() {
  const db = privateLocationClient()
  const { data: { session }, error: sessionError } = await db.auth.getSession()
  if (sessionError) throw new Error(locationServiceError(sessionError.code))
  let userId: string
  if (session) {
    const { data, error } = await db.auth.getUser()
    if (error || !data.user) throw new Error("匿名認証の有効性を確認できませんでした。再読み込みしてお試しください。")
    userId = data.user.id
  } else {
    const { data, error } = await db.auth.signInAnonymously()
    if (error || !data.user) throw new Error(locationServiceError(error?.code))
    userId = data.user.id
  }
  return userId
}

export async function preparePrivateLocation() {
  const userId = await ensureAnonymousUser()
  const db = privateLocationClient()
  // Verify table readiness before requesting or transmitting coordinates.
  const { error } = await db.from("private_locations").select("user_id", { head: true }).limit(0)
  if (error) throw new Error(locationServiceError(error.code))
  return userId
}

export async function savePrivateLocation(userId: string, sample: LocationSample) {
  const { error } = await privateLocationClient().from("private_locations")
    .upsert({ user_id: userId, ...sample }, { onConflict: "user_id" })
  if (error) throw new Error(locationServiceError(error.code))
}

export async function deletePrivateLocation() {
  const db = privateLocationClient()
  const { data, error } = await db.auth.getUser()
  if (error || !data.user) throw new Error("保存した位置情報の本人確認ができませんでした。")
  const { error: deletionError } = await db.from("private_locations").delete().eq("user_id", data.user.id)
  if (deletionError) throw new Error(locationServiceError(deletionError.code))
}
