import { createElement, useEffect, useRef, useState, type ChangeEvent } from "react"
import * as THREE from "three"
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js"
import { VRButton } from "three/examples/jsm/webxr/VRButton.js"
import {
  ActionButton,
  initialSceneView,
  SceneBreadcrumb,
  type SceneMode,
  type ScenePlace,
  SphereControls,
  type SceneView,
} from "./SphereControls"
import { type CloudDome, loadCloudDome } from "./cloudDome"
import {
  type Memory,
  saveMemory,
  shrinkPhoto,
} from "./memoriesApi"
import { createMemoryImmersion } from "./memoryImmersion"
import { createMemoryMaterials } from "./memoryMaterial"
import {
  createMemoryRing,
  type MemoryRing,
  type RingFragment,
} from "./memoryRing"
import {
  createTabBar,
  createTabButton,
  type TabAction,
  type TabTheme,
} from "./memoryTabs"
import {
  adjacentPhoto,
  createStickStepper,
  photoNavigation,
  type PhotoStep,
  swipeStep,
} from "./photoBrowse"
import { PHOTO_GUIDE, SPACE_GUIDE, VR_TOAST_SECONDS, vrGuide } from "./sceneGuide"
import { getSphereImageSources } from "./sphereImageSources"
import { createSphereJourney, wrapAngle } from "./sphereJourney"
import {
  bubbleFocusPhases,
  createSphereSatellites,
  updateSphereSatellites,
} from "./sphereSatellites"
import { createBubbleMembranes, type BubbleMembranes } from "./bubbleMembranes"
import { localizeVRButton } from "./vrButtonLabels"
import { createVRGuidePanel } from "./vrGuidePanel"
import { createVRMemoryLayout } from "./vrMemoryLayout"
import { MemoryDraftDialog } from "./MemoryDraftDialog"
import { appendDraftFiles, PHOTO_ACCEPT, type MemoryDraft } from "./memoryDraft"

type SupportStatus = "確認中…" | "対応" | "非対応" | "利用不可" | "確認エラー"
const sessionModes = ["immersive-vr", "immersive-ar"] as const
const CAMERA_FOV = 70

type MemoryPlace = { page: number; slot: number; pages: number }
type AddMemoryToScene = (
  memory: Pick<Memory, "id" | "photos" | "title">,
  animate: boolean,
  place?: MemoryPlace,
) => void
// Each page of own memories faces its own direction around the viewer;
// many pages share the circle instead of overlapping.
const ownPageYaw = (page: number, pages: number) =>
  -page * Math.min(Math.PI / 2, (Math.PI * 2) / Math.max(1, pages))

export default function App({ personal = false }: { personal?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const vrSlotRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<{
    back: () => void
    step: (step: PhotoStep) => void
    turnTo: (yaw: number) => void
  } | null>(null)
  const hasXR = Boolean(navigator.xr)
  const [support, setSupport] =
    useState<Record<typeof sessionModes[number], SupportStatus>>({
      "immersive-vr": hasXR ? "確認中…" : "利用不可",
      "immersive-ar": hasXR ? "確認中…" : "利用不可",
    })
  const [renderError, setRenderError] = useState("")
  const [toast, setToast] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composerRef = useRef<HTMLButtonElement>(null)
  const publishingRef = useRef(false)
  const [draft, setDraft] = useState<MemoryDraft | null>(null)
  const [publishError, setPublishError] = useState("")
  const addMemoryRef = useRef<AddMemoryToScene>(() => {})
  const clearMemoriesRef = useRef(() => {})
  const memoryPlacesRef = useRef(new Map<string, MemoryPlace>())
  // Newest first. Mirrored in a ref so a rebuilt scene can replay it.
  const memoriesRef = useRef<Memory[]>([])
  const [syncStatus, setSyncStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  )
  const [savingCount, setSavingCount] = useState(0)
  const [view, setView] = useState<SceneView>(initialSceneView)
  const [presenting, setPresenting] = useState(false)
  // The VR panel mirrors the footer's status and every toast.
  const guideStatusRef = useRef("")
  const toastSinkRef = useRef<(message: string) => void>(() => {})
  useEffect(() => {
    if (!toast) return
    toastSinkRef.current(toast)
    const id = window.setTimeout(() => setToast(""), VR_TOAST_SECONDS * 1000)
    return () => window.clearTimeout(id)
  }, [toast])

  useEffect(() => {
    let disposed = false
    const xr = navigator.xr

    if (xr) {
      for (const mode of sessionModes) {
        xr.isSessionSupported(mode).then(
          (supported) => {
            if (!disposed) {
              setSupport((current) => ({
                ...current,
                [mode]: supported ? "対応" : "非対応",
              }))
            }
          },
          () => {
            if (!disposed) {
              setSupport((current) => ({ ...current, [mode]: "確認エラー" }))
            }
          },
        )
      }
    }

    const container = containerRef.current!
    let renderer: THREE.WebGLRenderer

    try {
      renderer = new THREE.WebGLRenderer({ antialias: true })
    } catch {
      setRenderError(
        "WebGLを初期化できませんでした。ブラウザーの設定をご確認ください。",
      )
      return () => {
        disposed = true
      }
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(container.clientWidth, container.clientHeight)
    renderer.xr.enabled = true
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1
    container.appendChild(renderer.domElement)

    const theme = getComputedStyle(document.documentElement)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(theme.getPropertyValue("--scene-background").trim())

    const camera = new THREE.PerspectiveCamera(
      CAMERA_FOV,
      container.clientWidth / container.clientHeight,
      0.01,
      100,
    )
    camera.name = "MemoryCamera"
    camera.position.set(0, 1.5, 0)
    scene.add(camera)

    let cloudDome: CloudDome | null = null
    void loadCloudDome({
      scene,
      renderer,
      url: `${import.meta.env.BASE_URL}exports/cloud-dome-grid.glb`,
    }).then(
      (dome) => {
        if (disposed) {
          dome.dispose()
          return
        }
        cloudDome = dome
      },
      () => {
        if (!disposed) {
          setRenderError(
            "背景空間を読み込めませんでした。再読み込みしてください。",
          )
        }
      },
    )

    const geometry = new THREE.SphereGeometry(0.15, 64, 32)
    const bubbleColor = new THREE.Color(theme.getPropertyValue("--sphere").trim())
    type PhotoCover = {
      reveal: { value: number }
      startedAt: number | null
      loaded: boolean
    }
    const makeSphere = (position: THREE.Vector3, phase: number, key: string) => {
      const { material, paleMaterial, update: updateMaterial } = createMemoryMaterials(bubbleColor, key)
      const group = new THREE.Group()
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = "MemoryCore"
      const fusionMaterial = material.clone()
      fusionMaterial.onBeforeCompile = material.onBeforeCompile
      // Shared by hover membranes and the surrounding bubbles' return fusion.
      const fusion = new MarchingCubes(48, fusionMaterial, false, false, 20000)
      fusion.name = "MemoryFusion"
      fusion.scale.setScalar(0.36)
      fusion.visible = false
      group.position.copy(position)
      // Do not show or select an empty sphere while its photos are loading.
      group.visible = false
      group.add(mesh, fusion)
      scene.add(group)
      return {
        group,
        mesh,
        material,
        paleMaterial,
        updateMaterial,
        fusionMaterial,
        shellOpacity: material.opacity,
        membranes: null as BubbleMembranes | null,
        // Four resting previews; two more emerge while hovered or gazed at.
        satellites: [] as ReturnType<typeof createSphereSatellites>,
        fusion,
        phase,
        title: "",
        // Resting place; the group bobs around it and leans toward a hover.
        home: position.clone(),
        // 0 → 1 over HOVER_SECONDS while a pointer or controller ray rests on it.
        hover: 0,
        // Entry keeps the bubbles split without giving a touch tap hover feedback.
        dispersion: 0,
        bornAt: null as number | null,
        grow: 1,
        // Other memories step aside while one surrounds the viewer.
        presence: 1,
        // Photo shown inside the intact sphere.
        cover: null as PhotoCover | null,
        // One photo per photo fragment once the sphere opens into a ring.
        photos: [] as THREE.SpriteMaterial[],
        // Original photo URLs, aligned with `photos`, for the immersive screen.
        photoSources: [] as string[],
        // Title and photo count under the sphere, shown while it is hovered.
        label: null as THREE.Sprite | null,
        removed: false,
        // Turned toward the viewer when the sphere sits off to the side on another page.
        facing: 0,
      }
    }
    type Sphere = ReturnType<typeof makeSphere>
    const initialDirectories = ["assets-2", "assets-1", "assets-3"] as const
    const spheres: Sphere[] = [-0.6325, 0, 0.6325].map((x, index) =>
      makeSphere(new THREE.Vector3(x, 1.5, -1.5), index * 1.2, `builtin:${initialDirectories[index]}`),
    )
    const memoryLayout = createVRMemoryLayout()

    // Circular, soft-edged photo that grows outward as `reveal` goes 0 → 1.
    const applyPhotoMask = (
      material: THREE.SpriteMaterial,
      reveal: { value: number },
    ) => {
      material.onBeforeCompile = (shader) => {
        shader.uniforms.revealProgress = reveal
        shader.fragmentShader =
          "uniform float revealProgress;\n" +
          shader.fragmentShader.replace(
            "#include <map_fragment>",
            `
              #include <map_fragment>
              float radius = length((vMapUv - vec2(0.5)) * 2.0);
              float revealRadius = revealProgress * 1.08;
              float revealMask = 1.0 - smoothstep(
                revealRadius - 0.08, revealRadius, radius
              );
              diffuseColor.a *= revealMask *
                (1.0 - smoothstep(0.0, 1.0, radius));
            `,
          )
      }
    }
    const memoryTextures: THREE.Texture[] = []
    const memoryMaterials: THREE.SpriteMaterial[] = []
    const fullReveal = { value: 1 }
    // Center-crop to a square so the circular mask never stretches the photo.
    const loadSquareTexture = (src: string) =>
      new Promise<THREE.Texture>((resolve, reject) => {
        const img = new Image()
        // Stored photos come from Supabase Storage on another origin.
        img.crossOrigin = "anonymous"
        img.onload = () => {
          if (disposed) {
            reject(new Error("scene disposed"))
            return
          }
          const size = 512
          const canvas = document.createElement("canvas")
          canvas.width = canvas.height = size
          const side = Math.min(img.naturalWidth, img.naturalHeight)
          canvas
            .getContext("2d")!
            .drawImage(
              img,
              (img.naturalWidth - side) / 2,
              (img.naturalHeight - side) / 2,
              side,
              side,
              0,
              0,
              size,
              size,
            )
          const texture = new THREE.CanvasTexture(canvas)
          texture.colorSpace = THREE.SRGBColorSpace
          memoryTextures.push(texture)
          resolve(texture)
        }
        img.onerror = () => {
          reject(new Error("image load failed"))
        }
        img.src = src
      })
    const labelFont =
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans JP', sans-serif"
    const LABEL_HEIGHT = 0.12
    // Two lines: the title, then a detail such as how many photos the memory holds.
    const makeLabel = (title: string, detail: string) => {
      const name = title.length > 24 ? `${title.slice(0, 23)}…` : title
      const titleFont = `600 46px ${labelFont}`
      const detailFont = `400 32px ${labelFont}`
      const height = 148
      const canvas = document.createElement("canvas")
      const context = canvas.getContext("2d")!
      context.font = titleFont
      const titleWidth = context.measureText(name).width
      context.font = detailFont
      const detailWidth = context.measureText(detail).width
      // Resizing the canvas resets the context, so styles are set afterwards.
      canvas.width = Math.ceil(Math.max(titleWidth, detailWidth)) + 96
      canvas.height = height
      context.fillStyle = theme.getPropertyValue("--surface-glass").trim()
      context.strokeStyle = theme.getPropertyValue("--surface-border").trim()
      context.lineWidth = 2
      context.beginPath()
      context.roundRect(4, 4, canvas.width - 8, height - 8, 40)
      context.fill()
      context.stroke()
      context.textAlign = "center"
      context.textBaseline = "middle"
      context.font = titleFont
      context.fillStyle = theme.getPropertyValue("--ink").trim()
      context.fillText(name, canvas.width / 2, 56)
      context.font = detailFont
      context.fillStyle = theme.getPropertyValue("--muted").trim()
      context.fillText(detail, canvas.width / 2, 104)
      const texture = new THREE.CanvasTexture(canvas)
      texture.colorSpace = THREE.SRGBColorSpace
      const labelMaterial = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        // Read over the orbiting circles and neighbouring memories.
        depthTest: false,
        toneMapped: false,
      })
      memoryTextures.push(texture)
      memoryMaterials.push(labelMaterial)
      const label = new THREE.Sprite(labelMaterial)
      label.renderOrder = 100
      label.userData.width = LABEL_HEIGHT * (canvas.width / height)
      label.scale.set(label.userData.width, LABEL_HEIGHT, 1)
      label.visible = false
      scene.add(label)
      return label
    }
    // How far the overlapping bubbles reach from the sphere's center, so the
    // label sits below all of them.
    const clusterReach = (satellites: Sphere["satellites"]) =>
      satellites.reduce(
        (reach, satellite) => Math.max(reach, satellite.reach),
        0.15,
      )
    const loadSpherePhotos = (sphere: Sphere, urls: string[]) => {
      const uniqueUrls = [...new Set(urls)]
      const cover: PhotoCover = {
        reveal: { value: 0 },
        startedAt: null,
        loaded: false,
      }
      sphere.cover = cover
      void Promise.allSettled(uniqueUrls.map(loadSquareTexture)).then((results) => {
        if (disposed) return
        if (sphere.removed) {
          results.forEach((result) => { if (result.status === "fulfilled") result.value.dispose() })
          return
        }
        const loaded = results.flatMap((result, index) =>
          result.status === "fulfilled"
            ? [{ texture: result.value, src: uniqueUrls[index] }]
            : [],
        )
        if (loaded.length !== uniqueUrls.length) {
          setToast("一部の写真を読み込めませんでした。再読み込みしてください。")
        }
        if (!loaded.length) return
        const coverMaterial = new THREE.SpriteMaterial({
          map: loaded[0].texture,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        })
        applyPhotoMask(coverMaterial, cover.reveal)
        const coverSprite = new THREE.Sprite(coverMaterial)
        coverSprite.scale.set(0.29, 0.29, 1)
        coverSprite.renderOrder = -1
        sphere.mesh.add(coverSprite)
        sphere.photos = loaded.map(({ texture: map }) => {
          const material = new THREE.SpriteMaterial({
            map,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
          })
          applyPhotoMask(material, fullReveal)
          return material
        })
        sphere.photoSources = loaded.map(({ src }) => src)
        memoryMaterials.push(coverMaterial, ...sphere.photos)
        // Keep five resting bubbles and seven focused bubbles regardless of photo count.
        // All photos, including those without a preview here, still ride the ring.
        sphere.satellites = createSphereSatellites(
          geometry,
          sphere.material,
          sphere.photos.length - 1,
        )
        sphere.satellites.forEach(({ mesh, photoIndex }) => {
          if (photoIndex !== null) {
            const sprite = new THREE.Sprite(sphere.photos[photoIndex])
            sprite.scale.set(0.29, 0.29, 1)
            sprite.renderOrder = -1
            mesh.add(sprite)
          }
          sphere.group.add(mesh)
        })
        sphere.membranes = createBubbleMembranes(
          sphere.group,
          [sphere.mesh, ...sphere.satellites.map(({ mesh }) => mesh)],
          sphere.material,
          geometry.parameters.radius,
        )
        sphere.label = makeLabel(sphere.title, `${sphere.photos.length}枚の写真`)
        sphere.label.name = sphere.group.name.replace("MemoryCollection-", "MemoryLabel-")
        sphere.label.userData.reach = clusterReach(sphere.satellites)
        cover.loaded = true
      })
    }
    spheres.forEach((sphere, index) => {
      sphere.title = `記憶 ${String(index + 1).padStart(2, "0")}`
      sphere.group.name = `MemoryCollection-${initialDirectories[index]}`
      loadSpherePhotos(sphere, getSphereImageSources(initialDirectories[index]))
    })
    // New memories fill rows above the original three spheres.
    const slotX = [0, -0.6325, 0.6325, -1.265, 1.265]
    let memoryCount = 0
    addMemoryRef.current = ({ id, photos, title }, animate, place) => {
      const slot = place?.slot ?? memoryCount++
      const x = slotX[slot % slotX.length]
      const position = new THREE.Vector3(
        x,
        2.02 + Math.floor(slot / slotX.length) * 0.46,
        -1.5 - Math.abs(x) * 0.15,
      )
      // Own memories sit at eye level in the demo row's slots, facing the viewer from their page's direction.
      if (place) position.set(slotX[place.slot], 1.5, -1.5).applyAxisAngle(THREE.Object3D.DEFAULT_UP, ownPageYaw(place.page, place.pages))
      const sphere = makeSphere(position, slot * 0.9 + 0.4, `memory:${id}`)
      if (place) sphere.facing = ownPageYaw(place.page, place.pages)
      sphere.title = title || "記憶"
      sphere.group.name = `MemoryCollection-upload-${slot}`
      if (animate) {
        sphere.bornAt = elapsed
        sphere.grow = 0.001
        sphere.group.scale.setScalar(0.001)
      }
      spheres.push(sphere)
      loadSpherePhotos(sphere, photos)
    }
    // Paging own memories swaps the added spheres; the three demo spheres stay.
    clearMemoriesRef.current = () => {
      for (const sphere of spheres.splice(initialDirectories.length)) {
        sphere.removed = true
        if (hoveredSphere === sphere) hoveredSphere = null
        sphere.group.removeFromParent()
        sphere.label?.removeFromParent()
        sphere.label?.material.map?.dispose()
        sphere.label?.material.dispose()
        sphere.membranes?.dispose()
        sphere.fusion.geometry.dispose()
        for (const material of [sphere.material, sphere.fusionMaterial, sphere.paleMaterial, ...sphere.photos]) material.dispose()
        sphere.photos.forEach((photo) => photo.map?.dispose())
      }
      memoryCount = 0
    }
    let elapsed = 0
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()

    const tabTheme: TabTheme = {
      font: labelFont,
      primary: theme.getPropertyValue("--primary").trim(),
      onPrimary: theme.getPropertyValue("--surface").trim(),
      glass: theme.getPropertyValue("--surface-composer").trim(),
      ink: theme.getPropertyValue("--ink").trim(),
      border: theme.getPropertyValue("--surface-border").trim(),
    }
    // "戻る" in the ring layer waits just below the front photo, always facing
    // the viewer, so a VR ray can close the ring without picking a fragment first.
    const RING_BACK_DROP = 0.35
    const RING_BACK_AHEAD = 0.7
    const ringBackButton = createTabButton("戻る", "back", "secondary", tabTheme)
    ringBackButton.mesh.name = "MemoryRingTab-back"
    const ringBack = createTabBar([ringBackButton])
    scene.add(ringBack.group)
    // Every VR layer keeps a way out of the session below the other buttons.
    const EXIT_DROP = 0.65
    const exitButton = createTabButton("VRを終了", "exit", "secondary", tabTheme)
    exitButton.mesh.name = "MemoryVRTab-exit"
    const exitBar = createTabBar([exitButton])
    scene.add(exitBar.group)
    const immersion = createMemoryImmersion({
      scene,
      backdropColor: theme.getPropertyValue("--immersion-backdrop").trim(),
      tabTheme,
      maxTextureSize: renderer.capabilities.maxTextureSize,
    })
    const guide = createVRGuidePanel({
      scene,
      theme: {
        font: labelFont,
        ink: tabTheme.ink,
        muted: theme.getPropertyValue("--muted").trim(),
        glass: tabTheme.glass,
        border: tabTheme.border,
        toast: theme.getPropertyValue("--primary-hover").trim(),
        onToast: tabTheme.onPrimary,
      },
    })
    toastSinkRef.current = (message) => guide.notify(message)
    let ring: MemoryRing<Sphere> | null = null

    // Head pose: the XR camera while presenting, otherwise the web camera.
    const getHead = () =>
      renderer.xr.isPresenting ? renderer.xr.getCamera() : camera
    const viewerPosition = new THREE.Vector3()
    const viewerDirection = new THREE.Vector3()
    const readViewer = () => {
      const eye = getHead()
      eye.getWorldPosition(viewerPosition)
      eye.getWorldDirection(viewerDirection)
    }

    // Heading of a floating VR button around the viewer. Glances leave it put
    // so a ray can settle on it; turning well away swings it back in front.
    const followViewer = (bar: { group: THREE.Group }, drop: number) => {
      let yaw = 0
      let following = false
      return (delta: number, snap: boolean) => {
        // Looking almost straight down has no heading; keep the last one.
        if (Math.hypot(viewerDirection.x, viewerDirection.z) > 0.2) {
          const heading = Math.atan2(-viewerDirection.x, -viewerDirection.z)
          const turn = wrapAngle(heading - yaw)
          if (snap) {
            yaw = heading
            following = false
          } else {
            if (Math.abs(turn) > 0.6) following = true
            if (following) {
              yaw += turn * (1 - Math.exp(-delta * 6))
              if (Math.abs(turn) < 0.01) following = false
            }
          }
        }
        bar.group.position.set(
          viewerPosition.x - Math.sin(yaw) * RING_BACK_AHEAD,
          viewerPosition.y - drop,
          viewerPosition.z - Math.cos(yaw) * RING_BACK_AHEAD,
        )
      }
    }
    const placeRingBack = followViewer(ringBack, RING_BACK_DROP)
    const placeExit = followViewer(exitBar, EXIT_DROP)

    // Web (non-XR) navigation: drag to look around; in the space, WASD /
    // arrows, wheel or pinch walk inside the dome's walkable area.
    camera.rotation.order = "YXZ"
    const look = { yaw: 0, pitch: 0 }
    const walkRadius = 2.35
    const eyeHeight = camera.position.y

    // One press on a memory glides up to it and opens it around the viewer.
    const journey = createSphereJourney<Sphere>({
      readPose: () => ({
        position: camera.position,
        yaw: look.yaw,
        pitch: look.pitch,
      }),
      writePose: ({ position, yaw, pitch }) => {
        camera.position.copy(position)
        look.yaw = yaw
        look.pitch = pitch
      },
      prefersReducedMotion: () =>
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      walkRadius,
    })

    // The single source of truth for the current layer, shared by input and
    // the overlay. A ring is disposed the frame it reports "done".
    const currentMode = (): SceneMode => {
      if (journey.travelling) return "transition"
      if (immersion.status === "open") return "photo"
      if (immersion.status !== "closed") return "transition"
      if (ring) return ring.status === "open" ? "ring" : "transition"
      return "space"
    }

    let hoveredSphere: Sphere | null = null
    const hoverBounds = new THREE.Sphere()
    const hoverHit = new THREE.Vector3()
    type Pick =
      | { kind: "tab"; action: TabAction }
      | { kind: "fragment"; fragment: RingFragment }
      | { kind: "sphere"; sphere: Sphere; mesh: THREE.Object3D }
      | null
    const pick = (): Pick => {
      const mode = currentMode()
      if (mode === "transition") return null
      scene.updateMatrixWorld(true)
      if (exitBar.shown) {
        const exitHit = raycaster.intersectObjects(exitBar.targets(), false)[0]
        const exitAction = exitHit && exitBar.actionFor(exitHit.object)
        if (exitAction) return { kind: "tab", action: exitAction }
      }
      if (mode === "photo") {
        const hit = raycaster.intersectObjects(immersion.targets(), false)[0]
        const action = hit && immersion.actionFor(hit.object)
        return action ? { kind: "tab", action } : null
      }
      if (mode === "ring" && ring) {
        const tabHit = renderer.xr.isPresenting
          ? raycaster.intersectObjects(ringBack.targets(), false)[0]
          : undefined
        const action = tabHit && ringBack.actionFor(tabHit.object)
        if (action) return { kind: "tab", action }
        const hit = raycaster.intersectObjects(ring.targets(), false)[0]
        const fragment = hit && ring.fragmentFor(hit.object)
        return fragment ? { kind: "fragment", fragment } : null
      }
      const hit = raycaster.intersectObjects(
        spheres
          .filter((sphere) => sphere.group.visible)
          .flatMap((sphere) => [
            sphere.mesh,
            ...sphere.satellites.map(({ mesh }) => mesh),
          ].filter((mesh) => mesh.visible)),
        false,
      )[0]
      const sphere =
        hit &&
        spheres.find(
          (entry) =>
            entry.mesh === hit.object ||
            entry.satellites.some(({ mesh }) => mesh === hit.object),
        )
      if (sphere) return { kind: "sphere", sphere, mesh: hit.object }
      const membraneHit = raycaster.intersectObjects(
        spheres.filter(entry => entry.group.visible).flatMap(entry =>
          entry.membranes?.group.visible
            ? entry.membranes.group.children.filter(surface => surface.visible)
            : [],
        ),
        false,
      )[0]
      const joinedSphere = membraneHit && spheres.find(entry =>
        entry.membranes?.group === membraneHit.object.parent,
      )
      if (joinedSphere) return { kind: "sphere", sphere: joinedSphere, mesh: joinedSphere.mesh }
      // Hold focus across the gaps between dispersed bubbles, not just their surfaces.
      if (hoveredSphere?.group.visible) {
        hoveredSphere.group.getWorldPosition(hoverBounds.center)
        hoverBounds.radius = (hoveredSphere.label?.userData.reach ?? 0.15) * hoveredSphere.group.scale.x
        if (raycaster.ray.intersectSphere(hoverBounds, hoverHit)) {
          return { kind: "sphere", sphere: hoveredSphere, mesh: hoveredSphere.mesh }
        }
      }
      return null
    }

    const pickByGaze = (): Pick => {
      if (currentMode() !== "space" || memoryLayout.pending) return null
      raycaster.set(viewerPosition, viewerDirection)
      return pick()
    }

    const openRing = (sphere: Sphere, leadPhoto: number) => {
      if (ring) return
      // A click can interrupt a split; the ring must start with fully visible shells.
      sphere.material.opacity = sphere.shellOpacity
      sphere.fusionMaterial.opacity = sphere.shellOpacity
      sphere.membranes?.hide()
      readViewer()
      const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1.8
      ring = createMemoryRing({
        scene,
        sphere,
        geometry,
        material: sphere.material,
        paleMaterial: sphere.paleMaterial,
        center: viewerPosition,
        elapsed,
        leadPhoto,
        duration,
      })
      if (duration === 0) ring.update(elapsed, 0, viewerPosition)
    }

    // The picked circle's photo opens in front: the cover, or a satellite's.
    const leadPhotoFor = (sphere: Sphere, mesh: THREE.Object3D | null) => {
      return sphere.satellites.find((entry) => entry.mesh === mesh)?.photoIndex ?? 0
    }

    const enterMemory = (sphere: Sphere, mesh: THREE.Object3D) => {
      if (currentMode() !== "space") return
      const leadPhoto = leadPhotoFor(sphere, mesh)
      openRing(sphere, leadPhoto)
    }

    // The photo on the curved screen, as an index into the ring's memory.
    let viewing: number | null = null
    // Where the screen opened; "ahead" when the viewer looks straight down.
    let photoYaw = 0
    const updatePhotoNavigation = () => {
      if (!ring || viewing === null) return
      immersion.setNavigation(photoNavigation(viewing, ring.sphere.photos.length))
    }

    const enterImmersion = (fragment: RingFragment) => {
      if (currentMode() !== "ring" || !ring || fragment.photoIndex === null) {
        return
      }
      const photo = ring.sphere.photos[fragment.photoIndex]
      if (!photo?.map) return
      readViewer()
      ring.setHover(null)
      viewing = fragment.photoIndex
      photoYaw = Math.atan2(-viewerDirection.x, -viewerDirection.z)
      immersion.open({
        texture: photo.map,
        src: ring.sphere.photoSources[fragment.photoIndex],
        center: viewerPosition,
        yaw: photoYaw,
        pitch: Math.asin(THREE.MathUtils.clamp(viewerDirection.y, -1, 1)),
        elapsed,
      })
      updatePhotoNavigation()
    }

    // Previous or next photo of the same memory; never past the first or last.
    const showPhoto = (step: PhotoStep) => {
      if (currentMode() !== "photo" || !ring || viewing === null) return
      const index = adjacentPhoto(viewing, step, ring.sphere.photos.length)
      if (index === null) return
      const photo = ring.sphere.photos[index]
      if (!photo?.map) return
      viewing = index
      immersion.show({
        texture: photo.map,
        src: ring.sphere.photoSources[index],
        elapsed,
      })
      updatePhotoNavigation()
    }

    // One layer up: photo → ring → space. Mid-approach it calls the glide off
    // and heads home; every other transition (and the space) ignores it.
    const goBack = () => {
      const mode = currentMode()
      if (mode === "photo") {
        // The ring comes back with the last photo's fragment straight ahead.
        readViewer()
        const heading =
          Math.hypot(viewerDirection.x, viewerDirection.z) > 0.2
            ? Math.atan2(-viewerDirection.x, -viewerDirection.z)
            : photoYaw
        if (viewing !== null) ring?.face(viewing, heading, elapsed)
        immersion.close(elapsed)
      } else if (mode === "ring") ring?.close(elapsed)
      else if (journey.travelling === "approach") {
        ring?.close(elapsed)
        journey.returnHome()
      }
    }

    controlsRef.current = { back: goBack, step: showPhoto, turnTo: (yaw) => turnTo(yaw) }

    // One layer down. Empty space does nothing; every press is ignored mid-transition.
    const activate = (target: Pick) => {
      const mode = currentMode()
      if (mode === "transition" || !target) return
      if (target.kind === "tab") {
        if (target.action === "exit") void renderer.xr.getSession()?.end()
        else if (target.action === "back") goBack()
        else showPhoto(target.action === "next" ? 1 : -1)
      } else if (target.kind === "sphere") {
        if (mode === "space") enterMemory(target.sphere, target.mesh)
      } else if (mode === "ring") enterImmersion(target.fragment)
    }

    // The ring photo under the pointer, ray or gaze shows its memory's title and place in the ring.
    let hoveredFragment: RingFragment | null = null
    let fragmentLabel: { fragment: RingFragment; label: THREE.Sprite } | null = null
    const FRAGMENT_LABEL_SCALE = 1.3
    const disposeFragmentLabel = () => {
      if (!fragmentLabel) return
      const { label } = fragmentLabel
      label.removeFromParent()
      if (label.material.map) {
        memoryTextures.splice(memoryTextures.indexOf(label.material.map), 1)
        label.material.map.dispose()
      }
      memoryMaterials.splice(memoryMaterials.indexOf(label.material), 1)
      label.material.dispose()
      fragmentLabel = null
    }
    const updateFragmentLabel = () => {
      const shown = currentMode() === "ring" && ring?.status === "open" && hoveredFragment?.photoIndex != null
        ? hoveredFragment
        : null
      if (fragmentLabel?.fragment !== shown) {
        disposeFragmentLabel()
        if (shown && ring && shown.photoIndex !== null) {
          const label = makeLabel(ring.sphere.title, `写真 ${shown.photoIndex + 1}/${ring.sphere.photos.length}`)
          label.material.opacity = 1
          label.scale.set(label.userData.width * FRAGMENT_LABEL_SCALE, LABEL_HEIGHT * FRAGMENT_LABEL_SCALE, 1)
          label.visible = true
          fragmentLabel = { fragment: shown, label }
        }
      }
      if (!fragmentLabel) return
      const { mesh } = fragmentLabel.fragment
      fragmentLabel.label.position.copy(mesh.position)
      fragmentLabel.label.position.y -=
        geometry.parameters.radius * mesh.scale.x + 0.03 + (LABEL_HEIGHT * FRAGMENT_LABEL_SCALE) / 2
    }

    // Pointer, controller ray and head gaze share the same focus animation.
    const setHover = (target: Pick) => {
      const action = target?.kind === "tab" ? target.action : null
      hoveredSphere = target?.kind === "sphere" ? target.sphere : null
      hoveredFragment = target?.kind === "fragment" ? target.fragment : null
      ringBack.setHover(action)
      exitBar.setHover(action)
      immersion.setHover(action)
      ring?.setHover(target?.kind === "fragment" ? target.fragment : null)
    }

    const setPointerRay = (event: MouseEvent) => {
      const bounds = renderer.domElement.getBoundingClientRect()
      pointer.set(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
      )
      camera.updateMatrixWorld(true)
      raycaster.setFromCamera(pointer, camera)
    }

    const walkForward = new THREE.Vector3()
    const walkRight = new THREE.Vector3()
    const walk = (forwardAmount: number, sideAmount: number) => {
      // The ring and the curved screen are centered on the viewer, and
      // transitions own the camera; walking only works in the space.
      if (currentMode() !== "space") return
      walkForward.set(-Math.sin(look.yaw), 0, -Math.cos(look.yaw))
      walkRight.set(Math.cos(look.yaw), 0, -Math.sin(look.yaw))
      camera.position
        .addScaledVector(walkForward, forwardAmount)
        .addScaledVector(walkRight, sideAmount)
      const distance = Math.hypot(camera.position.x, camera.position.z)
      if (distance > walkRadius) {
        camera.position.x *= walkRadius / distance
        camera.position.z *= walkRadius / distance
      }
      camera.position.y = eyeHeight
    }
    // Dragging always looks around; mid-glide the turn carries into the glide.
    const lookAround = (yaw: number, pitch: number) => {
      if (journey.turn(yaw, pitch)) return
      look.yaw += yaw
      look.pitch = THREE.MathUtils.clamp(look.pitch + pitch, -1.2, 1.2)
    }
    const activePointers = new Map<number, { x: number; y: number }>()
    let dragDistance = 0
    // A press that starts mid-transition never activates, even if released after.
    let pressedInTransition = false
    // Where a one-finger gesture began, to tell a photo swipe from a look.
    let swipe: { x: number; y: number; at: number; yaw: number; pitch: number } | null = null
    // After a swipe the view eases back to where the gesture began.
    let lookSettle: { yaw: number; pitch: number } | null = null
    // Paging own memories turns the view slowly toward the next page's direction.
    let pageTurn: number | null = null
    const turnTo = (yaw: number) => {
      lookSettle = null
      const target = look.yaw + wrapAngle(yaw - look.yaw)
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        look.yaw = target
        look.pitch = 0
        pageTurn = null
      } else pageTurn = target
    }
    const pinchSpan = () => {
      const [a, b] = [...activePointers.values()]
      return Math.hypot(a.x - b.x, a.y - b.y)
    }
    let lastPinchSpan = 0

    const pointerDown = (event: PointerEvent) => {
      if (renderer.xr.isPresenting) return
      if (event.pointerType === "mouse" && event.button !== 0) return
      renderer.domElement.setPointerCapture(event.pointerId)
      activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (activePointers.size === 1) {
        dragDistance = 0
        pressedInTransition = currentMode() === "transition"
        swipe = {
          x: event.clientX,
          y: event.clientY,
          at: event.timeStamp,
          yaw: look.yaw,
          pitch: look.pitch,
        }
        lookSettle = null
        pageTurn = null
      }
      if (activePointers.size === 2) {
        lastPinchSpan = pinchSpan()
        swipe = null
      }
    }
    const pointerUp = (event: PointerEvent) => {
      activePointers.delete(event.pointerId)
      if (activePointers.size === 0 && dragDistance > 6) {
        renderer.domElement.style.cursor = "grab"
      }
      // On touch, a quick sideways flick in the photo layer steps photos
      // like a carousel; slower drags (and the mouse) only look around.
      if (
        event.type === "pointerup" &&
        event.pointerType !== "mouse" &&
        activePointers.size === 0 &&
        swipe &&
        currentMode() === "photo"
      ) {
        const step = swipeStep(
          event.clientX - swipe.x,
          event.clientY - swipe.y,
          event.timeStamp - swipe.at,
        )
        if (step) {
          lookSettle = { yaw: swipe.yaw, pitch: swipe.pitch }
          showPhoto(step)
        }
      }
      if (activePointers.size === 0) swipe = null
    }
    const click = (event: MouseEvent) => {
      if (renderer.xr.isPresenting) return
      if (pressedInTransition) return
      // A drag that looked around should not also pick a sphere.
      if (dragDistance > 6) return
      setPointerRay(event)
      activate(pick())
    }
    const pointerMove = (event: PointerEvent) => {
      if (renderer.xr.isPresenting) return
      const previous = activePointers.get(event.pointerId)
      if (previous) {
        const dx = event.clientX - previous.x
        const dy = event.clientY - previous.y
        previous.x = event.clientX
        previous.y = event.clientY
        dragDistance += Math.hypot(dx, dy)
        if (activePointers.size === 1) lookAround(dx * 0.004, dy * 0.004)
        else if (activePointers.size === 2) {
          const span = pinchSpan()
          walk((span - lastPinchSpan) * 0.01, 0)
          lastPinchSpan = span
        }
        if (dragDistance > 6) {
          renderer.domElement.style.cursor = "grabbing"
          return
        }
      }
      // Touch has no hover: a tap goes straight into the memory.
      if (event.pointerType === "touch") {
        setHover(null)
        return
      }
      if (currentMode() === "transition") {
        setHover(null)
        renderer.domElement.style.cursor = "grab"
        return
      }
      setPointerRay(event)
      const target = pick()
      setHover(target)
      renderer.domElement.style.cursor = target ? "pointer" : "grab"
    }
    const pointerLeave = () => {
      setHover(null)
      if (activePointers.size === 0) renderer.domElement.style.cursor = "default"
    }
    const wheel = (event: WheelEvent) => {
      if (renderer.xr.isPresenting) return
      event.preventDefault()
      const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1
      walk(THREE.MathUtils.clamp(-event.deltaY * lines * 0.002, -0.4, 0.4), 0)
    }
    const pressedKeys = new Set<string>()
    const walkKeys = new Set([
      "KeyW", "KeyA", "KeyS", "KeyD",
      "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    ])
    const keyDown = (event: KeyboardEvent) => {
      if (renderer.xr.isPresenting) return
      const target = event.target as HTMLElement | null
      if (
        target?.closest("input, textarea, select, [contenteditable='true']")
      ) {
        return
      }
      if (event.code === "Escape") {
        // Esc steps back one layer: photo → ring → space.
        goBack()
        return
      }
      const photoStep =
        event.code === "ArrowLeft" ? -1 : event.code === "ArrowRight" ? 1 : 0
      if (
        photoStep &&
        currentMode() === "photo" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault()
        // Holding an arrow key steps once rather than racing through.
        if (!event.repeat) showPhoto(photoStep)
        return
      }
      if (!walkKeys.has(event.code) || event.metaKey || event.ctrlKey) return
      event.preventDefault()
      pressedKeys.add(event.code)
    }
    const keyUp = (event: KeyboardEvent) => {
      pressedKeys.delete(event.code)
    }
    const clearKeys = () => pressedKeys.clear()
    const updateWebNavigation = (delta: number) => {
      if (document.querySelector("dialog[open]")) {
        clearKeys()
        return
      }
      const axis = (positive: string[], negative: string[]) =>
        Number(positive.some((code) => pressedKeys.has(code))) -
        Number(negative.some((code) => pressedKeys.has(code)))
      const forwardAxis = axis(["KeyW", "ArrowUp"], ["KeyS", "ArrowDown"])
      const sideAxis = axis(["KeyD", "ArrowRight"], ["KeyA", "ArrowLeft"])
      if (forwardAxis || sideAxis) {
        const step = (1.4 * delta) / Math.hypot(forwardAxis, sideAxis)
        walk(forwardAxis * step, sideAxis * step)
      }
      if (lookSettle) {
        const blend = 1 - Math.exp(-delta * 12)
        look.yaw += (lookSettle.yaw - look.yaw) * blend
        look.pitch += (lookSettle.pitch - look.pitch) * blend
        if (
          Math.abs(lookSettle.yaw - look.yaw) +
            Math.abs(lookSettle.pitch - look.pitch) <
          1e-4
        ) {
          lookSettle = null
        }
      }
      if (pageTurn !== null) {
        const blend = 1 - Math.exp(-delta * 4)
        look.yaw += (pageTurn - look.yaw) * blend
        look.pitch -= look.pitch * blend
        if (Math.abs(pageTurn - look.yaw) + Math.abs(look.pitch) < 1e-4) pageTurn = null
      }
      camera.rotation.set(look.pitch, look.yaw, 0)
    }
    renderer.domElement.addEventListener("pointerdown", pointerDown)
    renderer.domElement.addEventListener("pointerup", pointerUp)
    renderer.domElement.addEventListener("pointercancel", pointerUp)
    renderer.domElement.addEventListener("click", click)
    renderer.domElement.addEventListener("pointermove", pointerMove)
    renderer.domElement.addEventListener("pointerleave", pointerLeave)
    renderer.domElement.addEventListener("wheel", wheel, { passive: false })
    window.addEventListener("keydown", keyDown)
    window.addEventListener("keyup", keyUp)
    window.addEventListener("blur", clearKeys)

    const controllers = [
      renderer.xr.getController(0),
      renderer.xr.getController(1),
    ]
    const rayGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(0, 0, -3),
    ])
    const rayMaterial = new THREE.LineBasicMaterial({
      color: theme.getPropertyValue("--sphere").trim(),
      transparent: true,
      opacity: 0.4,
      // Stay visible over the immersion backdrop and floating tabs.
      depthTest: false,
    })
    // In the ring, pressing while a photo is aimed at or gazed at opens it at once;
    // a pinch (or trigger) held anywhere else and swept sideways turns the ring.
    let ringGrab: { controller: THREE.XRTargetRaySpace; angle: number } | null = null
    const rayAngle = (controller: THREE.XRTargetRaySpace) => {
      controller.updateWorldMatrix(true, false)
      raycaster.setFromXRController(controller)
      return Math.atan2(raycaster.ray.direction.z, raycaster.ray.direction.x)
    }
    const updateRingGrab = () => {
      if (!ringGrab) return
      if (currentMode() !== "ring" || !ring) {
        ringGrab = null
        return
      }
      const angle = rayAngle(ringGrab.controller)
      const turn = wrapAngle(angle - ringGrab.angle)
      ringGrab.angle = angle
      ring.spin(turn)
    }
    const controllerHandlers = controllers.map((controller) => {
      const select = () => {
        if (!renderer.xr.isPresenting || memoryLayout.pending) return
        controller.updateWorldMatrix(true, false)
        raycaster.setFromXRController(controller)
        const target = pick() ?? pickByGaze()
        if (currentMode() === "ring" && ring?.status === "open" && !target) {
          ringGrab = { controller, angle: rayAngle(controller) }
          return
        }
        activate(target)
      }
      const release = () => {
        if (ringGrab?.controller === controller) ringGrab = null
      }
      const ray = new THREE.Line(rayGeometry, rayMaterial)
      ray.renderOrder = 200
      controller.add(ray)
      controller.addEventListener("selectstart", select)
      controller.addEventListener("selectend", release)
      scene.add(controller)
      return { select, release }
    })

    // In the photo layer, tilting a controller's thumbstick left or right
    // steps one photo per tilt.
    const sticks = new WeakMap<XRInputSource, ReturnType<typeof createStickStepper>>()
    const readSticks = () => {
      const session = renderer.xr.getSession()
      if (!session) return
      for (const source of session.inputSources) {
        const axes = source.gamepad?.axes
        if (!axes?.length) continue
        // xr-standard puts the thumbstick on axes 2–3; touchpad-only
        // controllers report on 0–1.
        const x = axes.length >= 4 ? axes[2] : axes[0]
        let stepper = sticks.get(source)
        if (!stepper) {
          stepper = createStickStepper()
          sticks.set(source, stepper)
        }
        // Read every frame so a tilt held while entering does not step.
        const step = stepper(x)
        if (step && currentMode() === "photo") showPhoto(step)
      }
    }

    const vrButton = VRButton.createButton(renderer)
    const stopLocalizingVRButton = localizeVRButton(vrButton)
    ;(vrSlotRef.current ?? container).appendChild(vrButton)

    const resize = () => {
      const { clientWidth: width, clientHeight: height } = container
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)

    // Entering or leaving VR starts over in the space. The ring and the
    // curved screen surround the previous viewpoint, so they close at once
    // before the view resets; a glide in progress is settled the same way.
    const closeLayers = () => {
      // A key or gesture held before VR must not move the restored web view.
      clearKeys()
      activePointers.clear()
      swipe = null
      lookSettle = null
      ringGrab = null
      setHover(null)
      disposeFragmentLabel()
      immersion.reset()
      if (ring) ring.sphere.paleMaterial.opacity = ring.sphere.material.opacity
      ring?.dispose()
      ring = null
      viewing = null
      ringBack.hide(true)
      exitBar.hide(true)
    }
    // The web view to come back to after VR.
    let webView: { position: THREE.Vector3; yaw: number; pitch: number } | null = null
    const sessionStart = () => {
      closeLayers()
      journey.reset()
      webView = { position: camera.position.clone(), yaw: look.yaw, pitch: look.pitch }
      memoryLayout.begin()
      // Shader compilation can delay the next frame; hide the stale Web layout now.
      spheres.forEach((sphere) => {
        sphere.group.visible = false
        if (sphere.label) sphere.label.visible = false
      })
      setPresenting(true)
      setDragging(false)
      guide.snap()
    }
    const sessionEnd = () => {
      closeLayers()
      journey.reset()
      memoryLayout.reset()
      setPresenting(false)
      // three.js leaves the last head pose and the headset's lens on the
      // web camera; put back the view from before VR.
      if (webView) {
        camera.position.copy(webView.position)
        look.yaw = webView.yaw
        look.pitch = webView.pitch
        webView = null
      }
      lookSettle = null
      camera.rotation.set(look.pitch, look.yaw, 0)
      camera.fov = CAMERA_FOV
      camera.zoom = 1
      resize()
    }
    renderer.xr.addEventListener("sessionstart", sessionStart)
    renderer.xr.addEventListener("sessionend", sessionEnd)

    let previousTime: number | null = null
    let reportedView = ""
    const HOVER_SECONDS = 0.85
    const toViewer = new THREE.Vector3()
    const viewerOrientation = new THREE.Quaternion()
    // Controller rays hover like the mouse; the first ray on a target wins.
    const pickByControllers = (): Pick => {
      for (const controller of controllers) {
        // Untracked controllers keep a stale pose; only aim with tracked ones.
        if (!controller.visible) continue
        controller.updateWorldMatrix(true, false)
        raycaster.setFromXRController(controller)
        const target = pick()
        if (target) return target
      }
      return null
    }
    renderer.setAnimationLoop((time, frame) => {
      const delta =
        previousTime === null ? 0 : Math.min((time - previousTime) / 1000, 0.1)
      previousTime = time
      elapsed += delta
      // Glide first so the camera pose and any newly opened ring apply this frame.
      journey.update(delta)
      if (renderer.xr.isPresenting) readSticks()
      else updateWebNavigation(delta)
      cloudDome?.update(delta)
      readViewer()
      if (renderer.xr.isPresenting && memoryLayout.pending) {
        const referenceSpace = renderer.xr.getReferenceSpace()
        // sessionstart precedes tracking; never anchor to the stale web camera.
        const pose = frame && referenceSpace ? frame.getViewerPose(referenceSpace) : null
        if (pose) {
          const { position, orientation } = pose.transform
          viewerPosition.set(position.x, position.y, position.z)
          viewerOrientation.set(orientation.x, orientation.y, orientation.z, orientation.w)
          memoryLayout.capture(viewerPosition, viewerOrientation)
          guide.snap()
        }
      }
      const focus = ring?.sphere ?? journey.approaching
      spheres.forEach((sphere) => {
        sphere.updateMaterial(elapsed)
        sphere.hover = THREE.MathUtils.clamp(
          sphere.hover + (sphere === hoveredSphere ? delta : -delta) / HOVER_SECONDS,
          0,
          1,
        )
        sphere.dispersion = THREE.MathUtils.clamp(
          sphere.dispersion + (sphere === hoveredSphere || sphere === journey.approaching ? delta : -delta) / HOVER_SECONDS,
          0,
          1,
        )
        const lean = THREE.MathUtils.smoothstep(sphere.hover, 0, 1)
        const phases = bubbleFocusPhases(sphere.dispersion)
        memoryLayout.position(sphere.home, sphere.group.position)
        sphere.group.position.y += Math.sin(elapsed * 0.42 + sphere.phase) * 0.052
          + Math.sin(elapsed * 0.19 + sphere.phase * 1.7) * 0.012
        const wobble = 1 + Math.sin(elapsed * 0.7 + sphere.phase) * 0.012
        const coreSize = phases.coreScale
        sphere.mesh.scale.set(coreSize * wobble, coreSize / wobble, coreSize)
        if (lean > 0) {
          // Lean 5cm toward the viewer while hovered.
          toViewer.subVectors(viewerPosition, sphere.group.position).normalize()
          sphere.group.position.addScaledVector(toViewer, 0.05 * lean)
        }
        if (sphere.bornAt !== null) {
          // A new memory pops in once it has photos to show.
          if (!sphere.cover?.loaded) sphere.bornAt = elapsed
          const t = Math.min((elapsed - sphere.bornAt) / 0.9, 1)
          // Ease-out-back so a new memory "pops" into the space.
          const c = 1.70158
          const grow = 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2)
          sphere.grow = Math.max(0.001, grow)
          if (t === 1) sphere.bornAt = null
        }
        const present = !focus || focus === sphere ? 1 : 0
        sphere.presence += (present - sphere.presence) * (1 - Math.exp(-delta * 5))
        const size = sphere.grow * sphere.presence
        sphere.group.scale.setScalar(Math.max(0.001, size * (1 + 0.08 * lean)))
        sphere.group.visible =
          !memoryLayout.pending && sphere.cover?.loaded === true && sphere.presence > 0.01
        // A gentle sway preserves the asymmetric cluster instead of turning it edge-on.
        sphere.group.rotation.set(
          Math.sin(elapsed * 0.22 + sphere.phase) * 0.035,
          sphere.facing + memoryLayout.yaw + Math.sin(elapsed * 0.18 + sphere.phase) * 0.055,
          Math.sin(elapsed * 0.2 + sphere.phase) * 0.025,
        )
        if (sphere.label) {
          const { label } = sphere
          label.material.opacity = lean
          label.visible = sphere.group.visible && lean > 0.001 && !ring
          label.position.set(
            sphere.group.position.x,
            sphere.group.position.y -
              label.userData.reach * sphere.group.scale.x -
              (0.03 + LABEL_HEIGHT / 2) * size,
            sphere.group.position.z,
          )
          label.scale.set(label.userData.width * size, LABEL_HEIGHT * size, 1)
        }
        // Preview bubbles drift out and fold away while all photos ride the ring.
        const openness = ring?.sphere === sphere ? ring.openness : 0
        updateSphereSatellites(sphere.satellites, elapsed, openness, sphere.dispersion)
        if (openness > 0) {
          const fold = Math.max(0.001, 1 - openness)
          sphere.satellites.forEach(({ mesh }) => mesh.scale.multiplyScalar(fold))
        }
        if (ring?.sphere === sphere) {
          sphere.satellites.forEach(({ mesh }) => { mesh.visible = false })
        }
        // Overlap, not animation progress, decides whether bubbles share a film.
        const inRing = ring?.sphere === sphere
        if (inRing || !sphere.group.visible) sphere.membranes?.hide()
        else sphere.membranes?.update(elapsed)
        if (!inRing) {
          sphere.fusion.visible = false
        }
      })
      if (ring) {
        ring.update(elapsed, delta, viewerPosition)
        ring.sphere.paleMaterial.opacity = ring.sphere.material.opacity * (1 - 0.62 * ring.openness)
        if (ring.status === "done") {
          const restored = ring.sphere
          ring.dispose()
          ring = null
          restored.membranes?.update(elapsed)
          viewing = null
          journey.returnHome()
        }
      }
      const mode = currentMode()
      if (mode === "ring" && renderer.xr.isPresenting) {
        // Snaps in front on arrival, then follows the viewer around.
        placeRingBack(delta, !ringBack.shown)
        ringBack.show()
      } else if (ringBack.shown) {
        ringBack.hide()
      }
      if (renderer.xr.isPresenting && !memoryLayout.pending) {
        placeExit(delta, !exitBar.shown)
        exitBar.show()
      } else if (exitBar.shown) {
        exitBar.hide()
      }
      if (renderer.xr.isPresenting) updateRingGrab()
      if (mode === "transition") setHover(null)
      else if (renderer.xr.isPresenting) setHover(pickByControllers() ?? pickByGaze())
      updateFragmentLabel()
      ringBack.update(delta, viewerPosition)
      exitBar.update(delta, viewerPosition)
      immersion.update(elapsed, delta, viewerPosition, renderer.xr.isPresenting)
      const subject = ring?.sphere ?? journey.approaching
      // The breadcrumb follows the viewer's choice: it moves on the press
      // that heads into a memory or photo, and on the 戻る that leaves it.
      const place: ScenePlace =
        immersion.status === "opening" || immersion.status === "open"
          ? "photo"
          : journey.travelling === "approach" ||
              ring?.status === "flowing" ||
              ring?.status === "open"
            ? "memory"
            : "space"
      const next: SceneView = {
        mode,
        place,
        approaching: journey.travelling === "approach",
        title: subject?.title ?? "",
        photoCount: subject?.photos.length ?? 0,
        photoIndex: viewing,
      }
      const viewKey = JSON.stringify(next)
      if (viewKey !== reportedView) {
        reportedView = viewKey
        setView(next)
      }
      if (renderer.xr.isPresenting) {
        guide.setContent(vrGuide(next, guideStatusRef.current))
      }
      guide.update(delta, renderer.xr.isPresenting && !memoryLayout.pending, viewerPosition, viewerDirection)
      // Reveal from the center on first load and whenever the photo returns.
      spheres.forEach((sphere) => {
        const { cover } = sphere
        if (!cover) return
        if (cover.loaded && ring?.sphere !== sphere) {
          cover.startedAt ??= elapsed
          const progress = Math.min((elapsed - cover.startedAt) / 0.8, 1)
          cover.reveal.value = progress * progress * (3 - 2 * progress)
        } else {
          cover.startedAt = null
          cover.reveal.value = 0
        }
      })
      renderer.render(scene, camera)
    })

    // Restore memories already known to React (StrictMode remount, HMR).
    memoriesRef.current
      .slice()
      .reverse()
      .forEach((memory) => addMemoryRef.current(memory, false, memoryPlacesRef.current.get(memory.id)))

    return () => {
      disposed = true
      addMemoryRef.current = () => {}
      clearMemoriesRef.current = () => {}
      toastSinkRef.current = () => {}
      controlsRef.current = null
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener("pointerdown", pointerDown)
      renderer.domElement.removeEventListener("pointerup", pointerUp)
      renderer.domElement.removeEventListener("pointercancel", pointerUp)
      renderer.domElement.removeEventListener("click", click)
      renderer.domElement.removeEventListener("pointermove", pointerMove)
      renderer.domElement.removeEventListener("pointerleave", pointerLeave)
      renderer.domElement.removeEventListener("wheel", wheel)
      window.removeEventListener("keydown", keyDown)
      window.removeEventListener("keyup", keyUp)
      window.removeEventListener("blur", clearKeys)
      renderer.setAnimationLoop(null)
      renderer.xr.removeEventListener("sessionstart", sessionStart)
      renderer.xr.removeEventListener("sessionend", sessionEnd)
      controllers.forEach((controller, index) => {
        controller.removeEventListener("selectstart", controllerHandlers[index].select)
        controller.removeEventListener("selectend", controllerHandlers[index].release)
      })
      const session = renderer.xr.getSession()
      if (session) void session.end().catch(() => {})
      ring?.dispose()
      journey.dispose()
      ringBack.dispose()
      exitBar.dispose()
      immersion.dispose()
      guide.dispose()
      geometry.dispose()
      // Sprites share one geometry; dispose it once.
      const sprite = spheres
        .flatMap((sphere) => sphere.mesh.children)
        .find((child): child is THREE.Sprite => child instanceof THREE.Sprite)
      sprite?.geometry.dispose()
      spheres.forEach((sphere) => {
        sphere.membranes?.dispose()
        sphere.fusion.geometry.dispose()
        sphere.material.dispose()
        sphere.fusionMaterial.dispose()
        sphere.paleMaterial.dispose()
      })
      rayGeometry.dispose()
      rayMaterial.dispose()
      cloudDome?.dispose()
      memoryTextures.forEach((texture) => texture.dispose())
      memoryMaterials.forEach((material) => material.dispose())
      renderer.dispose()
      renderer.domElement.remove()
      stopLocalizingVRButton()
      vrButton.remove()
    }
  }, [])

  const addMemory = (memory: Memory, animate: boolean, place?: MemoryPlace) => {
    memoriesRef.current = [memory, ...memoriesRef.current]
    addMemoryRef.current(memory, animate, place)
  }

  // The preserved demo uses bundled photos; no legacy backend polling.
  useEffect(() => { setSyncStatus("ready") }, [])

  // Memories the viewer published from the place tab join the demo spheres, one page at a time.
  const [ownPage, setOwnPage] = useState(0)
  const [ownPages, setOwnPages] = useState(1)
  const [ownLoading, setOwnLoading] = useState(false)
  useEffect(() => {
    if (!personal) return
    let cancelled = false
    setOwnLoading(true)
    // Page 1 is the demo row. Page 2 repeats the demo folders in the same slots
    // (center, left, right) with a different cover; own memories follow, three per page.
    const demoPage: Memory[] = (["assets-1", "assets-2", "assets-3"] as const).map((directory, slot) => {
      const photos = getSphereImageSources(directory)
      const cover = Math.floor(photos.length / 2)
      return {
        id: `demo-${directory}-page-2`,
        title: `記憶 ${String([5, 4, 6][slot]).padStart(2, "0")}`,
        photos: [...photos.slice(cover), ...photos.slice(0, cover)],
        createdAt: "",
      }
    })
    const placePages = (pages: Memory[][]) => {
      clearMemoriesRef.current()
      memoriesRef.current = []
      memoryPlacesRef.current.clear()
      pages.forEach((memories, page) => memories.forEach((memory, slot) => {
        const place = { page: page + 1, slot, pages: pages.length + 1 }
        memoryPlacesRef.current.set(memory.id, place)
        addMemory(memory, false, place)
      }))
      setOwnPages(pages.length + 1)
    }
    void (async () => {
      const pages: Memory[][] = [demoPage]
      try {
        // Every page is placed at once so VR can show them all around the viewer.
        const { findOwnMemories } = await import("./placeMemoriesApi")
        for (let page = 0; ; page++) {
          const { memories, hasMore } = await findOwnMemories(page, 3)
          if (cancelled) return
          if (memories.length) pages.push(memories.map(({ id, title, photos, createdAt }) => ({ id, title, photos, createdAt })))
          if (!hasMore) break
        }
        setSyncStatus("ready")
      } catch (error) {
        console.error("Failed to load own memories", error)
        if (!cancelled) setSyncStatus("error")
      } finally {
        if (!cancelled) {
          placePages(pages)
          setOwnLoading(false)
        }
      }
    })()
    return () => { cancelled = true }
  }, [personal])
  const showOwnPage = (page: number) => {
    setOwnPage(page)
    controlsRef.current?.turnTo(ownPageYaw(page, ownPages))
  }

  const addFiles = (list: FileList | null) => {
    if (publishingRef.current || !list?.length) return
    const result = appendDraftFiles(draft?.files ?? [], Array.from(list))
    if (!draft && !result.files.length) {
      if (result.notice) setToast(result.notice)
      return
    }
    setDraft({
      id: draft?.id ?? crypto.randomUUID(),
      title: draft?.title ?? "",
      ...result,
    })
    setPublishError("")
  }
  const closeDraft = () => {
    setDraft(null)
    setPublishError("")
    window.requestAnimationFrame(() => composerRef.current?.focus())
  }
  const publishDraft = async () => {
    if (!draft?.files.length || publishingRef.current) return
    publishingRef.current = true
    setSavingCount(1)
    setPublishError("")
    const title = draft.title.trim()
    try {
      const blobs = await Promise.all(draft.files.map((file) => shrinkPhoto(file)))
      const saved = await saveMemory(draft.id, title, blobs)
      // A draft never enters the shared scene until publication succeeds.
      if (!memoriesRef.current.some(({ id }) => id === saved.id)) addMemory(saved, true)
      closeDraft()
      setToast(`${title ? `「${title}」` : `${draft.files.length}枚の写真`}をみんなの空間に公開しました`)
    } catch (error) {
      console.error("Failed to publish memory", error)
      setPublishError(error instanceof Error ? error.message : "公開できませんでした。写真とタイトルは残っています。")
    } finally {
      publishingRef.current = false
      setSavingCount(0)
    }
  }
  const openPicker = () => fileInputRef.current?.click()
  const [dragging, setDragging] = useState(false)
  const vrReady = support["immersive-vr"] === "対応"
  const footStatus =
    renderError ||
    (savingCount > 0
      ? "みんなの空間に保存しています…"
      : syncStatus === "loading"
        ? "みんなの思い出を読み込んでいます…"
        : syncStatus === "error"
          ? "思い出を読み込めませんでした。時間をおいて再読み込みしてください"
          : "")
  useEffect(() => {
    guideStatusRef.current = footStatus
  }, [footStatus])

  return (
    <div
      className="app"
      data-mode={view.mode}
      data-presenting={presenting}
      onDragOver={(event) => {
        event.preventDefault()
        if (!personal && !presenting && view.mode === "space" && event.dataTransfer.types.includes("Files")) setDragging(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false)
      }}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        if (!personal && !presenting && view.mode === "space") addFiles(event.dataTransfer.files)
      }}
    >
      <div ref={containerRef} className="xr-canvas" />
      <div className="web-ui" inert={presenting} aria-hidden={presenting}>
      <SphereControls
        view={view}
        onBack={() => controlsRef.current?.back()}
        onStep={(step) => controlsRef.current?.step(step)}
      />

      <header className="ov-top">
        <span className="ov-brand">
          <img
            className="ov-logo"
            src="/brand/memoria-logo.png"
            alt="memoria"
            width={1972}
            height={468}
          />
        </span>
        <SceneBreadcrumb view={view} />
        <span className="ov-chip" data-on={vrReady}>
          <span aria-hidden="true" />
          {personal && "貴方の思い出 · "}
          {vrReady ? "VR対応" : `VR ${support["immersive-vr"]}`}
        </span>
      </header>

      <p
        className="ov-immersion-hint"
        role="status"
        aria-hidden={view.mode !== "photo"}
      >
        {PHOTO_GUIDE}
      </p>

      <div className={personal ? "ov-dock place-dock" : "ov-dock"} inert={view.mode !== "space"}>
        <div className="ov-row">
        {personal ? <div className="ov-composer place-gallery-controls">
          <button className="ov-pill" disabled={ownLoading || ownPage === 0} onClick={() => showOwnPage(ownPage - 1)}>前へ</button>
          <span className="place-prompt">自分の思い出 · {ownPage + 1}ページ</span>
          <button className="ov-pill" disabled={ownLoading || ownPage >= ownPages - 1} onClick={() => showOwnPage(ownPage + 1)}>次へ</button>
        </div> : <div className="ov-composer">
          <ActionButton className="ov-icon" onClick={openPicker} aria-label="写真を選んで記憶をつくる">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </ActionButton>
          <ActionButton className="ov-composer-prompt" onClick={openPicker}>
            写真から、記憶をつくる
          </ActionButton>
          <ActionButton ref={composerRef} className="ov-pill" onClick={openPicker}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <circle cx="8" cy="8" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
            写真を選ぶ
          </ActionButton>
        </div>}
        <div ref={vrSlotRef} className="ov-vr" data-ready={vrReady} />
        </div>
        <p className="ov-foot">
          {footStatus || (personal ? "このブラウザーで残した思い出 · 泡を押して写真を見る" : SPACE_GUIDE)}
        </p>
      </div>

      {dragging && <div className="ov-dropveil">ここにドロップして、公開前に写真を確認</div>}

      {draft && <MemoryDraftDialog
        draft={draft}
        publishing={savingCount > 0}
        error={publishError}
        onTitleChange={(title) => setDraft((current) => current && { ...current, title })}
        onRemove={(index) => {
          setDraft((current) => current && { ...current, files: current.files.filter((_, i) => i !== index), notice: "" })
          setPublishError("")
        }}
        onAdd={openPicker}
        onPublish={() => void publishDraft()}
        onDiscard={closeDraft}
        onDrop={addFiles}
      />}

      {createElement("input", {
        ref: fileInputRef,
        type: "file",
        accept: PHOTO_ACCEPT,
        multiple: true,
        hidden: true,
        onChange: (event: ChangeEvent<HTMLInputElement>) => {
          addFiles(event.target.files)
          event.target.value = ""
        },
      })}
      {toast && (
        <div className="xr-toast" role="status">
          {toast}
        </div>
      )}
      </div>
    </div>
  )
}
