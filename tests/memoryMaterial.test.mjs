import assert from "node:assert/strict"
import test from "node:test"
import * as THREE from "three"
import { createMemoryMaterials } from "../src/memoryMaterial.ts"

// A representative theme color; production reads the --sphere design token.
const base = new THREE.Color().setHSL(0.72, 0.57, 0.77, THREE.SRGBColorSpace)
const create = (t, key) => {
  const materials = createMemoryMaterials(base, key)
  t.after(() => {
    materials.material.dispose()
    materials.paleMaterial.dispose()
  })
  return materials
}

test("each built-in memory gets a different subtle tint", (t) => {
  const colors = ["assets-2", "assets-1", "assets-3"].map((directory) =>
    create(t, `builtin:${directory}`).material.color,
  )
  assert.equal(new Set(colors.map((color) => color.getHexString())).size, 3)
  const hues = colors.map((color) =>
    color.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace).h,
  )
  for (let index = 0; index < hues.length; index++) {
    for (let other = index + 1; other < hues.length; other++) {
      assert(Math.abs(hues[index] - hues[other]) > 0.02, "visibly different, not just different hex values")
    }
  }
})

test("a memory's tint survives reloads and a different loading order", (t) => {
  const before = create(t, "memory:shared-id").material.color
  create(t, "memory:newer-id")
  const after = create(t, "memory:shared-id").material.color
  assert(before.equals(after))
  assert(!before.equals(create(t, "memory:another-id").material.color))
})

test("tints stay near the theme's hue, saturation, and lightness without mutating it", (t) => {
  const original = base.clone()
  // three.js's linear/sRGB conversion has a small round-trip error.
  const tolerance = 1e-4
  for (let index = 0; index < 100; index++) {
    const hsl = create(t, `memory:${index}`).material.color.getHSL(
      { h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace,
    )
    assert(Math.abs(hsl.h - 0.72) <= 0.12 + tolerance)
    assert(Math.abs(hsl.s - 0.57) <= 0.03 + tolerance)
    assert(Math.abs(hsl.l - 0.77) <= 0.01 + tolerance)
  }
  assert(base.equals(original))
})

test("each memory owns its ring fade, while both materials keep the same color and Fresnel", (t) => {
  const first = create(t, "memory:first")
  const second = create(t, "memory:second")
  assert(first.material.color.equals(first.paleMaterial.color))
  assert.notEqual(first.material, first.paleMaterial)
  first.paleMaterial.opacity = 0.2
  assert.equal(first.material.opacity, 0.65)
  assert.equal(second.paleMaterial.opacity, 0.65)
  for (const material of [first.material, first.paleMaterial]) {
    assert.equal(material.transparent, true)
    assert.equal(material.depthWrite, false)
    assert.equal(material.isMeshPhysicalMaterial, true)
    assert.equal(material.roughness, 0.12)
    assert.equal(material.metalness, 0)
    assert.equal(material.ior, 1.33)
    assert.equal(material.clearcoat, 1)
    assert.equal(material.iridescence, 1)
    assert.deepEqual(material.iridescenceThicknessRange, [180, 520])
    const shader = { uniforms: {}, fragmentShader: "#include <opaque_fragment>" }
    material.onBeforeCompile(shader)
    assert(shader.fragmentShader.includes("float rim"))
    assert(shader.fragmentShader.includes("mix(0.025, 0.86, rim)"))
    assert(shader.fragmentShader.includes("vec3 rainbow"))
    assert(shader.fragmentShader.includes("float crescent"))
    assert(shader.fragmentShader.includes("float glint"))
  }
})

test("soap-film colors flow with time, sharing a clock only within the same memory", (t) => {
  const first = create(t, "memory:first")
  const second = create(t, "memory:second")
  const shaders = [first.material, first.paleMaterial, second.material].map(material => {
    const shader = { uniforms: {}, fragmentShader: "#include <opaque_fragment>" }
    material.onBeforeCompile(shader)
    return shader
  })
  assert.equal(shaders[0].uniforms.bubbleTime, shaders[1].uniforms.bubbleTime)
  assert.notEqual(shaders[0].uniforms.bubbleTime, shaders[2].uniforms.bubbleTime)
  assert.notEqual(shaders[0].uniforms.bubblePhase.value, shaders[2].uniforms.bubblePhase.value)
  first.update(12.5)
  assert.equal(shaders[0].uniforms.bubbleTime.value, 12.5)
  assert.equal(shaders[1].uniforms.bubbleTime.value, 12.5)
  assert.equal(shaders[2].uniforms.bubbleTime.value, 0)
  assert.equal(first.material.opacity, 0.65)
})
