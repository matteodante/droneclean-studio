// 1. Export speed and format: the segment, untouched, as H.265 MP4 at the project's full size, with the app's
// automatic "ultra" bitrate and with a custom 120 Mbps; and what the app does with an untouched clip by default.
import { PROJECT_FPS } from '../lib/context.mjs'
import { describeExport } from './describe.mjs'

export const name = 'export-speed-and-format'

export async function measure(ctx) {
  const segment = await ctx.segment(ctx.config.segmentSeconds)
  const auto = await ctx.export({ what: 'segment', kind: 'auto' })
  const custom = await ctx.export({ what: 'segment', kind: 'custom' })
  const copyPath = await ctx.export({ what: 'segment-copy-path', kind: 'auto' })
  return {
    ...(await ctx.header(name, { segment })),
    parameters: {
      segmentSeconds: ctx.config.segmentSeconds,
      customBitrateBitsPerSecond: ctx.config.customBitrate,
      project: '3840x2880 at 59.94 fps (60000/1001), the clip rate exactly',
      projectFpsValue: PROJECT_FPS,
      howExportRuns:
        "the app's own functions: mapRequestedClientSettings, assessSmartCopyEligibility, resolveClientSettings, convertTimelineToComposition, resolveMediaUrls, runRender (use-client-render.ts, render-pipeline.ts)",
      forcedFrameByFrame:
        'the clip carries a +0.01 dB audio gain (it has no audio) so that the packet-copy shortcut does not replace the render; the untouched-clip runs below are without it',
      untouchedClip:
        'a 59.94 project of this 59.94 clip makes smart copy eligible, and smart copy returns the cut file untouched; untouchedClipPacketRemux switches it off so that run measures the packet remux, and its record also carries the assessment with smart copy on (design 1.5, decision 4)',
    },
    result: {
      ultraAutoBitrate: describeExport(auto),
      custom120Mbps: describeExport(custom),
      untouchedClipPacketRemux: describeExport(copyPath),
      untouchedClipSmartCopy: copyPath.export.smartCopyIfEnabled,
    },
  }
}
