import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"

// TypeScript port of public/exports/cloud-dome-three.js.
export type CloudDome = {
  root: THREE.Group
  update: (delta: number) => void
  dispose: () => void
}

type WaterMaterial = THREE.MeshPhysicalMaterial

export async function loadCloudDome({
  scene,
  renderer,
  url,
  daylight = true,
  reflections = true,
}: {
  scene: THREE.Scene
  renderer: THREE.WebGLRenderer
  url: string
  daylight?: boolean
  reflections?: boolean
}): Promise<CloudDome> {
  const gltf = await new GLTFLoader().loadAsync(url)
  const root = gltf.scene
  scene.add(root)

  const theme = getComputedStyle(document.documentElement)
  const dome = root.getObjectByName("Dome_And_Shallow_Bed") as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshStandardMaterial
  > | undefined
  if (dome) {
    dome.material.color.set(theme.getPropertyValue("--space-dome").trim())
    // This is a backdrop, not a wall that can clip a viewer-centered bubble cloud.
    dome.material.depthWrite = false
  }

  const water = root.getObjectByName("Shallow_Water") as THREE.Mesh<
    THREE.BufferGeometry,
    WaterMaterial
  >
  water.material.color.set(theme.getPropertyValue("--space-water").trim())
  water.renderOrder = 2
  water.material.depthWrite = false
  const grid = root.getObjectByName("Floor_Grid") as THREE.Mesh | undefined
  if (grid) {
    const gridMaterial = grid.material as THREE.MeshStandardMaterial
    gridMaterial.color.set(theme.getPropertyValue("--space-dome").trim())
    gridMaterial.depthWrite = false
    gridMaterial.polygonOffset = true
    gridMaterial.polygonOffsetFactor = -1
    gridMaterial.polygonOffsetUnits = -1
  }
  const domeGrid = root.getObjectByName("Dome_Grid") as THREE.Mesh | undefined
  if (domeGrid) {
    const gridMaterial = domeGrid.material as THREE.MeshStandardMaterial
    gridMaterial.color.set(theme.getPropertyValue("--space-grid").trim())
    gridMaterial.depthWrite = false
  }

  const mixer = new THREE.AnimationMixer(root)
  for (const clip of gltf.animations) mixer.clipAction(clip).play()

  if (daylight) {
    const lights = new THREE.Group()
    lights.name = "Optional_Daylight"
    const white = theme.getPropertyValue("--surface").trim()
    const lavender = theme.getPropertyValue("--space-light").trim()
    lights.add(new THREE.AmbientLight(white, 1.1))
    lights.add(new THREE.HemisphereLight(white, lavender, 1.15))
    const sun = new THREE.DirectionalLight(white, 2.8)
    sun.position.set(-3.2, 5.4, 2.6)
    const fill = new THREE.DirectionalLight(lavender, 0.45)
    fill.position.set(2.5, 2, -3)
    lights.add(sun, sun.target, fill, fill.target)
    root.add(lights)
  }

  let reflectionTarget: THREE.WebGLCubeRenderTarget | undefined
  let probe: THREE.CubeCamera | undefined
  if (reflections) {
    reflectionTarget = new THREE.WebGLCubeRenderTarget(128, {
      type: THREE.HalfFloatType,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
    })
    probe = new THREE.CubeCamera(0.04, 20, reflectionTarget)
    probe.position.set(0, 0.08, 0)
    root.add(probe)
    water.material.envMap = reflectionTarget.texture
    water.material.envMapIntensity = 1.1
    water.material.needsUpdate = true
  }

  let elapsed = 0
  let nextCapture = 0
  return {
    root,
    update(delta) {
      const step = Math.max(0, Math.min(delta, 0.05))
      elapsed += step
      mixer.update(step)
      for (const texture of new Set([
        water.material.normalMap,
        water.material.clearcoatNormalMap,
      ])) {
        if (!texture) continue
        const offset = texture.offset
        offset.x = (offset.x + step * 0.004) % 1
        offset.y = (offset.y + step * 0.006) % 1
      }
      if (!probe || elapsed < nextCapture) return
      const visible = water.visible
      water.visible = false
      try {
        root.updateWorldMatrix(true, true)
        probe.update(renderer, scene)
      } finally {
        water.visible = visible
      }
      nextCapture = elapsed + (renderer.xr.isPresenting ? 1.5 : 0.75)
    },
    dispose() {
      mixer.stopAllAction()
      mixer.uncacheRoot(root)
      root.removeFromParent()
      const textures = new Set<THREE.Texture>()
      const materials = new Set<THREE.Material>()
      const geometries = new Set<THREE.BufferGeometry>()
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        geometries.add(object.geometry)
        for (const material of [object.material].flat()) materials.add(material)
      })
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) textures.add(value)
        }
        material.dispose()
      }
      for (const texture of textures) texture.dispose()
      for (const geometry of geometries) geometry.dispose()
      reflectionTarget?.dispose()
    },
  }
}
