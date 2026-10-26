import {
  AmbientLight,
  AnimationMixer,
  CubeCamera,
  DirectionalLight,
  Group,
  HalfFloatType,
  HemisphereLight,
  LinearMipmapLinearFilter,
  WebGLCubeRenderTarget,
} from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"

/**
 * Optional Three.js integration. The GLBs themselves work without this helper.
 * Call update(deltaSeconds) in your existing render loop and dispose() on exit.
 */
export async function loadCloudDome({
  scene,
  renderer,
  url = new URL("./cloud-dome.glb", import.meta.url).href,
  daylight = true,
  reflections = true,
}) {
  const gltf = await new GLTFLoader().loadAsync(url)
  const root = gltf.scene
  scene.add(root)
  const water = root.getObjectByName("Shallow_Water")
  water.renderOrder = 2
  water.material.depthWrite = false
  const grid = root.getObjectByName("Floor_Grid")
  if (grid) {
    grid.material.depthWrite = false
    grid.material.polygonOffset = true
    grid.material.polygonOffsetFactor = -1
    grid.material.polygonOffsetUnits = -1
  }
  const domeGrid = root.getObjectByName("Dome_Grid")
  if (domeGrid) domeGrid.material.depthWrite = false
  const mixer = new AnimationMixer(root)
  for (const clip of gltf.animations) mixer.clipAction(clip).play()

  if (daylight) {
    const lights = new Group()
    lights.name = "Optional_Daylight"
    lights.add(new AmbientLight("#ffffff", 1.1))
    lights.add(new HemisphereLight("#ffffff", "#e7edf4", 1.15))
    const sun = new DirectionalLight("#fffdf6", 2.8)
    sun.position.set(-3.2, 5.4, 2.6)
    const fill = new DirectionalLight("#edf4ff", 0.45)
    fill.position.set(2.5, 2, -3)
    lights.add(sun, sun.target, fill, fill.target)
    root.add(lights)
  }
  let reflectionTarget
  let probe
  if (reflections) {
    reflectionTarget = new WebGLCubeRenderTarget(128, {
      type: HalfFloatType,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
    })
    probe = new CubeCamera(0.04, 20, reflectionTarget)
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
    mixer,
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
      const textures = new Set()
      const materials = new Set()
      const geometries = new Set()
      root.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry)
        if (object.material) materials.add(object.material)
      })
      for (const material of materials) {
        for (const value of Object.values(material)) {
          if (value?.isTexture) textures.add(value)
        }
        material.dispose()
      }
      for (const texture of textures) texture.dispose()
      for (const geometry of geometries) geometry.dispose()
      reflectionTarget?.dispose()
    },
  }
}
