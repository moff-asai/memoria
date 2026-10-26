import assert from "node:assert/strict"
import test from "node:test"
import {
  followBlend,
  PHOTO_GUIDE,
  placeTrail,
  RING_GUIDE,
  SPACE_GUIDE,
  toastOpacity,
  VR_GUIDE,
  VR_MOVING,
  VR_TOAST_SECONDS,
  vrGuide,
} from "../src/sceneGuide.ts"

const at = (place, photoIndex = null, mode = place === "memory" ? "ring" : place) => ({
  mode,
  place,
  title: "記憶 02",
  photoIndex,
  photoCount: 8,
})

test("placeTrail reads 空間 › title, then › 写真 n/N, and nothing in the space", () => {
  assert.deepEqual(placeTrail(at("space")), [])
  assert.deepEqual(placeTrail(at("memory")), ["空間", "記憶 02"])
  assert.deepEqual(placeTrail(at("photo", 2)), ["空間", "記憶 02", "写真 3/8"])
  assert.deepEqual(placeTrail(at("photo")), ["空間", "記憶 02"], "no count before a photo is picked")
})

test("the VR guide names the controller and where each 戻る waits", () => {
  const words = Object.values(VR_GUIDE).flat().join(" ")
  for (const webOnly of ["ドラッグ", "WASD", "ホイール", "ピンチ", "Esc", "←", "→"]) {
    assert(!words.includes(webOnly), `no "${webOnly}" in VR`)
  }
  assert(VR_GUIDE.space.join("").includes("トリガー"), "the space says how to enter")
  assert(VR_GUIDE.memory.join("").includes("足元の「戻る」"), "the ring says where 戻る is")
  assert(VR_GUIDE.photo.join("").includes("スティック"), "a photo says how to step")
  assert(VR_GUIDE.photo.join("").includes("画面下の「戻る」"), "a photo says where 戻る is")
  assert(RING_GUIDE && PHOTO_GUIDE && SPACE_GUIDE, "the web keeps its own copy")
  const disclosure = "写真はみんなの空間に公開されます"
  assert(SPACE_GUIDE.includes(disclosure))
  assert(VR_GUIDE.space.includes(disclosure), "VR keeps the web's sharing disclosure")
})

test("vrGuide carries the breadcrumb and shows status only in the space, like the footer", () => {
  const status = "みんなの空間に保存しています…"
  assert.deepEqual(vrGuide(at("space"), status), {
    trail: [],
    lines: VR_GUIDE.space,
    note: status,
  })
  assert.deepEqual(vrGuide(at("photo", 0), status), {
    trail: ["空間", "記憶 02", "写真 1/8"],
    lines: VR_GUIDE.photo,
    note: "",
  })
})

test("between layers the VR guide says it is moving, keeping the breadcrumb", () => {
  const guide = vrGuide(at("memory", null, "transition"), "")
  assert.deepEqual(guide.trail, ["空間", "記憶 02"])
  assert.deepEqual(guide.lines, [VR_MOVING])
  assert.equal(VR_MOVING, "移動中…")
})

test("a VR toast fades in, holds for 3 seconds, then goes", () => {
  assert.equal(VR_TOAST_SECONDS, 3)
  assert.equal(toastOpacity(-1), 0)
  assert.equal(toastOpacity(-Infinity), 0)
  assert(toastOpacity(0.1) > 0 && toastOpacity(0.1) < 1, "fades in")
  assert.equal(toastOpacity(0.2), 1)
  assert.equal(toastOpacity(3), 1, "still fully shown at 3 seconds")
  assert(toastOpacity(3.15) > 0 && toastOpacity(3.15) < 1, "then fades")
  assert.equal(toastOpacity(3.3), 0, "gone")
  assert.equal(toastOpacity(Infinity), 0, "a toast never raised stays hidden")
})

test("the panel follows as lerp 0.1 per 60 fps frame, whatever the frame rate", () => {
  assert(Math.abs(followBlend(1 / 60) - 0.1) < 1e-12)
  assert.equal(followBlend(0), 0)
  // Two 120 Hz frames close the same gap as one 60 Hz frame.
  const half = followBlend(1 / 120)
  assert(Math.abs(1 - (1 - half) ** 2 - 0.1) < 1e-12)
})
