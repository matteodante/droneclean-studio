/**
 * Native font loading utilities.
 *
 * Faces come from the app's own assets: `@/studio/fonts/catalog-fonts` maps each
 * catalogue family and weight to a bundled Fontsource stylesheet, imported on
 * demand. Nothing here reads or builds a remote URL.
 */

import { DEFAULT_TEXT_FONT_FAMILY, FONT_CATALOG, type FontCatalogEntry } from './font-catalog'
import { CATALOG_FONT_SOURCES } from '@/studio/fonts/catalog-fonts'
import { createLogger } from '@/shared/logging/logger'

const logger = createLogger('FontLoader')

// Font weight CSS value mapping
export const FONT_WEIGHT_MAP: Record<string, number> = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
}

// Cache for loaded fonts
const loadedFontFamilies = new Map<string, string>()
const loadingPromises = new Map<string, Promise<string>>()

interface FontConfig {
  family: string
  weights: readonly number[]
}

const FONT_CONFIGS = new Map<string, FontConfig>()

function normalizeWeights(weights: readonly number[]): number[] {
  const uniqueWeights = [...new Set(weights)]
    .filter((weight) => Number.isFinite(weight) && weight > 0)
    .sort((a, b) => a - b)

  return uniqueWeights.length > 0 ? uniqueWeights : [400]
}

function toConfigEntry(family: string, weights: readonly number[]): FontConfig {
  return {
    family,
    weights: normalizeWeights(weights),
  }
}

function registerFont(
  fontKey: string,
  cssFamilyOrWeights: string | readonly number[] = fontKey,
  weights: readonly number[] = [400],
): void {
  if (typeof cssFamilyOrWeights === 'string') {
    FONT_CONFIGS.set(fontKey, toConfigEntry(cssFamilyOrWeights, weights))
    return
  }

  FONT_CONFIGS.set(fontKey, toConfigEntry(fontKey, cssFamilyOrWeights))
}

function registerFontCatalog(catalog: readonly FontCatalogEntry[]): void {
  for (const font of catalog) {
    registerFont(font.value, font.family, font.weights)
  }
}

function getFontConfig(fontName: string): FontConfig {
  const existing = FONT_CONFIGS.get(fontName)
  if (existing) {
    return existing
  }

  const fallback = toConfigEntry(fontName, [400])
  FONT_CONFIGS.set(fontName, fallback)
  return fallback
}

registerFontCatalog(FONT_CATALOG)

/**
 * Import the bundled stylesheets for one family. Families outside the catalogue
 * (older projects may name any font) import nothing and fall back to the system
 * family, as a missing Fontsource package would on Google Fonts.
 *
 * Workers have no stylesheet context, so the import is skipped there instead of
 * failing (the export renderer runs in a worker).
 */
async function importBundledFaces(fontName: string, weights: readonly number[]): Promise<void> {
  if (typeof document === 'undefined') {
    return
  }

  const bundled = CATALOG_FONT_SOURCES.get(fontName)
  if (!bundled) {
    return
  }

  await Promise.all(weights.map((weight) => bundled.weights.get(weight)?.()))
}

/**
 * Import the bundled faces for a font and report the CSS font-family value.
 */
async function loadBundledFont(fontName: string): Promise<string> {
  if (typeof document === 'undefined') {
    return fontName
  }

  const config = getFontConfig(fontName)

  // Check if already loading
  const existingPromise = loadingPromises.get(fontName)
  if (existingPromise) {
    return existingPromise
  }

  // Check if already loaded
  const cached = loadedFontFamilies.get(fontName)
  if (cached) {
    return cached
  }

  const loadPromise = (async () => {
    try {
      await importBundledFaces(fontName, config.weights)

      // Wait for font to be ready using Font Loading API
      if (document.fonts) {
        await document.fonts.ready

        // Check if font is actually loaded
        const fontFace = `400 16px "${config.family}"`
        const loaded = document.fonts.check(fontFace)

        if (!loaded) {
          // Try to force load
          await document.fonts.load(fontFace)
        }
      }

      // Cache and return the font family
      const fontFamily = `"${config.family}", sans-serif`
      loadedFontFamilies.set(fontName, fontFamily)
      return fontFamily
    } catch (error) {
      logger.warn(`Failed to load font "${fontName}":`, error)
      return fontName
    } finally {
      loadingPromises.delete(fontName)
    }
  })()

  loadingPromises.set(fontName, loadPromise)
  return loadPromise
}

/**
 * Load a font for use in compositions.
 * This should be called before rendering text that uses the font.
 *
 * @param fontName - The font name (e.g., 'Inter', 'Roboto')
 * @returns The CSS font-family value to use in styles
 */
export function loadFont(fontName: string): string {
  // Check if font is already loaded and return cached fontFamily
  const cached = loadedFontFamilies.get(fontName)
  if (cached) {
    return cached
  }

  // Start loading in background (fire and forget for sync API compatibility)
  void loadBundledFont(fontName)

  // Return immediately with font-family string
  // The font will be available when it finishes loading
  const config = getFontConfig(fontName)
  return `"${config.family}", sans-serif`
}

/**
 * Ensure font families and specific weights are available before rendering.
 */
export async function ensureFontsLoaded(
  fontNames: readonly string[],
  weights: readonly number[] = [400],
): Promise<void> {
  if (fontNames.length === 0 || typeof document === 'undefined' || !document.fonts) {
    return
  }

  const uniqueFonts = [...new Set(fontNames.map((name) => name.trim() || DEFAULT_TEXT_FONT_FAMILY))]

  // The stylesheet must be in the document before `document.fonts.load` can
  // find a face to fetch, so import first and wait for it.
  await Promise.all(
    uniqueFonts.map((fontName) => {
      const config = getFontConfig(fontName)
      const weightsToLoad = weights.length > 0 ? weights : config.weights
      return importBundledFaces(fontName, weightsToLoad)
    }),
  )

  await Promise.all(
    uniqueFonts.flatMap((fontName) => {
      const config = getFontConfig(fontName)
      const family = config.family
      const weightsToLoad = weights.length > 0 ? weights : config.weights
      return weightsToLoad.map((weight) =>
        document.fonts.load(`${weight} 16px "${family}"`, 'BESbswy'),
      )
    }),
  )
}

/**
 * Load all fonts needed for a set of text items.
 *
 * @param fontNames - Array of font names to load
 * @returns Array of CSS fontFamily values
 */
export function loadFonts(fontNames: string[]): string[] {
  const uniqueFonts = [...new Set(fontNames.map((name) => name.trim() || DEFAULT_TEXT_FONT_FAMILY))]
  return uniqueFonts.map(loadFont)
}
