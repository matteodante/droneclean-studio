// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import { transitionRegistry } from '@/shared/timeline/transitions/registry'
import type { ActiveTransition } from './canvas-transitions'
import { renderTransition } from './canvas-transitions'

interface RecordedDraw {
  source: unknown
  scale: number
}

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
  drawImage(source: unknown): void {
    this.draws.push({ source, scale: this.scaleX })
  }
}

class FakePath2D {
  moveTo(): void {}
  arc(): void {}
  rect(): void {}
  closePath(): void {}
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe.each(['iris', 'clockWipe'] as const)('built-in %s fallback covers the frame', (presentation) => {
  it('draws the outgoing clip growing 1 to 1.04 and the incoming one settling 1.04 to 1, never below 1', () => {
    ;(globalThis as { Path2D?: unknown }).Path2D ??= FakePath2D
    // The registry has a renderer for both; remove it so the built-in switch runs.
    vi.spyOn(transitionRegistry, 'getRenderer').mockReturnValue(undefined)

    for (const progress of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
      const ctx = new RecordingContext()
      const left = { width: 640, height: 360 }
      const right = { width: 640, height: 360 }
      renderTransition(
        ctx as unknown as OffscreenCanvasRenderingContext2D,
        { transition: { presentation }, progress } as unknown as ActiveTransition,
        left as unknown as OffscreenCanvas,
        right as unknown as OffscreenCanvas,
        { width: 640, height: 360, fps: 30 },
      )
      const out = ctx.draws.filter((d) => d.source === left)
      const inc = ctx.draws.filter((d) => d.source === right)
      expect(out, `${presentation} p=${progress}`).toHaveLength(1)
      expect(inc).toHaveLength(1)
      expect(out[0]!.scale).toBeCloseTo(1 + 0.04 * progress, 10)
      expect(inc[0]!.scale).toBeCloseTo(1.04 - 0.04 * progress, 10)
      expect(out[0]!.scale).toBeGreaterThanOrEqual(1)
      expect(inc[0]!.scale).toBeGreaterThanOrEqual(1)
    }
  })
})
