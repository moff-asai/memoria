import * as THREE from "three"
import type { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js"
import { updateSphereFusion } from "./sphereFusion.ts"
import { createBubbleMembranes } from "./bubbleMembranes.ts"

export type RingSphere = {
  group: THREE.Group
  mesh: THREE.Mesh
  fusion: MarchingCubes
  photos: readonly THREE.SpriteMaterial[]
  satellites?: readonly { mesh: THREE.Mesh; photoIndex: number | null }[]
}

export type RingStatus =
  | "flowing"
  | "open"
  | "gathering"
  | "fusing"
  | "done"

export type RingFragment = {
  mesh: THREE.Mesh
  photoIndex: number | null
  /** Offset inside the fused cluster, in the sphere group's local space. */
  target: THREE.Vector3
  /** Resting world position on the ring. */
  slot: THREE.Vector3
  restScale: number
  from: THREE.Vector3
  fromScale: number
  /** Signed angle travelled around the viewer while flowing out. */
  sweep: number
  delay: number
  emphasis: number
  phase: number
}

const GATHER_DURATION = 1.05
const GATHER_STAGGER = 0.25
const FUSE_DURATION = 0.6
// Matches the curved screen's fade-out, so the ring settles as it reappears.
const TURN_DURATION = 0.6
const CLUSTER_RADIUS = 0.19
const CLUSTER_SCALE = 0.5

const clamp01 = (value: number) => Math.min(Math.max(value, 0), 1)
const easeInOut = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

// Signed shortest turn from one angle to another; near-opposite slots follow
// the hinted direction so the stream splits evenly around the viewer.
const sweepBetween = (from: number, to: number, hint: number) => {
  let delta =
    THREE.MathUtils.euclideanModulo(to - from + Math.PI, Math.PI * 2) - Math.PI
  if (
    hint !== 0 &&
    Math.sign(delta) !== Math.sign(hint) &&
    Math.abs(delta) > Math.PI * 0.9
  ) {
    delta += Math.sign(hint) * Math.PI * 2
  }
  return delta
}

// Interpolates around the viewer (polar), so fragments swirl along the ring
// instead of cutting straight through the user.
const flowPoint = (
  out: THREE.Vector3,
  center: THREE.Vector3,
  from: THREE.Vector3,
  to: THREE.Vector3,
  sweep: number,
  t: number,
  outwardBulge = 0.18,
) => {
  const r0 = Math.hypot(from.x - center.x, from.z - center.z)
  const r1 = Math.hypot(to.x - center.x, to.z - center.z)
  const angle = Math.atan2(from.z - center.z, from.x - center.x) + sweep * t
  const bulge = Math.sin(Math.PI * t)
  const radius = r0 + (r1 - r0) * t + bulge * outwardBulge
  return out.set(
    center.x + Math.cos(angle) * radius,
    from.y + (to.y - from.y) * t + bulge * outwardBulge * 0.55,
    center.z + Math.sin(angle) * radius,
  )
}

const angleAround = (center: THREE.Vector3, point: THREE.Vector3) =>
  Math.atan2(point.z - center.z, point.x - center.x)

// Rotates `point` about the vertical axis through `center`, in the same
// sense as `angleAround`.
const turnAround = (
  point: THREE.Vector3,
  center: THREE.Vector3,
  angle: number,
) => {
  const dx = point.x - center.x
  const dz = point.z - center.z
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  point.x = center.x + dx * cos - dz * sin
  point.z = center.z + dx * sin + dz * cos
  return point
}

export const ringFragmentCount = (photoCount: number) =>
  Math.max(1, photoCount)

export function createMemoryRing<S extends RingSphere>({
  scene,
  sphere,
  geometry,
  material,
  paleMaterial,
  center,
  elapsed,
  leadPhoto = 0,
  duration = 1.8,
}: {
  scene: THREE.Scene
  sphere: S
  geometry: THREE.BufferGeometry
  material: THREE.Material
  paleMaterial: THREE.Material
  /** Viewer eye position the ring surrounds. */
  center: THREE.Vector3
  elapsed: number
  /** Photo placed in slot 0, where the sphere was picked. */
  leadPhoto?: number
  /** Duration of the single movement from the existing bubbles to the circle. */
  duration?: number
}) {
  const ringCenter = center.clone()
  const group = new THREE.Group()
  group.name = "MemoryRing"
  scene.add(group)

  const count = ringFragmentCount(sphere.photos.length)
  sphere.group.updateWorldMatrix(true, false)
  const origin = new THREE.Vector3().setFromMatrixPosition(
    sphere.group.matrixWorld,
  )
  const entryRadius = 1.8
  const photoDiameter = Math.min(0.84, count > 1
    ? 2 * entryRadius * Math.sin(Math.PI / count) * 0.72 : 0.84)
  group.userData.center = ringCenter
  group.userData.entryRadius = entryRadius
  const startAngle = angleAround(ringCenter, origin)
  const placeSlot = (slot: THREE.Vector3, index: number) => {
    const angle = startAngle + index * Math.PI * 2 / count
    slot.set(ringCenter.x + Math.cos(angle) * entryRadius, ringCenter.y,
      ringCenter.z + Math.sin(angle) * entryRadius)
  }
  const previews = [
    { mesh: sphere.mesh, photoIndex: 0 as number | null },
    ...(sphere.satellites ?? []),
  ]
  const previewVisibility = previews.map(({ mesh }) => mesh.visible)
  const emptyPreviews = previews.filter(({ mesh, photoIndex }) => mesh.visible && photoIndex === null)
  const worldScale = new THREE.Vector3()
  const photoSlots = new Map<number, number>()
  const photoCount = sphere.photos.length
  sphere.photos.forEach((_, index) => {
    const order = THREE.MathUtils.euclideanModulo(index - leadPhoto, photoCount)
    photoSlots.set(
      Math.round((order * count) / photoCount) % count,
      index,
    )
  })

  const fragments: RingFragment[] = Array.from({ length: count }, (_, k) => {
    const photoIndex = photoSlots.get(k) ?? null
    const fy = 1 - (2 * (k + 0.5)) / count
    const fr = Math.sqrt(1 - fy * fy)
    const fa = k * Math.PI * (3 - Math.sqrt(5))
    const slot = new THREE.Vector3()
    placeSlot(slot, k)
    const source = photoIndex === null
      ? emptyPreviews.shift()
      : previews.find(entry => entry.photoIndex === photoIndex && entry.mesh.visible)
    const target = source
      ? source.mesh.position.clone()
      : new THREE.Vector3(Math.cos(fa) * fr, fy, Math.sin(fa) * fr).multiplyScalar(CLUSTER_RADIUS * 0.45)
    const from = source
      ? source.mesh.getWorldPosition(new THREE.Vector3())
      : sphere.group.localToWorld(target.clone())
    const fromScale = source ? source.mesh.getWorldScale(worldScale).x : 0.08
    const mesh = new THREE.Mesh(
      geometry,
      photoIndex === null ? paleMaterial : material,
    )
    mesh.position.copy(from)
    mesh.scale.setScalar(fromScale)
    mesh.name =
      photoIndex === null ? `MemoryFragment-${k}` : `MemoryPhoto-${photoIndex}`
    if (photoIndex !== null) {
      const sprite = new THREE.Sprite(sphere.photos[photoIndex])
      sprite.scale.set(0.29, 0.29, 1)
      sprite.renderOrder = -1
      mesh.add(sprite)
    }
    group.add(mesh)
    return {
      mesh,
      photoIndex,
      target,
      slot,
      restScale: photoDiameter / 0.3,
      from,
      fromScale,
      sweep: 0,
      delay: 0,
      emphasis: 0,
      phase: k * 1.9,
    }
  })
  const hasPhotos = fragments.some(({ photoIndex }) => photoIndex !== null)

  let status: RingStatus = "flowing"
  let startedAt = elapsed
  let openness = 0
  let hovered: RingFragment | null = null
  // How far the whole ring has turned around the viewer since it opened.
  let turn = 0
  let turnFrom = 0
  let turnTo = 0
  let turnStartedAt: number | null = null

  sphere.group.remove(sphere.mesh)
  sphere.satellites?.forEach(({ mesh }) => { mesh.visible = false })
  sphere.fusion.visible = false
  fragments.forEach((fragment, index) => {
    fragment.sweep = sweepBetween(
      angleAround(ringCenter, fragment.from),
      angleAround(ringCenter, fragment.slot),
      index % 2 === 0 ? 1 : -1,
    )
    fragment.delay = 0
  })
  const membranes = createBubbleMembranes(
    group,
    fragments.map(fragment => fragment.mesh),
    material as THREE.MeshStandardMaterial,
    0.15,
  )
  membranes.update(elapsed)

  const position = new THREE.Vector3()
  const clusterPoint = new THREE.Vector3()
  const inward = new THREE.Vector3()
  const centerShift = new THREE.Vector3()

  const clusterWorld = (fragment: RingFragment) => {
    clusterPoint.copy(fragment.target)
    return sphere.group.localToWorld(clusterPoint)
  }

  const restPosition = (fragment: RingFragment, now: number) => {
    position.copy(fragment.slot)
    if (turn !== 0) turnAround(position, ringCenter, turn)
    return position
  }

  const updateEmphasis = (delta: number) => {
    const blend = 1 - Math.exp(-delta * 10)
    for (const fragment of fragments) {
      const goal = fragment === hovered ? 0.45 : 0
      fragment.emphasis += (goal - fragment.emphasis) * blend
    }
  }

  return {
    sphere,
    fragments,
    center: ringCenter,
    get status() {
      return status
    },
    /** 0 while fused, 1 while the ring is fully spread. */
    get openness() {
      return openness
    },
    setHover(fragment: RingFragment | null) {
      hovered = fragment
    },
    /** Fragments that can be picked: photo fragments, or every fragment when none has a photo. */
    targets() {
      if (status !== "open") return []
      return fragments
        .filter(({ photoIndex }) => !hasPhotos || photoIndex !== null)
        .map(({ mesh }) => mesh)
    },
    fragmentFor(object: THREE.Object3D) {
      return fragments.find(({ mesh }) => mesh === object) ?? null
    },
    /**
     * Turn the ring around the viewer until `photoIndex`'s fragment rests
     * straight ahead along `heading` (the viewer's yaw; 0 faces -z).
     */
    face(photoIndex: number, heading: number, now: number) {
      if (status !== "flowing" && status !== "open") return
      const fragment = fragments.find((entry) => entry.photoIndex === photoIndex)
      if (!fragment) return
      const ahead = Math.atan2(-Math.cos(heading), -Math.sin(heading))
      const resting = angleAround(ringCenter, fragment.slot) + turn
      turnFrom = turn
      turnTo = turn + sweepBetween(resting, ahead, 0)
      turnStartedAt = now
    },
    /** Gather every fragment back into the sphere. */
    close(now: number) {
      if (status !== "flowing" && status !== "open") return
      status = "gathering"
      startedAt = now
      hovered = null
      sphere.group.updateWorldMatrix(true, false)
      for (const fragment of fragments) {
        fragment.from.copy(fragment.mesh.position)
        fragment.fromScale = fragment.mesh.scale.x
        // The ring may have turned since it opened; measure from where the
        // fragment rests now.
        fragment.sweep = sweepBetween(
          angleAround(ringCenter, clusterWorld(fragment)),
          angleAround(ringCenter, fragment.from),
          fragment.sweep,
        )
        // Far fragments leave first so everything arrives together.
        fragment.delay =
          (1 - Math.min(Math.abs(fragment.sweep) / Math.PI, 1)) *
          GATHER_STAGGER
      }
    },
    update(now: number, delta: number, viewer?: THREE.Vector3) {
      updateEmphasis(delta)
      if (status === "flowing" && viewer) {
        // Both ends travel with the user's position so entry cannot leave the
        // bubbles behind or add a second recession after the camera stops.
        centerShift.subVectors(viewer, ringCenter)
        ringCenter.copy(viewer)
        fragments.forEach((fragment, index) => {
          fragment.from.add(centerShift)
          placeSlot(fragment.slot, index)
        })
      }
      if (turnStartedAt !== null) {
        const progress = clamp01((now - turnStartedAt) / TURN_DURATION)
        turn = turnFrom + (turnTo - turnFrom) * easeOut(progress)
        if (progress >= 1) turnStartedAt = null
      }
      if (status === "flowing" || status === "open") {
        let total = 0
        for (const fragment of fragments) {
          const t =
            status === "open"
              ? 1
              : duration <= 0 ? 1 : clamp01((now - startedAt) / duration)
          const eased = easeInOut(t)
          total += eased
          const rest = restPosition(fragment, now)
          if (t < 1) {
            fragment.sweep = sweepBetween(
              angleAround(ringCenter, fragment.from),
              angleAround(ringCenter, rest),
              fragment.sweep,
            )
            flowPoint(
              fragment.mesh.position,
              ringCenter,
              fragment.from,
              rest,
              fragment.sweep,
              eased,
              0,
            )
          } else {
            fragment.mesh.position.copy(rest)
          }
          const size = fragment.fromScale + (fragment.restScale - fragment.fromScale) * eased
          fragment.mesh.scale.setScalar(size)
        }
        openness = total / fragments.length
        if (status === "flowing" && openness >= 1) status = "open"
        membranes.update(now)
        return
      }

      if (status === "gathering") {
        sphere.group.updateWorldMatrix(true, false)
        let total = 0
        for (const fragment of fragments) {
          const t = clamp01(
            (now - startedAt - fragment.delay) / GATHER_DURATION,
          )
          const eased = easeInOut(t)
          total += eased
          const goal = clusterWorld(fragment)
          flowPoint(
            fragment.mesh.position,
            ringCenter,
            fragment.from,
            goal,
            sweepBetween(
              angleAround(ringCenter, fragment.from),
              angleAround(ringCenter, goal),
              -fragment.sweep,
            ),
            eased,
          )
          fragment.mesh.scale.setScalar(
            fragment.fromScale + (CLUSTER_SCALE - fragment.fromScale) * eased,
          )
        }
        openness = 1 - total / fragments.length
        if (total < fragments.length) {
          membranes.update(now)
          return
        }
        membranes.hide()
        fragments.forEach(({ mesh }) => {
          mesh.visible = false
        })
        sphere.fusion.visible = true
        updateSphereFusion(sphere.fusion, fragments, 1, 0)
        status = "fusing"
        startedAt = now
        return
      }

      if (status === "fusing") {
        const progress = clamp01((now - startedAt) / FUSE_DURATION)
        updateSphereFusion(sphere.fusion, fragments, 1, progress)
        if (progress < 1) return
        sphere.fusion.visible = false
        sphere.group.add(sphere.mesh)
        openness = 0
        status = "done"
      }
    },
    dispose() {
      membranes.dispose()
      group.removeFromParent()
      if (!sphere.mesh.parent) sphere.group.add(sphere.mesh)
      previews.forEach(({ mesh }, index) => { mesh.visible = previewVisibility[index] })
      sphere.fusion.visible = false
    },
  }
}

export type MemoryRing<S extends RingSphere = RingSphere> = ReturnType<
  typeof createMemoryRing<S>
>
