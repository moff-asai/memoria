import assert from "node:assert/strict"
import test from "node:test"
import { ownMemoryPosition } from "../src/ownMemoryLayout.ts"

test("own gallery uses the demo's centered three-column spacing", () => {
  assert.deepEqual([0, 1, 2].map(index => ownMemoryPosition(index, 3).x), [-0.6325, 0, 0.6325])
  assert.equal(ownMemoryPosition(0, 1).x, 0)
  const slots = Array.from({ length: 9 }, (_, index) => ownMemoryPosition(index, 9))
  assert.equal(new Set(slots.map(slot => `${slot.x},${slot.y}`)).size, 9)
  assert(slots.every(slot => slot.z < 0 && Math.abs(slot.y) <= 0.54))
})
test("mobile galleries stay centered and separated vertically", () => {
  const slots = [0, 1, 2].map(index => ownMemoryPosition(index, 3, true))
  assert(slots.every(slot => slot.x === 0))
  assert.equal(slots[0].y - slots[1].y, 0.54)
  assert.equal(slots[1].y - slots[2].y, 0.54)
})
