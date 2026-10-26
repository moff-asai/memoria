import assert from "node:assert/strict"
import test from "node:test"
import * as THREE from "three"
import {
  APPROACH_GAP,
  approachPose,
  createSphereJourney,
  TRAVEL_SECONDS,
} from "../src/sphereJourney.ts"

const close = (actual, expected, message) =>
  assert(Math.abs(actual - expected) < 1e-9, `${message}: ${actual} ≠ ${expected}`)

function fixture(t, { reducedMotion = false, walkRadius = 2.35 } = {}) {
  const camera = new THREE.PerspectiveCamera(70, 1.5, 0.01, 100)
  camera.position.set(0, 1.5, 0)
  const look = { yaw: 0, pitch: 0 }
  const memory = { title: "テストの記憶" }
  const center = new THREE.Vector3(0.6325, 1.5, -1.5)
  const journey = createSphereJourney({
    readPose: () => ({ position: camera.position, yaw: look.yaw, pitch: look.pitch }),
    writePose: ({ position, yaw, pitch }) => {
      camera.position.copy(position)
      look.yaw = yaw
      look.pitch = pitch
    },
    prefersReducedMotion: () => reducedMotion,
    walkRadius,
  })
  t.after(() => journey.dispose())
  const pose = () => ({
    position: camera.position.toArray(),
    yaw: look.yaw,
    pitch: look.pitch,
  })
  return { camera, look, memory, center, journey, pose }
}

test("approachPose stops short of the memory at eye height and faces it", () => {
  const from = { position: new THREE.Vector3(0, 1.5, 0), yaw: 0, pitch: 0 }
  const target = new THREE.Vector3(0, 1.5, -1.5)
  const to = approachPose(from, target)
  close(to.position.distanceTo(target), APPROACH_GAP, "gap to the memory")
  assert(APPROACH_GAP <= 0.3, "the viewer enters the bubble cluster, not just its distant edge")
  close(to.position.y, 1.5, "eye height is kept")
  close(to.yaw, 0, "already facing the memory")
  close(to.pitch, 0, "level with the memory")
  assert.notEqual(to.position, from.position, "the source pose is not mutated")
  close(from.position.z, 0, "source position unchanged")
})

test("approachPose stays put when already close, and respects the walk radius", () => {
  const nearZ = -1.5 + APPROACH_GAP / 2
  const near = approachPose(
    { position: new THREE.Vector3(0, 1.5, nearZ), yaw: 0, pitch: 0 },
    new THREE.Vector3(0, 1.5, -1.5),
  )
  close(near.position.z, nearZ, "no step backwards")
  const far = approachPose(
    { position: new THREE.Vector3(0, 1.5, 0), yaw: 0, pitch: 0 },
    new THREE.Vector3(0, 1.5, -5),
    { walkRadius: 2 },
  )
  close(Math.hypot(far.position.x, far.position.z), 2, "clamped to the walkable area")
})

test("approachPose turns the short way and looks up at higher memories", () => {
  const to = approachPose(
    { position: new THREE.Vector3(0, 1.5, 0), yaw: Math.PI * 2 - 0.1, pitch: 0 },
    new THREE.Vector3(0, 2.2, -1.5),
  )
  assert(Math.abs(to.yaw - Math.PI * 2) < 0.2, "yaw unwinds less than half a turn")
  assert(to.pitch > 0, "looks up")
})

test("approach reports arrival after TRAVEL_SECONDS while the cloud can unfold alongside it", (t) => {
  const { journey, memory, center, pose } = fixture(t)
  const origin = pose()
  assert.equal(journey.approaching, null)
  let arrived = 0
  journey.approach(memory, center, () => arrived++)
  assert.equal(journey.travelling, "approach")
  assert.equal(journey.approaching, memory, "the approached memory is known mid-glide")
  journey.update(TRAVEL_SECONDS / 2)
  assert.equal(arrived, 0, "arrival is not reported mid-glide")
  assert.notDeepEqual(pose().position, origin.position, "the camera visibly moves")
  journey.approach({ title: "別の記憶" }, center, () => arrived++)
  assert.equal(journey.approaching, memory, "a second approach is ignored mid-glide")
  journey.update(TRAVEL_SECONDS)
  assert.equal(arrived, 1)
  assert.equal(journey.travelling, null)
  assert.equal(journey.approaching, null, "arrival ends the approach")
  const camera = new THREE.Vector3().fromArray(pose().position)
  close(camera.distanceTo(center), APPROACH_GAP, "stops in front of the memory")
})

test("returnHome glides back to the exact pose before the approach", (t) => {
  const { journey, memory, center, pose, look } = fixture(t)
  look.yaw = 0.4
  look.pitch = -0.2
  const origin = pose()
  journey.approach(memory, center, () => {})
  journey.update(TRAVEL_SECONDS)
  journey.returnHome()
  assert.equal(journey.travelling, "return")
  assert.equal(journey.approaching, null, "returning is not approaching")
  journey.update(TRAVEL_SECONDS / 2)
  assert.notDeepEqual(pose(), origin)
  journey.update(TRAVEL_SECONDS)
  assert.equal(journey.travelling, null)
  assert.deepEqual(pose().position, origin.position)
  close(pose().yaw, origin.yaw, "yaw restored")
  close(pose().pitch, origin.pitch, "pitch restored")
  journey.returnHome()
  assert.equal(journey.travelling, null, "no second return without an approach")
})

test("returnHome mid-approach calls the approach off and glides back home", (t) => {
  const { journey, memory, center, pose, look } = fixture(t)
  look.yaw = 0.3
  const origin = pose()
  let arrived = 0
  journey.approach(memory, center, () => arrived++)
  journey.update(TRAVEL_SECONDS * 0.4)
  journey.turn(0.5, 0)
  journey.returnHome()
  assert.equal(journey.travelling, "return", "cancelling turns the glide around")
  assert.equal(journey.approaching, null, "the memory is no longer approached")
  journey.update(TRAVEL_SECONDS * 2)
  assert.equal(arrived, 0, "a cancelled approach never opens the memory")
  assert.equal(journey.travelling, null)
  assert.deepEqual(pose().position, origin.position, "back where the viewer stood")
  close(pose().yaw, origin.yaw, "yaw restored")
  close(pose().pitch, origin.pitch, "pitch restored")
  journey.approach(memory, center, () => arrived++)
  journey.update(TRAVEL_SECONDS)
  assert.equal(arrived, 1, "the memory can be approached again afterwards")
})

test("turn does nothing outside a glide", (t) => {
  const { journey, pose } = fixture(t)
  const before = pose()
  assert.equal(journey.turn(0.3, 0.1), false)
  assert.deepEqual(pose(), before)
})

test("looking around mid-approach carries into the arrival pose", (t) => {
  const { journey, memory, center, pose } = fixture(t)
  const expected = approachPose(
    { position: new THREE.Vector3(0, 1.5, 0), yaw: 0, pitch: 0 },
    center,
    { walkRadius: 2.35 },
  )
  journey.approach(memory, center, () => {})
  journey.update(TRAVEL_SECONDS / 3)
  assert.equal(journey.turn(0.3, 0.1), true)
  journey.update(TRAVEL_SECONDS)
  close(pose().yaw, expected.yaw + 0.3, "yaw keeps the drag")
  close(pose().pitch, expected.pitch + 0.1, "pitch keeps the drag")
  assert.deepEqual(
    pose().position,
    expected.position.toArray(),
    "looking around never moves the viewer",
  )
})

test("turning mid-glide keeps pitch within the look limit", (t) => {
  const { journey, memory, center, pose } = fixture(t)
  journey.approach(memory, center, () => {})
  journey.update(TRAVEL_SECONDS / 4)
  journey.turn(0, 5)
  journey.update(TRAVEL_SECONDS)
  assert(pose().pitch <= 1.2 + 1e-9, `pitch is clamped (${pose().pitch})`)
})

test("looking around mid-return lands exactly home, still facing the new way", (t) => {
  const { journey, memory, center, pose } = fixture(t)
  const origin = pose()
  journey.approach(memory, center, () => {})
  journey.update(TRAVEL_SECONDS)
  journey.returnHome()
  journey.update(TRAVEL_SECONDS / 2)
  assert.equal(journey.turn(-0.5, 0.2), true)
  journey.update(TRAVEL_SECONDS)
  assert.equal(journey.travelling, null)
  assert.deepEqual(pose().position, origin.position, "position is home")
  close(pose().yaw, origin.yaw - 0.5, "yaw keeps the drag")
  close(pose().pitch, origin.pitch + 0.2, "pitch keeps the drag")
})

test("reduced motion moves and opens immediately", (t) => {
  const { journey, memory, center, pose } = fixture(t, { reducedMotion: true })
  const origin = pose()
  let arrived = false
  journey.approach(memory, center, () => {
    arrived = true
  })
  assert(arrived, "opens in the same frame")
  assert.equal(journey.travelling, null)
  assert.equal(journey.approaching, null)
  journey.returnHome()
  assert.equal(journey.travelling, null)
  assert.deepEqual(pose().position, origin.position)
})

test("reset snaps home mid-approach, e.g. when an XR session starts", (t) => {
  const { journey, memory, center, pose } = fixture(t)
  const origin = pose()
  let arrived = false
  journey.approach(memory, center, () => {
    arrived = true
  })
  journey.update(TRAVEL_SECONDS / 2)
  journey.reset()
  assert.equal(journey.travelling, null)
  assert.equal(journey.approaching, null)
  assert.deepEqual(pose(), origin)
  journey.update(TRAVEL_SECONDS)
  assert.equal(arrived, false, "the memory never opens")
})
