import type { DraftPhoto } from "./placeMemoriesApi"
const MAX_SIDE = 1600
const toPhoto = (canvas: HTMLCanvasElement) => new Promise<DraftPhoto>((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (!blob || blob.size > 3 * 1024 * 1024) { reject(new Error("写真を準備できませんでした。別の写真でお試しください。")); return }
    resolve({ id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob) })
  }, "image/jpeg", 0.86)
})
const canvasFor = (width: number, height: number) => {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext("2d")
  if (!context) throw new Error("写真を準備できません。")
  return { canvas, context }
}
export async function preparePlacePhoto(file: File) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 20 * 1024 * 1024) {
    throw new Error("JPEG・PNG・WebPの写真を選んでください（1枚20MBまで）。")
  }
  const bitmap = await createImageBitmap(file)
  try {
    const { canvas, context } = canvasFor(bitmap.width, bitmap.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    // Re-encoding strips EXIF, including hidden GPS tags, from every upload.
    return await toPhoto(canvas)
  } finally { bitmap.close() }
}
