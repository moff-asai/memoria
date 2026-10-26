import assert from "node:assert/strict"
import { test } from "node:test"
import { appendDraftFiles, MAX_DRAFT_PHOTOS } from "../src/memoryDraft.ts"

const photo = (name, type = "image/jpeg") =>
  new File(["photo"], name, { type, lastModified: 123 })

test("photos can be selected first and appended across multiple selections", () => {
  const first = photo("first.jpg")
  const second = photo("second.png", "image/png")
  const initial = appendDraftFiles([], [first])
  const result = appendDraftFiles(initial.files, [second])
  assert.deepEqual(result.files, [first, second])
  assert.deepEqual(initial.files, [first], "the previous draft is not mutated")
  assert.equal(result.notice, "")
})

test("the total draft, not each selection, is limited to ten photos", () => {
  const existing = Array.from({ length: 9 }, (_, index) =>
    photo(`${index}.jpg`),
  )
  const result = appendDraftFiles(existing, [
    photo("new.jpg"),
    photo("extra.jpg"),
  ])
  assert.equal(result.files.length, MAX_DRAFT_PHOTOS)
  assert.equal(result.files.at(-1).name, "new.jpg")
  assert.match(result.notice, /10枚/)
})

test("selecting an existing photo again does not duplicate it", () => {
  const first = photo("first.jpg")
  const result = appendDraftFiles([first], [photo("first.jpg")])
  assert.deepEqual(result.files, [first])
  assert.match(result.notice, /重複/)
})

test("picker and drop both accept only supported photo types", () => {
  const valid = photo("photo.webp", "image/webp")
  const result = appendDraftFiles([], [
    photo("movie.mp4", "video/mp4"),
    valid,
    photo("photo.heic", "image/heic"),
  ])
  assert.deepEqual(result.files, [valid])
  assert.match(result.notice, /JPEG・PNG・WebP/)
})

test("removing a photo frees a slot for another selection", () => {
  const full = Array.from({ length: MAX_DRAFT_PHOTOS }, (_, index) =>
    photo(`${index}.jpg`),
  )
  const result = appendDraftFiles(
    full.filter((_, index) => index !== 2),
    [photo("replacement.jpg")],
  )
  assert.equal(result.files.length, MAX_DRAFT_PHOTOS)
  assert.equal(result.files.at(-1).name, "replacement.jpg")
  assert.equal(result.notice, "")
})
