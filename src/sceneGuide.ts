import type { ScenePlace, SceneView } from "./SphereControls"

/** The web overlay's guidance for each layer. */
export const SPACE_GUIDE =
  "球体を押すと、記憶のなかへ · ドラッグで見回し、WASD・ホイール・ピンチで歩けます · 写真はみんなの空間に公開されます"
export const RING_GUIDE = "写真を選ぶと、記憶にひたれます"
export const PHOTO_GUIDE = "← → で写真を切り替え · 戻るでリングへ"

/**
 * The same guidance inside VR, one instruction per line. Mouse and keyboard
 * give way to the controller, and each 戻る is named by where its 3D button
 * waits: at the feet in the ring, under the curved screen on a photo.
 */
export const VR_GUIDE: Record<ScenePlace, readonly string[]> = {
  space: [
    "球体にレイを向けてトリガーを引くと、記憶のなかへ",
    "写真はみんなの空間に公開されます",
  ],
  memory: ["写真をトリガーで選ぶと、記憶にひたれます", "足元の「戻る」で空間へ"],
  photo: ["スティックか左右の矢印で写真を切り替え", "画面下の「戻る」でリングへ"],
}
/**
 * While the ring opens or closes, or a photo opens. VR never glides toward a
 * memory, so there is no approach to cancel and nothing to press meanwhile.
 */
export const VR_MOVING = "移動中…"

type Place = Pick<SceneView, "place" | "title" | "photoIndex" | "photoCount">
type View = Place & Pick<SceneView, "mode">

/** The breadcrumb: none in the space, 空間 › title, then › 写真 n/N on a photo. */
export function placeTrail({ place, title, photoIndex, photoCount }: Place) {
  if (place === "space") return []
  const trail = ["空間", title]
  if (place === "photo" && photoIndex !== null) {
    trail.push(`写真 ${photoIndex + 1}/${photoCount}`)
  }
  return trail
}

export type VRGuide = {
  trail: string[]
  lines: readonly string[]
  /** Loading, saving or error status, shown in the space like the footer. */
  note: string
}

/** What the VR panel shows for where the viewer is. */
export function vrGuide(view: View, status: string): VRGuide {
  return {
    trail: placeTrail(view),
    lines: view.mode === "transition" ? [VR_MOVING] : VR_GUIDE[view.place],
    note: view.place === "space" ? status : "",
  }
}

/** A toast stays on the VR panel this long, then fades away. */
export const VR_TOAST_SECONDS = 3
const TOAST_FADE_IN = 0.2
const TOAST_FADE_OUT = 0.3

/** The toast's opacity `age` seconds after it was raised. */
export function toastOpacity(age: number) {
  if (!(age >= 0) || age >= VR_TOAST_SECONDS + TOAST_FADE_OUT) return 0
  if (age < TOAST_FADE_IN) return age / TOAST_FADE_IN
  if (age <= VR_TOAST_SECONDS) return 1
  return 1 - (age - VR_TOAST_SECONDS) / TOAST_FADE_OUT
}

/** The VR panel closes this share of the gap to the head every 60 fps frame. */
export const VR_FOLLOW = 0.1

/**
 * The follow's lerp factor for a frame `delta` seconds long: VR_FOLLOW at
 * 60 fps, scaled so 72, 90 or 120 Hz headsets trail by the same time.
 */
export const followBlend = (delta: number) =>
  1 - Math.pow(1 - VR_FOLLOW, Math.max(0, delta) * 60)
