// The shadow section's overlay on the preview: the one click that marks the shadow, and the
// circles it draws (design 4.1, section 7, slice E5).
//
// The overlay is mounted once by the preview and does nothing until a clip's shadow section is
// open. While the section waits for the mark, the overlay takes the next click on the picture,
// turns it into source pixels through the preview's own screen-to-canvas transform and the clip's
// placement, and writes the mark with the source frame the playhead shows — the exact frame the
// tracker starts from. Afterwards it draws the mark's circle on its own frame and the free pass's
// circle on every tracked frame the pilot scrubs through.
//
// The projection is the renderer's own: the clip's box is `resolveTransform`'s (its explicit
// transform, or the fit-to-canvas default), the source is scaled into that box, flipped and then
// rotated about the anchor exactly as the composition draws it (`toTransformStyle`), and finally
// scaled from the project canvas to the player's CSS pixels, which the overlay covers.

import type { MouseEvent } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useThrottledFrame } from '@/features/preview/hooks/use-throttled-frame'
import { screenToCanvas } from '@/features/preview/utils/coordinate-transform'
import { useMediaLibraryStore } from '@/features/media-library/stores/media-library-store'
import { useTimelineSettingsStore } from '@/features/timeline/stores/timeline-settings-store'
import { getMediaSourceFps } from '@/features/timeline/utils/media-item-frames'
import { cn } from '@/shared/ui/cn'
import { clipSourcePosition } from '@/studio/speed'
import type { VideoItem } from '@/types/timeline'
import { TrackedShadowOverlay } from './TrackedShadowOverlay'
import { useShadowSession, useShadowSessionItem, useShadowSessionStore } from './use-shadow-session'

/**
 * The mark's radius as a share of the source's shorter side. One click gives the tracker a point
 * and a circle around it (the model asks the radius to be positive); 3.5% is the size the engine's
 * own recordings use for the drone's shadow on clip 0020 (96.5 px of 2880, design 4.1, section 6).
 */
const MARK_RADIUS_FRACTION = 0.035

/** The brand's amber, the colour of the circles. */
const SHADOW_COLOR = '#FFB938'

/** Where the clip's source picture sits on the player, and how source pixels map onto it. */
interface ShadowOverlayGeometry {
  /** CSS pixels per project pixel. */
  scaleX: number
  scaleY: number
  /** The clip's drawn box in project pixels: its top-left corner and size. */
  box: { left: number; top: number; width: number; height: number }
  /** The box's rotation and flip origin, in box-local pixels. */
  anchor: { x: number; y: number }
  rotation: number
  flipHorizontal: boolean
  flipVertical: boolean
  /** The source's own size in pixels. */
  source: { width: number; height: number }
}

interface GeometryInput {
  item: VideoItem
  projectSize: { width: number; height: number }
  playerSize: { width: number; height: number }
  source: { width: number; height: number }
}

interface MarkShadowOverlayProps {
  /** The preview's container rectangle, for `screenToCanvas`; null until it is measured. */
  containerRect: DOMRect | null
  playerSize: { width: number; height: number }
  projectSize: { width: number; height: number }
  /** The preview's zoom: -1 for auto-fit, or the scale itself. */
  zoom: number
}

/** Rotates `point` around `center` by `degrees`; the negative angle undoes a render rotation. */
function rotateAround(
  point: { x: number; y: number },
  center: { x: number; y: number },
  degrees: number,
): { x: number; y: number } {
  if (degrees === 0) return point
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const dx = point.x - center.x
  const dy = point.y - center.y
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

/** Mirrors a box-local point inside the box when the clip is flipped; its own inverse. */
function flipInside(
  point: { x: number; y: number },
  geometry: Pick<ShadowOverlayGeometry, 'anchor' | 'flipHorizontal' | 'flipVertical'>,
): { x: number; y: number } {
  return {
    x: geometry.flipHorizontal ? 2 * geometry.anchor.x - point.x : point.x,
    y: geometry.flipVertical ? 2 * geometry.anchor.y - point.y : point.y,
  }
}

/** The stored value, or the default the renderer would use for it. */
function orDefault<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value
}

/**
 * The clip's placement on the player: `resolveTransform`'s defaults (fit the source into the
 * canvas, centred) when the clip has no explicit transform, then the player's scale over the
 * project's. The source's size must be the picture's displayed size, which is the size the preview
 * draws.
 */
function shadowOverlayGeometry({
  item,
  projectSize,
  playerSize,
  source,
}: GeometryInput): ShadowOverlayGeometry {
  const transform = orDefault(item.transform, {})
  const fitScale = Math.min(projectSize.width / source.width, projectSize.height / source.height)
  const width = Math.max(1e-6, orDefault(transform.width, source.width * fitScale))
  const height = Math.max(1e-6, orDefault(transform.height, source.height * fitScale))
  return {
    scaleX: playerSize.width / projectSize.width,
    scaleY: playerSize.height / projectSize.height,
    box: {
      left: projectSize.width / 2 + orDefault(transform.x, 0) - width / 2,
      top: projectSize.height / 2 + orDefault(transform.y, 0) - height / 2,
      width,
      height,
    },
    anchor: {
      x: orDefault(transform.anchorX, width / 2),
      y: orDefault(transform.anchorY, height / 2),
    },
    rotation: orDefault(transform.rotation, 0),
    flipHorizontal: orDefault(transform.flipHorizontal, false),
    flipVertical: orDefault(transform.flipVertical, false),
    source,
  }
}

/** A point in source pixels as CSS pixels inside the overlay, which covers the player exactly. */
function sourcePointToOverlay(
  point: { x: number; y: number },
  geometry: ShadowOverlayGeometry,
): { x: number; y: number } {
  const local = flipInside(
    {
      x: (point.x / geometry.source.width) * geometry.box.width,
      y: (point.y / geometry.source.height) * geometry.box.height,
    },
    geometry,
  )
  const rotated = rotateAround(local, geometry.anchor, geometry.rotation)
  return {
    x: (geometry.box.left + rotated.x) * geometry.scaleX,
    y: (geometry.box.top + rotated.y) * geometry.scaleY,
  }
}

/** The inverse of `sourcePointToOverlay`: a point in project pixels as source pixels. */
function canvasPointToSourcePoint(
  point: { x: number; y: number },
  geometry: ShadowOverlayGeometry,
): { x: number; y: number } {
  const local = rotateAround(
    { x: point.x - geometry.box.left, y: point.y - geometry.box.top },
    geometry.anchor,
    -geometry.rotation,
  )
  const unflipped = flipInside(local, geometry)
  return {
    x: (unflipped.x / geometry.box.width) * geometry.source.width,
    y: (unflipped.y / geometry.box.height) * geometry.source.height,
  }
}

/** A source circle (centre and radius) as the ellipse the box draws it as, in CSS pixels. */
function sourceCircleToOverlay(
  circle: { x: number; y: number; radius: number },
  geometry: ShadowOverlayGeometry,
): { left: number; top: number; width: number; height: number; rotation: number } {
  const center = sourcePointToOverlay(circle, geometry)
  const radiusX = circle.radius * (geometry.box.width / geometry.source.width) * geometry.scaleX
  const radiusY = circle.radius * (geometry.box.height / geometry.source.height) * geometry.scaleY
  return {
    left: center.x - radiusX,
    top: center.y - radiusY,
    width: 2 * radiusX,
    height: 2 * radiusY,
    rotation: geometry.rotation,
  }
}

/**
 * The source frame the playhead shows on a clip, or null when the playhead is outside it: the
 * one mapping's (`clipSourcePosition`), so a curved or cut clip marks the frame it shows
 * (review finding C11).
 */
function playheadSourceFrame(
  item: VideoItem,
  timelineFrame: number,
  timelineFps: number,
): number | null {
  const localFrame = timelineFrame - item.from
  if (localFrame < 0 || localFrame >= item.durationInFrames) return null
  return clipSourcePosition(
    { ...item, sourceFps: getMediaSourceFps(item, timelineFps) },
    localFrame,
    timelineFps,
  ).frame
}

/** The clip's source size, from its own record or, when it has none, from the media library. */
function sourceSizeOf(
  item: VideoItem,
  media: { width: number; height: number } | undefined,
): { width: number; height: number } | null {
  const width = item.sourceWidth ?? media?.width
  const height = item.sourceHeight ?? media?.height
  return width && height ? { width, height } : null
}

/**
 * Draws the mark and the tracked shadow for the open section's clip, and takes the click that
 * writes the mark. Renders nothing while no section is open, so the preview behaves as before.
 */
export function MarkShadowOverlay({
  containerRect,
  playerSize,
  projectSize,
  zoom,
}: MarkShadowOverlayProps) {
  const { t } = useTranslation()
  const session = useShadowSession()
  const item = useShadowSessionItem(session.clipId)
  const media = useMediaLibraryStore((state) =>
    item?.mediaId ? state.mediaById[item.mediaId] : undefined,
  )
  const timelineFrame = useThrottledFrame()
  const timelineFps = useTimelineSettingsStore((state) => state.fps)

  const geometry = useMemo<ShadowOverlayGeometry | null>(() => {
    if (!item) return null
    const source = sourceSizeOf(item, media)
    if (!source) return null
    return shadowOverlayGeometry({ item, projectSize, playerSize, source })
  }, [item, media, playerSize, projectSize])

  const trackedCircles = useMemo(() => {
    if (!geometry || !session.pass) return []
    return session.pass.points.map((point) => ({
      frame: point.frame,
      ...sourceCircleToOverlay(point, geometry),
    }))
  }, [geometry, session.pass])

  if (!session.isOpen || !item || !geometry) return null

  const currentFrame = playheadSourceFrame(item, timelineFrame, timelineFps)
  const mark = item.shadowRemoval?.mark
  const marking = session.marking

  /** The click that sets the mark: screen pixels to the source's own pixels and frame. */
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!marking || !containerRect || currentFrame === null) return
    event.preventDefault()
    event.stopPropagation()
    const canvasPoint = screenToCanvas(event.clientX, event.clientY, {
      containerRect,
      playerSize,
      projectSize,
      zoom,
    })
    const sourcePoint = canvasPointToSourcePoint(canvasPoint, geometry)
    const { width, height } = geometry.source
    if (
      sourcePoint.x < 0 ||
      sourcePoint.y < 0 ||
      sourcePoint.x >= width ||
      sourcePoint.y >= height
    ) {
      return
    }
    const radius = Math.max(1, Math.round(MARK_RADIUS_FRACTION * Math.min(width, height)))
    useShadowSessionStore.getState().setMark(item, {
      x: sourcePoint.x,
      y: sourcePoint.y,
      sourceFrame: currentFrame,
      radius,
    })
  }

  const markCircle =
    mark && currentFrame === mark.sourceFrame ? sourceCircleToOverlay(mark, geometry) : null

  return (
    <div
      data-testid="shadow-mark-overlay"
      className={cn(
        // Above the transform gizmo (z-40): the clip is selected while its shadow is marked, and
        // the gizmo covers the whole picture, so the click must reach this layer first.
        'absolute inset-0 z-50',
        marking ? 'pointer-events-auto cursor-crosshair' : 'pointer-events-none',
      )}
      onClick={marking ? handleClick : undefined}
    >
      {markCircle && (
        <div
          data-testid="shadow-mark-circle"
          aria-hidden="true"
          className="pointer-events-none absolute rounded-full border-2 border-dashed"
          style={{
            left: markCircle.left,
            top: markCircle.top,
            width: markCircle.width,
            height: markCircle.height,
            borderColor: SHADOW_COLOR,
            boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.55)',
            transform: `rotate(${markCircle.rotation}deg)`,
          }}
        />
      )}
      {currentFrame !== null && (
        <TrackedShadowOverlay circles={trackedCircles} sourceFrame={currentFrame} />
      )}
      {marking && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-md bg-black/70 px-2 py-1 text-[11px] font-medium text-white">
          {t('editor.shadowSection.clickHint')}
        </div>
      )}
    </div>
  )
}
