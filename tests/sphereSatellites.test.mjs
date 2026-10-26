import assert from "node:assert/strict"
import test from "node:test"
import * as THREE from "three"
import { bubbleFocusPhases, createSphereSatellites, updateSphereSatellites } from "../src/sphereSatellites.ts"

test.beforeEach((t) => {
  let seed = 42
  t.mock.method(Math, "random", () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  })
})

const create = (t, photoCount) => {
  const geometry = new THREE.SphereGeometry(0.15, 16, 8)
  const material = new THREE.MeshStandardMaterial()
  t.after(() => {
    geometry.dispose()
    material.dispose()
  })
  return createSphereSatellites(geometry, material, photoCount)
}

test("every memory has four resting previews and two focus-only bubbles regardless of photo count", (t) => {
  for (const count of [0, 1, 3, 4, 9]) {
    const satellites = create(t, count)
    assert.equal(satellites.length, 6)
    assert.equal(satellites.filter(({ mesh }) => mesh.visible).length, 4)
    assert.deepEqual(
      satellites.map(({ photoIndex }) => photoIndex),
      Array.from({ length: 6 }, (_, index) => index < count ? index + 1 : null),
    )
  }
})

test("resting sizes are random and the largest preview is 0.6 times its former size", (t) => {
  const layouts = new Set()
  const sizes = new Set()
  let hasIrregularGaps = false
  for (let index = 0; index < 32; index++) {
    const satellites = create(t, 9).filter(({ resting }) => resting)
    const scales = satellites.map(({ scale }) => scale)
    assert.equal(Math.max(...scales), 0.74 * 0.6)
    assert.equal(scales[2], 0.74 * 0.6)
    assert.equal(new Set(scales).size, 4, "resting previews are not uniformly sized")
    assert(scales.every((scale, index) => index === 2 || (scale >= 0.28 && scale <= 0.4)))
    sizes.add(JSON.stringify(scales))
    layouts.add(JSON.stringify(satellites.map(({ mesh }) => mesh.position.toArray())))
    const gaps = satellites.map(({ angle }, index) =>
      THREE.MathUtils.euclideanModulo(satellites[(index + 1) % 4].angle - angle, Math.PI * 2),
    )
    assert(gaps.every(gap => gap > Math.PI / 4), "initial positions do not pile up")
    hasIrregularGaps ||= Math.max(...gaps) - Math.min(...gaps) > Math.PI / 4
    satellites.forEach(({ mesh }) => {
      const distance = Math.hypot(mesh.position.x, mesh.position.y)
      assert(distance < 0.15 * (1 + mesh.scale.x), "each bubble overlaps the center")
      assert(distance > 0.15, "each preview center stays outside the main bubble")
    })
  }
  assert.equal(layouts.size, 32, "memories do not reuse the same arrangement")
  assert.equal(sizes.size, 32, "sizes are sampled independently for each memory")
  assert(hasIrregularGaps, "layouts are not quarter-turn slots with slight jitter")
})

test("small bubbles drift in a breeze and gently wobble without accumulating drift", (t) => {
  const satellites = create(t, 4).filter(({ resting }) => resting)
  const start = satellites.map(({ mesh }) => mesh.position.clone())
  assert.equal(new Set(satellites.map(({ phase }) => phase)).size, 4)
  assert.equal(new Set(satellites.map(({ driftSpeed }) => driftSpeed)).size, 4)
  assert.equal(new Set(satellites.map(({ swaySpeed }) => swaySpeed)).size, 4, "each bubble sways independently")
  const motion = satellites.map(() => 0)
  for (const elapsed of [4, 8, 12, 20]) {
    updateSphereSatellites(satellites, elapsed, 0)
    satellites.forEach(({ mesh }, index) => {
      motion[index] = Math.max(motion[index], mesh.position.distanceTo(start[index]))
      assert.notEqual(mesh.scale.x, mesh.scale.y, "the flexible film is not rigidly spherical")
      const volume = mesh.scale.x * mesh.scale.y * mesh.scale.z
      assert(Math.abs(Math.cbrt(volume) / satellites[index].scale - 1) <= 0.012 + 1e-9)
    })
  }
  motion.forEach(distance => {
    assert(distance > 0.015, "movement is visible, not just a tiny pulse")
  })
  for (const elapsed of [1, 10, 60, 600, 3600]) {
    updateSphereSatellites(satellites, elapsed, 0)
    satellites.forEach(({ mesh, scale, reach, angle }) => {
      const largestScale = Math.max(mesh.scale.x, mesh.scale.y, mesh.scale.z)
      const smallestScale = Math.min(mesh.scale.x, mesh.scale.y, mesh.scale.z)
      assert(Math.abs(largestScale / scale - 1) <= 0.04 + 1e-9)
      assert(Math.abs(smallestScale / scale - 1) <= 0.04 + 1e-9)
      const distance = Math.hypot(mesh.position.x, mesh.position.y)
      assert(distance < 0.15 * (1 + smallestScale), "bubbles remain connected")
      assert(distance > 0.15, "the preview centers remain outside the main bubble")
      assert(mesh.position.length() + 0.15 * largestScale <= reach + 1e-9, "the label clears the motion")
      const turn = THREE.MathUtils.euclideanModulo(Math.atan2(mesh.position.y, mesh.position.x) - angle + Math.PI, Math.PI * 2) - Math.PI
      assert(Math.abs(turn) <= 0.32 + 1e-9, "bubbles float around their random resting place instead of continuously orbiting")
    })
  }
  updateSphereSatellites(satellites, 0, 0)
  satellites.forEach(({ mesh }, index) => assert(mesh.position.equals(start[index])))
})

test("randomness is sampled at creation, never on animation frames", (t) => {
  const satellites = create(t, 4)
  t.mock.method(Math, "random", () => { throw new Error("random layout changed during animation") })
  updateSphereSatellites(satellites, 5, 0)
  const first = satellites.map(({ mesh }) => mesh.position.clone())
  updateSphereSatellites(satellites, 10, 0)
  updateSphereSatellites(satellites, 10, 0, 1)
  updateSphereSatellites(satellites, 5, 0)
  satellites.forEach(({ mesh }, index) => assert(mesh.position.equals(first[index])))
})

test("opening the ring expands the bubbles and closing restores the same composition", (t) => {
  const satellites = create(t, 4).filter(({ resting }) => resting)
  updateSphereSatellites(satellites, 5, 0)
  const closed = satellites.map(({ mesh }) => mesh.position.clone())
  updateSphereSatellites(satellites, 5, 1)
  satellites.forEach(({ mesh }, index) => {
    const radius = Math.hypot(mesh.position.x, mesh.position.y)
    const closedRadius = Math.hypot(closed[index].x, closed[index].y)
    assert(Math.abs(radius - closedRadius - 0.12) < 1e-9)
    assert.equal(mesh.position.z, closed[index].z)
  })
  updateSphereSatellites(satellites, 5, 0)
  satellites.forEach(({ mesh }, index) => assert(mesh.position.equals(closed[index])))
})

test("focus disperses six small-to-medium previews and unfocus restores the four resting bubbles", (t) => {
  for (const photoCount of [0, 1, 4, 9]) {
    const satellites = create(t, photoCount)
    updateSphereSatellites(satellites, 5, 0)
    const resting = satellites.map(({ mesh }) => ({
      position: mesh.position.clone(),
      scale: mesh.scale.clone(),
    }))
    updateSphereSatellites(satellites, 5, 0, 1)
    assert.equal(satellites.filter(({ mesh }) => mesh.visible).length, 6)
    satellites.forEach(({ mesh, reach }, index) => {
      const largestScale = Math.max(mesh.scale.x, mesh.scale.y, mesh.scale.z)
      assert(largestScale <= 0.64, "no large preview remains while focused")
      assert(largestScale >= 0.39, "the new bubbles are visible, not tiny particles")
      assert(mesh.position.length() > resting[index].position.length(), "bubbles disperse outward")
      assert(mesh.position.length() + 0.15 * largestScale <= reach + 1e-9)
    })
    updateSphereSatellites(satellites, 5, 0, 0.5)
    assert(satellites.slice(4).every(({ mesh }) => mesh.visible && mesh.scale.x > 0.1))
    updateSphereSatellites(satellites, 5, 0, 0)
    assert.equal(satellites.filter(({ mesh }) => mesh.visible).length, 4)
    satellites.forEach(({ mesh }, index) => {
      assert(mesh.position.equals(resting[index].position))
      assert(mesh.scale.equals(resting[index].scale))
    })
  }
})

test("buds grow inside the large bubble before separating, with the same path for merging", (t) => {
  const satellites = create(t, 9)
  const early = bubbleFocusPhases(0.2)
  assert(early.birth > 0)
  assert.equal(early.release, 0)
  assert(early.coreScale > 0.95)
  updateSphereSatellites(satellites, 5, 0, 0.2)
  for (const { mesh } of satellites.slice(4)) {
    assert(mesh.visible)
    assert(mesh.scale.x > 0.1)
    assert.equal(mesh.position.length(), 0, "buds are still inside the parent")
  }
  updateSphereSatellites(satellites, 5, 0, 0.6)
  const midway = satellites.map(({ mesh }) => ({
    position: mesh.position.clone(),
    scale: mesh.scale.clone(),
  }))
  updateSphereSatellites(satellites, 5, 0, 1)
  updateSphereSatellites(satellites, 5, 0, 0.6)
  satellites.forEach(({ mesh }, index) => {
    assert(mesh.position.equals(midway[index].position), "reversing follows the same continuous path")
    assert(mesh.scale.equals(midway[index].scale))
  })
  assert.equal(bubbleFocusPhases(0).coreScale, 1)
  assert.equal(bubbleFocusPhases(1).coreScale, 0.52)
  const before = bubbleFocusPhases(0.6)
  const after = bubbleFocusPhases(0.60001)
  assert(Math.abs(after.coreScale - before.coreScale) < 0.0001)
  assert(Math.abs(after.release - before.release) < 0.0001)
})
