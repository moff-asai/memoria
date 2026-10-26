import * as THREE from "three"
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js"
import { updateBubbleFusion } from "./sphereFusion.ts"

/** Connected overlaps share one outer surface; photos and hit geometry stay intact. */
export function createBubbleMembranes(
  owner: THREE.Group,
  bubbles: readonly THREE.Mesh[],
  material: THREE.MeshStandardMaterial,
  baseRadius: number,
) {
  const group = new THREE.Group()
  group.name = "MemoryMembranes"
  owner.add(group)
  const records = bubbles.map((mesh, index) => {
    const original = mesh.material as THREE.MeshStandardMaterial
    const shell = original.clone()
    shell.onBeforeCompile = original.onBeforeCompile
    mesh.material = shell
    return {
      mesh, index, original, shell, radius: 0,
      previousPosition: new THREE.Vector3(),
      previousRadius: 0,
    }
  })
  const pool: {
    surface: MarchingCubes
    material: THREE.MeshStandardMaterial
    key: string
    updatedAt: number
  }[] = []
  const minimum = new THREE.Vector3()
  const maximum = new THREE.Vector3()
  const center = new THREE.Vector3()
  const corner = new THREE.Vector3()
  let disposed = false

  const hide = () => {
    group.visible = false
    pool.forEach(({ surface }) => { surface.visible = false })
    records.forEach(record => { record.shell.opacity = record.original.opacity })
  }

  return {
    group,
    hide,
    update(elapsed: number) {
      if (disposed) return
      const wasHidden = !group.visible
      hide()
      group.visible = true
      const active = records.filter(record => {
        const scale = record.mesh.scale
        record.radius = baseRadius * Math.cbrt(scale.x * scale.y * scale.z)
        return record.mesh.visible && record.radius > 0.0001
      })
      const parents = records.map((_, index) => index)
      const root = (index: number): number => {
        while (parents[index] !== index) {
          parents[index] = parents[parents[index]]
          index = parents[index]
        }
        return index
      }
      const edges: { first: number; weight: number }[] = []
      for (let i = 0; i < active.length; i++) {
        for (let j = i + 1; j < active.length; j++) {
          const first = active[i]
          const second = active[j]
          const gap = first.mesh.position.distanceTo(second.mesh.position) - first.radius - second.radius
          const weight = 1 - THREE.MathUtils.smoothstep(gap, baseRadius * 0.08, baseRadius * 0.16)
          if (weight <= 0) continue
          parents[root(second.index)] = root(first.index)
          edges.push({ first: first.index, weight })
        }
      }
      const connected = new Map<number, typeof active>()
      for (const record of active) {
        const key = root(record.index)
        const component = connected.get(key) ?? []
        component.push(record)
        connected.set(key, component)
      }
      const weights = new Map<number, number>()
      for (const edge of edges) {
        const key = root(edge.first)
        weights.set(key, Math.max(weights.get(key) ?? 0, edge.weight))
      }
      let used = 0
      for (const [id, component] of connected) {
        const weight = weights.get(id) ?? 0
        if (component.length < 2 || weight <= 0.001) continue
        let entry = pool[used]
        if (!entry) {
          const film = material.clone()
          film.onBeforeCompile = material.onBeforeCompile
          const surface = new MarchingCubes(48, film, false, false, 20000)
          // The preallocated field changes shape; keep culling and picking bounds conservative.
          surface.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.sqrt(3))
          surface.name = `MemoryMembrane-${used}`
          group.add(surface)
          entry = { surface, material: film, key: "", updatedAt: -Infinity }
          pool.push(entry)
        }
        used++
        entry.surface.visible = true
        entry.material.opacity = Math.max(...component.map(record => record.original.opacity)) * weight
        component.forEach(record => { record.shell.opacity = record.original.opacity * (1 - weight) })
        const key = component.map(record => record.index).join(",")
        const changing = component.some(record =>
          record.mesh.position.distanceToSquared(record.previousPosition) > 0.0008 ** 2 ||
          Math.abs(record.radius - record.previousRadius) > 0.0004,
        )
        // Slow idle motion needs only 30Hz geometry; splitting updates every frame.
        if (wasHidden || entry.key !== key || changing || elapsed - entry.updatedAt >= 1 / 30) {
          minimum.setScalar(Infinity)
          maximum.setScalar(-Infinity)
          let largestRadius = 0
          for (const record of component) {
            const p = record.mesh.position
            const r = record.radius
            minimum.min(corner.set(p.x - r, p.y - r, p.z - r))
            maximum.max(corner.set(p.x + r, p.y + r, p.z + r))
            largestRadius = Math.max(largestRadius, r)
          }
          center.addVectors(minimum, maximum).multiplyScalar(0.5)
          const halfWidth = Math.max(
            maximum.x - minimum.x, maximum.y - minimum.y, maximum.z - minimum.z,
          ) / 2 + Math.max(largestRadius, baseRadius * 0.08)
          entry.surface.position.copy(center)
          entry.surface.scale.setScalar(halfWidth)
          updateBubbleFusion(entry.surface, component.map(record => record.mesh), baseRadius, center)
          entry.key = key
          entry.updatedAt = elapsed
          component.forEach(record => {
            record.previousPosition.copy(record.mesh.position)
            record.previousRadius = record.radius
          })
        }
      }
    },
    dispose() {
      if (disposed) return
      hide()
      disposed = true
      group.removeFromParent()
      records.forEach(record => {
        if (record.mesh.material === record.shell) record.mesh.material = record.original
        record.shell.dispose()
      })
      pool.forEach(entry => {
        entry.surface.geometry.dispose()
        entry.material.dispose()
      })
    },
  }
}

export type BubbleMembranes = ReturnType<typeof createBubbleMembranes>
