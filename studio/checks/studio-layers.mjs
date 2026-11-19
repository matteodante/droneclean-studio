// Layer rules for `src/studio/` (finding F3 of docs/reviews/2026-11-18-findings.md), run by
// `scripts/check-layer-boundaries.mjs` (`npm run check:layer-boundaries`):
//
//   core-purity  The core of the fork may not reach React, a store or `src/features/`, directly or through
//                the modules it imports: the time maths, the colour maths, the precise render contract, the
//                stabilization client / stage / settings, the motion-blur weights and the speed mapping.
//                The core is what the headless engine, the workers and the tests rely on without a UI.
//   types-ui     `src/types/` may not reach a `src/studio` UI module (a `.tsx` file, a folder `ui`,
//                `panel`, `panels` or `components`, or a module that imports React), directly or through
//                the modules it imports.
//
// Today's violations are listed in `checks/baselines/studio-layers.json`. The baseline may only shrink: a
// violation that is not in it fails the check, and an entry that is no longer a violation fails it too,
// until it is removed (`node scripts/check-layer-boundaries.mjs --shrink-baseline` removes the fixed ones
// and never adds one). So the debt cannot grow, and a paid-off entry cannot be used up again.
//
// A violation is named `<rule> | <module that must stay clean> | <module that breaks the rule> | <specifier>`;
// the module that must stay clean is a core file, or a `src/types/` file.

import fs from 'node:fs'
import path from 'node:path'
import {
  collectSourceFiles,
  collectSpecifiers,
  normalizePath,
  resolveImportTarget,
} from '../scripts/feature-import-utils.mjs'

const BASELINE_PATH = path.join(import.meta.dirname, 'baselines', 'studio-layers.json')

/** The files of the core, as paths relative to the studio folder (tests excluded). */
const CORE_FILES = [
  /^src\/studio\/time\/(?!.*\.test\.)[^/]+\.ts$/,
  /^src\/studio\/color\/(cube|display|gamut|log|lut-texture|profiles|tetrahedral|types)\.ts$/,
  /^src\/studio\/render\/precise\/contract\.ts$/,
  /^src\/studio\/stabilization\/(client|stage|settings)\.ts$/,
  /^src\/studio\/motion-blur\/(?!.*\.test\.)[^/]+\.ts$/,
  /^src\/studio\/speed\/mapping\.ts$/,
]

const isTest = (file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
const isCore = (file) => CORE_FILES.some((pattern) => pattern.test(file))
const REACT = /^(react|react-dom|zustand)(\/|$)/
const isStoreModule = (file) =>
  /(^|\/)(stores?|state)\//.test(file) || /(^|[-.\/])stores?\.[cm]?[jt]sx?$/.test(file)
const isUiModule = (file, source) =>
  /\.tsx$/.test(file) ||
  /^src\/studio\/(.*\/)?(ui|panel|panels|components)\//.test(file) ||
  /from\s+['"]react(-dom)?(\/[^'"]*)?['"]/.test(source)

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * Every violation of the two rules in the tree below `rootDir/src`, as
 * `{ key, rule, from, offender, specifier }`. Sorted, so the baseline is stable.
 */
export function collectStudioLayerViolations(rootDir) {
  const srcDir = path.join(rootDir, 'src')
  const relative = (absolute) => normalizePath(path.relative(rootDir, absolute))
  const sources = new Map()
  const edgesOf = new Map()

  function read(file) {
    if (!sources.has(file)) sources.set(file, stripComments(fs.readFileSync(file, 'utf8')))
    return sources.get(file)
  }
  function edges(file) {
    if (!edgesOf.has(file)) {
      edgesOf.set(
        file,
        collectSpecifiers(read(file)).map((specifier) => ({
          specifier,
          target: resolveImportTarget(rootDir, file, specifier),
        })),
      )
    }
    return edgesOf.get(file)
  }

  /** The files reachable from `start` (itself included) through non-test source files under src/. */
  function reachable(start) {
    const seen = new Set([start])
    const queue = [start]
    while (queue.length > 0) {
      const file = queue.pop()
      for (const { target } of edges(file)) {
        if (!target || seen.has(target) || isTest(target) || !target.startsWith(srcDir)) continue
        seen.add(target)
        queue.push(target)
      }
    }
    return seen
  }

  /** The path a specifier names even when no file is there (so a rule cannot be dodged by a typo). */
  function unresolvedName(from, specifier) {
    if (specifier.startsWith('@/')) return `src/${specifier.slice(2)}`
    if (specifier.startsWith('.')) return relative(path.resolve(path.dirname(from), specifier))
    return null
  }

  const violations = new Map()
  const add = (rule, from, offender, specifier) => {
    const key = `${rule} | ${from} | ${offender} | ${specifier}`
    violations.set(key, { key, rule, from, offender, specifier })
  }

  for (const file of collectSourceFiles(srcDir)) {
    const name = relative(file)
    if (isTest(name)) continue

    if (isCore(name)) {
      for (const member of reachable(file)) {
        for (const { specifier, target } of edges(member)) {
          const targetName = target ? relative(target) : unresolvedName(member, specifier)
          if (REACT.test(specifier)) add('core-purity', name, relative(member), specifier)
          else if (targetName?.startsWith('src/features/'))
            add('core-purity', name, relative(member), specifier)
          else if (targetName && isStoreModule(targetName) && !isTest(targetName))
            add('core-purity', name, relative(member), specifier)
        }
      }
    }

    if (name.startsWith('src/types/')) {
      for (const member of reachable(file)) {
        const memberName = relative(member)
        if (memberName.startsWith('src/studio/') && isUiModule(memberName, read(member))) {
          add('types-ui', name, memberName, memberName)
        }
      }
    }
  }

  return [...violations.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** The baseline's entries, or an empty list when the file is missing. */
export function readBaseline(baselinePath = BASELINE_PATH) {
  if (!fs.existsSync(baselinePath)) return []
  return JSON.parse(fs.readFileSync(baselinePath, 'utf8')).violations
}

/** Splits the violations into the new ones (not in the baseline) and the baseline entries no longer violated. */
export function compareWithBaseline(violations, baseline) {
  const known = new Set(baseline)
  const current = new Set(violations.map((violation) => violation.key))
  return {
    added: violations.filter((violation) => !known.has(violation.key)),
    fixed: baseline.filter((key) => !current.has(key)),
  }
}

/** Writes the baseline without the entries that are fixed; it never adds an entry. */
export function shrinkBaseline(violations, baselinePath = BASELINE_PATH) {
  const { fixed } = compareWithBaseline(violations, readBaseline(baselinePath))
  const kept = readBaseline(baselinePath).filter((key) => !fixed.includes(key))
  writeBaseline(kept, baselinePath)
  return fixed
}

export function writeBaseline(keys, baselinePath = BASELINE_PATH) {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true })
  fs.writeFileSync(
    baselinePath,
    `${JSON.stringify({ comment: 'May only shrink. See checks/studio-layers.mjs.', violations: keys }, null, 2)}\n`,
  )
}

/**
 * Runs the rules for the layer check: prints what failed and returns the number of failures.
 * `shrink` removes the fixed entries from the baseline instead of failing for them.
 */
export function runStudioLayerRules(rootDir, { shrink = false, baselinePath = BASELINE_PATH } = {}) {
  const violations = collectStudioLayerViolations(rootDir)
  if (shrink) {
    const removed = shrinkBaseline(violations, baselinePath)
    console.log(`Studio layer baseline: ${removed.length} fixed entr${removed.length === 1 ? 'y' : 'ies'} removed.`)
  }
  const baseline = readBaseline(baselinePath)
  const { added, fixed } = compareWithBaseline(violations, baseline)
  let failures = 0

  if (added.length > 0) {
    failures += added.length
    console.error(`Studio layer rules failed: ${added.length} new violation(s) (not in the baseline):\n`)
    for (const violation of added) {
      const what =
        violation.rule === 'core-purity'
          ? `core module ${violation.from} reaches ${violation.specifier} in ${violation.offender}; the core may not reach React, a store or src/features/`
          : `src/types module ${violation.from} reaches the studio UI module ${violation.offender}; src/types/ may not depend on UI`
      console.error(`- [${violation.rule}] ${what}`)
    }
  }
  if (fixed.length > 0) {
    failures += fixed.length
    console.error(
      `\nStudio layer rules failed: ${fixed.length} baseline entr${fixed.length === 1 ? 'y is' : 'ies are'} no longer a violation. ` +
        'Remove them (node scripts/check-layer-boundaries.mjs --shrink-baseline) so the debt cannot come back:\n',
    )
    for (const key of fixed) console.error(`- ${key}`)
  }
  if (failures === 0) {
    console.log(
      `Studio layer rules passed: ${violations.length} known violation(s) in the baseline, none new, none fixed and left in.`,
    )
  }
  return failures
}
