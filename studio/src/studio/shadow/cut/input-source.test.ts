import { BlobSource, UrlSource } from 'mediabunny'
import { describe, expect, it } from 'vitest'
import { inputSourceOf } from './input-source'

describe('the shadow cutter reads its source', () => {
  it('from the Blob itself', () => {
    expect(inputSourceOf(new Blob(['bytes']))).toBeInstanceOf(BlobSource)
  })

  it('from the URL the desktop shell serves a path-linked file at, in ranges', () => {
    expect(inputSourceOf({ url: 'droneclean://app/__media/m-1' })).toBeInstanceOf(UrlSource)
  })
})
