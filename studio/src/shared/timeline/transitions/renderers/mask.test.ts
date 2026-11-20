// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { TransitionRegistry } from '../registry'
import { registerMaskTransitions } from './mask'

interface RecordedDraw {
  source: unknown
  dx: number
  dy: number
  dw: number
  dh: number
  scale: number
}

/** Records every drawImage with the transform and destination rectangle it was drawn with. */
class RecordingContext {
  globalAlpha = 1
  draws: RecordedDraw[] = []
  private scaleX = 1
  private stack: number[] = []

  save(): void {
    this.stack.push(this.scaleX)
  }
  restore(): void {
    this.scaleX = this.stack.pop() ?? 1
  }
  translate(): void {}
  scale(x: number): void {
    this.scaleX *= x
  }
  clip(): void {}
  drawImage(source: unknown, dx = 0, dy = 0, dw = 0, dh = 0): void {
    this.draws.push({ source, dx, dy, dw, dh, scale: this.scaleX })
  }
}

// Path2D does not exist in node; the renderers only build a clip path with it.
class FakePath2D {
  moveTo(): void {}
  arc(): void {}
  rect(): void {}
  closePath(): void {}
}

const W = 640
const H = 360

function render(id: 'iris' | 'clockWipe', progress: number) {
  ;(globalThis as { Path2D?: unknown }).Path2D ??= FakePath2D
  const registry = new TransitionRegistry()
  registerMaskTransitions(registry)
  const renderer = registry.getRenderer(id)
  expect(renderer?.renderCanvas, id).toBeDefined()

  const ctx = new RecordingContext()
  const left = { width: W, height: H }
  const right = { width: W, height: H }
  renderer!.renderCanvas!(
    ctx as unknown as OffscreenCanvasRenderingContext2D,
    left as unknown as OffscreenCanvas,
    right as unknown as OffscreenCanvas,
    progress,
    undefined,
    { width: W, height: H },
  )
  return { ctx, left, right }
}

describe.each(['iris', 'clockWipe'] as const)('%s renderCanvas covers the frame', (id) => {
  it('draws each clip over the whole frame at a scale of at least 1, so no clip edge shows inside it', () => {
    // A clip drawn smaller than the frame stretches or leaves its edge pixels inside the picture: FreeCut shrank the
    // outgoing clip to 0.96 in the GPU shader (DroneClean, 20 Nov 2026: a band 40 px wide at 4K).
    for (const p of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const { ctx, left, right } = render(id, p)
      for (const source of [left, right]) {
        const draws = ctx.draws.filter((d) => d.source === source)
        expect(draws, `${id} p=${p}`).toHaveLength(1)
        const d = draws[0]!
        expect([d.dx, d.dy, d.dw, d.dh]).toEqual([0, 0, W, H])
        expect(d.scale).toBeGreaterThanOrEqual(1)
      }
    }
  })
})
