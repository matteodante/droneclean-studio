// The tracked shadow's circle on the preview, at the frame being shown (design 4.1, section 7).
//
// The free pass's points arrive in source pixels and source frames; `MarkShadowOverlay` projects
// them through the clip's own placement once, and this component only picks the one on the frame
// the playhead shows, or nothing when the pass has no point there (the tracker lost the shadow, or
// the playhead is outside the tracked stretches).

/** One tracked frame, already in CSS pixels inside the overlay that covers the player. */
interface ShadowTrackedCircle {
  frame: number
  left: number
  top: number
  width: number
  height: number
  /** The clip's rotation, which turns the source circle into a turned ellipse. */
  rotation: number
}

interface TrackedShadowOverlayProps {
  circles: ShadowTrackedCircle[]
  /** The source frame the playhead shows right now. */
  sourceFrame: number
}

/** The tracked shadow's circle on one source frame, or nothing when the pass did not find it there. */
export function TrackedShadowOverlay({ circles, sourceFrame }: TrackedShadowOverlayProps) {
  const circle = circles.find((candidate) => candidate.frame === sourceFrame)
  if (!circle) return null
  return (
    <div
      data-testid="shadow-tracked-circle"
      aria-hidden="true"
      className="pointer-events-none absolute rounded-full border-2"
      style={{
        left: circle.left,
        top: circle.top,
        width: circle.width,
        height: circle.height,
        borderColor: '#FFB938',
        boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.55)',
        transform: `rotate(${circle.rotation}deg)`,
      }}
    />
  )
}
