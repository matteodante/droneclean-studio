import { describe, expect, it } from 'vite-plus/test'
import { SourceError, unreadableSourceReason } from './source-error'

describe('SourceError', () => {
  it('names the clip, the media and the frame in a plain message', () => {
    const error = new SourceError({ clip: 'DJI_0020', mediaId: 'm-1', frame: 7, reason: 'gone' })
    expect(error.name).toBe('SourceError')
    expect(error.message).toBe(
      "The export stopped: the video of clip 'DJI_0020' (media m-1) could not be read at frame 7: gone",
    )
  })

  it('leaves out the media and the frame when it has none', () => {
    expect(new SourceError({ clip: 'a', reason: 'gone' }).message).toBe(
      "The export stopped: the video of clip 'a' could not be read: gone",
    )
  })
})

describe('unreadableSourceReason', () => {
  const base = {
    hasExtractor: true,
    extractorOpened: false,
    extractorDisabled: false,
    hasElement: false,
  }

  it('says the file may be gone when the element could not load it', () => {
    expect(
      unreadableSourceReason({ ...base, hasElement: true, elementError: { code: 4, message: '' } }),
    ).toMatch(/moved, renamed or deleted/)
  })

  it('says the file is damaged when the element could not decode it', () => {
    expect(
      unreadableSourceReason({ ...base, hasElement: true, elementError: { code: 3, message: '' } }),
    ).toMatch(/damaged|codec/)
  })

  it('tells a file that was never opened from a decoder that gave up and one that returned nothing', () => {
    expect(unreadableSourceReason({ ...base, hasExtractor: false })).toMatch(/never opened/)
    expect(unreadableSourceReason({ ...base, extractorDisabled: true })).toMatch(/repeatedly/)
    expect(unreadableSourceReason(base)).toMatch(/could not open the file/)
    expect(unreadableSourceReason({ ...base, extractorOpened: true })).toMatch(/no picture/)
  })
})
