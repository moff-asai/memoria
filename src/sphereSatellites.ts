import * as THREE from "three"

const RESTING_COUNT = 4
const MAX_RESTING_SCALE = 0.74 * 0.6
const FOCUSED_SCALES = [0.49, 0.49, 0.58, 0.48, 0.42, 0.46] as const
const RADIAL_DRIFT = 0.055
const PULSE = 0.04

/** One reversible timeline: buds grow inside the parent before drifting free. */
export function bubbleFocusPhases(progress: number) {
  const t = THREE.MathUtils.clamp(progress, 0, 1)
  return {
    birth: THREE.MathUtils.smoothstep(t, 0.02, 0.42),
    release: THREE.MathUtils.smoothstep(t, 0.2, 0.94),
    coreScale: THREE.MathUtils.lerp(1, 0.52, THREE.MathUtils.smoothstep(t, 0.14, 0.92)),
    neck: Math.sin(Math.PI * t) ** 2,
  }
}

export function createSphereSatellites(
  geometry: THREE.SphereGeometry,
  material: THREE.MeshStandardMaterial,
  photoCount: number,
) {
  const mainRadius = geometry.parameters.radius
  // Random angular gaps avoid the cross-shaped, quarter-turn arrangement.
  // A lower bound keeps the initial previews from piling up on one side.
  const gaps = Array.from({ length: RESTING_COUNT }, () => THREE.MathUtils.randFloat(0.65, 1.35))
  const totalGap = gaps.reduce((sum, gap) => sum + gap, 0)
  let nextAngle = THREE.MathUtils.randFloat(0, Math.PI * 2)
  const angles = gaps.map((gap) => {
    const angle = nextAngle
    nextAngle += gap / totalGap * Math.PI * 2
    return angle
  })
  // Two extra bubbles emerge into the widest gaps when the memory is focused.
  const extraAngles = gaps.map((gap, index) => ({
    gap,
    angle: angles[index] + gap / totalGap * Math.PI,
  })).sort((left, right) => right.gap - left.gap).slice(0, 2).map(({ angle }) => angle)
  const satellites = FOCUSED_SCALES.map((focusedScale, index) => {
    const resting = index < RESTING_COUNT
    const scale = resting
      ? index === 2 ? MAX_RESTING_SCALE : THREE.MathUtils.randFloat(0.28, 0.4)
      : focusedScale
    // Smaller resting bubbles sit closer so they still overlap the main film.
    const radius = mainRadius * (resting
      ? THREE.MathUtils.randFloat(1.12, Math.min(1.3, 1 + scale * 0.7))
      : THREE.MathUtils.randFloat(1.12, 1.3))
    const depth = mainRadius * THREE.MathUtils.randFloat(-0.24, 0.24)
    const depthDrift = mainRadius * 0.14
    const focusExpansion = mainRadius * THREE.MathUtils.randFloat(0.18, 0.24)
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = `MemoryPreview-${index + 1}`
    return {
      mesh,
      // Extra photos remain available in the ring; empty bubbles keep the silhouette.
      photoIndex: index < photoCount ? index + 1 : null,
      angle: resting ? angles[index] : extraAngles[index - RESTING_COUNT],
      resting,
      focusedScale,
      focusExpansion,
      phase: THREE.MathUtils.randFloat(0, Math.PI * 2),
      scale,
      radius,
      depth,
      depthDrift,
      swaySpeed: THREE.MathUtils.randFloat(0.18, 0.34),
      driftSpeed: THREE.MathUtils.randFloat(0.3, 0.6),
      pulseSpeed: THREE.MathUtils.randFloat(0.45, 0.75),
      // Maximum animated extent keeps the hover label below the moving bubbles.
      reach: Math.hypot(radius * (1 + RADIAL_DRIFT) + focusExpansion, Math.abs(depth) + depthDrift)
        + mainRadius * Math.max(scale, focusedScale) * (1 + PULSE),
      expansion: 0.12,
    }
  })
  updateSphereSatellites(satellites, 0, 0)
  return satellites
}

export function updateSphereSatellites(
  satellites: ReturnType<typeof createSphereSatellites>,
  elapsed: number,
  spread: number,
  focus = 0,
) {
  const phases = bubbleFocusPhases(focus)
  for (const satellite of satellites) {
    const appearance = satellite.resting ? 1 : phases.birth
    satellite.mesh.visible = appearance > 0.001
    // Layered, bounded waves feel like a breeze rather than a mechanical orbit.
    const angle = satellite.angle
      + Math.sin(elapsed * satellite.swaySpeed + satellite.phase) * 0.24
      + Math.sin(elapsed * satellite.driftSpeed * 0.43 + satellite.phase * 1.7) * 0.08
    const radius = (
      satellite.radius
        * (1 + Math.sin(elapsed * satellite.driftSpeed * 0.73 + satellite.phase) * RADIAL_DRIFT)
        * (satellite.resting ? 1 - phases.neck * 0.12 : phases.release)
        + satellite.focusExpansion * phases.release
        + satellite.expansion * spread
    )
    satellite.mesh.position.set(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      (satellite.depth
        + Math.sin(elapsed * satellite.driftSpeed * 0.43 + satellite.phase) * satellite.depthDrift)
        * (satellite.resting ? 1 : phases.release),
    )
    // A tiny volume-preserving squash suggests a flexible soap film.
    const breath = 1 + Math.sin(elapsed * satellite.pulseSpeed * 0.5 + satellite.phase) * 0.012
    const wobble = 1 + Math.sin(elapsed * satellite.pulseSpeed + satellite.phase) * 0.025
    const size = THREE.MathUtils.lerp(satellite.scale, satellite.focusedScale, phases.release) * breath * appearance
    satellite.mesh.scale.set(
      size * wobble,
      size / wobble,
      size,
    )
    // The new photos reveal only as their bubbles leave the parent membrane.
    for (const child of satellite.mesh.children) {
      if ((child as THREE.Sprite).isSprite) {
        const photoSize = 0.29 * (satellite.resting ? 1 : phases.release)
        child.scale.set(photoSize, photoSize, 1)
      }
    }
  }
}
