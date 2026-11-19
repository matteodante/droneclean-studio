import { BlobSource, UrlSource, type Source } from 'mediabunny'
import type { ShadowSource } from './interface'

/** mediabunny's reader for a shadow source: the Blob itself, or ranged reads of the shell's URL. */
export function inputSourceOf(source: ShadowSource): Source {
  return source instanceof Blob ? new BlobSource(source) : new UrlSource(source.url)
}
