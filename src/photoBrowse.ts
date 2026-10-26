/** -1 steps to the previous photo, 1 to the next. */
export type PhotoStep = -1 | 1

/**
 * The photo `step` away from `index`, or null past the first or last one:
 * stepping never wraps around.
 */
export const adjacentPhoto = (index: number, step: PhotoStep, count: number) => {
  const next = index + step
  return next >= 0 && next < count ? next : null
}

/** Whether stepping back or forward from `index` can go anywhere. */
export const photoNavigation = (index: number, count: number) => ({
  previous: adjacentPhoto(index, -1, count) !== null,
  next: adjacentPhoto(index, 1, count) !== null,
})

export const SWIPE_DISTANCE = 50
export const SWIPE_MILLISECONDS = 400

/**
 * A quick, mostly horizontal flick (in CSS pixels and milliseconds) steps
 * like a carousel: flicking left shows the next photo, right the previous.
 * Slower or more vertical drags only look around.
 */
export const swipeStep = (
  dx: number,
  dy: number,
  milliseconds: number,
): PhotoStep | 0 => {
  if (milliseconds > SWIPE_MILLISECONDS) return 0
  if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return 0
  return dx < 0 ? 1 : -1
}

export const STICK_PRESS = 0.7
export const STICK_RELEASE = 0.3

/**
 * One step per tilt of a thumbstick: tilting past STICK_PRESS steps once,
 * and the stick must ease back under STICK_RELEASE before it steps again.
 */
export function createStickStepper() {
  let armed = true
  return (x: number): PhotoStep | 0 => {
    if (Math.abs(x) < STICK_RELEASE) armed = true
    if (!armed || Math.abs(x) < STICK_PRESS) return 0
    armed = false
    return x > 0 ? 1 : -1
  }
}
