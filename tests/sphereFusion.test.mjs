import assert from "node:assert/strict"
import test from "node:test"
import * as THREE from "three"
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js"
import { updateBubbleFusion } from "../src/sphereFusion.ts"

const create = (t) => {
  const geometry = new THREE.SphereGeometry(0.15, 16, 8)
  const material = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })
  const surface = new MarchingCubes(32, material, false, false, 10000)
  surface.scale.setScalar(0.36)
  const bubbles = [new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material)]
  bubbles.forEach(bubble => bubble.scale.setScalar(0.6))
  t.after(() => {
    surface.geometry.dispose()
    geometry.dispose()
    material.dispose()
  })
  const throughNeck = () => {
    surface.updateMatrixWorld(true)
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 0.5), new THREE.Vector3(0, 0, -1))
    return ray.intersectObject(surface, false)
  }
  return { surface, bubbles, throughNeck }
}

test("nearby bubbles form a real membrane neck, and separated bubbles release it", (t) => {
  const { surface, bubbles, throughNeck } = create(t)
  bubbles[0].position.x = -0.1
  bubbles[1].position.x = 0.1
  updateBubbleFusion(surface, bubbles, 0.15)
  assert(surface.geometry.drawRange.count > 0)
  assert(throughNeck().length > 0, "there is a continuous surface between the lobes")
  bubbles[0].position.x = -0.19
  bubbles[1].position.x = 0.19
  updateBubbleFusion(surface, bubbles, 0.15)
  assert.equal(throughNeck().length, 0, "the membrane pinches apart instead of leaving a connector")
  bubbles[0].position.x = -0.1
  bubbles[1].position.x = 0.1
  updateBubbleFusion(surface, bubbles, 0.15)
  assert(throughNeck().length > 0, "bringing the bubbles back fuses the same membrane")
})

test("hidden or zero-size buds do not leave stale fluid geometry", (t) => {
  const { surface, bubbles } = create(t)
  updateBubbleFusion(surface, bubbles, 0.15)
  assert(surface.geometry.drawRange.count > 0)
  bubbles[0].visible = false
  bubbles[1].scale.setScalar(0)
  updateBubbleFusion(surface, bubbles, 0.15)
  assert.equal(surface.geometry.drawRange.count, 0)
})
