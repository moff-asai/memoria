import assert from "node:assert/strict"
import test from "node:test"
import * as THREE from "three"
import { createBubbleMembranes } from "../src/bubbleMembranes.ts"
import { createSphereSatellites } from "../src/sphereSatellites.ts"

const fixture = (t, count = 4) => {
  const owner = new THREE.Group()
  const geometry = new THREE.SphereGeometry(0.15, 16, 8)
  const material = new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.65 })
  const bubbles = Array.from({ length: count }, () => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.scale.setScalar(0.6)
    owner.add(mesh)
    return mesh
  })
  const membranes = createBubbleMembranes(owner, bubbles, material, 0.15)
  const surfaces = () => membranes.group.children.filter(surface => surface.visible)
  t.after(() => {
    membranes.dispose()
    geometry.dispose()
    material.dispose()
  })
  return { owner, geometry, material, bubbles, membranes, surfaces }
}

test("three or more transitively overlapping bubbles have one film and no internal shells", (t) => {
  const { bubbles, material, membranes, surfaces } = fixture(t)
  bubbles[0].position.x = -0.14
  bubbles[1].position.x = 0
  bubbles[2].position.x = 0.14
  bubbles[3].position.x = 1.2
  membranes.update(0)
  assert.equal(surfaces().length, 1, "connected overlaps share a single surface")
  assert(surfaces()[0].geometry.drawRange.count > 0)
  assert(bubbles.slice(0, 3).every(bubble => bubble.material.opacity === 0), "individual interior rims are not drawn")
  assert.equal(bubbles[3].material.opacity, 0.65, "a detached bubble keeps its own film")
  assert.equal(material.opacity, 0.65, "the shared source material is not changed")
  const positions = bubbles.map(bubble => bubble.position.clone())
  membranes.update(3)
  assert.equal(surfaces().length, 1, "the film remains unified at rest, not just during animation")
  bubbles.forEach((bubble, index) => assert(bubble.position.equals(positions[index])))
})

test("separate overlapping groups get independent films and detach cleanly", (t) => {
  const { bubbles, membranes, surfaces } = fixture(t)
  bubbles.forEach((bubble, index) => { bubble.position.x = [0, 0.14, 1, 1.14][index] })
  membranes.update(0)
  assert.equal(surfaces().length, 2)
  assert(bubbles.every(bubble => bubble.material.opacity === 0))
  bubbles.forEach((bubble, index) => { bubble.position.x = index * 0.5 })
  membranes.update(1)
  assert.equal(surfaces().length, 0)
  assert(bubbles.every(bubble => bubble.material.opacity === 0.65))
  bubbles[1].position.x = 0.14
  membranes.update(2)
  assert.equal(surfaces().length, 1, "touching again restores the shared film")
})

test("a translated cloud uses local overlap volumes instead of a coarse whole-room surface", (t) => {
  const { bubbles, membranes, surfaces } = fixture(t, 2)
  bubbles[0].position.set(5, 1, -3)
  bubbles[1].position.set(5.14, 1, -3)
  membranes.update(0)
  const surface = surfaces()[0]
  assert(surface.position.distanceTo(new THREE.Vector3(5.07, 1, -3)) < 1e-9)
  assert(surface.scale.x < 0.4, "the field stays tightly fitted to the joined bubbles")
  membranes.group.updateWorldMatrix(true, true)
  const ray = new THREE.Raycaster(new THREE.Vector3(5.07, 1, 0), new THREE.Vector3(0, 0, -1))
  assert(ray.intersectObject(surface, false).length > 0, "the real membrane joins the translated lobes")
})

test("the default five-bubble resting cluster is always one membrane", (t) => {
  const owner = new THREE.Group()
  const geometry = new THREE.SphereGeometry(0.15, 16, 8)
  const material = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.65 })
  const core = new THREE.Mesh(geometry, material)
  const satellites = createSphereSatellites(geometry, material, 6)
  const bubbles = [core, ...satellites.map(satellite => satellite.mesh)]
  owner.add(...bubbles)
  const membranes = createBubbleMembranes(owner, bubbles, material, 0.15)
  t.after(() => { membranes.dispose(); geometry.dispose(); material.dispose() })
  membranes.update(0)
  assert.equal(membranes.group.children.filter(surface => surface.visible).length, 1)
  assert(bubbles.filter(bubble => bubble.visible).every(bubble => bubble.material.opacity === 0))
})

test("photos, selection meshes and original materials survive hiding and disposal", (t) => {
  const { owner, material, bubbles, membranes } = fixture(t, 2)
  const photoMaterial = new THREE.SpriteMaterial({ opacity: 0.8 })
  t.after(() => photoMaterial.dispose())
  const photo = new THREE.Sprite(photoMaterial)
  bubbles[0].add(photo)
  bubbles[1].position.x = 0.14
  membranes.update(0)
  assert(bubbles.every(bubble => bubble.visible), "hit geometry is still available")
  assert.equal(photo.material.opacity, 0.8, "the photo is not faded with the shell")
  membranes.hide()
  assert(!membranes.group.visible)
  assert(bubbles.every(bubble => bubble.material.opacity === 0.65))
  membranes.update(1)
  assert(membranes.group.visible)
  assert(bubbles.every(bubble => bubble.material.opacity === 0))
  membranes.dispose()
  assert(!owner.children.includes(membranes.group))
  assert(bubbles.every(bubble => bubble.material === material))
})
