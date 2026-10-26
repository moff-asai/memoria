import * as THREE from "three"

/** Seconds the web camera takes to glide toward (or back from) a memory. */
export const TRAVEL_SECONDS = 1.1
/** How far short of a memory the viewer stops before it opens around them. */
export const APPROACH_GAP = 0.24

const PITCH_LIMIT = 1.2

/** Web camera pose: eye position plus yaw/pitch (rotation order YXZ). */
export type ViewPose = {
  position: THREE.Vector3
  yaw: number
  pitch: number
}

export type TravelKind = "approach" | "return"

/** `angle` wrapped into [-π, π): the short way round. */
export const wrapAngle = (angle: number) =>
  THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI

export const clonePose = ({ position, yaw, pitch }: ViewPose): ViewPose => ({
  position: position.clone(),
  yaw,
  pitch,
})

/**
 * Where the viewer stands to face `target` from `gap` away. Eye height is
 * kept, the walkable radius is respected, and yaw turns the short way.
 */
export function approachPose(
  from: ViewPose,
  target: THREE.Vector3,
  { gap = APPROACH_GAP, walkRadius = Infinity } = {},
): ViewPose {
  const position = from.position.clone()
  const dx = target.x - position.x
  const dz = target.z - position.z
  const distance = Math.hypot(dx, dz)
  if (distance > gap) {
    const travel = (distance - gap) / distance
    position.x += dx * travel
    position.z += dz * travel
  }
  const radial = Math.hypot(position.x, position.z)
  if (radial > walkRadius) {
    position.x *= walkRadius / radial
    position.z *= walkRadius / radial
  }
  const lookX = target.x - position.x
  const lookZ = target.z - position.z
  return {
    position,
    yaw: from.yaw + wrapAngle(Math.atan2(-lookX, -lookZ) - from.yaw),
    pitch: THREE.MathUtils.clamp(
      Math.atan2(target.y - position.y, Math.hypot(lookX, lookZ)),
      -PITCH_LIMIT,
      PITCH_LIMIT,
    ),
  }
}

/**
 * Web-camera glide between layers: approach while bubbles unfold around the
 * viewer, report arrival, then glide back home once the memory has closed.
 * Looking around (`turn`) still works mid-glide and carries into the pose
 * the viewer arrives at.
 */
export function createSphereJourney<T>({
  readPose,
  writePose,
  prefersReducedMotion = () => false,
  walkRadius = Infinity,
}: {
  readPose: () => ViewPose
  writePose: (pose: ViewPose) => void
  prefersReducedMotion?: () => boolean
  walkRadius?: number
}) {
  // Pose before the current approach; the viewer returns here afterwards.
  let home: ViewPose | null = null
  let travel: {
    kind: TravelKind
    target: T | null
    elapsed: number
    from: ViewPose
    to: ViewPose
    arrive: () => void
  } | null = null
  const pose: ViewPose = { position: new THREE.Vector3(), yaw: 0, pitch: 0 }

  const travelTo = (
    kind: TravelKind,
    target: T | null,
    to: ViewPose,
    arrive: () => void,
  ) => {
    if (prefersReducedMotion()) {
      writePose(to)
      arrive()
      return
    }
    const from = clonePose(readPose())
    travel = {
      kind,
      target,
      elapsed: 0,
      from,
      to: { ...to, yaw: from.yaw + wrapAngle(to.yaw - from.yaw) },
      arrive,
    }
  }

  const returnHome = () => {
    travel = null
    const to = home
    if (!to) return
    travelTo("return", null, to, () => {
      home = null
    })
  }

  return {
    get travelling(): TravelKind | null {
      return travel?.kind ?? null
    },
    /** The memory being approached, only while the glide is in progress. */
    get approaching(): T | null {
      return travel?.kind === "approach" ? travel.target : null
    },
    /** Glide up to `center` in front of `target`, then hand over to `arrive`. */
    approach(target: T, center: THREE.Vector3, arrive: () => void) {
      if (travel) return
      const from = readPose()
      home ??= clonePose(from)
      travelTo(
        "approach",
        target,
        approachPose(from, center, { walkRadius }),
        arrive,
      )
    },
    /** Glide back to where the viewer stood before the last approach. */
    returnHome,
    /**
     * Look around mid-glide: the turn is added to both ends of the glide so
     * it stays in the pose the viewer arrives at. Returns false (and does
     * nothing) when no glide is in progress.
     */
    turn(yaw: number, pitch: number) {
      if (!travel) return false
      const { from, to } = travel
      from.yaw += yaw
      to.yaw += yaw
      from.pitch = THREE.MathUtils.clamp(from.pitch + pitch, -PITCH_LIMIT, PITCH_LIMIT)
      to.pitch = THREE.MathUtils.clamp(to.pitch + pitch, -PITCH_LIMIT, PITCH_LIMIT)
      return true
    },
    /** Snap home without animation, e.g. when an XR session starts or ends. */
    reset() {
      travel = null
      if (home) writePose(home)
      home = null
    },
    update(delta = 0) {
      if (!travel) return
      travel.elapsed += Math.max(0, delta)
      const progress = Math.min(travel.elapsed / TRAVEL_SECONDS, 1)
      const eased = THREE.MathUtils.smootherstep(progress, 0, 1)
      const { from, to } = travel
      pose.position.lerpVectors(from.position, to.position, eased)
      pose.yaw = THREE.MathUtils.lerp(from.yaw, to.yaw, eased)
      pose.pitch = THREE.MathUtils.lerp(from.pitch, to.pitch, eased)
      writePose(pose)
      if (progress === 1) {
        const { arrive } = travel
        travel = null
        arrive()
      }
    },
    dispose() {
      travel = null
    },
  }
}

export type SphereJourney<T> = ReturnType<typeof createSphereJourney<T>>
