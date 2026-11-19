/**
 * What an export may carry over from its source's metadata (task 3.4).
 *
 * A drone file holds the flight's GPS position, the drone's serial number, a cover picture and
 * free-text comments. A pilot who posts an export must not leak where he lives or which drone he
 * owns, so the default is nothing: the output gets only what the muxer itself writes (the
 * container brands, the export's own creation time) and what a player needs from the tracks
 * (rotation, colour tags, frame rate), which are not metadata tags.
 *
 * mediabunny's `Conversion` copies the input's tags when no `tags` option is given; every
 * `Conversion.init` in the app passes this function as `tags` (a test reads the sources and
 * fails when one does not).
 */
import type { MetadataTags } from 'mediabunny'

/** The tags of an export: none, whatever the source carried. */
export function exportMetadataTags(_sourceTags: MetadataTags): MetadataTags {
  return {}
}
