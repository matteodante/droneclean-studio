// A source with no sound: mediabunny read its container and found no audio track. Drone footage often has none (the
// Avata 2 records no audio). That is an answer, not a decode failure, so FreeCut's export audio does not go on to its
// fallbacks for it: the AC3 decoder finds no track either, and the Web Audio fallback reads the whole file into one
// ArrayBuffer to try — 3.2 to 3.7 GB for one 4K Avata 2 clip. On the editor page that ran the renderer out of memory
// ("Near V8 cage limit", exit code 5) and killed the page mid-export (19 Nov 2026, the MCP tour). The segment of such
// a source adds silence to the mix.

/** The source has no audio track: its segment is silent */
export class NoAudioTrackError extends Error {
  constructor() {
    super('No audio track found')
    this.name = 'NoAudioTrackError'
  }
}
