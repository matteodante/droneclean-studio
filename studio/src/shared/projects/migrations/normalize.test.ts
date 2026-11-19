// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { Project } from '@/types/project'
import { migrateProject } from './index'
import { normalizeProject } from './normalize'
import { CURRENT_SCHEMA_VERSION } from './types'

const FPS_59_94 = 59.94005994005994

function makeProject(fps: number): Project {
  return {
    id: 'project-1',
    name: 'Drone flight',
    description: '',
    createdAt: 0,
    updatedAt: 0,
    duration: 0,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    metadata: { width: 1920, height: 1080, fps },
  }
}

describe('normalizeProject frame rate', () => {
  it.each([
    { stored: 30, kept: 30, reason: 'an old project at 30' },
    { stored: 59.94005994005994, kept: FPS_59_94, reason: 'a 59.94 project' },
    { stored: 29.97002997002997, kept: 29.97002997002997, reason: 'a 29.97 project' },
    { stored: 23.976023976023978, kept: 23.976023976023978, reason: 'a 23.976 project' },
    { stored: 120, kept: 120, reason: 'a legacy 120 project' },
    { stored: 240, kept: 240, reason: 'a legacy 240 project' },
    { stored: 0, kept: 1, reason: 'zero' },
    { stored: 500, kept: 240, reason: 'a value above the schema bound' },
  ])('keeps $reason ($stored) as $kept', ({ stored, kept }) => {
    expect(normalizeProject(makeProject(stored)).metadata.fps).toBe(kept)
  })
})

describe('migrateProject frame rate', () => {
  it.each([
    { stored: 30, reason: 'an old project at 30' },
    { stored: FPS_59_94, reason: 'a 59.94 project' },
  ])('loads $reason bit-exactly without migrating it', ({ stored }) => {
    const result = migrateProject(makeProject(stored))

    expect(result.migrated).toBe(false)
    expect(result.project.metadata.fps).toBe(stored)
  })
})
