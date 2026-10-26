import assert from "node:assert/strict"
import test from "node:test"
import * as THREE from "three"
import { createPlaceBubbles } from "../src/placeBubbles.ts"
import { createMemoryRing } from "../src/memoryRing.ts"

test("placed memories share the demo's five resting and seven focused bubbles", () => {
  const geometry = new THREE.SphereGeometry(0.15, 16, 8)
  const photos = Array.from({ length: 10 }, () => new THREE.SpriteMaterial())
  const bubble = createPlaceBubbles(geometry, new THREE.Color("#c9b9ed"), "own-memory", photos, 0)
  bubble.update(0, 0, false, false, true, false)
  assert.equal(1 + bubble.satellites.filter(entry => entry.mesh.visible).length, 5)
  bubble.update(1, 1, true, false, true, false)
  assert.equal(1 + bubble.satellites.filter(entry => entry.mesh.visible).length, 7)
  assert.equal(bubble.satellites.filter(entry => entry.photoIndex !== null).length, 6)
  bubble.update(2, 1, false, false, true, false)
  assert.equal(1 + bubble.satellites.filter(entry => entry.mesh.visible).length, 5)
  const scene = new THREE.Scene(); scene.add(bubble.group); bubble.group.position.z = -1.5
  const ring = createMemoryRing({ scene, sphere: bubble, geometry, material: bubble.film.material,
    paleMaterial: bubble.film.paleMaterial, center: new THREE.Vector3(), elapsed: 2, duration: 0 })
  bubble.update(2, 0, false, true, true, false); ring.update(2, 0)
  assert.equal(ring.targets().length, photos.length)
  assert(bubble.satellites.every(entry => !entry.mesh.visible))
  ring.dispose()
  bubble.update(3, 1, false, false, true, false)
  assert.equal(1 + bubble.satellites.filter(entry => entry.mesh.visible).length, 5)
  assert.equal(bubble.mesh.parent, bubble.group)
  bubble.dispose(); geometry.dispose(); photos.forEach(photo => photo.dispose())
})
