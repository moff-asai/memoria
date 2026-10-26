import assert from "node:assert/strict"
import test from "node:test"
import * as THREE from "three"
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js"
import { createMemoryRing, ringFragmentCount } from "../src/memoryRing.ts"

const fixture = (t, photoCount = 7, leadPhoto = 0, sourceHeight = 1.55) => {
  const scene = new THREE.Scene()
  const geometry = new THREE.SphereGeometry(0.15, 16, 8)
  const material = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.65 })
  const paleMaterial = material.clone()
  const photos = Array.from({ length: photoCount }, () => new THREE.SpriteMaterial())
  const group = new THREE.Group()
  group.position.set(0.4, sourceHeight, -1.5)
  group.rotation.set(0.03, 0.08, -0.02)
  group.scale.setScalar(1.08)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.scale.setScalar(0.52)
  const fusion = new MarchingCubes(24, material, false, false, 10000)
  fusion.scale.setScalar(0.36)
  fusion.visible = false
  const satellites = Array.from({ length: 6 }, (_, index) => {
    const bubble = new THREE.Mesh(geometry, material)
    const angle = index * Math.PI / 3
    bubble.position.set(Math.cos(angle) * 0.21, Math.sin(angle) * 0.19, (index % 2 - 0.5) * 0.04)
    bubble.scale.setScalar(0.43 + index * 0.02)
    group.add(bubble)
    return { mesh: bubble, photoIndex: index + 1 < photoCount ? index + 1 : null }
  })
  group.add(mesh, fusion)
  scene.add(group)
  scene.updateMatrixWorld(true)
  const previews = [{ mesh, photoIndex: 0 }, ...satellites]
  const snapshot = new Map(previews.filter(p => p.photoIndex !== null).map(p => [
    p.photoIndex,
    {
      position: p.mesh.getWorldPosition(new THREE.Vector3()),
      scale: p.mesh.getWorldScale(new THREE.Vector3()).x,
    },
  ]))
  const center = new THREE.Vector3(0.4, 1.5, 0)
  const sphere = { group, mesh, fusion, photos, satellites }
  const ring = createMemoryRing({ scene, sphere, geometry, material, paleMaterial, center, elapsed: 0, leadPhoto })
  t.after(() => {
    ring.dispose()
    geometry.dispose()
    fusion.geometry.dispose()
    material.dispose()
    paleMaterial.dispose()
    photos.forEach(photo => photo.dispose())
  })
  return { ring, sphere, center, snapshot, scene }
}

test("the visible small bubbles flow from their existing world poses without reforming a large sphere", (t) => {
  const { ring, sphere, snapshot } = fixture(t, 7, 4)
  assert.equal(ring.status, "flowing")
  assert.equal(ring.fragments.length, 7)
  assert.equal(sphere.fusion.visible, false)
  assert.equal(sphere.mesh.parent, null)
  assert(sphere.satellites.every(({ mesh }) => !mesh.visible), "source bubbles do not remain as duplicates")
  assert.equal(ring.fragments[0].photoIndex, 4, "the chosen photo welcomes the viewer in front")
  for (const fragment of ring.fragments) {
    const source = snapshot.get(fragment.photoIndex)
    assert(source)
    assert(fragment.mesh.visible)
    assert(fragment.from.distanceTo(source.position) < 1e-9)
    assert(fragment.mesh.position.distanceTo(source.position) < 1e-9)
    assert(Math.abs(fragment.fromScale - source.scale) < 1e-9)
  }
})

test("one bubble per photo rests at eye height at equal angular and horizontal intervals", (t) => {
  for (const photoCount of [1, 3, 7, 10]) {
    const { ring, center } = fixture(t, photoCount)
    ring.update(3, 0.1)
    assert.equal(ring.status, "open")
    assert.equal(ring.fragments.length, photoCount)
    assert.equal(ringFragmentCount(photoCount), photoCount)
    assert.equal(new Set(ring.fragments.map(f => f.photoIndex)).size, photoCount)
    const before = ring.fragments.map(f => f.mesh.position.clone())
    let gap
    for (let index = 0; index < photoCount; index++) {
      const fragment = ring.fragments[index]
      assert(Math.abs(fragment.mesh.position.y - center.y) < 1e-9)
      assert(Math.abs(fragment.mesh.position.distanceTo(center) - 1.8) < 1e-9)
      const distance = fragment.mesh.position.distanceTo(ring.fragments[(index + 1) % photoCount].mesh.position)
      gap ??= distance
      assert(Math.abs(distance - gap) < 1e-9)
      assert.equal(fragment.mesh.scale.x, ring.fragments[0].mesh.scale.x)
    }
    ring.update(5, 0.1)
    ring.fragments.forEach((f, index) => assert(f.mesh.position.distanceTo(before[index]) < 1e-9))
  }
})

test("entry is one continuous circular movement without an additional splitting phase", (t) => {
  const { ring, center } = fixture(t)
  assert.equal(ring.status, "flowing")
  ring.update(0.9, 0.1, center)
  assert.equal(ring.status, "flowing")
  assert(Math.abs(ring.openness - 0.5) < 1e-9)
  ring.update(1.8, 0.1, center)
  assert.equal(ring.status, "open")
  assert(ring.fragments.some(f => f.slot.z > center.z))
  assert(ring.fragments.some(f => f.slot.x < center.x))
  assert(ring.fragments.some(f => f.slot.x > center.x))
})

test("returning gathers and fuses the floating bubbles and restores the source memory", (t) => {
  const { ring, sphere, scene } = fixture(t)
  ring.update(3, 0.1)
  ring.close(3)
  ring.update(5, 0.1)
  assert.equal(ring.status, "fusing")
  assert(sphere.fusion.visible)
  ring.update(6, 0.1)
  assert.equal(ring.status, "done")
  assert.equal(sphere.mesh.parent, sphere.group)
  ring.dispose()
  assert.equal(scene.getObjectByName("MemoryRing"), undefined)
  assert(sphere.satellites.every(({ mesh }) => mesh.visible))
  assert(!sphere.fusion.visible)
})

test("a grabbed open ring turns every fragment around the viewer by the spun angle", (t) => {
  const { ring, center } = fixture(t, 5)
  ring.update(2, 0.016, center)
  assert.equal(ring.status, "open")
  const before = ring.fragments.map(({ mesh }) => mesh.position.clone())
  ring.spin(Math.PI / 2)
  ring.update(2.1, 0.016, center)
  ring.fragments.forEach(({ mesh }, index) => {
    const from = Math.atan2(before[index].z - center.z, before[index].x - center.x)
    const to = Math.atan2(mesh.position.z - center.z, mesh.position.x - center.x)
    const turned = THREE.MathUtils.euclideanModulo(to - from + Math.PI, Math.PI * 2) - Math.PI
    assert(Math.abs(turned - Math.PI / 2) < 1e-9, `fragment ${index} turned ${turned}`)
    assert(Math.abs(mesh.position.distanceTo(center) - before[index].distanceTo(center)) < 1e-9, "radius is kept")
  })
})

test("spin is ignored until the ring is open", (t) => {
  const { ring, center } = fixture(t, 5)
  ring.spin(1)
  ring.update(2, 0.016, center)
  const settled = ring.fragments.map(({ mesh }) => mesh.position.clone())
  const { ring: plain, center: plainCenter } = fixture(t, 5)
  plain.update(2, 0.016, plainCenter)
  plain.fragments.forEach(({ mesh }, index) => assert(mesh.position.distanceTo(settled[index]) < 1e-9))
})
