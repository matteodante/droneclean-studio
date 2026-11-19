#!/usr/bin/env node
/**
 * Checks the feature map in this folder.
 *
 * Every entry is a `### Name` heading followed by four fields:
 *
 *   - Where: <area › panel › section>
 *   - Does: <one plain sentence>
 *   - SDK: `studio.namespace.method` or `none`
 *   - Code: `src/path/under/studio.tsx`
 *
 * The check fails (exit 1) when a field is missing, when the SDK name is not a
 * method declared in `src/studio/sdk/types.ts`, or when the code path does not
 * exist under `studio/`. An entry whose code is under `src/studio/` (the fork's
 * own features) must have an SDK method: `none` fails there, unless the entry is
 * written `none (view only)` because it only navigates or shows the UI.
 * Fenced code blocks are examples, not entries.
 *
 * Run from `studio/`: node docs/feature-map/check.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_MAP_DIR = HERE
export const DEFAULT_STUDIO_ROOT = path.resolve(HERE, '../..')
export const SDK_TYPES_PATH = 'src/studio/sdk/types.ts'

const FIELDS = ['Where', 'Does', 'SDK', 'Code']

/** What an entry of the fork's own features writes when it has no SDK method because it only shows or opens the UI. */
export const VIEW_ONLY = 'none (view only)'

/** The fork's own code lives here: its features must be reachable through the SDK (plan decision D7). */
const FORK_CODE_PREFIX = 'src/studio/'

/**
 * Collects `studio.<namespace>.<method>` for every method declared in the
 * `XxxApi` interfaces of the SDK's public types.
 *
 * @param {string} source contents of src/studio/sdk/types.ts
 * @returns {Set<string>}
 */
export function parseSdkMethods(source) {
  const methods = new Set()
  const interfacePattern = /^export interface ([A-Za-z]+)Api \{([\s\S]*?)^\}/gm
  let match
  while ((match = interfacePattern.exec(source))) {
    const namespace = match[1][0].toLowerCase() + match[1].slice(1)
    const body = match[2]
    const methodPattern = /^ {2}([A-Za-z_$][\w$]*)\(/gm
    let method
    while ((method = methodPattern.exec(body))) {
      methods.add(`studio.${namespace}.${method[1]}`)
    }
  }
  return methods
}

/**
 * Splits a map file into entries, ignoring fenced code blocks.
 *
 * @param {string} source
 * @returns {{ name: string, line: number, fields: Map<string, string> }[]}
 */
export function parseEntries(source) {
  const entries = []
  let entry = null
  let inFence = false
  const lines = source.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const heading = /^### (.+?)\s*$/.exec(line)
    if (heading) {
      entry = { name: heading[1].trim(), line: index + 1, fields: new Map() }
      entries.push(entry)
      continue
    }
    if (/^#{1,2} /.test(line)) {
      entry = null
      continue
    }
    if (!entry) continue

    const field = new RegExp(`^- (${FIELDS.join('|')}):\\s*(.*)$`).exec(line)
    if (field) {
      entry.fields.set(field[1], field[2].trim())
    }
  }
  return entries
}

function readBackticked(value) {
  const match = /^`([^`]+)`$/.exec(value)
  return match ? match[1] : null
}

/**
 * @param {object} [options]
 * @param {string} [options.mapDir]
 * @param {string} [options.studioRoot]
 * @param {string} [options.sdkFile] path of the SDK types relative to studioRoot
 * @returns {{ errors: string[], entryCount: number, fileCount: number }}
 */
export function checkFeatureMap(options = {}) {
  const mapDir = options.mapDir ?? DEFAULT_MAP_DIR
  const studioRoot = options.studioRoot ?? DEFAULT_STUDIO_ROOT
  const sdkFile = options.sdkFile ?? SDK_TYPES_PATH

  const errors = []
  let entryCount = 0

  const sdkSource = fs.readFileSync(path.join(studioRoot, sdkFile), 'utf8')
  const sdkMethods = parseSdkMethods(sdkSource)

  const files = fs
    .readdirSync(mapDir)
    .filter((name) => name.endsWith('.md'))
    .sort()

  for (const file of files) {
    const source = fs.readFileSync(path.join(mapDir, file), 'utf8')
    for (const entry of parseEntries(source)) {
      entryCount += 1
      const where = `${file} › ${entry.name}`

      for (const field of FIELDS) {
        if (!entry.fields.has(field) || entry.fields.get(field) === '') {
          errors.push(`${where}: missing ${field}`)
        }
      }

      const sdkValue = entry.fields.get('SDK')
      if (sdkValue) {
        const sdkName = readBackticked(sdkValue)
        if (sdkValue === VIEW_ONLY) {
          // Accepted anywhere: nothing to look up
        } else if (sdkName === null) {
          errors.push(`${where}: SDK must be \`studio.<namespace>.<method>\` or \`none\`, got ${sdkValue}`)
        } else if (sdkName !== 'none' && !sdkMethods.has(sdkName)) {
          errors.push(`${where}: unknown SDK method ${sdkName}`)
        }
      }

      const codeForSdk = readBackticked(entry.fields.get('Code') ?? '')
      if (
        entry.fields.get('SDK') === '`none`' &&
        codeForSdk !== null &&
        codeForSdk.startsWith(FORK_CODE_PREFIX)
      ) {
        errors.push(
          `${where}: a feature of the fork (${codeForSdk}) needs an SDK method; write \`none (view only)\` only for an entry that just opens or shows the UI`,
        )
      }

      const codeValue = entry.fields.get('Code')
      if (codeValue) {
        const codePath = readBackticked(codeValue)
        if (codePath === null) {
          errors.push(`${where}: Code must be a backticked path under studio/, got ${codeValue}`)
        } else {
          const resolved = path.resolve(studioRoot, codePath)
          const inside = resolved.startsWith(studioRoot + path.sep)
          if (!inside) {
            errors.push(`${where}: code file is outside studio/: ${codePath}`)
          } else if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
            errors.push(`${where}: code file not found: ${codePath}`)
          }
        }
      }
    }
  }

  return { errors, entryCount, fileCount: files.length }
}

function main() {
  const { errors, entryCount, fileCount } = checkFeatureMap()
  if (errors.length > 0) {
    for (const error of errors) console.error(error)
    console.error(`feature map: ${errors.length} problem(s) in ${fileCount} file(s)`)
    process.exit(1)
  }
  console.log(`feature map: ${entryCount} entries in ${fileCount} files ok`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
