import { describe, expect, it } from 'vite-plus/test'
import type { VideoItem } from '@/types/timeline'
import { STAGE_ORDER, createStageRegistry } from './registry'
import type { SourceStage, StageId, StageScope } from './types'

const SCOPES: Record<StageId, StageScope> = {
  stabilize: 'source-frame',
  'input-colour': 'source-frame',
  look: 'output-frame',
}

function stage(id: StageId, active: boolean, scope: StageScope = SCOPES[id]): SourceStage {
  return {
    id,
    scope,
    active: () => active,
    key: () => id,
    outputSize: (_item, input) => input,
    prepare: async () => {},
    ready: () => true,
    encode: () => {},
  }
}

const item = {} as VideoItem

describe('createStageRegistry', () => {
  it('keeps the fixed order and answers by activity and scope', () => {
    const registry = createStageRegistry([
      stage('stabilize', true),
      stage('input-colour', false),
      stage('look', true),
    ])
    expect(registry.stages.map((s) => s.id)).toEqual([...STAGE_ORDER])
    expect(registry.activeStages(item).map((s) => s.id)).toEqual(['stabilize', 'look'])
    expect(registry.activeStagesOf(item, 'source-frame').map((s) => s.id)).toEqual(['stabilize'])
    expect(registry.activeStagesOf(item, 'output-frame').map((s) => s.id)).toEqual(['look'])
    expect(registry.activeStagesOf(item, 'output-frame').map((s) => s.id)).toEqual(['look'])
  })

  it('classifies the input transform with the stabilization: per source frame, before the gather', () => {
    const registry = createStageRegistry([
      stage('stabilize', true),
      stage('input-colour', true),
      stage('look', true),
    ])
    expect(registry.activeStagesOf(item, 'source-frame').map((s) => s.id)).toEqual([
      'stabilize',
      'input-colour',
    ])
    expect(registry.activeStagesOf(item, 'output-frame').map((s) => s.id)).toEqual(['look'])
  })

  it('refuses a stage out of order, missing or repeated', () => {
    expect(() =>
      createStageRegistry([
        stage('input-colour', true),
        stage('stabilize', true),
        stage('look', true),
      ]),
    ).toThrow(/in that order/)
    expect(() => createStageRegistry([stage('stabilize', true), stage('look', true)])).toThrow(
      /stabilize, input-colour, look/,
    )
    expect(() =>
      createStageRegistry([
        stage('stabilize', true),
        stage('stabilize', true),
        stage('look', true),
      ]),
    ).toThrow(/in that order/)
  })

  it('refuses a stage in the wrong scope', () => {
    expect(() =>
      createStageRegistry([
        stage('stabilize', true, 'output-frame'),
        stage('input-colour', true),
        stage('look', true),
      ]),
    ).toThrow(/scope 'source-frame'/)
  })
})
