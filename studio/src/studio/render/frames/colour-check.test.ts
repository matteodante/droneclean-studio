// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { StageError } from '@/studio/render/stages/types'
import type { VideoItem } from '@/types/timeline'
import { sourceColourProblem, type SourceColourReport } from './colour-check'
import { createSourceFrameProvider } from './provider'
import type { BackendFrame, FrameBackend } from './types'

describe('sourceColourProblem: which sources are drawn (design 3.6 section 2.18 a)', () => {
  const accepted: Array<[string, SourceColourReport | undefined]> = [
    ['BT.709 in every field', { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709' }],
    ['no report at all', undefined],
    ['an empty report (untagged)', {}],
    ['fields null or unknown (untagged, read as BT.709)', { primaries: null, transfer: 'unknown', matrix: 'unspecified' }],
    ['only the matrix tagged, as 709', { matrix: 'bt709' }],
    ['BT.601 (an SD clip)', { primaries: 'smpte170m', transfer: 'smpte170m', matrix: 'smpte170m' }],
    ['BT.601 PAL', { primaries: 'bt470bg', transfer: 'bt709', matrix: 'bt470bg' }],
  ]
  it.each(accepted)('accepts %s', (_name, report) => {
    expect(sourceColourProblem(report)).toBeNull()
  })

  const refused: Array<[string, SourceColourReport, string[]]> = [
    ['BT.2020 primaries', { primaries: 'bt2020', transfer: 'bt709', matrix: 'bt709' }, ['primaries bt2020']],
    ['PQ (WebCodecs name)', { transfer: 'pq' }, ['transfer pq']],
    ['PQ (FFmpeg name)', { transfer: 'smpte2084' }, ['transfer smpte2084']],
    ['HLG (WebCodecs name)', { transfer: 'hlg' }, ['transfer hlg']],
    ['HLG (FFmpeg name)', { transfer: 'arib-std-b67' }, ['transfer arib-std-b67']],
    ['a BT.2020 matrix', { matrix: 'bt2020-ncl' }, ['matrix bt2020-ncl']],
    [
      'BT.2020 with PQ (HDR10)',
      { primaries: 'bt2020', transfer: 'pq', matrix: 'bt2020-ncl' },
      ['primaries bt2020', 'transfer pq', 'matrix bt2020-ncl'],
    ],
    [
      'mixed: 709 primaries and matrix with an HLG curve',
      { primaries: 'bt709', transfer: 'hlg', matrix: 'bt709' },
      ['transfer hlg'],
    ],
    ['a linear transfer', { transfer: 'linear' }, ['transfer linear']],
    ['one tagged field that is not 709 beside untagged ones', { primaries: 'bt2020', transfer: null }, ['primaries bt2020']],
  ]
  it.each(refused)('refuses %s, naming the tags', (_name, report, named) => {
    const problem = sourceColourProblem(report)
    expect(problem).not.toBeNull()
    for (const tag of named) expect(problem).toContain(tag)
    expect(problem).toMatch(/not BT\.709/)
  })

  it('names only the tags that are wrong', () => {
    expect(sourceColourProblem({ primaries: 'bt709', transfer: 'hlg', matrix: 'bt709' })).not.toContain('primaries')
  })
})

describe('the provider refuses a non-709 source (design 3.6 section 2.18 a)', () => {
  const FPS = 30
  const clip = { id: 'c1', type: 'video', label: 'Night flight', src: 'blob:hdr', from: 0, durationInFrames: 60, sourceStart: 0, sourceFps: FPS, speed: 1 } as VideoItem

  function backendWith(colour: SourceColourReport | undefined) {
    let live = 0
    const backend: FrameBackend = {
      origin: 'webcodecs',
      async decode(_file, index): Promise<BackendFrame> {
        live++
        const texture = { destroy: () => void live-- } as unknown as GPUTexture
        return { texture, index, width: 64, height: 36, colour }
      },
      destroy() {},
    }
    return { backend, live: () => live }
  }
  const make = (backend: FrameBackend, mode: 'export' | 'preview') =>
    createSourceFrameProvider({ backend, maxSamples: 1, mode, projectRate: FPS })

  it('throws a StageError naming the clip, its tags and the frame, in an export, and frees the texture', async () => {
    const fake = backendWith({ primaries: 'bt2020', transfer: 'hlg', matrix: 'bt2020-ncl' })
    const error = await make(fake.backend, 'export').frameAt(clip, 4).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StageError)
    expect(error).toMatchObject({ clip: 'Night flight', stage: 'input-colour', sourceIndex: 4 })
    expect((error as Error).message).toContain("Clip 'Night flight'")
    expect((error as Error).message).toContain('primaries bt2020, transfer hlg, matrix bt2020-ncl')
    expect(fake.live()).toBe(0)
  })

  it('refuses every later frame of the file too, in a preview as well', async () => {
    const fake = backendWith({ transfer: 'pq' })
    const provider = make(fake.backend, 'preview')
    await expect(provider.frameAt(clip, 0)).rejects.toBeInstanceOf(StageError)
    await expect(provider.frameAt(clip, 1)).rejects.toBeInstanceOf(StageError)
  })

  it('draws a BT.709 and an untagged source', async () => {
    for (const colour of [{ primaries: 'bt709', transfer: 'bt709', matrix: 'bt709' }, undefined]) {
      const frame = await make(backendWith(colour).backend, 'export').frameAt(clip, 2)
      expect(frame.index).toBe(2)
    }
  })
})
