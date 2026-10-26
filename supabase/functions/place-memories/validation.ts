export const PHOTO_BUCKET = "place-memory-photos"
export const MAX_PHOTOS = 10
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export class InputError extends Error {}
export function validId(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) throw new InputError("IDが正しくありません。")
  return value
}
export function validLocation(data: Record<string, unknown>, publishing = false, now = Date.now()) {
  const { latitude, longitude, accuracy_m, captured_at } = data
  if (typeof latitude !== "number" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      typeof longitude !== "number" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      typeof accuracy_m !== "number" || !Number.isFinite(accuracy_m) || accuracy_m < 0 || accuracy_m > 50 ||
      typeof captured_at !== "string" || !Number.isFinite(Date.parse(captured_at))) {
    throw new InputError("現在地の精度を確認できません。屋外で現在地を更新してください。")
  }
  const age = now - Date.parse(captured_at)
  if (age < -30000 || age > (publishing ? 300000 : 120000)) throw new InputError("現在地を更新してから、もう一度お試しください。")
  return { latitude, longitude, accuracy_m, captured_at }
}
export function validTitle(value: unknown) {
  if (typeof value !== "string" || value.trim().length > 80) throw new InputError("タイトルは80文字以内で入力してください。")
  return value.trim() || "この場所の思い出"
}
export function validPhotos(value: unknown, owner: string, memory: string): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PHOTOS || new Set(value).size !== value.length) {
    throw new InputError("写真は1〜10枚で選んでください。")
  }
  return value.map((path) => {
    if (typeof path !== "string") throw new InputError("写真を確認できません。")
    const parts = path.split("/")
    if (parts.length !== 3 || parts[0] !== owner || parts[1] !== memory || !parts[2].endsWith(".jpg")) throw new InputError("写真の所有者を確認できません。")
    validId(parts[2].slice(0, -4))
    return path
  })
}
