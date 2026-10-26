import { createElement, useRef, type ComponentPropsWithRef } from "react"
import { type PhotoStep, photoNavigation } from "./photoBrowse"
import { placeTrail, RING_GUIDE } from "./sceneGuide"

/**
 * Which layer the viewer is in. Pressing goes one layer down
 * (space → ring → photo); "戻る" or Esc goes one layer up. Every animation
 * between layers is "transition", where only looking around is accepted —
 * except the approach, which "戻る" or Esc calls off. Only the space lets the
 * viewer walk; the ring and photo layers surround them. The photo layer
 * steps between the memory's photos in place.
 */
export type SceneMode = "space" | "ring" | "photo" | "transition"

/**
 * Where the viewer has chosen to be, for the breadcrumb. It moves on the
 * press, not when the animation lands: gliding up to a memory or unrolling a
 * photo already counts as being there, and 戻る leaves at once.
 */
export type ScenePlace = "space" | "memory" | "photo"

/** What the HTML overlay mirrors from the 3D scene. */
export type SceneView = {
  mode: SceneMode
  place: ScenePlace
  /** Gliding up to a memory; the only transition that can be called off. */
  approaching: boolean
  title: string
  photoCount: number
  /** The photo on the curved screen, as an index into the memory's photos. */
  photoIndex: number | null
}

export const initialSceneView: SceneView = {
  mode: "space",
  place: "space",
  approaching: false,
  title: "",
  photoCount: 0,
  photoIndex: null,
}

// The navigation actions share the existing composer's pill-button language.
export function ActionButton(props: ComponentPropsWithRef<"button">) {
  return createElement("button", { type: "button", ...props })
}

// Every way back is named 戻る; Esc is a key hint, not part of the name.
function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <ActionButton className="ov-pill" aria-keyshortcuts="Escape" onClick={onClick}>
      戻る
      <span className="journey-key" aria-hidden="true">
        Esc
      </span>
    </ActionButton>
  )
}

/**
 * The trail to where the viewer is, top center: hidden in the space,
 * 空間 › {title} in a memory, and 空間 › {title} › 写真 n/N on a photo.
 */
export function SceneBreadcrumb({ view }: { view: SceneView }) {
  const shown = view.place !== "space"
  // Keep the last trail on screen while it fades out toward the space.
  const trail = useRef<string[]>(["空間", ""])
  if (shown) trail.current = placeTrail(view)
  const kinds = ["space", "memory", "photo"]
  const crumbs = trail.current.map((label, index) => ({ kind: kinds[index], label }))
  return (
    <nav
      className="journey-crumbs"
      aria-label="現在地"
      aria-hidden={!shown}
      data-shown={shown}
    >
      <ol aria-live="polite">
        {crumbs.map(({ kind, label }, index) => (
          <li
            key={kind}
            className="journey-crumb"
            data-kind={kind}
            aria-current={index === crumbs.length - 1 ? "location" : undefined}
          >
            {index > 0 && (
              <span className="journey-crumb-sep" aria-hidden="true">
                ›
              </span>
            )}
            <span className="journey-crumb-label">{label}</span>
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function SphereControls({
  view,
  onBack,
  onStep,
}: {
  view: SceneView
  onBack: () => void
  onStep: (step: PhotoStep) => void
}) {
  // Always mounted so the ring overlay can fade out instead of vanishing.
  const inRing = view.mode === "ring"
  const inPhoto = view.mode === "photo"
  const { previous, next } = photoNavigation(view.photoIndex ?? 0, view.photoCount)
  return (
    <>
      {/* The ring's 戻る sits where the approach's lone 戻る was. */}
      <div className="journey-toolbar" inert={!inRing && !inPhoto}>
        <p className="journey-caption" role="status">
          {inRing ? RING_GUIDE : ""}
        </p>
        <div className="journey-back">
          <BackButton onClick={onBack} />
        </div>
      </div>
      <div
        className="journey-cancel journey-back"
        data-shown={view.approaching}
        inert={!view.approaching}
      >
        <BackButton onClick={onBack} />
      </div>
      {/* The photo layer's arrows wait at the screen's edges; past the first
       * or last photo the arrow fades back and does nothing. */}
      <div className="photo-nav" inert={!inPhoto}>
        <ActionButton
          className="photo-nav-button"
          data-side="previous"
          aria-label="前の写真"
          disabled={!previous}
          onClick={() => onStep(-1)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m15 5-7 7 7 7" />
          </svg>
        </ActionButton>
        <ActionButton
          className="photo-nav-button"
          data-side="next"
          aria-label="次の写真"
          disabled={!next}
          onClick={() => onStep(1)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 5 7 7-7 7" />
          </svg>
        </ActionButton>
      </div>
    </>
  )
}
