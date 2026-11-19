/**
 * The types of the input colour stage (design 5.1, section 4.6): the profile a clip is set
 * to and the interface the precise render path (3.2) will call.
 *
 * The maths these types feed is beside this file, as pure functions; the WebGPU
 * implementation is slice 5.1c, so no code in the app uses `InputColorPass` yet and the
 * input transform stays behind the feature switch until 3.2 lands.
 */

/** A colour profile a clip can be set to: D-Log M, D-Log, or no transform at all. */
export type ColorProfileId = 'dlog-m' | 'dlog' | 'none'

/**
 * One colour as three floats. The scale depends on the function that takes it: a source
 * code (the 10-bit value divided by 1023) going in, display-referred RGB coming out.
 */
export type Rgb = readonly [number, number, number]

/**
 * The input colour stage of design 5.1 section 4.6, implemented by slice 5.1c: one
 * full-screen pass that maps a source frame's code values to display-referred RGB. The
 * precise path (3.2) owns the textures and the command encoder; the stage owns only its
 * pipeline and uniform buffer, so preview and export share it.
 */
export interface InputColorPass {
  /**
   * Records the pass. `input` and `output` are `rgba16float` textures without mips, both
   * `size` pixels; `profile` selects the constants in the uniform buffer, and `none`
   * copies the input through.
   */
  encode(
    encoder: GPUCommandEncoder,
    input: GPUTextureView,
    output: GPUTextureView,
    profile: ColorProfileId,
    size: { readonly width: number; readonly height: number },
  ): void
}
