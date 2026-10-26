export const MAX_DRAFT_PHOTOS = 10
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp"

export type MemoryDraft = {
  id: string
  title: string
  files: File[]
  notice: string
}

/** Keep earlier selections when a picker or drop adds photos to this memory. */
export function appendDraftFiles(current: File[], incoming: File[]) {
  const supported = new Set(PHOTO_ACCEPT.split(","))
  const files = [...current]
  let unsupported = false
  let overflow = false
  let duplicate = false
  for (const file of incoming) {
    if (!supported.has(file.type)) {
      unsupported = true
      continue
    }
    if (
      files.some(
        (existing) =>
          existing.name === file.name &&
          existing.size === file.size &&
          existing.lastModified === file.lastModified &&
          existing.type === file.type,
      )
    ) {
      duplicate = true
      continue
    }
    if (files.length >= MAX_DRAFT_PHOTOS) {
      overflow = true
      continue
    }
    files.push(file)
  }
  const notice = [
    overflow && `写真は1つの記憶に${MAX_DRAFT_PHOTOS}枚まで追加できます。`,
    unsupported && "JPEG・PNG・WebPの写真を選んでください。",
    duplicate && "選択済みの写真は重複して追加していません。",
  ]
    .filter(Boolean)
    .join(" ")
  return { files, notice }
}
