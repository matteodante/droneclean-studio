// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import type { Rate } from '@/studio/time'
import {
  formatFpsValue,
  formatProjectFps,
  getProjectFpsOptions,
  isAllowedProjectFps,
  projectFpsValue,
  resolveAutoMatchProjectFps,
} from './project-fps'

// The exact doubles a project file holds (design 1.5, section 5.4).
const FPS_23_976 = 23.976023976023978
const FPS_29_97 = 29.97002997002997
const FPS_59_94 = 59.94005994005994

const RATE_23_976: Rate = { num: 24000, den: 1001 }
const RATE_29_97: Rate = { num: 30000, den: 1001 }
const RATE_59_94: Rate = { num: 60000, den: 1001 }

const OFFERED_OPTIONS = [
  { label: '23.976 fps', value: FPS_23_976 },
  { label: '24 fps', value: 24 },
  { label: '25 fps', value: 25 },
  { label: '29.97 fps', value: FPS_29_97 },
  { label: '30 fps', value: 30 },
  { label: '50 fps', value: 50 },
  { label: '59.94 fps', value: FPS_59_94 },
  { label: '60 fps', value: 60 },
]

describe('getProjectFpsOptions', () => {
  it('offers the eight exact rates with their labels', () => {
    expect(getProjectFpsOptions()).toEqual(OFFERED_OPTIONS)
  })

  it.each([30, FPS_59_94, 60, 23.976])('offers the same eight to a project at %s', (currentFps) => {
    expect(getProjectFpsOptions(currentFps)).toEqual(OFFERED_OPTIONS)
  })

  it.each([
    { currentFps: 120, label: '120 fps (Legacy)' },
    { currentFps: 240, label: '240 fps (Legacy)' },
  ])('keeps the legacy rate $currentFps of an old project', ({ currentFps, label }) => {
    const options = getProjectFpsOptions(currentFps)

    expect(options).toHaveLength(OFFERED_OPTIONS.length + 1)
    expect(options.at(-1)).toEqual({ label, value: currentFps })
  })
})

describe('isAllowedProjectFps', () => {
  it.each([
    { value: FPS_23_976, reason: 'a 23.976 project' },
    { value: 24, reason: 'a 24 project' },
    { value: 25, reason: 'a 25 project' },
    { value: FPS_29_97, reason: 'a 29.97 project' },
    { value: 30, reason: 'a 30 project' },
    { value: 50, reason: 'a 50 project' },
    { value: FPS_59_94, reason: 'a 59.94 project' },
    { value: 60, reason: 'a 60 project' },
    { value: 120, reason: 'a legacy 120 project' },
    { value: 240, reason: 'a legacy 240 project' },
    { value: 23.976, reason: 'the decimal name 23.976' },
    { value: 29.97, reason: 'the decimal name 29.97' },
    { value: 59.94, reason: 'the decimal name 59.94' },
  ])('accepts $reason ($value)', ({ value }) => {
    expect(isAllowedProjectFps(value)).toBe(true)
  })

  it.each([
    { value: 0, reason: 'zero' },
    { value: 241, reason: 'above the schema bound' },
    { value: 47.5, reason: 'a rate the project does not offer' },
    { value: 59.9401, reason: 'a value near but not at 59.94' },
    { value: Number.NaN, reason: 'NaN' },
    { value: Number.POSITIVE_INFINITY, reason: 'infinity' },
    { value: -60, reason: 'a negative rate' },
  ])('rejects $reason', ({ value }) => {
    expect(isAllowedProjectFps(value)).toBe(false)
  })
})

describe('projectFpsValue', () => {
  it.each([
    { stored: 30, value: 30 },
    { stored: FPS_59_94, value: FPS_59_94 },
    { stored: 59.94, value: FPS_59_94 },
    { stored: 23.976, value: FPS_23_976 },
    { stored: 240, value: 240 },
    { stored: Number.NaN, value: Number.NaN },
  ])('turns $stored into the stored number $value', ({ stored, value }) => {
    expect(projectFpsValue(stored)).toBe(value)
  })
})

describe('resolveAutoMatchProjectFps', () => {
  it.each([
    { source: FPS_59_94, rate: RATE_59_94, fps: FPS_59_94, exact: true },
    { source: 60 / 1.001, rate: RATE_59_94, fps: FPS_59_94, exact: true },
    { source: 59.94, rate: RATE_59_94, fps: FPS_59_94, exact: true },
    { source: FPS_29_97, rate: RATE_29_97, fps: FPS_29_97, exact: true },
    { source: 29.97, rate: RATE_29_97, fps: FPS_29_97, exact: true },
    { source: FPS_23_976, rate: RATE_23_976, fps: FPS_23_976, exact: true },
    { source: 23.976, rate: RATE_23_976, fps: FPS_23_976, exact: true },
    { source: 25, rate: { num: 25, den: 1 }, fps: 25, exact: true },
    { source: 60, rate: { num: 60, den: 1 }, fps: 60, exact: true },
    { source: 47.5, rate: { num: 50, den: 1 }, fps: 50, exact: false },
    { source: 120, rate: { num: 60, den: 1 }, fps: 60, exact: false },
    { source: 240, rate: { num: 60, den: 1 }, fps: 60, exact: false },
    { source: 0, rate: { num: 30, den: 1 }, fps: 30, exact: false },
    { source: Number.NaN, rate: { num: 30, den: 1 }, fps: 30, exact: false },
  ])('matches a $source fps source to $fps fps (exact: $exact)', ({ source, rate, fps, exact }) => {
    expect(resolveAutoMatchProjectFps(source)).toEqual({ rate, fps, exact })
  })
})

describe('formatFpsValue', () => {
  it('formats integer and decimal fps values cleanly', () => {
    expect(formatFpsValue(60)).toBe('60')
    expect(formatFpsValue(FPS_59_94)).toBe('59.94')
    expect(formatFpsValue(FPS_29_97)).toBe('29.97')
    expect(formatFpsValue(FPS_23_976)).toBe('23.976')
  })
})

describe('formatProjectFps', () => {
  it.each([
    { fps: 30, label: '30' },
    { fps: 60, label: '60' },
    { fps: 120, label: '120' },
    { fps: FPS_59_94, label: '59.94' },
    { fps: 59.94, label: '59.94' },
    { fps: FPS_29_97, label: '29.97' },
    { fps: FPS_23_976, label: '23.976' },
    { fps: 47.5, label: '47.5' },
    { fps: 59.9401, label: '59.94' },
    { fps: Number.NaN, label: '0' },
  ])('shows a stored $fps as "$label"', ({ fps, label }) => {
    expect(formatProjectFps(fps)).toBe(label)
  })
})
