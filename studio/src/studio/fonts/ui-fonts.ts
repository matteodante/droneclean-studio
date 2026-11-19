/**
 * The interface fonts, bundled from Fontsource: IBM Plex Sans for text and IBM
 * Plex Mono for technical values, the families `src/index.css` already names.
 *
 * The package stylesheets (not the per-subset files) are imported because only
 * they carry the `unicode-range` of each subset; two per-subset files for one
 * weight would declare the same family and shadow each other, leaving Latin
 * text without glyphs. The browser still downloads only the subsets the text
 * needs.
 */

import '@fontsource/ibm-plex-sans/300.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
