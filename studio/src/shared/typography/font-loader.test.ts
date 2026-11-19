import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { ensureFontsLoaded, FONT_WEIGHT_MAP, loadFont, loadFonts } from './font-loader'

interface StubFontFaceSet {
  ready: Promise<void>
  check: ReturnType<typeof vi.fn>
  load: ReturnType<typeof vi.fn>
}

function stubFontFaceSet(): StubFontFaceSet {
  const fonts: StubFontFaceSet = {
    ready: Promise.resolve(),
    check: vi.fn(() => true),
    load: vi.fn(async () => []),
  }
  Object.defineProperty(document, 'fonts', { configurable: true, value: fonts })
  return fonts
}

describe('font loader', () => {
  beforeEach(() => {
    stubFontFaceSet()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(document, 'fonts')
    vi.restoreAllMocks()
  })

  it('returns the CSS font-family the catalogue declares', () => {
    expect(loadFont('Roboto')).toBe('"Roboto", sans-serif')
    expect(loadFonts(['', 'Open Sans', 'Open Sans'])).toEqual([
      '"Inter", sans-serif',
      '"Open Sans", sans-serif',
    ])
    expect(FONT_WEIGHT_MAP.bold).toBe(700)
  })

  it('loads faces from bundled assets only, never from a remote stylesheet', async () => {
    const appendChild = vi.spyOn(document.head, 'appendChild')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    loadFont('Roboto')
    loadFonts(['Montserrat', 'Arial'])
    await ensureFontsLoaded(['Roboto', 'Montserrat', 'Arial'], [400, 700])

    expect(appendChild).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(document.querySelector('link[data-font]')).toBeNull()
  })

  it('does not contain a URL that could reach a font host', () => {
    const source = readFileSync(resolve('src/shared/typography/font-loader.ts'), 'utf8')

    expect(source).not.toMatch(/https?:\/\//)
    expect(source).not.toMatch(/googleapis|gstatic/)
  })

  it('asks the Font Loading API for every requested weight', async () => {
    const fonts = document.fonts as unknown as StubFontFaceSet

    await ensureFontsLoaded(['Roboto'], [400, 700])

    const requested = fonts.load.mock.calls.map(([fontFace]) => fontFace)
    expect(requested).toContain('400 16px "Roboto"')
    expect(requested).toContain('700 16px "Roboto"')
  })

  it('falls back to the system family for a font outside the catalogue', async () => {
    const fonts = document.fonts as unknown as StubFontFaceSet

    await expect(ensureFontsLoaded(['Arial'], [400])).resolves.toBeUndefined()
    expect(loadFont('Arial')).toBe('"Arial", sans-serif')
    expect(fonts.load).toHaveBeenCalledWith('400 16px "Arial"', 'BESbswy')
  })

  it('does nothing when there is no document (worker or headless context)', async () => {
    vi.stubGlobal('document', undefined)

    await expect(ensureFontsLoaded(['Roboto'], [400])).resolves.toBeUndefined()
    expect(loadFont('Roboto')).toBe('"Roboto", sans-serif')
  })
})
