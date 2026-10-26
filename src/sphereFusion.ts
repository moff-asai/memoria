import type { Mesh, Vector3 } from "three"
import type { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js"

/** A shared fluid membrane follows the animated lobes, including their necks. */
export function updateBubbleFusion(
  surface: MarchingCubes,
  bubbles: readonly Mesh[],
  baseRadius: number,
  origin?: Vector3,
) {
  const fieldWidth = surface.scale.x * 2
  const subtract = 24
  surface.reset()
  for (const bubble of bubbles) {
    if (!bubble.visible) continue
    const radius = baseRadius * Math.cbrt(bubble.scale.x * bubble.scale.y * bubble.scale.z)
    if (radius < 0.0001) continue
    surface.addBall(
      0.5 + (bubble.position.x - (origin?.x ?? 0)) / fieldWidth,
      0.5 + (bubble.position.y - (origin?.y ?? 0)) / fieldWidth,
      0.5 + (bubble.position.z - (origin?.z ?? 0)) / fieldWidth,
      (surface.isolation + subtract) * (radius / fieldWidth) ** 2,
      subtract,
    )
  }
  surface.update()
}

export function updateSphereFusion(
  surface: MarchingCubes,
  fragments: readonly { target: Vector3 }[],
  initialSpread: number,
  progress: number,
) {
  const eased = progress * progress * (3 - 2 * progress)
  const spread = initialSpread * (1 - eased)
  const fieldWidth = surface.scale.x * 2
  const subtract = 12
  const fragmentRadius = 0.075 * initialSpread
  // Calibrate both ends so separate lobes join into the original 0.15m sphere.
  const separateStrength =
    (surface.isolation + subtract) * (fragmentRadius / fieldWidth) ** 2
  const mergedStrength =
    ((surface.isolation + fragments.length * subtract) / fragments.length) *
    (0.15 / fieldWidth) ** 2
  const strength =
    separateStrength + (mergedStrength - separateStrength) * eased

  surface.reset()
  for (const { target } of fragments) {
    surface.addBall(
      0.5 + (target.x * spread) / fieldWidth,
      0.5 + (target.y * spread) / fieldWidth,
      0.5 + (target.z * spread) / fieldWidth,
      strength,
      subtract,
    )
  }
  surface.update()
}
