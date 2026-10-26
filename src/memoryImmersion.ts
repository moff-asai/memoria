import * as THREE from "three"
import {
  createArrowButton,
  createTabBar,
  createTabButton,
  type TabAction,
  type TabTheme,
} from "./memoryTabs"

export type ImmersionStatus = "closed" | "opening" | "open" | "closing"

const RADIUS = 1.6
const HEIGHT = 2.2
const SCREEN_Y = -0.05
const MIN_ARC = THREE.MathUtils.degToRad(70)
const MAX_ARC = THREE.MathUtils.degToRad(200)
const FADE_IN = 0.7
const REVEAL = 1.1
const FADE_OUT = 0.6
/** Switching photos: the current one fades out, then the next unrolls. */
export const SWITCH_FADE = 0.3
export const SWITCH_REVEAL = 0.6
const LOAD_TIMEOUT = 1.5
const BACKDROP_OPACITY = 0.95
const MAX_SCREEN_TEXTURE = 2048
// The 3D arrows float just inside the screen's side edges, kept within a
// comfortable turn of the head when a wide photo wraps far around.
const ARROW_RADIUS = 1.45
const ARROW_INSET = 0.1
const ARROW_MAX_ANGLE = 1.0

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1)
const smooth = (t: number) => t * t * (3 - 2 * t)

// The photo on screen leaves (fades out), waits for the next one to load,
// then reveals it from the center.
type PhotoPhase = "leaving" | "waiting" | "revealing"
type ScreenPhoto = {
  texture: THREE.Texture
  owned: boolean
  src: string | undefined
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

// Cover-fits the photo, feathers the edges, and unrolls it from the center.
const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform vec2 uvScale;
  uniform vec2 uvOffset;
  uniform float reveal;
  uniform float opacity;
  varying vec2 vUv;
  void main() {
    vec4 texel = texture2D(map, vUv * uvScale + uvOffset);
    float edge =
      smoothstep(0.0, 0.07, vUv.x) * (1.0 - smoothstep(0.93, 1.0, vUv.x)) *
      smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.92, 1.0, vUv.y));
    float spread = abs(vUv.x - 0.5) * 2.0;
    float front = reveal * 1.15;
    float revealMask = 1.0 - smoothstep(front - 0.15, front, spread);
    gl_FragColor = vec4(texel.rgb, texel.a * edge * revealMask * opacity);
    #include <colorspace_fragment>
  }
`

/**
 * A curved screen that wraps around the viewer and shows one photo at a
 * time, with 戻る below and arrows at its sides to step between photos.
 */
export function createMemoryImmersion({
  scene,
  backdropColor,
  tabTheme,
  maxTextureSize,
}: {
  scene: THREE.Scene
  backdropColor: string
  tabTheme: TabTheme
  maxTextureSize: number
}) {
  // Uploads can be phone-camera originals; cap the GPU texture so a single
  // photo cannot exhaust memory and lose the WebGL context on mobile/VR.
  const textureLimit = Math.min(MAX_SCREEN_TEXTURE, maxTextureSize)
  const toScreenTexture = (image: HTMLImageElement) => {
    const scale = Math.min(
      1,
      textureLimit / Math.max(image.naturalWidth, image.naturalHeight),
    )
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    // The screen fills the view, so mipmaps add memory without visible gain.
    texture.generateMipmaps = false
    texture.minFilter = THREE.LinearFilter
    return texture
  }

  const root = new THREE.Group()
  root.name = "MemoryImmersion"
  root.visible = false
  scene.add(root)

  // Drawn over everything (depthTest off) so the space dims behind the screen.
  const backdropGeometry = new THREE.SphereGeometry(3.4, 48, 24)
  const backdropMaterial = new THREE.MeshBasicMaterial({
    color: backdropColor,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })
  const backdrop = new THREE.Mesh(backdropGeometry, backdropMaterial)
  backdrop.renderOrder = 100
  root.add(backdrop)

  const uniforms = {
    map: { value: null as THREE.Texture | null },
    uvScale: { value: new THREE.Vector2(1, 1) },
    uvOffset: { value: new THREE.Vector2(0, 0) },
    reveal: { value: 0 },
    opacity: { value: 0 },
  }
  const screenMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const screen = new THREE.Mesh(new THREE.BufferGeometry(), screenMaterial)
  screen.name = "MemoryImmersionScreen"
  screen.renderOrder = 101
  screen.position.y = SCREEN_Y
  root.add(screen)

  const backBar = createTabBar([
    createTabButton("戻る", "back", "secondary", tabTheme, 102),
  ])
  backBar.group.position.set(0, -0.55, -1.25)
  const previousBar = createTabBar([
    createArrowButton("previous", tabTheme, 102),
  ])
  const nextBar = createTabBar([createArrowButton("next", tabTheme, 102)])
  const bars = [backBar, previousBar, nextBar]
  bars.forEach(({ group }) => root.add(group))

  let status: ImmersionStatus = "closed"
  let startedAt = 0
  let visibility = 0
  let closingFrom = 0
  let phase: PhotoPhase = "waiting"
  // Leaving: when the fade began. Waiting: the earliest the reveal may
  // start. Revealing: when the reveal began.
  let phaseAt = 0
  // The current photo's own opacity, under the screen's visibility.
  let fade = 1
  let fadeFrom = 1
  let revealSeconds = REVEAL
  let token = 0
  let requestedAt = 0
  let requestedSrc: string | undefined
  let preview: THREE.Texture | null = null
  // A photo that is ready to go on screen.
  let pending: ScreenPhoto | null = null
  // The full photo arrived or failed to; no stand-in is needed any more.
  let settled = false
  let ownedTexture: THREE.Texture | null = null
  let arrowAngle = 0
  let arrowGoal = 0
  let snapArrows = true
  let controlsVisible = false

  const setTexture = (texture: THREE.Texture, owned: boolean) => {
    if (uniforms.map.value === texture) return
    if (ownedTexture && ownedTexture !== texture) ownedTexture.dispose()
    ownedTexture = owned ? texture : null
    uniforms.map.value = texture
    const image = texture.image as { width: number; height: number }
    const imageAspect = image.width / image.height || 1
    // Let wide photos wrap further around the viewer; crop only past the limits.
    const arc = THREE.MathUtils.clamp(
      (HEIGHT * imageAspect) / RADIUS,
      MIN_ARC,
      MAX_ARC,
    )
    const screenAspect = (arc * RADIUS) / HEIGHT
    if (imageAspect > screenAspect) {
      uniforms.uvScale.value.set(screenAspect / imageAspect, 1)
    } else {
      uniforms.uvScale.value.set(1, imageAspect / screenAspect)
    }
    uniforms.uvOffset.value.set(
      (1 - uniforms.uvScale.value.x) / 2,
      (1 - uniforms.uvScale.value.y) / 2,
    )
    const geometry = new THREE.CylinderGeometry(
      RADIUS,
      RADIUS,
      HEIGHT,
      96,
      1,
      true,
      Math.PI - arc / 2,
      arc,
    )
    // Seen from inside, the cylinder's u runs right-to-left; flip it.
    const uv = geometry.getAttribute("uv")
    for (let index = 0; index < uv.count; index++) {
      uv.setX(index, 1 - uv.getX(index))
    }
    screen.geometry.dispose()
    screen.geometry = geometry
    arrowGoal = Math.min(arc / 2 - ARROW_INSET, ARROW_MAX_ANGLE)
    if (snapArrows) {
      arrowAngle = arrowGoal
      snapArrows = false
    }
  }

  const discardPending = () => {
    if (pending?.owned) pending.texture.dispose()
    pending = null
  }

  // Shows `texture` (the ring's square crop) as a stand-in while the full
  // photo loads, if that takes longer than LOAD_TIMEOUT.
  const request = (
    texture: THREE.Texture,
    src: string | undefined,
    elapsed: number,
  ) => {
    const current = ++token
    discardPending()
    preview = texture
    requestedAt = elapsed
    requestedSrc = src
    settled = false
    if (!src) {
      pending = { texture, owned: false, src }
      settled = true
      return
    }
    // The ring holds square crops; load the full photo for the screen.
    const loader = new THREE.ImageLoader()
    loader.setCrossOrigin("anonymous")
    loader.load(
      src,
      (image) => {
        if (current !== token || status === "closed") return
        discardPending()
        pending = { texture: toScreenTexture(image), owned: true, src }
        settled = true
      },
      undefined,
      () => {
        if (current !== token || settled || !preview) return
        settled = true
        if (!pending && uniforms.map.value !== preview) {
          pending = { texture: preview, owned: false, src }
        }
      },
    )
  }

  const updatePhoto = (elapsed: number) => {
    if (phase === "leaving") {
      const progress = clamp01((elapsed - phaseAt) / SWITCH_FADE)
      fade = fadeFrom * (1 - smooth(progress))
      if (progress < 1) return
      phase = "waiting"
      phaseAt = elapsed
    }
    if (phase === "waiting") {
      if (!pending && !settled && preview && elapsed - requestedAt > LOAD_TIMEOUT) {
        pending = { texture: preview, owned: false, src: requestedSrc }
      }
      if (!pending || elapsed < phaseAt) return
      phase = "revealing"
      phaseAt = elapsed
      fade = 1
    }
    // A full photo that arrives after its stand-in replaces it in place.
    if (pending) {
      setTexture(pending.texture, pending.owned)
      screen.userData.src = pending.src
      pending = null
    }
    uniforms.reveal.value = smooth(clamp01((elapsed - phaseAt) / revealSeconds))
  }

  const placeArrows = () => {
    const x = Math.sin(arrowAngle) * ARROW_RADIUS
    const z = -Math.cos(arrowAngle) * ARROW_RADIUS
    previousBar.group.position.set(-x, SCREEN_Y, z)
    nextBar.group.position.set(x, SCREEN_Y, z)
  }

  const finishClosing = () => {
    status = "closed"
    root.visible = false
    visibility = 0
    discardPending()
    uniforms.map.value = null
    ownedTexture?.dispose()
    ownedTexture = null
    preview = null
    screen.userData.src = undefined
  }

  return {
    get status() {
      return status
    },
    open({
      texture,
      src,
      center,
      yaw,
      pitch = 0,
      elapsed,
    }: {
      texture: THREE.Texture
      src: string | undefined
      center: THREE.Vector3
      yaw: number
      pitch?: number
      elapsed: number
    }) {
      status = "opening"
      startedAt = elapsed
      visibility = 0
      phase = "waiting"
      phaseAt = elapsed + FADE_IN * 0.4
      fade = 1
      revealSeconds = REVEAL
      snapArrows = true
      uniforms.reveal.value = 0
      root.position.copy(center)
      root.rotation.set(pitch, yaw, 0, "YXZ")
      root.visible = true
      request(texture, src, elapsed)
    },
    /**
     * Swap in another photo: the current one fades out over SWITCH_FADE,
     * then the next unrolls from the center over SWITCH_REVEAL. A further
     * request mid-switch retargets it.
     */
    show({
      texture,
      src,
      elapsed,
    }: {
      texture: THREE.Texture
      src: string | undefined
      elapsed: number
    }) {
      if (status !== "opening" && status !== "open") return
      if (phase === "revealing") {
        phase = "leaving"
        phaseAt = elapsed
        fadeFrom = fade
      }
      revealSeconds = SWITCH_REVEAL
      request(texture, src, elapsed)
    },
    /** Fades back (and disables) the arrow toward a missing photo. */
    setNavigation({ previous, next }: { previous: boolean; next: boolean }) {
      previousBar.setDisabled(previous ? [] : ["previous"])
      nextBar.setDisabled(next ? [] : ["next"])
    },
    close(elapsed: number) {
      if (status !== "opening" && status !== "open") return
      status = "closing"
      startedAt = elapsed
      closingFrom = visibility
      bars.forEach((bar) => bar.hide())
    },
    /** Close at once, e.g. when the viewpoint jumps into or out of VR. */
    reset() {
      if (status === "closed") return
      // A photo still loading must not land on a later opening.
      token++
      bars.forEach((bar) => bar.hide(true))
      finishClosing()
      backdropMaterial.opacity = 0
      uniforms.opacity.value = 0
      uniforms.reveal.value = 0
    },
    update(elapsed: number, delta: number, viewer: THREE.Vector3, presenting: boolean) {
      controlsVisible = presenting
      if (!controlsVisible) bars.forEach((bar) => bar.hide(true))
      if (status === "closed") return
      if (status === "closing") {
        const progress = clamp01((elapsed - startedAt) / FADE_OUT)
        visibility = closingFrom * (1 - smooth(progress))
        if (progress >= 1) {
          bars.forEach((bar) => bar.update(delta, viewer))
          finishClosing()
          return
        }
      } else {
        visibility = smooth(clamp01((elapsed - startedAt) / FADE_IN))
        updatePhoto(elapsed)
        if (controlsVisible && uniforms.reveal.value > 0.3 && !backBar.shown) {
          bars.forEach((bar) => bar.show())
        }
        if (
          status === "opening" &&
          visibility >= 1 &&
          phase === "revealing" &&
          uniforms.reveal.value >= 1
        ) {
          status = "open"
        }
      }
      backdropMaterial.opacity = BACKDROP_OPACITY * visibility
      uniforms.opacity.value = visibility * fade
      screen.scale.y = 0.94 + 0.06 * visibility
      // Wider or narrower photos move the arrows; they glide to the new edges.
      arrowAngle += (arrowGoal - arrowAngle) * (1 - Math.exp(-delta * 8))
      placeArrows()
      root.updateWorldMatrix(true, false)
      bars.forEach((bar) => bar.update(delta, viewer))
    },
    targets() {
      return controlsVisible && (status === "opening" || status === "open")
        ? bars.flatMap((bar) => bar.targets())
        : []
    },
    actionFor(object: THREE.Object3D): TabAction | null {
      for (const bar of bars) {
        const action = bar.actionFor(object)
        if (action) return action
      }
      return null
    },
    setHover(action: TabAction | null) {
      bars.forEach((bar) => bar.setHover(action))
    },
    dispose() {
      token++
      discardPending()
      bars.forEach((bar) => bar.dispose())
      root.removeFromParent()
      backdropGeometry.dispose()
      backdropMaterial.dispose()
      screen.geometry.dispose()
      screenMaterial.dispose()
      ownedTexture?.dispose()
    },
  }
}

export type MemoryImmersion = ReturnType<typeof createMemoryImmersion>
