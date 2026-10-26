import * as THREE from "three"
import { loadCloudDome, type CloudDome } from "./cloudDome"
import { createPlaceBubbles } from "./placeBubbles"
import { ownMemoryPosition } from "./ownMemoryLayout"
import { createMemoryImmersion } from "./memoryImmersion"
import { createTabBar, createTabButton, type TabTheme } from "./memoryTabs"
import { createMemoryRing, type MemoryRing, type RingFragment } from "./memoryRing"
import { relativePlace, type GeoPoint } from "./placeGeometry"
import type { PlaceMemory } from "./placeMemoriesApi"

type Marker = ReturnType<typeof createPlaceBubbles> & { memory: PlaceMemory; home: THREE.Vector3; phase: number }
export type PlaceScene = {
  setMemories: (memories: PlaceMemory[], origin?: GeoPoint) => void
  setHeading: (degrees: number, pitch?: number) => void
  updateTitle: (id: string, title: string) => void
  alignNorth: () => void
  back: () => void
  dispose: () => void
}
export async function createPlaceScene(host: HTMLDivElement, options: {
  session?: XRSession
  backdrop?: "cloud-dome"
  layout?: "nearby" | "mine"
  compact?: boolean
  onRing: (memory: PlaceMemory | null) => void
  onPhoto: (memory: PlaceMemory, index: number) => void
  onError: (message: string) => void
}): Promise<PlaceScene> {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.xr.enabled = true
  renderer.xr.setReferenceSpaceType("local")
  host.appendChild(renderer.domElement)
  const scene = new THREE.Scene()
  const theme = getComputedStyle(document.documentElement)
  const tabTheme: TabTheme = {
    font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    primary: theme.getPropertyValue("--primary").trim(), onPrimary: theme.getPropertyValue("--surface").trim(),
    glass: theme.getPropertyValue("--surface-composer").trim(), ink: theme.getPropertyValue("--ink").trim(),
    border: theme.getPropertyValue("--surface-border").trim(),
  }
  const ringBack = createTabBar([createTabButton("戻る", "back", "secondary", tabTheme)])
  ringBack.group.scale.setScalar(1.6); scene.add(ringBack.group)
  const immersion = createMemoryImmersion({ scene, tabTheme,
    backdropColor: theme.getPropertyValue("--immersion-backdrop").trim(), maxTextureSize: renderer.capabilities.maxTextureSize })
  let immersivePhoto = 0
  const eye = new THREE.PerspectiveCamera(70, 1, 0.01, 100)
  const markersRoot = new THREE.Group()
  scene.add(markersRoot, new THREE.HemisphereLight(0xffffff, 0xc7b6dc, 2.5))
  const light = new THREE.DirectionalLight(0xffffff, 2)
  light.position.set(-2, 3, 4); scene.add(light)
  const geometry = new THREE.SphereGeometry(0.15, 48, 24)
  const loader = new THREE.TextureLoader()
  const raycaster = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const position = new THREE.Vector3()
  const forward = new THREE.Vector3()
  const targets: Marker[] = []
  let ring: MemoryRing<Marker> | null = null
  let loading = false
  let pointerActive = false
  let hovered: Marker | null = null
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches
  const frustum = new THREE.Frustum()
  const projection = new THREE.Matrix4()
  const markerBounds = new THREE.Sphere(new THREE.Vector3(), 0.7)
  let disposed = false
  let revision = 0
  let previous: number | null = null
  let elapsed = 0
  let yaw = 0, pitch = 0
  let arAnchor: THREE.Vector3 | null = null
  let arNorth = 0
  let cloudDome: CloudDome | null = null
  let drag: { x: number; y: number; moved: number } | null = null
  const loadedTextures = new Set<THREE.Texture>()
  const photoMaterials = new Set<THREE.SpriteMaterial>()
  const resize = () => {
    renderer.setSize(host.clientWidth, host.clientHeight)
    eye.aspect = host.clientWidth / Math.max(1, host.clientHeight); eye.updateProjectionMatrix()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host); resize()
  const disposeMarker = (marker: Marker) => {
    marker.dispose()
    marker.photos.forEach(material => { if (material.map) { loadedTextures.delete(material.map); material.map.dispose() }; photoMaterials.delete(material); material.dispose() })
  }
  const loadPhoto = async (url: string) => {
    const texture = await loader.loadAsync(url)
    if (disposed) { texture.dispose(); throw new Error("disposed") }
    const image = texture.image as HTMLImageElement
    const canvas = document.createElement("canvas")
    canvas.width = 512; canvas.height = 512
    const context = canvas.getContext("2d")
    if (!context) { texture.dispose(); throw new Error("canvas") }
    const side = Math.min(image.width, image.height)
    context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 512, 512)
    texture.dispose()
    const preview = new THREE.CanvasTexture(canvas)
    preview.colorSpace = THREE.SRGBColorSpace
    return preview
  }
  const photoMaterial = (texture: THREE.Texture) => {
    loadedTextures.add(texture)
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false })
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `
        #include <map_fragment>
        float radius = length((vMapUv - vec2(0.5)) * 2.0);
        diffuseColor.a *= 1.0 - smoothstep(0.0, 1.0, radius);
      `)
    }
    photoMaterials.add(material)
    return material
  }
  const setMemories = (memories: PlaceMemory[], origin?: GeoPoint) => {
    const current = ++revision
    immersion.reset(); ringBack.hide(true)
    ring?.dispose(); ring = null; options.onRing(null)
    targets.splice(0).forEach(disposeMarker)
    hovered = null
    for (const [index, memory] of memories.entries()) {
      // Seven small previews match the demo; remaining images load only on entry.
      void Promise.allSettled(memory.photos.slice(0, 7).map(async (url) => {
        const texture = await loadPhoto(url)
        if (disposed || current !== revision) { texture.dispose(); return null }
        return texture
      })).then((results) => {
        const textures = results.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : [])
        if (results.some(result => result.status === "rejected")) {
          textures.forEach(texture => texture.dispose())
          if (!disposed && current === revision) options.onError("写真を読み込めませんでした。更新して再度お試しください。")
          return
        }
        if (disposed || current !== revision) { textures.forEach(t => t?.dispose()); return }
        if (textures.some(t => !t)) return
        const photos = textures.map(texture => photoMaterial(texture!))
        const cluster = createPlaceBubbles(geometry, new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue("--sphere").trim()), memory.id, photos, index * 1.2)
        const home = new THREE.Vector3()
        if (options.layout === "mine") {
          const slot = ownMemoryPosition(index, memories.length, options.compact)
          home.set(slot.x, slot.y, slot.z)
        } else if (origin) {
          const { bearing, distance } = relativePlace(origin, memory)
          const radius = 2.2 + Math.min(distance, 50) * 0.035
          home.set(Math.sin(bearing) * radius, 0, -Math.cos(bearing) * radius)
        }
        cluster.group.position.copy(home)
        cluster.group.scale.setScalar(options.layout === "mine" ? 1 : 1.7)
        markersRoot.add(cluster.group)
        const marker: Marker = { ...cluster, memory, home, phase: index * 1.2 }
        targets.push(marker)
      }).catch(() => { if (!disposed && current === revision) options.onError("写真の読み込み期限が切れた可能性があります。周辺を更新してください。") })
    }
  }
  const pickMarker = () => {
    const hit = raycaster.intersectObjects(targets.filter(marker => marker.group.visible).flatMap(marker =>
      [marker.mesh, ...marker.satellites.map(entry => entry.mesh)].filter(mesh => mesh.visible)), false)[0]
    return targets.find(marker => marker.mesh === hit?.object || marker.satellites.some(entry => entry.mesh === hit?.object)) ?? null
  }
  const showImmersivePhoto = (index: number, opening: boolean) => {
    if (!ring) return
    const texture = ring.sphere.photos[index]?.map
    if (!texture) return
    immersivePhoto = index
    const head = renderer.xr.getCamera()
    head.getWorldPosition(position); head.getWorldDirection(forward)
    const input = { texture, src: ring.sphere.memory.photos[index], elapsed }
    if (opening) immersion.open({ ...input, center: position, yaw: Math.atan2(-forward.x, -forward.z) })
    else immersion.show(input)
    immersion.setNavigation({ previous: index > 0, next: index < ring.sphere.photos.length - 1 })
  }
  const choose = async () => {
    if (loading) return
    if (renderer.xr.isPresenting && immersion.status !== "closed") {
      const hit = raycaster.intersectObjects(immersion.targets(), false)[0]
      const action = hit ? immersion.actionFor(hit.object) : null
      if (action === "back") immersion.close(elapsed)
      if (action === "previous" && immersivePhoto > 0) showImmersivePhoto(immersivePhoto - 1, false)
      if (action === "next" && ring && immersivePhoto < ring.sphere.photos.length - 1) showImmersivePhoto(immersivePhoto + 1, false)
      return
    }
    if (renderer.xr.isPresenting && raycaster.intersectObjects(ringBack.targets(), false)[0]) { ring?.close(elapsed); return }
    if (ring && ring.status !== "open") return
    if (ring) {
      const hit = raycaster.intersectObjects(ring.targets(), false)[0]
      const fragment: RingFragment | null = hit ? ring.fragmentFor(hit.object) : null
      if (fragment?.photoIndex !== null && fragment?.photoIndex !== undefined) {
        if (renderer.xr.isPresenting) showImmersivePhoto(fragment.photoIndex, true)
        else options.onPhoto(ring.sphere.memory, fragment.photoIndex)
      }
      return
    }
    const marker = pickMarker()
    if (!marker) return
    const current = revision
    if (marker.photos.length < marker.memory.photos.length) {
      loading = true
      try {
        const results = await Promise.allSettled(marker.memory.photos.slice(marker.photos.length).map(loadPhoto))
        const textures = results.flatMap(result => result.status === "fulfilled" ? [result.value] : [])
        if (disposed || current !== revision || results.some(result => result.status === "rejected")) {
          textures.forEach(texture => texture.dispose())
          if (!disposed && current === revision) options.onError("写真を読み込めませんでした。周辺を更新して再度お試しください。")
          return
        }
        marker.photos.push(...textures.map(photoMaterial))
      } finally { loading = false }
    }
    if (disposed || current !== revision) return
    marker.membranes.hide()
    hovered = null
    scene.updateMatrixWorld(true)
    const head = renderer.xr.isPresenting ? renderer.xr.getCamera() : eye
    head.getWorldPosition(position)
    ring = createMemoryRing({ scene, sphere: marker, geometry, material: marker.film.material,
      paleMaterial: marker.film.paleMaterial, center: position, elapsed,
      duration: reduced ? 0 : 1.8 })
    targets.forEach(t => { t.group.visible = t === marker })
    options.onRing(marker.memory)
  }
  const down = (event: PointerEvent) => { drag = { x: event.clientX, y: event.clientY, moved: 0 }; renderer.domElement.setPointerCapture(event.pointerId) }
  const move = (event: PointerEvent) => {
    const bounds = renderer.domElement.getBoundingClientRect()
    ndc.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1)
    pointerActive = event.pointerType === "mouse" && !drag
    if (!drag || renderer.xr.isPresenting) return
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y
    drag.moved += Math.hypot(dx, dy); drag.x = event.clientX; drag.y = event.clientY
    yaw -= dx * 0.004; pitch = THREE.MathUtils.clamp(pitch - dy * 0.004, -1.15, 1.15)
  }
  const up = (event: PointerEvent) => {
    const pick = drag && drag.moved < 8
    drag = null
    if (!pick) return
    const bounds = renderer.domElement.getBoundingClientRect()
    ndc.set((event.clientX - bounds.left) / bounds.width * 2 - 1, -(event.clientY - bounds.top) / bounds.height * 2 + 1)
    raycaster.setFromCamera(ndc, eye); void choose()
  }
  const cancel = () => { drag = null; pointerActive = false; hovered = null }
  const controllers = [renderer.xr.getController(0), renderer.xr.getController(1)]
  const handlers = controllers.map(controller => {
    const select = () => { scene.updateMatrixWorld(true); raycaster.setFromXRController(controller); void choose() }
    controller.addEventListener("selectstart", select); scene.add(controller); return select
  })
  renderer.domElement.addEventListener("pointerdown", down)
  renderer.domElement.addEventListener("pointermove", move)
  renderer.domElement.addEventListener("pointerup", up)
  renderer.domElement.addEventListener("pointercancel", cancel)
  renderer.domElement.addEventListener("pointerleave", cancel)
  // The "local" reference space starts at head height; the dome floor sits at the demo's 1.5m eye height below it.
  const placeDome = () => {
    if (!cloudDome || !arAnchor) return
    cloudDome.root.position.set(arAnchor.x, arAnchor.y - 1.5, arAnchor.z)
  }
  const cleanup = () => {
    if (disposed) return
    disposed = true; revision++; observer.disconnect(); renderer.setAnimationLoop(null)
    immersion.dispose(); ringBack.dispose(); cloudDome?.dispose(); cloudDome = null
    ring?.dispose(); targets.splice(0).forEach(disposeMarker)
    loadedTextures.forEach(t => t.dispose()); photoMaterials.forEach(m => m.dispose())
    controllers.forEach((controller, i) => controller.removeEventListener("selectstart", handlers[i]))
    renderer.domElement.removeEventListener("pointerdown", down); renderer.domElement.removeEventListener("pointermove", move)
    renderer.domElement.removeEventListener("pointerup", up); renderer.domElement.removeEventListener("pointercancel", cancel)
    renderer.domElement.removeEventListener("pointerleave", cancel)
    geometry.dispose(); renderer.dispose(); renderer.domElement.remove()
  }
  if (options.session) {
    try { await renderer.xr.setSession(options.session) }
    catch (error) { cleanup(); throw error }
  }
  if (options.backdrop === "cloud-dome") {
    void loadCloudDome({ scene, renderer, url: `${import.meta.env.BASE_URL}exports/cloud-dome-grid.glb` }).then(
      (dome) => {
        if (disposed) { dome.dispose(); return }
        cloudDome = dome
        if (arAnchor) placeDome()
      },
      () => { if (!disposed) options.onError("背景空間を読み込めませんでした。再読み込みしてください。") },
    )
  }
  renderer.setAnimationLoop((time, frame) => {
    const delta = previous === null ? 0 : Math.min((time - previous) / 1000, 0.1)
    previous = time; elapsed += delta
    if (!renderer.xr.isPresenting) { eye.rotation.set(pitch, -yaw, 0, "YXZ") }
    else if (!arAnchor && frame) {
      const ref = renderer.xr.getReferenceSpace()
      const pose = ref ? frame.getViewerPose(ref) : null
      if (pose) {
        arAnchor = new THREE.Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z)
        const q = new THREE.Quaternion().set(pose.transform.orientation.x, pose.transform.orientation.y, pose.transform.orientation.z, pose.transform.orientation.w)
        forward.set(0, 0, -1).applyQuaternion(q)
        arNorth = Math.atan2(-forward.x, -forward.z) + yaw
        markersRoot.position.copy(arAnchor); markersRoot.rotation.y = arNorth
        placeDome()
      }
    }
    cloudDome?.update(delta)
    eye.updateMatrixWorld(true)
    scene.updateMatrixWorld(true)
    const head = renderer.xr.isPresenting ? renderer.xr.getCamera() : eye
    head.getWorldPosition(position)
    if (!ring && !loading) {
      if (renderer.xr.isPresenting) {
        raycaster.ray.origin.copy(position); head.getWorldDirection(raycaster.ray.direction)
        hovered = pickMarker()
      } else if (pointerActive) {
        raycaster.setFromCamera(ndc, eye); hovered = pickMarker()
      } else hovered = null
    } else hovered = null
    renderer.domElement.style.cursor = hovered ? "pointer" : "grab"
    projection.multiplyMatrices(head.projectionMatrix, head.matrixWorldInverse)
    frustum.setFromProjectionMatrix(projection)
    targets.forEach(marker => {
      const inRing = ring?.sphere === marker
      if (!inRing) {
        marker.group.position.copy(marker.home)
        marker.group.position.y += reduced ? 0 : Math.sin(elapsed * 0.42 + marker.phase) * 0.052 + Math.sin(elapsed * 0.19 + marker.phase * 1.7) * 0.012
        marker.group.lookAt(position)
        if (!reduced) marker.group.rotateZ(Math.sin(elapsed * 0.2 + marker.phase) * 0.025)
      }
      marker.group.getWorldPosition(markerBounds.center)
      marker.update(elapsed, delta, marker === hovered, inRing, marker.group.visible && frustum.intersectsSphere(markerBounds), reduced)
    })
    if (ring) {
      ring.update(elapsed, delta, position)
      if (ring.status === "done") { ring.dispose(); ring = null; targets.forEach(t => { t.group.visible = true }); options.onRing(null) }
    }
    if (renderer.xr.isPresenting && ring?.status === "open" && immersion.status === "closed") {
      head.getWorldDirection(forward); forward.y = 0; forward.normalize()
      ringBack.group.position.copy(position).addScaledVector(forward, 0.8); ringBack.group.position.y -= 0.65
      ringBack.show()
    } else ringBack.hide()
    ringBack.update(delta, position)
    immersion.update(elapsed, delta, position, renderer.xr.isPresenting)
    renderer.render(scene, eye)
  })
  return {
    setMemories,
    updateTitle(id, title) {
      const marker = targets.find(value => value.memory.id === id)
      if (marker) marker.memory = { ...marker.memory, title }
    },
    setHeading(degrees, tilt = 0) { yaw = degrees * Math.PI / 180; pitch = THREE.MathUtils.clamp(tilt, -1.15, 1.15) },
    alignNorth() {
      if (renderer.xr.isPresenting) {
        renderer.xr.getCamera().getWorldDirection(forward)
        markersRoot.rotation.y = Math.atan2(-forward.x, -forward.z)
      } else yaw = 0
    },
    back() { if (immersion.status !== "closed") immersion.close(elapsed); else ring?.close(elapsed) },
    dispose: cleanup,
  }
}
