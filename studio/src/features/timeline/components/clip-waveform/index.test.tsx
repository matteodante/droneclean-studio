import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { clipSourceOffsetSeconds, clipSourcePosition } from '@/studio/speed'
import { ClipWaveform } from './index'

/** The source's one spike, in seconds (the mock below: 100 peaks a second, the spike at 100). */
const SPIKE_SECONDS = 1

const state = vi.hoisted(() => ({
  renderWindow: undefined as
    | ((ctx: CanvasRenderingContext2D, windowOffset: number, windowWidth: number) => void)
    | undefined,
}))

vi.mock('../../hooks/use-waveform', () => {
  const peaks = new Float32Array(20 * 100)
  peaks[1 * 100] = 1
  return {
    useWaveform: () => ({
      peaks,
      duration: 20,
      sampleRate: 100,
      stereo: false,
      maxPeak: 1,
      loadedSamples: peaks.length,
      isLoading: false,
      error: null,
    }),
  }
})

vi.mock('./visible-waveform-canvas', () => ({
  VisibleWaveformCanvas: ({
    renderWindow,
  }: {
    renderWindow: (ctx: CanvasRenderingContext2D, offset: number, width: number) => void
  }) => {
    state.renderWindow = renderWindow
    return null
  },
}))

vi.mock('../measure-parent-height', () => ({
  observeParentElementHeight: (_element: unknown, setHeight: (height: number) => void) => {
    setHeight(40)
    return () => {}
  },
}))

/** The amplitude the waveform draws in each pixel column of a window. */
function drawnAmplitudes(width: number): number[] {
  const tops: number[] = []
  const ctx = {
    beginPath: () => {},
    moveTo: () => {},
    lineTo: (_x: number, y: number) => tops.push(y),
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
  } as unknown as CanvasRenderingContext2D
  state.renderWindow!(ctx, 0, width)
  // The first `width + 1` points trace the top contour, `centerY - amplitude`, centre 20.
  return tops.slice(0, width + 1).map((y) => 20 - y)
}

describe('the waveform of a clip with a speed curve (review finding T8)', () => {
  beforeEach(() => {
    state.renderWindow = undefined
  })

  it('draws a source moment where the preview shows it: a 1x -> 4x -> 1x ramp', () => {
    const ramp = {
      type: 'video',
      sourceStart: 0,
      sourceFps: 30,
      durationInFrames: 96,
      speed: 3,
      speedCurve: {
        keys: [
          { frame: 0, speed: 1 },
          { frame: 32, speed: 4 },
          { frame: 64, speed: 4 },
          { frame: 96, speed: 1 },
        ],
      },
    } as const
    const pixelsPerSecond = 100
    render(
      <ClipWaveform
        mediaId="media-1"
        clipWidth={320}
        sourceStart={0}
        sourceEnd={9.6}
        sourceDuration={20}
        trimStart={0}
        speed={ramp.speed}
        sourceOffsetAt={clipSourceOffsetSeconds(ramp, 30)}
        fps={30}
        isVisible={false}
        pixelsPerSecond={pixelsPerSecond}
      />,
    )
    expect(state.renderWindow).toBeDefined()

    const amplitudes = drawnAmplitudes(320)
    const loudest = amplitudes.indexOf(Math.max(...amplitudes))
    // The first clip frame whose picture is the spike's source frame (30 at 30 fps).
    let frame = 0
    while (clipSourcePosition(ramp, frame, 30).frame < SPIKE_SECONDS * 30) frame++
    const shownAt = (frame / 30) * pixelsPerSecond
    expect(Math.abs(loudest - shownAt), `spike drawn at ${loudest}px`).toBeLessThanOrEqual(2)
  })
})
