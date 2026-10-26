import * as THREE from "three"

export type TabAction = "back" | "previous" | "next" | "exit"

export type TabTheme = {
  font: string
  primary: string
  onPrimary: string
  glass: string
  ink: string
  border: string
}

const TAB_HEIGHT = 0.09
const CANVAS_HEIGHT = 128
const ARROW_SIZE = 0.13
const ARROW_CANVAS = 160
// Disabled buttons stay in place but read as unavailable.
const DISABLED_OPACITY = 0.3

// A left arrow: step back one layer.
const drawBackIcon = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
) => {
  const h = size / 2
  context.beginPath()
  context.moveTo(x + h, y)
  context.lineTo(x - h, y)
  context.moveTo(x - h * 0.15, y - h * 0.8)
  context.lineTo(x - h, y)
  context.lineTo(x - h * 0.15, y + h * 0.8)
  context.stroke()
}

// Turns a drawn canvas into a raycastable plane `height` tall.
const buttonFromCanvas = (
  canvas: HTMLCanvasElement,
  action: TabAction,
  height: number,
  renderOrder: number,
) => {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const width = (height * canvas.width) / canvas.height
  const geometry = new THREE.PlaneGeometry(width, height)
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = `MemoryTab-${action}`
  mesh.renderOrder = renderOrder
  return {
    mesh,
    material,
    action,
    width,
    dispose() {
      geometry.dispose()
      material.dispose()
      texture.dispose()
    },
  }
}

/** A floating pill button rendered on a plane so it can be raycast in XR. */
export function createTabButton(
  label: string,
  action: TabAction,
  variant: "primary" | "secondary",
  theme: TabTheme,
  renderOrder = 50,
) {
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")!
  const font = `600 46px ${theme.font}`
  const inset = 8
  const padX = 44
  const iconSize = 32
  const gap = 18
  context.font = font
  const textWidth = Math.ceil(context.measureText(label).width)
  canvas.width = inset * 2 + padX * 2 + iconSize + gap + textWidth
  canvas.height = CANVAS_HEIGHT

  const pillHeight = CANVAS_HEIGHT - inset * 2
  context.beginPath()
  context.roundRect(
    inset,
    inset,
    canvas.width - inset * 2,
    pillHeight,
    pillHeight / 2,
  )
  context.fillStyle = variant === "primary" ? theme.primary : theme.glass
  context.fill()
  if (variant === "secondary") {
    context.lineWidth = 3
    context.strokeStyle = theme.border
    context.stroke()
  }
  const color = variant === "primary" ? theme.onPrimary : theme.ink
  const iconX = inset + padX + iconSize / 2
  context.strokeStyle = color
  context.lineWidth = 4.5
  context.lineCap = "round"
  context.lineJoin = "round"
  drawBackIcon(context, iconX, CANVAS_HEIGHT / 2, iconSize)
  context.font = font
  context.fillStyle = color
  context.textAlign = "left"
  context.textBaseline = "middle"
  context.fillText(label, iconX + iconSize / 2 + gap, CANVAS_HEIGHT / 2 + 2)

  return buttonFromCanvas(canvas, action, TAB_HEIGHT, renderOrder)
}

/** A round glass button with a chevron, for stepping between photos. */
export function createArrowButton(
  action: "previous" | "next",
  theme: TabTheme,
  renderOrder = 50,
) {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = ARROW_CANVAS
  const context = canvas.getContext("2d")!
  const middle = ARROW_CANVAS / 2
  context.beginPath()
  context.arc(middle, middle, middle - 8, 0, Math.PI * 2)
  context.fillStyle = theme.glass
  context.fill()
  context.lineWidth = 3
  context.strokeStyle = theme.border
  context.stroke()
  const reach = ARROW_CANVAS * 0.13
  const tip = action === "next" ? reach * 0.55 : -reach * 0.55
  context.beginPath()
  context.moveTo(middle - tip, middle - reach)
  context.lineTo(middle + tip, middle)
  context.lineTo(middle - tip, middle + reach)
  context.strokeStyle = theme.ink
  context.lineWidth = 7
  context.lineCap = "round"
  context.lineJoin = "round"
  context.stroke()
  return buttonFromCanvas(canvas, action, ARROW_SIZE, renderOrder)
}

export type TabButton = ReturnType<typeof buttonFromCanvas>

/** A row of tab buttons that fades in, billboards toward the viewer, and reports hits. */
export function createTabBar(buttons: TabButton[], gap = 0.035) {
  const group = new THREE.Group()
  const content = new THREE.Group()
  group.add(content)
  group.visible = false
  buttons.forEach(({ mesh }) => content.add(mesh))

  let active = buttons.map(({ action }) => action)
  let disabled: readonly TabAction[] = []
  let shown = false
  let appear = 0
  let hovered: TabAction | null = null
  const hover = new Map(buttons.map(({ action }) => [action, 0]))
  const dim = new Map(buttons.map(({ action }) => [action, 0]))

  const visibleButtons = () =>
    buttons.filter(({ action }) => active.includes(action))
  const layout = () => {
    const row = visibleButtons()
    const total =
      row.reduce((sum, { width }) => sum + width, 0) + gap * (row.length - 1)
    let x = -total / 2
    buttons.forEach(({ mesh, action }) => {
      mesh.visible = active.includes(action)
    })
    row.forEach(({ mesh, width }) => {
      mesh.position.x = x + width / 2
      x += width + gap
    })
  }
  layout()

  return {
    group,
    get shown() {
      return shown
    },
    setActions(actions: TabAction[]) {
      active = actions
      layout()
    },
    /** Disabled buttons fade back and cannot be picked. */
    setDisabled(actions: readonly TabAction[]) {
      disabled = actions
    },
    show() {
      shown = true
      group.visible = true
    },
    /** Fades out, or vanishes at once with `immediately`. */
    hide(immediately = false) {
      shown = false
      hovered = null
      if (immediately) {
        appear = 0
        group.visible = false
      }
    },
    setHover(action: TabAction | null) {
      hovered = action
    },
    update(delta: number, lookTarget: THREE.Vector3) {
      const blend = 1 - Math.exp(-delta * 12)
      appear += ((shown ? 1 : 0) - appear) * blend
      if (!shown && appear < 0.01) {
        appear = 0
        group.visible = false
        return
      }
      content.position.y = (1 - appear) * -0.03
      for (const button of buttons) {
        const off = disabled.includes(button.action)
        const amount =
          hover.get(button.action)! +
          ((hovered === button.action && !off ? 1 : 0) -
            hover.get(button.action)!) *
            blend
        hover.set(button.action, amount)
        const faded =
          dim.get(button.action)! + ((off ? 1 : 0) - dim.get(button.action)!) * blend
        dim.set(button.action, faded)
        button.mesh.scale.setScalar(1 + amount * 0.07)
        button.material.opacity =
          appear *
          (0.94 + amount * 0.06) *
          (1 - (1 - DISABLED_OPACITY) * faded)
      }
      group.updateWorldMatrix(true, false)
      group.lookAt(lookTarget)
    },
    targets() {
      return shown && appear > 0.4
        ? visibleButtons()
            .filter(({ action }) => !disabled.includes(action))
            .map(({ mesh }) => mesh)
        : []
    },
    actionFor(object: THREE.Object3D) {
      return buttons.find(({ mesh }) => mesh === object)?.action ?? null
    },
    dispose() {
      buttons.forEach((button) => button.dispose())
      group.removeFromParent()
    },
  }
}

export type TabBar = ReturnType<typeof createTabBar>
