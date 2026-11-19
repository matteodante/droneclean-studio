// The input colour stage (design 3.6 section 2.2): an adapter over `color/gpu/input-color-pass.ts`. A clip with an input
// profile other than none is turned from code values into display-referred RGB, on each source frame (before the motion-blur gather: the transform depends on the source),
// in `rgba16float` both ways (section 2.6). The pass's per-profile uniforms are immutable buffers written once, so the
// stage needs nothing from the arena; its output has the input's size, so there is nothing for the derived-size store.

import { perDevice } from '@/studio/render/device-cache'
import { createInputColorPass, type InputColorFormats } from '@/studio/color/gpu/input-color-pass'
import type { ColorProfileId, InputColorPass } from '@/studio/color/types'
import type { VideoItem } from '@/types/timeline'
import { hasInputColour } from './predicates'
import { StageError, type Size, type SourceStage } from './types'

/** The formats every stage intermediate has (design 3.6 section 2.6) */
const FLOAT_FORMATS: InputColorFormats = { input: 'rgba16float', output: 'rgba16float' }

/** The built pass of a device and format pair, once its build resolved: what `encode` reads without awaiting */
interface Built {
  pass: InputColorPass | undefined
}

const keyOf = (formats: InputColorFormats): string => `${formats.input}>${formats.output}`

/**
 * The pass for a format pair, built once per device: two frames of one format share it, and a frame that arrives while
 * the first build is running awaits it instead of compiling again; a failed build is forgotten (`perDevice` drops a
 * rejected promise) and built again by the next ask.
 */
export function inputColorPassFor(
  device: GPUDevice,
  formats: InputColorFormats,
): Promise<InputColorPass> {
  return perDevice(device, `input-colour-pass|${keyOf(formats)}`, () =>
    createInputColorPass(device, formats).then((pass) => {
      builtOn(device, formats).pass = pass
      return pass
    }),
  )
}

function builtOn(device: GPUDevice, formats: InputColorFormats): Built {
  return perDevice(device, `input-colour-built|${keyOf(formats)}`, (): Built => ({ pass: undefined }))
}

function profileOf(item: VideoItem): ColorProfileId {
  return item.inputColor ?? 'none'
}

function clipName(item: VideoItem): string {
  return item.label ?? item.id
}

/** The input colour stage. */
export function createInputColourStage(): SourceStage {
  return {
    id: 'input-colour',
    scope: 'source-frame',
    active: hasInputColour,
    key: (item) => profileOf(item),
    outputSize: (_item, input): Size => input,
    async prepare(item, device) {
      try {
        await inputColorPassFor(device, FLOAT_FORMATS)
      } catch (error) {
        throw new StageError({
          clip: clipName(item),
          stage: 'input-colour',
          reason: `the colour pass could not be built: ${error instanceof Error ? error.message : String(error)}`,
          cause: error,
        })
      }
    },
    ready: () => true,
    encode(env, encoder, item, sourceIndex, input, output) {
      const fail = (reason: string): never => {
        throw new StageError({ clip: clipName(item), stage: 'input-colour', sourceIndex, reason })
      }
      const pass = builtOn(env.device, FLOAT_FORMATS).pass
      if (pass === undefined) return fail('the colour pass was not prepared on this device')
      if (input.format !== 'rgba16float' || output.format !== 'rgba16float') {
        return fail(`its textures must be rgba16float, got ${input.format} and ${output.format}`)
      }
      if (input.width !== output.width || input.height !== output.height) {
        return fail(
          `its output is ${output.width}x${output.height} but its input is ${input.width}x${input.height}`,
        )
      }
      pass.encode(encoder, input.createView(), output.createView(), profileOf(item), {
        width: input.width,
        height: input.height,
      })
    },
  }
}
