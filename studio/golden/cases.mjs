// The golden cases.
//
// One case = one small project + the exact frames to render from it. `protects`
// says in a sentence what a difference in that case would mean. Keep ids stable:
// they name the folders of stored frames.
//
// Layout: every project is 320x180 at 24 fps. Track 0 is the top layer.
import {
  buildProject,
  effect,
  imageItem,
  textItem,
  transition,
  videoItem,
  videoMediaId,
} from './lib/project.mjs'
import { RAW_HEIGHT, RAW_WIDTH, SHADOW_PIECE_FRAMES, SHADOW_SOURCE_FRAMES } from './lib/float.mjs'
import {
  BLUR_HEIGHT,
  BLUR_SOURCE_FRAMES,
  BLUR_WIDTH,
  checkFourTimes180,
  checkFourTimes360,
} from './lib/blur.mjs'
import { checkFlowHalfway, FLOW_HEIGHT, FLOW_SOURCE_FRAMES, FLOW_WIDTH } from './lib/flow.mjs'
import { LOOK_ID, lookOf, linearLookText } from './lib/look.mjs'
import { STAGE_WARP_CASE, STAGE_WARP_FLOAT_CASE } from './lib/stage-warp.mjs'

const GRADE_NOTE = 'single effect on the "card" test image'

/** A 5x5x5 .cube-style LUT, rgba8, red varying fastest: a teal-and-orange style cross-channel grade. */
// Test-support kit, exercised end to end by npm run golden (it needs a GPU, so Vitest coverage cannot see it)
// fallow-ignore-next-line complexity
function syntheticLut() {
  const size = 5
  const data = Buffer.alloc(size * size * size * 4)
  let o = 0
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const rf = r / (size - 1)
        const gf = g / (size - 1)
        const bf = b / (size - 1)
        const out = [rf * 0.9 + bf * 0.2 + 0.03, gf * 0.85 + rf * 0.12, bf * 0.7 + (1 - rf) * 0.28]
        for (const c of out) data[o++] = Math.max(0, Math.min(255, Math.round(c * 255)))
        data[o++] = 255
      }
    }
  }
  return { lutName: 'golden-teal-orange', lutSize: String(size), lutData: data.toString('base64') }
}

const cases = []
function add({
  id,
  group,
  protects,
  items,
  transitions,
  background,
  frames = [0],
  sameAsSource,
  float,
  width,
  height,
  minLevels,
}) {
  cases.push({
    id,
    group,
    protects,
    frames,
    sameAsSource,
    ...(float ? { float: true, raw: { width, height }, minLevels } : {}),
    project: buildProject({ id: `golden-${id}`, items, transitions, background, width, height }),
  })
}

/** One image, one effect (or a chain), full frame. */
function graded(id, group, protects, effects, image = 'card') {
  add({
    id,
    group,
    protects,
    items: [imageItem({ id: 'clip', image, track: 0, effects })],
  })
}

// --- Untouched images ------------------------------------------------------------------------------------------
for (const [image, what] of [
  ['card', 'colour bars, grey ramp and stairs, hue sweep, 1-pixel detail, four corner squares'],
  [
    'ramp',
    'a slow 64-level ramp (grey, red, green, blue): a step added or removed anywhere shows as a band',
  ],
  ['detail', 'a zone plate, noise, grid and diagonals: any resampling of the image shows'],
  ['scene', 'a dusk sky with a sun, hills and a field'],
]) {
  add({
    id: `passthrough-${image}`,
    group: 'untouched image',
    protects: `an image placed at 100 % with nothing on it comes out exactly as it went in (${what}). The frame must equal the source bit for bit.`,
    items: [imageItem({ id: 'clip', image, track: 0 })],
    sameAsSource: image,
  })
}

// --- Clip transform --------------------------------------------------------------------------------------------
const transformCase = (id, protects, props, extra = {}) =>
  add({
    id: `transform-${id}`,
    group: 'clip transform',
    protects,
    items: [
      ...(extra.over ? [imageItem({ id: 'under', image: extra.over, track: 1 })] : []),
      imageItem({ id: 'clip', image: 'card', track: 0, ...props }),
    ],
  })

transformCase(
  'scale-position',
  'size and position of a clip: 75 % size, moved 20 px right and 10 px up, over the dark background.',
  { transform: { x: 20, y: -10, width: 240, height: 135, rotation: 0, opacity: 1 } },
)
transformCase(
  'rotate',
  'rotation about the centre: 12 degrees clockwise at 70 % size; edges must be anti-aliased the same way.',
  { transform: { x: 0, y: 0, width: 224, height: 126, rotation: 12, opacity: 1 } },
)
transformCase('flip', 'horizontal and vertical flip (the corner squares swap places).', {
  transform: {
    x: 0,
    y: 0,
    width: 320,
    height: 180,
    rotation: 0,
    opacity: 1,
    flipHorizontal: true,
    flipVertical: true,
  },
})
transformCase(
  'crop',
  'cropping each edge by a different amount: left 10 %, right 20 %, top 15 %, bottom 5 %.',
  {
    crop: { left: 0.1, right: 0.2, top: 0.15, bottom: 0.05 },
  },
)
transformCase('crop-soft', 'a cropped clip with a soft edge (softness 0.1).', {
  crop: { left: 0.1, right: 0.1, top: 0.1, bottom: 0.1, softness: 0.1 },
})
transformCase(
  'opacity',
  'opacity 50 % of one image over another: the mix is (a + b) / 2 per channel, rounded the same way every time.',
  { transform: { x: 0, y: 0, width: 320, height: 180, rotation: 0, opacity: 0.5 } },
  { over: 'scene' },
)
transformCase(
  'combined',
  'scale, position, rotation, rounded corners and opacity together over a second image (the usual everyday clip).',
  {
    transform: {
      x: -15,
      y: 8,
      width: 256,
      height: 144,
      rotation: -8,
      opacity: 0.85,
      cornerRadius: 14,
    },
  },
  { over: 'scene' },
)

// --- Colour tools ----------------------------------------------------------------------------------------------
graded('color-brightness', 'colour', `brightness +0.15 (${GRADE_NOTE}).`, [
  effect('gpu-brightness', { amount: 0.15 }),
])
graded('color-contrast', 'colour', `contrast 1.4 around mid grey (${GRADE_NOTE}).`, [
  effect('gpu-contrast', { amount: 1.4 }),
])
graded(
  'color-exposure',
  'colour',
  `exposure +0.7 EV with a small offset and gamma (${GRADE_NOTE}).`,
  [effect('gpu-exposure', { exposure: 0.7, offset: 0.02, gamma: 1.1 })],
)
graded('color-saturation', 'colour', `saturation 1.6 (${GRADE_NOTE}).`, [
  effect('gpu-saturation', { amount: 1.6 }),
])
graded(
  'color-sky',
  'colour',
  'the sky tool on an overcast frame: the white sky takes the steel-blue gradient (horizon 0.58, protection 0.85), the hills and the orange kite stay as they were.',
  [effect('gpu-sky', { horizon: 0.58 })],
  'overcast',
)
graded('color-vibrance', 'colour', `vibrance +0.6 (${GRADE_NOTE}).`, [
  effect('gpu-vibrance', { amount: 0.6 }),
])
graded('color-temperature', 'colour', `temperature +0.4 (warmer) with tint -0.2 (${GRADE_NOTE}).`, [
  effect('gpu-temperature', { temperature: 0.4, tint: -0.2 }),
])
graded('color-hue-shift', 'colour', `hue shift by 0.25 of the wheel (${GRADE_NOTE}).`, [
  effect('gpu-hue-shift', { shift: 0.25 }),
])
graded(
  'color-levels',
  'colour',
  `levels: input black 0.1, input white 0.9, gamma 1.2, output 0.05 to 0.95 (${GRADE_NOTE}).`,
  [
    effect('gpu-levels', {
      inputBlack: 0.1,
      inputWhite: 0.9,
      gamma: 1.2,
      outputBlack: 0.05,
      outputWhite: 0.95,
    }),
  ],
)
graded(
  'color-curves',
  'colour',
  `curves: a lifted-shadow, pulled-highlight master curve and a boosted red channel (${GRADE_NOTE}). The curve is baked into a float table (rgba16float).`,
  [
    effect('gpu-curves', {
      masterShadowX: 0.25,
      masterShadowY: 0.32,
      masterHighlightX: 0.75,
      masterHighlightY: 0.7,
      redShadowX: 0.25,
      redShadowY: 0.3,
      redHighlightX: 0.75,
      redHighlightY: 0.82,
    }),
  ],
)
graded(
  'color-wheels',
  'colour',
  `colour wheels: cool shadows, warm highlights, plus saturation, contrast and exposure (${GRADE_NOTE}).`,
  [
    effect('gpu-color-wheels', {
      shadowsHue: 215,
      shadowsAmount: 0.35,
      highlightsHue: 35,
      highlightsAmount: 0.3,
      saturation: 12,
      contrast: 1.12,
      exposure: 0.1,
      colorBoost: 20,
    }),
  ],
)
graded(
  'color-lut',
  'colour',
  `the .cube LUT effect with a synthetic 5x5x5 teal-and-orange table at full strength (${GRADE_NOTE}). Protects the 3-D texture path and its trilinear sampling.`,
  [effect('gpu-lut', { intensity: 1, ...syntheticLut() })],
)
add({
  id: 'float-ramp-curves',
  group: 'float path',
  protects:
    'the curves effect keeps a 10-bit ramp (design 3.6 section 2.18 c): the 877 grey levels go through a smooth, rising master curve (lifted shadows, pulled highlights) in the float chain and must stay at least 700 different values (754 measured: the curve flattens the highlights, so some neighbouring codes meet); the curve table is float, an 8-bit table cut them to at most 256. The stored frame holds the exact picture.',
  items: [
    videoItem({
      id: 'clip',
      video: 'raw-ramp',
      track: 0,
      frames: 2,
      sourceFrames: 2,
      effects: [
        effect('gpu-curves', {
          masterShadowX: 0.25,
          masterShadowY: 0.32,
          masterHighlightX: 0.75,
          masterHighlightY: 0.7,
        }),
      ],
      width: RAW_WIDTH,
      height: RAW_HEIGHT,
    }),
  ],
  frames: [0],
  float: true,
  minLevels: 700,
  width: RAW_WIDTH,
  height: RAW_HEIGHT,
})

// --- Blur, sharpen, vignette, distortion -----------------------------------------------------------------------
graded(
  'blur-gaussian',
  'blur and distortion',
  'gaussian blur, radius 8, on the "detail" image (fine detail makes sampling differences visible).',
  [effect('gpu-gaussian-blur', { radius: 8, samples: 5 })],
  'detail',
)
graded(
  'stylize-sharpen',
  'blur and distortion',
  'sharpen, amount 1.5, on the "detail" image.',
  [effect('gpu-sharpen', { amount: 1.5, radius: 1 })],
  'detail',
)
graded(
  'stylize-vignette',
  'blur and distortion',
  'vignette on the "scene" image (a smooth radial falloff: banding shows).',
  [effect('gpu-vignette', { amount: 0.7, size: 0.5, softness: 0.6, roundness: 1 })],
  'scene',
)
graded(
  'distort-twirl',
  'blur and distortion',
  'twirl (amount 1.2, radius 0.5) on the "card" image: the shader samples the source at computed positions.',
  [effect('gpu-twirl', { amount: 1.2, radius: 0.5, centerX: 0.5, centerY: 0.5 })],
)

// --- Stacked effects (the rounding between passes) -------------------------------------------------------------
graded(
  'chain-roundtrip-ramp',
  'stacked effects',
  'exposure -2 EV then +2 EV on the slow ramp. Two colour effects run in ONE shader pass that rounds to 8 bits after each step, so the dark half-way value loses levels: the 64-level source ramp comes back with only 17 distinct levels. A 16-bit pipeline brings it back whole (phase 3 changes this on purpose).',
  [
    effect('gpu-exposure', { exposure: -2 }, 'fx-down'),
    effect('gpu-exposure', { exposure: 2 }, 'fx-up'),
  ],
  'ramp',
)
graded(
  'chain-grade-batch',
  'stacked effects',
  'a typical grade of five colour effects in a row (exposure, contrast, saturation, temperature, vibrance): all run in the one batched pass.',
  [
    effect('gpu-exposure', { exposure: 0.3 }, 'fx-1'),
    effect('gpu-contrast', { amount: 1.25 }, 'fx-2'),
    effect('gpu-saturation', { amount: 1.3 }, 'fx-3'),
    effect('gpu-temperature', { temperature: 0.2, tint: 0 }, 'fx-4'),
    effect('gpu-vibrance', { amount: 0.3 }, 'fx-5'),
  ],
)
graded(
  'chain-grade-batch-rest',
  'stacked effects',
  'the other colour effects that share the batched pass: brightness, levels, hue shift, sepia, grayscale and invert in a row (each has its own branch in the batch shader).',
  [
    effect('gpu-brightness', { amount: 0.05 }, 'fx-1'),
    effect('gpu-levels', { inputBlack: 0.05, inputWhite: 0.95, gamma: 1.1 }, 'fx-2'),
    effect('gpu-hue-shift', { shift: 0.08 }, 'fx-3'),
    effect('gpu-sepia', { amount: 0.25 }, 'fx-4'),
    effect('gpu-grayscale', { amount: 0.2 }, 'fx-5'),
    effect('gpu-invert', {}, 'fx-6'),
  ],
)
graded(
  'chain-batch-then-single',
  'stacked effects',
  'saturation (batched), then curves (its own pass), then contrast: where one pass ends and the next starts, the 8-bit texture between them rounds.',
  [
    effect('gpu-saturation', { amount: 0.4 }, 'fx-1'),
    effect(
      'gpu-curves',
      { masterShadowX: 0.25, masterShadowY: 0.12, masterHighlightX: 0.75, masterHighlightY: 0.9 },
      'fx-2',
    ),
    effect('gpu-contrast', { amount: 1.5 }, 'fx-3'),
  ],
  'card',
)
graded(
  'chain-blur-then-grade',
  'stacked effects',
  'gaussian blur followed by exposure -1.2 EV then +1.2 EV: the order of two effects and the rounding of the dark middle value.',
  [
    effect('gpu-gaussian-blur', { radius: 4, samples: 4 }, 'fx-1'),
    effect('gpu-exposure', { exposure: -1.2 }, 'fx-2'),
    effect('gpu-exposure', { exposure: 1.2 }, 'fx-3'),
  ],
  'scene',
)

// --- Transitions (midpoint) ------------------------------------------------------------------------------------
for (const [presentation, direction, what] of [
  ['fade', undefined, 'a cross-fade: (a + b) / 2'],
  ['wipe', 'from-left', 'a hard wipe edge half-way across'],
  ['clockWipe', undefined, 'a clock wipe at half a turn'],
]) {
  add({
    id: `transition-${presentation}`,
    group: 'transition',
    protects: `${presentation} transition between two images at its midpoint (${what}). Clip A overlaps clip B for 10 frames; frame 15 is the middle.`,
    items: [
      imageItem({ id: 'a', image: 'card', track: 0, from: 0, frames: 20 }),
      imageItem({ id: 'b', image: 'scene', track: 0, from: 10, frames: 20 }),
    ],
    transitions: [transition({ presentation, direction, left: 'a', right: 'b', frames: 10 })],
    frames: [15],
  })
}

// --- Blend modes -----------------------------------------------------------------------------------------------
for (const mode of ['multiply', 'overlay', 'difference']) {
  add({
    id: `blend-${mode}`,
    group: 'blend mode',
    protects: `blend mode "${mode}" of the stripes-and-disc image over the "scene" image.`,
    items: [
      imageItem({ id: 'top', image: 'overlay', track: 0, blendMode: mode }),
      imageItem({ id: 'under', image: 'scene', track: 1 }),
    ],
  })
}

// --- Text ------------------------------------------------------------------------------------------------------
add({
  id: 'text-over-image',
  group: 'text',
  protects:
    'a bold white title (Arial 40) over the "scene" image: text layout, anti-aliasing and compositing. Depends on the machine having Arial; see the README.',
  items: [
    textItem({
      id: 'title',
      text: 'DRONE 0042',
      track: 0,
      color: '#ffffff',
      fontSize: 40,
      transform: { x: 0, y: 50, width: 300, height: 60, rotation: 0, opacity: 1 },
    }),
    imageItem({ id: 'under', image: 'scene', track: 1 }),
  ],
})

// --- Video at an exact frame -----------------------------------------------------------------------------------
for (const [video, label, shows] of [
  ['h264-high', '8-bit H.264 High', 'the 8-bit decode path'],
  [
    'hevc-main10',
    '10-bit HEVC Main 10',
    'what 10-bit footage looks like today: decoded and flattened to 8 bits before anything else touches it',
  ],
]) {
  add({
    id: `video-${video}`,
    group: 'video',
    protects: `${label} clip, source frames 7 and 11 (the white box is 20 px further right on each frame, so a frame early or late shows). It shows ${shows}.`,
    items: [videoItem({ id: 'clip', video, track: 0 })],
    frames: [7, 11],
  })
  add({
    id: `video-${video}-stretched`,
    group: 'video',
    protects: `${label} clip with contrast 3 around mid grey, frame 7: stretches the slow luma ramp so that banding is plainly visible. The ramp has 128 steps in the 10-bit file and about 38 in the 8-bit one; today both are flattened to 8 bits before the effect, so each shows at most 38 distinct levels in the frame (33 for the H.264 file, 38 for the HEVC file). Phase 3 changes the 10-bit one on purpose.`,
    items: [
      videoItem({ id: 'clip', video, track: 0, effects: [effect('gpu-contrast', { amount: 3 })] }),
    ],
    frames: [7],
  })
}

// --- Input colour ----------------------------------------------------------------------------------------------
add({
  id: 'color-input-dlog-m',
  group: 'input colour',
  protects:
    'the input colour stage through the stage pipeline: a 10-bit-like ramp clip with D-Log M set on it goes source frame (8-bit decode, widened to rgba16float), input colour pass in float, then FreeCut\'s draw, instead of the untouched video path. A wrong curve, a wrong profile uniform or a pass that is missing changes the ramp; an untouched clip would be the source frame.',
  items: [videoItem({ id: 'clip', video: 'hevc-main10', track: 0, inputColor: 'dlog-m' })],
  frames: [7],
})
add({
  id: 'color-input-dlog-m-masked',
  group: 'input colour',
  protects:
    'the clip of color-input-dlog-m under a clip mask, a centred box half the frame wide and high: a masked clip is drawn on the canvas path, which must draw the staged picture too (review finding R1). Inside the box the frame equals color-input-dlog-m pixel for pixel, outside it is the background. The raw frame under the mask (flat log) changes the box.',
  items: [
    {
      id: 'mask',
      trackId: 'track-0',
      from: 0,
      durationInFrames: 12,
      label: 'mask',
      type: 'shape',
      shapeType: 'rectangle',
      fillColor: '#ffffff',
      isMask: true,
      maskType: 'clip',
      maskInvert: false,
      maskOpacity: 100,
      transform: { x: 0, y: 0, width: 160, height: 90, rotation: 0, opacity: 1 },
    },
    videoItem({ id: 'clip', video: 'hevc-main10', track: 1, inputColor: 'dlog-m' }),
  ],
  frames: [7],
})

// --- A cleaned shadow range at its boundary --------------------------------------------------------------------
// The piece is a different picture on purpose (see make-videos.sh): a frame read from the
// wrong file is obvious at these four frames, which are the two edges of the cleaned range
// and the frames either side of it.
add({
  id: 'shadow-piece-boundary',
  group: 'shadow removal',
  protects:
    'a clip whose cleaned piece covers source frames 30 to 59: frame 29 and frame 60 must be the source, frame 30 and frame 59 the piece, read at the piece\'s own frames 0 and 29. A frame from the wrong file, or the right file at the wrong offset (one frame early or late), changes the picture.',
  items: [
    videoItem({
      id: 'clip',
      video: 'shadow-source',
      frames: 64,
      sourceFrames: 72,
      shadowRemoval: {
        mark: { x: 160, y: 90, sourceFrame: 30, radius: 20 },
        ranges: [
          { startFrame: 30, endFrame: 60, credits: 45, jobId: 'job-1', passJobId: 'pass-1' },
        ],
        pieces: [
          {
            jobId: 'job-1',
            path: `media/${videoMediaId('shadow-source')}/shadow/30_30.mp4`,
            // The runner serves the committed media under this id on its own origin.
            src: `/media/${videoMediaId('shadow-piece')}`,
            startFrame: 30,
            frames: 30,
          },
        ],
      },
    }),
  ],
  frames: [29, 30, 59, 60],
})

// --- The stabilization stage (task 6.3) ------------------------------------------------------------------------
// Not a project: the case drives the shipped WebGPU stage directly with a synthetic frame, because nothing in the
// renderer draws it yet (slice C2 seats it). See `lib/stage-warp.mjs`.
cases.push(STAGE_WARP_CASE)

// --- The float path (design 3.6 section 2.13, review finding R2) -----------------------------------------------
// These cases render through the precise path: the compositor's rgba16float accumulator is read back as 16-bit values
// (`src/studio/render/test-sink.ts`) and stored as 16-bit data, compared exactly. The clips are raw 10-bit files that
// the raw test backend decodes (`lib/float.mjs` makes them), the project is the files' size so nothing is resampled.
const RAMP = { width: RAW_WIDTH, height: RAW_HEIGHT }
add({
  id: 'float-ramp-identity',
  group: 'float path',
  protects:
    'the float path keeps a 10-bit ramp: 877 grey levels in a row go through the source frame provider, the stage pipeline with no stage, FreeCut\'s draw and the float composite, and come out of the rgba16float accumulator as 877 different values (at least 800 are required, the stored frame holds the exact picture). One 8-bit intermediate anywhere in that path leaves at most 256 levels and fails the case.',
  items: [videoItem({ id: 'clip', video: 'raw-ramp', track: 0, frames: 2, sourceFrames: 2, ...RAMP })],
  frames: [0],
  float: true,
  minLevels: 800,
  ...RAMP,
})
add({
  id: 'float-ramp-dlog-m',
  group: 'float path',
  protects:
    'the same ramp with D-Log M set on the clip: the input colour pass in float between the source frame and the composite. The curve is smooth and rising, so the 877 codes must stay 877 different values after it (at least 800 are required); a pass or an intermediate that rounds to 8 bits, or a curve that clips the ramp, loses them.',
  items: [
    videoItem({
      id: 'clip',
      video: 'raw-ramp',
      track: 0,
      frames: 2,
      sourceFrames: 2,
      inputColor: 'dlog-m',
      ...RAMP,
    }),
  ],
  frames: [0],
  float: true,
  minLevels: 800,
  ...RAMP,
})
add({
  id: 'float-shadow-boundary',
  group: 'float path',
  protects:
    'the cleaned piece through the float path: a clip whose piece covers source frames 3 to 5 reads frames 2 and 6 from the source file and frames 3 and 5 from the piece, at the piece\'s own frames 0 and 2, as raw 10-bit pictures through the provider. A frame from the wrong file or one frame early or late is a different ramp.',
  items: [
    videoItem({
      id: 'clip',
      video: 'raw-shadow-source',
      frames: SHADOW_SOURCE_FRAMES,
      sourceFrames: SHADOW_SOURCE_FRAMES,
      shadowRemoval: {
        mark: { x: 512, y: 8, sourceFrame: 3, radius: 4 },
        ranges: [{ startFrame: 3, endFrame: 6, credits: 45, jobId: 'job-1', passJobId: 'pass-1' }],
        pieces: [
          {
            jobId: 'job-1',
            path: `media/${videoMediaId('raw-shadow-source')}/shadow/3_3.mp4`,
            src: `/media/${videoMediaId('raw-shadow-piece')}`,
            startFrame: 3,
            frames: SHADOW_PIECE_FRAMES,
          },
        ],
      },
      ...RAMP,
    }),
  ],
  frames: [2, 3, 5, 6],
  float: true,
  ...RAMP,
})
cases.push(STAGE_WARP_FLOAT_CASE)

// --- Motion blur (design 7.2 B, task 7.2) ----------------------------------------------------------------------
// A raw 12-frame clip (`lib/blur.mjs`): a static grey ramp above, a white box that moves 10 px a frame below. The
// motion blur switch is off in the app; the golden run turns it on through `setFeatureOverride` while a case renders.
const BLUR = { width: BLUR_WIDTH, height: BLUR_HEIGHT }
function addBlur({ id, protects, speed, shutterDegrees, frames, outputFrames, check, sameAsCase }) {
  add({
    id,
    group: 'motion blur',
    protects,
    items: [
      videoItem({
        id: 'clip',
        video: 'raw-blur-boxes',
        track: 0,
        frames: outputFrames,
        sourceFrames: BLUR_SOURCE_FRAMES,
        speed,
        ...(shutterDegrees ? { motionBlur: { shutterDegrees } } : {}),
        ...BLUR,
      }),
    ],
    frames,
    float: true,
    ...BLUR,
  })
  // The golden run turns the motion blur switch on through the feature module's override while it renders the case
  Object.assign(cases.at(-1), { check, sameAsCase })
  cases.at(-1).raw.features = ['motionBlur']
}
addBlur({
  id: 'blur-4x-360',
  protects:
    'motion blur at 4x with a 360 degree shutter, output frames 0 and 2: each frame is the mean in linear light of the four source frames it covers. The static grey ramp above is unchanged, the moving box below is four boxes each at 25 % of white (code 0.537 of the white-to-black mix), and the gaps stay black. A blend in code values, a wrong weight, a frame early or late or a stage that darkens the picture changes the boxes.',
  speed: 4,
  shutterDegrees: 360,
  outputFrames: 3,
  frames: [0, 2],
  check: checkFourTimes360,
})
addBlur({
  id: 'blur-4x-180',
  protects:
    'motion blur at 4x with a 180 degree shutter, output frames 0 and 1: the window covers the first two of the four source frames, so two boxes at 50 % and the other two frames absent. A shutter that ignores its angle shows four boxes.',
  speed: 4,
  shutterDegrees: 180,
  outputFrames: 3,
  frames: [0, 1],
  check: checkFourTimes180,
})
addBlur({
  id: 'blur-1x-off',
  protects:
    'a 1x clip with no blur, source frame 5: the reference the next case must equal bit for bit.',
  speed: 1,
  outputFrames: 12,
  frames: [5],
})
addBlur({
  id: 'blur-1x-on',
  protects:
    'a 1x clip with a 360 degree blur on, source frame 5: the shutter covers one source frame, so the pipeline passes it through and the picture equals blur-1x-off exactly (the identity that makes the switch safe at normal speed).',
  speed: 1,
  shutterDegrees: 360,
  outputFrames: 12,
  frames: [5],
  sameAsCase: 'blur-1x-off',
})

// --- Optical-flow slow motion (task 11.12) -------------------------------------------------------------------------
// A raw 6-frame clip (`lib/flow.mjs`): a smooth grey texture moving 6 px right and 2 px down a frame, at 0.5x with smooth
// slow motion in optical-flow mode. The motion blur switch is turned on for the case, as for the blur cases above.
add({
  id: 'flow-half-speed',
  group: 'motion blur',
  protects:
    'optical-flow slow motion at 0.5x, output frames 1, 2 and 3: frames 1 and 3 lie halfway between two source frames and are interpolated on the GPU from the flow measured both ways between them, so each is the texture moved halfway (within 1.5 levels of 1023 on average, and under a tenth of the plain blend\'s error, which doubles every edge); frame 2 is source frame 1 exactly. A kernel that reads a frame or a flow wrong, a phase off, a flow of the wrong size or the blend shown instead changes the frames in between.',
  items: [
    videoItem({
      id: 'clip',
      video: 'raw-flow-pattern',
      track: 0,
      frames: 8,
      sourceFrames: FLOW_SOURCE_FRAMES,
      speed: 0.5,
      motionBlur: { shutterDegrees: 360, smoothSlowMotion: 'optical-flow' },
      width: FLOW_WIDTH,
      height: FLOW_HEIGHT,
    }),
  ],
  frames: [1, 2, 3],
  float: true,
  width: FLOW_WIDTH,
  height: FLOW_HEIGHT,
})
Object.assign(cases.at(-1), { check: checkFlowHalfway })
cases.at(-1).raw.features = ['motionBlur']

// --- The creative look (design 3.6 section 3 row 5.2 look-hook, task 5.2) --------------------------------------
// The raw grey ramp with a 65 point look on the clip (`lib/look.mjs`: a linear cross-channel map, so every pixel has an
// exact expected value). The looks switch is off in the app; the golden run turns it on through `setFeatureOverride` and
// hands the page the look's `.cube` text, which the page parses into the library's table cache for the case.
const LOOK_TOLERANCE = 2 / 1023
const unorm = (image, x, channel) => image.data[(8 * image.width + x) * 4 + channel] / 65535
const SAMPLED_COLUMNS = [8, 100, 257, 512, 700, 901, 1015]
const rampValue = (x) => (64 + Math.floor((x * 877) / 1024)) / 1023

/** Every sampled pixel of a grey ramp through the look: `through(x)` is what the look is given, as 0..1 */
function lookProblems(image, through) {
  const problems = []
  for (const x of SAMPLED_COLUMNS) {
    const given = through(x, image)
    const want = lookOf(given, given, given)
    want.forEach((value, channel) => {
      const got = unorm(image, x, channel)
      if (Math.abs(got - value) > LOOK_TOLERANCE) {
        problems.push(`channel ${channel} at x=${x} is ${got.toFixed(5)}, the look gives ${value.toFixed(5)} for ${given.toFixed(5)}`)
      }
    })
  }
  return problems
}
function addLook({ id, protects, inputColor, check }) {
  add({
    id,
    group: 'creative look',
    protects,
    items: [
      videoItem({
        id: 'clip',
        video: 'raw-ramp',
        track: 0,
        frames: 2,
        sourceFrames: 2,
        ...(inputColor ? { inputColor } : {}),
        look: { id: LOOK_ID, intensity: 1 },
        ...RAMP,
      }),
    ],
    frames: [0],
    float: true,
    ...RAMP,
  })
  Object.assign(cases.at(-1), { check })
  Object.assign(cases.at(-1).raw, { features: ['looks'], looks: [{ id: LOOK_ID, text: linearLookText() }] })
}
addLook({
  id: 'float-look-linear',
  protects:
    'a 65 point look on the raw grey ramp, no input transform: each pixel is the look of its source value, (0.1 + 0.8 r, g, 0.1 + 0.5 b + 0.3 (1 - r)), within 2 levels of 1023. A stage that is not drawn, reads a channel or a row order wrong, or rounds to 8 bits before the look, is a different ramp.',
  check: (image) => lookProblems(image, (x) => rampValue(x)),
})
addLook({
  id: 'float-look-dlog-m',
  protects:
    'the same look after the D-Log M input transform: the look is given what the transform gave, never the file\'s codes. The green channel is the look\'s identity channel, so it carries the transform\'s output (it differs from the file by more than 10 levels of 1023 at the middle of the ramp), and red and blue are the look of that same green value. A look drawn before the transform would break that relation.',
  inputColor: 'dlog-m',
  check: (image) => {
    const problems = lookProblems(image, (x) => unorm(image, x, 1))
    const moved = Math.abs(unorm(image, 512, 1) - rampValue(512)) * 1023
    if (moved <= 10) problems.push(`the input transform did not run: the middle of the ramp moved only ${moved.toFixed(2)} levels`)
    return problems
  },
})

export const CASES = cases
