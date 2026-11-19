#!/usr/bin/env node
// Regenerates the FONT_LICENSES list in font-licenses.ts from the Fontsource
// packages the app bundles, so /licenses shows the notice each font carries.
//
//   node src/studio/licenses/generate-font-licenses.mjs
//
// The bundled packages are the ones `catalog-fonts.ts` and `ui-fonts.ts`
// import, which is exactly what the build emits: adding a font means importing
// its stylesheet and running this script. Per package it reads
// `node_modules/@fontsource/<slug>/metadata.json` (family, licence type) and
// `LICENSE` (copyright line). The URL is the project repository named in the
// copyright line or in PROJECT_URLS, or Google Fonts' repository when neither
// names one.

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../../..')
const LICENSES_FILE = path.join(ROOT, 'src/studio/licenses/font-licenses.ts')
const PACKAGES_DIR = path.join(ROOT, 'node_modules/@fontsource')
const DEFAULT_URL = 'https://github.com/google/fonts'
const LICENSES = ['OFL-1.1', 'Apache-2.0', 'UFL-1.0']
// Families whose licence notice names no repository, but whose project is known.
const PROJECT_URLS = {
  'IBM Plex Mono': 'https://github.com/IBM/plex',
  'IBM Plex Sans': 'https://github.com/IBM/plex',
}
// The modules that import the bundled Fontsource stylesheets.
const FONT_SOURCES = ['src/studio/fonts/catalog-fonts.ts', 'src/studio/fonts/ui-fonts.ts']
const PACKAGE_SPECIFIER = /@fontsource\/([a-z0-9-]+)\//g

const DATA_MARKER = 'export const FONT_LICENSES: readonly FontLicense[] = ['

function bundledSlugs() {
  const slugs = new Set()
  for (const file of FONT_SOURCES) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
    for (const match of source.matchAll(PACKAGE_SPECIFIER)) {
      if (match[1]) slugs.add(match[1])
    }
  }
  return [...slugs].sort()
}

/** Whether a line names a copyright holder (rather than, say, a licence title). */
function isCopyrightNotice(line) {
  return Boolean(line) && /copyright/i.test(line)
}

/** The first line of the licence that names a copyright holder. */
function copyrightOf(slug, attribution) {
  const text = fs.readFileSync(path.join(PACKAGES_DIR, slug, 'LICENSE'), 'utf8')
  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0]

  const candidates = [firstLine, attribution]
  return candidates.find(isCopyrightNotice) ?? firstLine ?? attribution ?? ''
}

/** The known repository of a family, else the one the copyright line names. */
function urlOf(family, copyright) {
  const projectUrl = PROJECT_URLS[family]
  if (projectUrl) return projectUrl
  const match = copyright.match(/https?:\/\/[^\s,;|)]+/)
  if (!match) return DEFAULT_URL
  return match[0].replace(/[.'":]+$/, '')
}

function readPackage(slug) {
  const metadata = JSON.parse(
    fs.readFileSync(path.join(PACKAGES_DIR, slug, 'metadata.json'), 'utf8'),
  )
  const license = metadata.license?.type
  if (!LICENSES.includes(license)) {
    throw new Error(`${slug}: licence type "${license}" is not one of ${LICENSES.join(', ')}`)
  }
  const copyright = copyrightOf(slug, metadata.license?.attribution)
  return {
    family: metadata.family,
    license,
    copyright: copyright.replace(/\s+/g, ' ').trim(),
    url: urlOf(metadata.family, copyright),
  }
}

function quote(value) {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
}

function render(fonts) {
  const entries = fonts.map((font) =>
    [
      '  {',
      `    family: ${quote(font.family)},`,
      `    license: ${quote(font.license)},`,
      `    copyright: ${quote(font.copyright)},`,
      `    url: ${quote(font.url)},`,
      '  },',
    ].join('\n'),
  )
  return `${DATA_MARKER}\n${entries.join('\n')}\n]\n`
}

function main() {
  const fonts = bundledSlugs().map(readPackage)
  fonts.sort((a, b) => a.family.localeCompare(b.family, 'en'))

  const source = fs.readFileSync(LICENSES_FILE, 'utf8')
  const markerIndex = source.indexOf(DATA_MARKER)
  if (markerIndex < 0) {
    throw new Error(`${LICENSES_FILE} has no "${DATA_MARKER}" line to replace`)
  }
  fs.writeFileSync(LICENSES_FILE, source.slice(0, markerIndex) + render(fonts))
  console.log(`${path.relative(ROOT, LICENSES_FILE)}: ${fonts.length} families`)
}

main()
