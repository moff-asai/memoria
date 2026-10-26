import * as THREE from "three"
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js"
import { createMemoryMaterials } from "./memoryMaterial.ts"
import { createBubbleMembranes } from "./bubbleMembranes.ts"
import { bubbleFocusPhases, createSphereSatellites, updateSphereSatellites } from "./sphereSatellites.ts"

export function createPlaceBubbles(geometry: THREE.SphereGeometry, color: THREE.Color,
  id: string, photos: THREE.SpriteMaterial[], phase: number) {
  const film = createMemoryMaterials(color, id)
  const group = new THREE.Group()
  group.name = `PlacedMemory-${id}`
  const mesh = new THREE.Mesh(geometry, film.material)
  const attach = (target: THREE.Mesh, index: number) => {
    if (!photos[index]) return
    const sprite = new THREE.Sprite(photos[index])
    sprite.scale.set(0.29, 0.29, 1); sprite.renderOrder = -1
    target.add(sprite)
  }
  attach(mesh, 0)
  const satellites = createSphereSatellites(geometry, film.material, photos.length - 1)
  satellites.forEach(entry => { if (entry.photoIndex !== null) attach(entry.mesh, entry.photoIndex); group.add(entry.mesh) })
  const fusion = new MarchingCubes(32, film.material, false, false, 10000)
  fusion.scale.setScalar(0.36); fusion.visible = false
  group.add(mesh, fusion)
  const membranes = createBubbleMembranes(group, [mesh, ...satellites.map(entry => entry.mesh)], film.material, geometry.parameters.radius)
  let focus = 0
  let lastSurface = -Infinity
  return {
    group, mesh, fusion, film, photos, satellites, membranes,
    update(elapsed: number, delta: number, focused: boolean, inRing: boolean, surfaceVisible: boolean, reduced: boolean) {
      focus = reduced ? Number(focused) : THREE.MathUtils.clamp(focus + (focused ? delta : -delta) / 0.85, 0, 1)
      const now = reduced ? 0 : elapsed
      film.update(now)
      const phases = bubbleFocusPhases(focus)
      const wobble = 1 + Math.sin(now * 0.7 + phase) * 0.012
      mesh.scale.set(phases.coreScale * wobble, phases.coreScale / wobble, phases.coreScale)
      updateSphereSatellites(satellites, now, 0, focus)
      if (inRing) {
        satellites.forEach(entry => { entry.mesh.visible = false })
        membranes.hide()
      } else {
        fusion.visible = false
        if (surfaceVisible && (focused || elapsed - lastSurface >= 1 / 30)) { membranes.update(elapsed); lastSurface = elapsed }
      }
    },
    dispose() {
      membranes.dispose(); fusion.geometry.dispose()
      film.material.dispose(); film.paleMaterial.dispose()
      group.removeFromParent()
    },
  }
}
