export const SUPABASE_PROJECT_REF = "niaopqpzpwrfhfwzllzs"
export const SUPABASE_URL = `https://${SUPABASE_PROJECT_REF}.supabase.co`

export function requirePublicKey(value: string | undefined) {
  const key = value?.trim()
  if (!key) throw new Error("接続設定が必要です。新しいSupabaseのPublishable keyを設定してください。")
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return key
  // Legacy anon JWTs must belong to this project. Never reuse the old project's session/key.
  try {
    const payload = key.split(".")[1]
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")))
    if (key.split(".").length === 3 && claims.role === "anon" && claims.ref === SUPABASE_PROJECT_REF) return key
  } catch { /* Invalid or secret keys fail closed. */ }
  throw new Error("接続キーを確認してください。このプロジェクトのPublishable keyまたはanon public keyが必要です。")
}
