import assert from "node:assert/strict"
import test from "node:test"
import {
  adjacentPhoto,
  createStickStepper,
  photoNavigation,
  STICK_PRESS,
  STICK_RELEASE,
  SWIPE_DISTANCE,
  SWIPE_MILLISECONDS,
  swipeStep,
} from "../src/photoBrowse.ts"

test("adjacentPhoto steps one photo and never wraps past either end", () => {
  assert.equal(adjacentPhoto(2, 1, 5), 3)
  assert.equal(adjacentPhoto(2, -1, 5), 1)
  assert.equal(adjacentPhoto(0, -1, 5), null, "nothing before the first photo")
  assert.equal(adjacentPhoto(4, 1, 5), null, "nothing after the last photo")
  assert.equal(adjacentPhoto(0, 1, 1), null, "a single photo goes nowhere")
})

test("stepping forward from the first photo reaches every photo in order", () => {
  const seen = [0]
  for (let index = 0; ; ) {
    const next = adjacentPhoto(index, 1, 7)
    if (next === null) break
    seen.push((index = next))
  }
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5, 6])
})

test("photoNavigation disables only the blocked direction", () => {
  assert.deepEqual(photoNavigation(0, 3), { previous: false, next: true })
  assert.deepEqual(photoNavigation(1, 3), { previous: true, next: true })
  assert.deepEqual(photoNavigation(2, 3), { previous: true, next: false })
  assert.deepEqual(photoNavigation(0, 1), { previous: false, next: false })
})

test("a quick sideways flick steps like a carousel; drags only look", () => {
  assert.equal(swipeStep(-SWIPE_DISTANCE - 10, 8, 120), 1, "flick left → next")
  assert.equal(swipeStep(SWIPE_DISTANCE + 10, -8, 120), -1, "flick right → previous")
  assert.equal(swipeStep(-SWIPE_DISTANCE + 5, 0, 120), 0, "too short")
  assert.equal(swipeStep(-120, 0, SWIPE_MILLISECONDS + 50), 0, "too slow: a look-around drag")
  assert.equal(swipeStep(-90, 80, 120), 0, "too vertical")
})

test("a thumbstick steps once per tilt and must recenter before stepping again", () => {
  const step = createStickStepper()
  assert.equal(step(0), 0)
  assert.equal(step(STICK_PRESS + 0.1), 1, "tilting right steps forward")
  assert.equal(step(1), 0, "holding the tilt does not repeat")
  assert.equal(step(STICK_RELEASE + 0.1), 0, "not yet recentered")
  assert.equal(step(-1), 0, "flicking through the other side without recentering")
  assert.equal(step(0), 0)
  assert.equal(step(-STICK_PRESS - 0.1), -1, "tilting left steps back")
  assert.equal(createStickStepper()(0.5), 0, "a half tilt does nothing")
})
