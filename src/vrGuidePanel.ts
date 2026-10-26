import * as THREE from "three"
import { followBlend, toastOpacity, type VRGuide } from "./sceneGuide"

export type GuideTheme = {
  font: string
  ink: string
  muted: string
  glass: string
  border: string
  toast: string
  onToast: string
}

/** Where the panel floats: this far below eye height, this far ahead. */
export const VR_PANEL_DROP = 0.35
export const VR_PANEL_AHEAD = 1.2

// Canvas pixels per meter: about twice a headset's pixel density at 1.2m.
const PIXELS_PER_METER = 2000
const MAX_TEXT_WIDTH = 1160
const MIN_PANEL_WIDTH = 520
const PAD_X = 64
const PAD_Y = 40
const RADIUS = 52
const CRUMB_SIZE = 40
const CRUMB_LINE = 58
const CRUMB_GAP = 22
const DIVIDER = 30
const GUIDE_SIZE = 54
const GUIDE_LINE = 78
const NOTE_SIZE = 40
const NOTE_LINE = 58
const TOAST_SIZE = 42
const TOAST_LINE = 60
const TOAST_PAD_X = 52
const TOAST_PAD_Y = 26
const TOAST_GAP = 0.025
const APPEAR_SECONDS = 0.35
// Never start a line with these, as in Japanese typesetting.
const NO_LINE_START = "、。，．・：；？！ー…」』）〉》】"

const wrapText = (
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) => {
  const lines: string[] = []
  let line = ""
  for (const char of text) {
    const next = line + char
    if (
      line &&
      context.measureText(next).width > maxWidth &&
      !NO_LINE_START.includes(char)
    ) {
      lines.push(line.trimEnd())
      line = char.trimStart()
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

// A plane whose face is a canvas, sized so one canvas pixel is 0.5mm.
const createCard = (name: string, renderOrder: number) => {
  const geometry = new THREE.PlaneGeometry(1, 1)
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    // Read over the ring, the curved screen and its tabs.
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  mesh.renderOrder = renderOrder
  mesh.visible = false
  return {
    mesh,
    material,
    paint(canvas: HTMLCanvasElement) {
      material.map?.dispose()
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      material.map = texture
      material.needsUpdate = true
      mesh.scale.set(
        canvas.width / PIXELS_PER_METER,
        canvas.height / PIXELS_PER_METER,
        1,
      )
    },
    dispose() {
      geometry.dispose()
      material.map?.dispose()
      material.dispose()
    },
  }
}

/**
 * The breadcrumb over the layer's guidance, on one glass card: crumbs in
 * ink with the current one bold and muted separators, as in the header.
 */
const drawPanel = ({ trail, lines, note }: VRGuide, theme: GuideTheme) => {
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")!
  const font = (weight: number, size: number) => `${weight} ${size}px ${theme.font}`

  const crumbFont = (index: number) =>
    font(index === trail.length - 1 ? 600 : 400, CRUMB_SIZE)
  const measureCrumbs = (crumbs: string[]) => {
    context.font = font(400, CRUMB_SIZE)
    const separator = context.measureText("›").width + CRUMB_GAP * 2
    return crumbs.reduce((width, crumb, index) => {
      context.font = crumbFont(index)
      return width + context.measureText(crumb).width + (index ? separator : 0)
    }, 0)
  }
  // A long title gives way first; 空間 and the photo count always fit.
  const crumbs = [...trail]
  while (crumbs.length > 1 && measureCrumbs(crumbs) > MAX_TEXT_WIDTH) {
    const title = [...crumbs[1].replace(/…$/, "")]
    if (title.length <= 1) break
    crumbs[1] = `${title.slice(0, -1).join("")}…`
  }
  const crumbsWidth = measureCrumbs(crumbs)
  context.font = font(500, GUIDE_SIZE)
  const guide = lines.flatMap((line) => wrapText(context, line, MAX_TEXT_WIDTH))
  const guideWidth = Math.max(0, ...guide.map((line) => context.measureText(line).width))
  context.font = font(400, NOTE_SIZE)
  const notes = note ? wrapText(context, note, MAX_TEXT_WIDTH) : []
  const noteWidth = Math.max(0, ...notes.map((line) => context.measureText(line).width))

  const width = Math.ceil(
    Math.max(MIN_PANEL_WIDTH, crumbsWidth + PAD_X * 2, guideWidth + PAD_X * 2, noteWidth + PAD_X * 2),
  )
  const height =
    PAD_Y * 2 +
    (crumbs.length ? CRUMB_LINE + DIVIDER : 0) +
    guide.length * GUIDE_LINE +
    notes.length * NOTE_LINE
  // Resizing the canvas resets the context, so styles are set afterwards.
  canvas.width = width
  canvas.height = height
  context.beginPath()
  context.roundRect(3, 3, width - 6, height - 6, RADIUS)
  context.fillStyle = theme.glass
  context.fill()
  context.lineWidth = 3
  context.strokeStyle = theme.border
  context.stroke()
  context.textBaseline = "middle"

  let y = PAD_Y
  if (crumbs.length) {
    let x = (width - crumbsWidth) / 2
    const middle = y + CRUMB_LINE / 2
    context.textAlign = "left"
    crumbs.forEach((crumb, index) => {
      if (index) {
        context.font = font(400, CRUMB_SIZE)
        context.fillStyle = theme.muted
        x += CRUMB_GAP
        context.fillText("›", x, middle)
        x += context.measureText("›").width + CRUMB_GAP
      }
      context.font = crumbFont(index)
      context.fillStyle = theme.ink
      context.fillText(crumb, x, middle)
      x += context.measureText(crumb).width
    })
    y += CRUMB_LINE
    context.beginPath()
    context.moveTo(PAD_X, y + DIVIDER / 2)
    context.lineTo(width - PAD_X, y + DIVIDER / 2)
    context.globalAlpha = 0.18
    context.lineWidth = 2
    context.strokeStyle = theme.muted
    context.stroke()
    context.globalAlpha = 1
    y += DIVIDER
  }
  context.textAlign = "center"
  context.font = font(500, GUIDE_SIZE)
  context.fillStyle = theme.ink
  for (const line of guide) {
    context.fillText(line, width / 2, y + GUIDE_LINE / 2)
    y += GUIDE_LINE
  }
  context.font = font(400, NOTE_SIZE)
  context.fillStyle = theme.muted
  for (const line of notes) {
    context.fillText(line, width / 2, y + NOTE_LINE / 2)
    y += NOTE_LINE
  }
  return canvas
}

// The toast keeps the web toast's look: a primary pill with light text.
const drawToast = (message: string, theme: GuideTheme) => {
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")!
  const font = `500 ${TOAST_SIZE}px ${theme.font}`
  context.font = font
  const lines = wrapText(context, message, MAX_TEXT_WIDTH)
  const textWidth = Math.max(...lines.map((line) => context.measureText(line).width))
  canvas.width = Math.ceil(textWidth + TOAST_PAD_X * 2)
  canvas.height = lines.length * TOAST_LINE + TOAST_PAD_Y * 2
  context.beginPath()
  context.roundRect(0, 0, canvas.width, canvas.height, Math.min(canvas.height / 2, RADIUS))
  context.fillStyle = theme.toast
  context.fill()
  context.font = font
  context.fillStyle = theme.onToast
  context.textAlign = "center"
  context.textBaseline = "middle"
  lines.forEach((line, index) => {
    context.fillText(line, canvas.width / 2, TOAST_PAD_Y + TOAST_LINE * (index + 0.5))
  })
  return canvas
}

/**
 * In VR the HTML overlay is out of sight, so its breadcrumb, guidance and
 * toasts float on a panel below and ahead of the viewer's eyes. The panel
 * trails the head a little, so a glance at a button does not chase it away.
 */
export function createVRGuidePanel({
  scene,
  theme,
}: {
  scene: THREE.Scene
  theme: GuideTheme
}) {
  const group = new THREE.Group()
  group.name = "VRGuide"
  group.visible = false
  scene.add(group)
  const panel = createCard("VRGuidePanel", 150)
  const toast = createCard("VRGuideToast", 151)
  group.add(panel.mesh, toast.mesh)

  let shownGuide = ""
  // Wall-clock seconds, so a slow frame never holds a toast up.
  let toastAt = -Infinity
  let appear = 0
  let snap = true
  const ahead = new THREE.Vector3(0, 0, -1)
  const target = new THREE.Vector3()

  // The toast rides just above the panel, nearer the line of sight.
  const placeToast = () => {
    toast.mesh.position.y =
      panel.mesh.scale.y / 2 + TOAST_GAP + toast.mesh.scale.y / 2
  }

  return {
    group,
    setContent(guide: VRGuide) {
      const key = JSON.stringify(guide)
      if (key === shownGuide) return
      shownGuide = key
      panel.paint(drawPanel(guide, theme))
      panel.mesh.userData.guide = guide
      placeToast()
    },
    /** Shows `message` above the panel for VR_TOAST_SECONDS. */
    notify(message: string) {
      toast.paint(drawToast(message, theme))
      toast.mesh.userData.text = message
      toastAt = performance.now() / 1000
      placeToast()
    },
    /** The next update puts the panel straight ahead instead of easing there. */
    snap() {
      snap = true
    },
    update(
      delta: number,
      presenting: boolean,
      eye: THREE.Vector3,
      direction: THREE.Vector3,
    ) {
      if (!presenting) {
        group.visible = false
        appear = 0
        snap = true
        return
      }
      // Looking almost straight down has no heading; keep the last one.
      if (Math.hypot(direction.x, direction.z) > 0.2) {
        ahead.set(direction.x, 0, direction.z).normalize()
      }
      target
        .copy(eye)
        .addScaledVector(ahead, VR_PANEL_AHEAD)
        .setY(eye.y - VR_PANEL_DROP)
      if (snap) {
        group.position.copy(target)
        snap = false
      } else {
        group.position.lerp(target, followBlend(delta))
      }
      // Tilted up to face the eyes. A plane's front is +z, so turning +z
      // toward the eyes is Object3D.lookAt's rule for non-cameras.
      group.lookAt(eye)
      appear = Math.min(1, appear + delta / APPEAR_SECONDS)
      panel.material.opacity = appear
      panel.mesh.visible = Boolean(panel.material.map)
      const toastShown = toastOpacity(performance.now() / 1000 - toastAt)
      toast.material.opacity = toastShown * appear
      toast.mesh.visible = toastShown > 0
      group.visible = true
    },
    dispose() {
      panel.dispose()
      toast.dispose()
      group.removeFromParent()
    },
  }
}

export type VRGuidePanel = ReturnType<typeof createVRGuidePanel>
