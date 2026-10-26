import assert from "node:assert/strict"
import test from "node:test"
import { locationSample } from "../src/privateLocation.ts"

const sample = (latitude = 0.1, longitude = 0.2, accuracy = 5) => ({
  coords: { latitude, longitude, accuracy }, timestamp: 1792951200000,
})
test("location payload contains only one measured position, accuracy and capture time", () => {
  const payload = locationSample(sample())
  assert.deepEqual(Object.keys(payload).sort(), ["accuracy_m", "captured_at", "latitude", "longitude"])
  assert.equal(payload.latitude, 0.1)
  assert.equal(payload.longitude, 0.2)
  assert.equal(payload.accuracy_m, 5)
  assert(Number.isFinite(Date.parse(payload.captured_at)))
})
test("invalid coordinates and accuracy cannot be submitted", () => {
  for (const data of [sample(NaN), sample(Infinity), sample(91), sample(0, -181),
    sample(0, 0, -1), sample(0, 0, Infinity), sample(0, 0, NaN)]) {
    assert.throws(() => locationSample(data))
  }
})
