# The input colour stage on the GPU (task 5.1, slices 5.1c and 5.2a; drawn by the stage pipeline, design 3.6)

One full-screen pass that turns a source frame's code values into display-referred Rec.709: the
decode of the clip's profile (`dlog-m`, `dlog`, or `none` for a pass-through), the gamut matrix in
linear light, the profile's shoulder, and the sRGB transfer function, in that order. The shader is
`transform()` of `../display.ts` in WGSL, and the constants are `../profiles.ts`' and `../gamut.ts`'.

| File                 | What                                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| `pass.ts`            | What both colour passes share: the full-screen triangle, `createPassPipeline`, `assertPassSize`        |
| `input-color-pass.ts`| `createInputColorPass(device, formats)`: the pipeline, the profiles' uniforms and `encode`              |
| `look-pass.ts`       | The `LookPass` (task 5.2b), same shape with a 3D texture                                                 |
| `input-color-pass.test.ts` | The uniforms' 16 floats, the shader's properties, the two target formats                           |
| `probe.mjs`, `probe-page.*` | The pass on the bench's ramp in Chromium (5.1c's measurement)                                     |

## Where the renderer calls it

The renderer reaches it through the stage pipeline (design 3.6, `src/studio/render/stages/`): the
input colour stage (`stages/input-colour.ts`) is an adapter over this pass, run after the
stabilization warp and before the look, in `rgba16float` in and out, preview included. FreeCut's
draw (crop, transform, corner pin, effects, masks) then takes the staged picture. A clip with no
profile and no other stage takes exactly the path it had, which is why the other golden frames do
not move.

The pass reads `textureLoad` at the written pixel, so nothing is filtered and the frame keeps its
size; `none` returns the texel bit for bit, so it is a copy. One pipeline is built per device and
format pair, when the stage is prepared, and reused after that.

## The check

```sh
npx vp test run src/studio/color/gpu                 # no GPU: the uniforms, the shader text, the cache
npm run golden -- --case color-input-dlog-m          # the pass's pixels through the pipeline, exact
```

The golden case is the committed 10-bit-like ramp clip (`golden/media/hevc-main10.mp4`) with
`inputColor: 'dlog-m'` on the item, frame 7: it goes source frame → input colour pass → draw
through the stage pipeline. An untouched clip would store the source frame, and a wrong curve or a
missing pass changes the ramp, so the frame pins the pipeline, the profile's uniform and the shader
together. `color-input-dlog-m-masked` is the same clip under a mask: the canvas path draws the
staged picture too, so inside the mask it equals the unmasked frame (finding R1).
