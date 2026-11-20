import { describe, expect, it } from 'vitest'
import { LeadingTrim } from './aac-priming'

describe('LeadingTrim', () => {
  it('cuts the priming from the front of the stream, across chunks', () => {
    const trim = new LeadingTrim(2_112)
    expect(trim.take(1_000, 48_000)).toBe(1_000)
    expect(trim.take(1_000, 48_000)).toBe(1_000)
    expect(trim.take(1_000, 48_000)).toBe(112)
    expect(trim.take(1_000, 48_000)).toBe(0)
  })

  it('cuts nothing when the priming is zero', () => {
    expect(new LeadingTrim(0).take(48_000, 48_000)).toBe(0)
  })

  it('scales the cut to the chunk sample rate', () => {
    expect(new LeadingTrim(2_112).take(100_000, 96_000)).toBe(4_224)
  })

  it('never cuts more than a short chunk holds', () => {
    const trim = new LeadingTrim(2_112)
    expect(trim.take(100, 48_000)).toBe(100)
    expect(trim.take(5_000, 48_000)).toBe(2_012)
  })
})
