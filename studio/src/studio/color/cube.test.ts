// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { CUBE_MAX_SIZE, parseCube, type CubeLut3D } from './cube'

/** A generated `.cube` body: `LUT_3D_SIZE` and the grid, red fastest. */
function cubeText(
  size: number,
  entry: (red: number, green: number, blue: number) => readonly [number, number, number],
): string {
  const lines: string[] = [`LUT_3D_SIZE ${size}`]
  for (let blue = 0; blue < size; blue++) {
    for (let green = 0; green < size; green++) {
      for (let red = 0; red < size; red++) {
        const [r, g, b] = entry(red, green, blue)
        lines.push(`${r} ${g} ${b}`)
      }
    }
  }
  return lines.join('\n')
}

/** The 3D grid, asserting the file parsed to one. */
function gridOf(text: string): CubeLut3D {
  const cube = parseCube(text)
  expect(cube.lut3d).not.toBeNull()
  return cube.lut3d as CubeLut3D
}

describe('parseCube', () => {
  it('parses a 2³ file with TITLE, comments and CRLF', () => {
    const text = [
      '# created by hand',
      'TITLE "Test LUT"',
      '',
      'LUT_3D_SIZE 2',
      '# data follows',
      '0 0 0',
      '1 0 0',
      '0 1 0',
      '1 1 0',
      '0 0 1',
      '1 0 1',
      '0 1 1',
      '1 1 1',
    ].join('\r\n')

    const cube = parseCube(text)
    expect(cube.title).toBe('Test LUT')
    expect(cube.lut3d?.size).toBe(2)
    expect(cube.shaper).toBeNull()
    expect(Array.from(cube.lut3d?.data ?? [])).toEqual([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1,
    ])
    expect(cube.lut3d?.domainMin).toEqual([0, 0, 0])
    expect(cube.lut3d?.domainMax).toEqual([1, 1, 1])
  })

  it('stores the rows red fastest on an asymmetric 2³ file', () => {
    const text = [
      'LUT_3D_SIZE 2',
      '0.2 0.5 0.5',
      '0.8 0.5 0.5',
      '0.2 0.5 0.5',
      '0.8 0.5 0.5',
      '0.2 0.5 0.5',
      '0.8 0.5 0.5',
      '0.2 0.5 0.5',
      '0.8 0.5 0.5',
    ].join('\n')

    const data = gridOf(text).data
    // Entry index = red + 2·green + 4·blue: red alternates with the fastest axis.
    for (let entry = 0; entry < 8; entry++) {
      expect(data[entry * 3]).toBeCloseTo(entry % 2 === 0 ? 0.2 : 0.8, 6)
      expect(data[entry * 3 + 1]).toBeCloseTo(0.5, 6)
      expect(data[entry * 3 + 2]).toBeCloseTo(0.5, 6)
    }
  })

  it('reads DOMAIN_MIN/DOMAIN_MAX as the input domain and keeps the values', () => {
    const text = [
      'LUT_3D_SIZE 2',
      'DOMAIN_MIN 0 0 0',
      'DOMAIN_MAX 2 2 2',
      '0 0 0',
      '2 0 0',
      '0 2 0',
      '2 2 0',
      '0 0 2',
      '2 0 2',
      '0 2 2',
      '1 1 1',
    ].join('\n')

    const cube = parseCube(text)
    expect(cube.lut3d?.domainMin).toEqual([0, 0, 0])
    expect(cube.lut3d?.domainMax).toEqual([2, 2, 2])
    // The values are not rescaled: 2 is still 2 and 1 is still 1 (the sampler applies the domain).
    expect(cube.lut3d?.data[1 * 3]).toBe(2)
    expect(cube.lut3d?.data[7 * 3]).toBe(1)
  })

  it('supports exponent notation', () => {
    const text = ['LUT_3D_SIZE 2', ...Array(8).fill('5e-1 1e0 0e0')].join('\n')
    const data = gridOf(text).data
    expect(data[0]).toBeCloseTo(0.5, 6)
    expect(data[1]).toBe(1)
    expect(data[2]).toBe(0)
  })

  it('accepts a trailing comment on a keyword line and data line', () => {
    const text = [
      'LUT_3D_SIZE 2 # grid',
      'DOMAIN_MIN 0 0 0 # black',
      'DOMAIN_MAX 1 1 1',
      '0 0 0 # first',
      '1 0 0',
      '0 1 0',
      '1 1 0',
      '0 0 1',
      '1 0 1',
      '0 1 1',
      '1 1 1',
    ].join('\n')

    const data = gridOf(text).data
    expect(data[0]).toBe(0)
    expect(data[3]).toBe(1)
  })

  it('ignores unknown keywords and a UTF-8 BOM', () => {
    const text = [
      '\uFEFF# generated',
      'LUT_3D_INPUT_RANGE 0 1',
      'TITLE "with a # inside"',
      'LUT_3D_SIZE 2',
      'LUT_3D_INPUT_RANGE 0 1',
      '0 0 0',
      '1 0 0',
      '0 1 0',
      '1 1 0',
      '0 0 1',
      '1 0 1',
      '0 1 1',
      '1 1 1',
    ].join('\r\n')

    const cube = parseCube(text)
    expect(cube.title).toBe('with a # inside')
    expect(cube.lut3d?.size).toBe(2)
  })

  it('reads a 1D-only file as a shaper and no grid', () => {
    const text = [
      'TITLE "curve"',
      'LUT_1D_SIZE 4',
      '0 0 0',
      '0.2 0.2 0.2',
      '0.7 0.7 0.7',
      '1 1 1',
    ].join('\n')
    const cube = parseCube(text)
    expect(cube.lut3d).toBeNull()
    expect(cube.shaper?.size).toBe(4)
    const data = cube.shaper?.data ?? new Float32Array()
    expect(Array.from(data, (value) => Number(value.toFixed(6)))).toEqual([
      0, 0, 0, 0.2, 0.2, 0.2, 0.7, 0.7, 0.7, 1, 1, 1,
    ])
  })

  it('splits the shaper rows from the grid in a file with both sizes', () => {
    const text = [
      'LUT_3D_SIZE 2',
      'LUT_1D_SIZE 2',
      '0 0 0',
      '1 1 1',
      '0 0 0',
      '1 0 0',
      '0 1 0',
      '1 1 0',
      '0 0 1',
      '1 0 1',
      '0 1 1',
      '2 2 2',
    ].join('\n')

    const cube = parseCube(text)
    expect(cube.shaper?.size).toBe(2)
    expect(Array.from(cube.shaper?.data ?? [])).toEqual([0, 0, 0, 1, 1, 1])
    // The grid's last entry is 2 2 2, not one of the shaper rows.
    expect(cube.lut3d?.data[7 * 3]).toBe(2)
    expect(cube.lut3d?.data[7 * 3 + 2]).toBe(2)
  })

  it('reads a blue-fastest file with entryOrder', () => {
    // A target red-fastest table whose every entry differs, written with blue changing fastest:
    // the file's rows run red outer, green, blue inner, and each row holds the target entry
    // red + 2·green + 4·blue.
    const target = Array.from({ length: 8 }, (_, entry) => [
      Number(((entry + 1) / 10).toFixed(1)),
      0,
      0,
    ])
    const rows: string[] = ['LUT_3D_SIZE 2']
    for (let red = 0; red < 2; red++) {
      for (let green = 0; green < 2; green++) {
        for (let blue = 0; blue < 2; blue++) {
          rows.push(`${(target[red + 2 * green + 4 * blue]?.[0] ?? 0).toFixed(1)} 0 0`)
        }
      }
    }
    const text = rows.join('\n')
    const blue = parseCube(text, { entryOrder: 'blue-fastest' })
    const parsed = Array.from(blue.lut3d?.data ?? [], (value) => Number(value.toFixed(3)))
    expect(parsed).toEqual(target.flat())

    // Without the option the same file reads in the format's order and is transposed.
    const red = parseCube(text)
    expect(Array.from(red.lut3d?.data ?? [], (value) => Number(value.toFixed(3)))).not.toEqual(
      target.flat(),
    )
  })

  it('rejects a wrong number of entries', () => {
    const text = ['LUT_3D_SIZE 2', '0 0 0', '1 1 1'].join('\n')
    expect(() => parseCube(text)).toThrow(/expected 8 data entries/)
  })

  it('rejects a missing size', () => {
    expect(() => parseCube('TITLE "no size"\n0 0 0\n')).toThrow(/LUT_3D_SIZE/)
  })

  it('rejects data before the size', () => {
    expect(() => parseCube('0 0 0\nLUT_3D_SIZE 2\n')).toThrow(/before LUT_1D_SIZE or LUT_3D_SIZE/)
  })

  it('rejects a size below 2 and a size above 65', () => {
    expect(() => parseCube('LUT_3D_SIZE 1\n')).toThrow(
      /LUT_3D_SIZE must be an integer between 2 and 65/,
    )
    expect(() => parseCube('LUT_3D_SIZE 66\n')).toThrow(
      /LUT_3D_SIZE must be an integer between 2 and 65/,
    )
    expect(() => parseCube('LUT_1D_SIZE 1\n')).toThrow(
      /LUT_1D_SIZE must be an integer between 2 and 65536/,
    )
  })

  it('rejects a second size keyword', () => {
    expect(() => parseCube('LUT_3D_SIZE 2\nLUT_3D_SIZE 2\n')).toThrow(/appears twice/)
  })

  it('rejects a data line that is not a multiple of three values', () => {
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0 1\n')).toThrow(/not a multiple of three/)
  })

  it('rejects a number cut off at the end of the file', () => {
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 1e')).toThrow(/not a finite number/)
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 .')).toThrow(/not a finite number/)
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 +')).toThrow(/not a finite number/)
  })

  it('rejects junk glued to a number', () => {
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0.5x\n')).toThrow(/unexpected "x" after a number/)
  })

  it('rejects a size keyword after the data', () => {
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0\nLUT_1D_SIZE 2\n')).toThrow(
      /appears after the data/,
    )
  })

  it('reads a 65³ file and rejects 66³', () => {
    const last = CUBE_MAX_SIZE - 1
    const text = cubeText(CUBE_MAX_SIZE, (red, green, blue) => [
      red / last,
      green / last,
      blue / last,
    ])
    const cube = parseCube(text)

    expect(cube.lut3d?.size).toBe(CUBE_MAX_SIZE)
    expect(cube.lut3d?.data.length).toBe(CUBE_MAX_SIZE ** 3 * 3)
    expect(cube.lut3d?.data[0]).toBe(0)
    expect(cube.lut3d?.data[cube.lut3d.data.length - 1]).toBe(1)
    // The middle entry (red, green, blue) = (32, 32, 32) of the red-fastest order.
    const middle = (32 + 65 * 32 + 65 * 65 * 32) * 3
    expect(cube.lut3d?.data[middle]).toBeCloseTo(32 / 64, 5)

    expect(() => parseCube('LUT_3D_SIZE 66\n')).toThrow(/between 2 and 65/)
  })
})
