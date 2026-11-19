// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  SPEED_GRAPH_PLOT_HEIGHT,
  frameToPlotX,
  plotYToSpeed,
  speedToPlotY,
  tickStep,
} from './graph-geometry'

describe('the speed graph axis', () => {
  it('puts 10x at the top, 0.1x at the bottom and 1x where the axis says', () => {
    expect(speedToPlotY(10)).toBeLessThan(speedToPlotY(1))
    expect(speedToPlotY(1)).toBeLessThan(speedToPlotY(0.1))
    expect(speedToPlotY(10)).toBeCloseTo(8, 10)
    expect(speedToPlotY(0.1)).toBeCloseTo(SPEED_GRAPH_PLOT_HEIGHT - 8, 10)
  })

  it('reads a pointer y back as the speed it was drawn for, at any plot height', () => {
    for (const height of [56, 90, SPEED_GRAPH_PLOT_HEIGHT]) {
      for (const speed of [0.1, 0.25, 1, 2.5, 4, 10]) {
        expect(plotYToSpeed(speedToPlotY(speed, height), height)).toBeCloseTo(speed, 9)
      }
    }
  })

  it('clamps a pointer outside the plot into the speed range', () => {
    expect(plotYToSpeed(-100)).toBe(10)
    expect(plotYToSpeed(1_000)).toBe(0.1)
  })

  it('maps a timeline frame the way the timeline ruler does', () => {
    // 100 px/s at 30 fps: frame 30 is 100 px after the content's edge, less the scroll.
    expect(frameToPlotX(30, 30, 100, 0)).toBe(100)
    expect(frameToPlotX(30, 30, 100, 40)).toBe(60)
  })

  it('spaces the frame ticks at least 64 px apart', () => {
    expect(tickStep(100, 30)).toBe(30)
    expect(tickStep(10, 30)).toBe(300)
    expect(tickStep(1_000, 30)).toBe(2)
  })
})
