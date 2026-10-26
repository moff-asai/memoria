import assert from "node:assert/strict"
import test from "node:test"
import * as THREE from "three"
import { createVRMemoryLayout } from "../src/vrMemoryLayout.ts"

const vector = (x, y, z) => new THREE.Vector3(x, y, z)
const close = (actual, expected) =>
  assert(actual.distanceTo(expected) < 1e-9, `${actual.toArray()} ≠ ${expected.toArray()}`)
const orientation = (pitch, yaw, roll = 0) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, "YXZ"))

test("web memory positions stay unchanged", () => {
  const layout = createVRMemoryLayout()
  const home = vector(0.6325, 1.5, -1.5)
  close(layout.position(home, vector()), home)
  assert.equal(layout.pending, false)
})

test("the first tracked pose anchors the central sphere horizontally at eye height", () => {
  for (const height of [0.9, 1.2, 1.8]) {
    for (const yaw of [0, Math.PI / 2, -Math.PI / 2, Math.PI, 0.7]) {
      for (const pitch of [-1.2, 0, 1.2]) {
        const layout = createVRMemoryLayout()
        const eye = vector(0.4, height, -0.3)
        layout.begin()
        assert.equal(layout.pending, true)
        layout.capture(eye, orientation(pitch, yaw, 0.2))
        assert.equal(layout.pending, false)
        close(
          layout.position(vector(0, 1.5, -1.5), vector()),
          vector(eye.x - Math.sin(yaw) * 1.5, eye.y, eye.z - Math.cos(yaw) * 1.5),
        )
      }
    }
  }
})

test("later head movement does not move the anchored layout; new memories use it too", () => {
  const layout = createVRMemoryLayout()
  layout.begin()
  layout.capture(vector(0.5, 1.1, 0.3), orientation(-0.5, Math.PI / 2))
  layout.capture(vector(9, 9, 9), orientation(1, 0))
  close(layout.position(vector(0, 1.5, -1.5), vector()), vector(-1, 1.1, 0.3))
  close(layout.position(vector(0.6325, 2.02, -1.5), vector()), vector(-1, 1.62, -0.3325))
})

test("exit restores web positions and reentry captures a fresh pose without accumulating offsets", () => {
  const layout = createVRMemoryLayout()
  const home = vector(0, 1.5, -1.5)
  layout.begin()
  layout.capture(vector(1, 1, 1), orientation(0, Math.PI))
  layout.reset()
  close(layout.position(home, vector()), home)
  assert.equal(layout.pending, false)
  layout.begin()
  layout.capture(vector(0, 1.7, 0), orientation(0.8, 0))
  close(layout.position(home, vector()), vector(0, 1.7, -1.5))
  close(home, vector(0, 1.5, -1.5))
})
