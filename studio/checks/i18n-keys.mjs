#!/usr/bin/env node
// Translation keys check: the app showed the raw key `presets.mixed` because a slice used `t('presets.mixed')`
// and never added the key to the language files, and nothing failed. This is that check.
//
//   node checks/i18n-keys.mjs                     check
//   node checks/i18n-keys.mjs --shrink-baseline   drop the baseline entries that are fixed now (never adds one)
//   node checks/i18n-keys.mjs --list              print every gap, fork or not
//
// What it reads: the nine language trees, merged the way `src/i18n/index.ts` merges them (`<lang>.json`, then
// `partials/<lang>/*.json`), and every use of a key in `src/` and `desktop/src/` (tests and `src/i18n/` excluded):
// `t('...')`, `x.t('...')`, `i18n.t('...')`, `<Trans i18nKey="...">`, and `...Key: 'namespace.key'` table entries
// (see `checks/lib/i18n-scan.mjs`). Plural groups (`foo_one`, `foo_other`) count as the key `foo`.
//
// Rules, in the order of the findings:
//  1. A static key the English files do not define is an error, with file and line. A `defaultValue` does not
//     excuse it: the other languages would show English. For a FreeCut file, today's gaps are in
//     `baselines/i18n-missing-english.json`, which may only shrink.
//  2. A key built at runtime cannot be checked here. Each one (file and argument text) is listed, with its
//     reason, in `baselines/i18n-dynamic-keys.json`; a new one, or a listed one that is gone, is an error.
//  3. A key English defines that another language lacks is an error when the fork uses the key (code in
//     `src/studio/` or a file of `UPSTREAM_CHANGES.md`, including every key under the fixed start of a runtime
//     key it builds). For the other keys, today's gaps are in `baselines/i18n-missing-translations.json`,
//     which may only shrink.
//
// Out of reach: keys held in variables that are not a `...Key:` property with a namespaced literal, keys passed
// to helpers under another name, keys in strings outside the code (JSON, markdown).
//
// Exit codes: 0 all good, 1 a finding, 2 the check could not run.

import fs from 'node:fs'
import path from 'node:path'
import {
  LANGUAGES,
  collectUses,
  definitions,
  isDefined,
  loadTree,
  missingByLanguage,
} from './lib/i18n-scan.mjs'

const DEFAULT_ROOT = path.resolve(import.meta.dirname, '..')
const BASELINES = path.join(import.meta.dirname, 'baselines')
const DYNAMIC_PATH = path.join(BASELINES, 'i18n-dynamic-keys.json')
const MISSING_ENGLISH_PATH = path.join(BASELINES, 'i18n-missing-english.json')
const MISSING_TRANSLATIONS_PATH = path.join(BASELINES, 'i18n-missing-translations.json')

/** The files `UPSTREAM_CHANGES.md` lists (FreeCut's files the fork changed), as paths relative to studio/. */
function upstreamChangedFiles(root) {
  const file = path.join(root, 'UPSTREAM_CHANGES.md')
  if (!fs.existsSync(file)) return new Set()
  const files = new Set()
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^\|\s*`([^`]+)`\s*\|/.exec(line)
    if (match) files.add(match[1])
  }
  return files
}

const isForkFile = (file, upstreamFiles) => file.startsWith('src/studio/') || upstreamFiles.has(file)

function readJson(file, fallback) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback
}

const readBaselines = (paths = {}) => ({
  dynamic: readJson(paths.dynamic ?? DYNAMIC_PATH, { entries: [] }).entries,
  missingEnglish: readJson(paths.missingEnglish ?? MISSING_ENGLISH_PATH, { keys: {} }).keys,
  missingTranslations: readJson(paths.missingTranslations ?? MISSING_TRANSLATIONS_PATH, { keys: {} }).keys,
})

const dynamicId = (file, expression) => `${file} :: ${expression}`

/** The fixed start of a runtime key built from a template literal: `a.b.${x}` gives `a.b.`; otherwise null. */
function templatePrefix(expression) {
  const match = /^`([^`$]*)\$\{/.exec(expression)
  return match && match[1].includes('.') ? match[1] : null
}

/**
 * Measures the tree at `root`. Returns `{ gaps }`, the facts the rules judge, with no baseline applied:
 *   englishMissing: Map<key, [{file, line, fork}]>   static keys English lacks
 *   dynamic: Map<id, {file, expression, lines}>      runtime keys
 *   translationMissing: Map<key, {languages, fork}>  English keys other languages lack
 */
export function measure(root) {
  const trees = Object.fromEntries(LANGUAGES.map((language) => [language, loadTree(root, language)]))
  if (Object.keys(trees.en).length === 0) throw new Error(`no English language files under ${root}/src/i18n/locales`)
  const english = definitions(trees.en)
  const upstream = upstreamChangedFiles(root)
  const uses = collectUses(root, Object.keys(trees.en))

  const englishMissing = new Map()
  const dynamic = new Map()
  const forkKeys = new Set()
  const forkPrefixes = []
  for (const use of uses) {
    const fork = isForkFile(use.file, upstream)
    if (use.kind === 'static') {
      if (fork) forkKeys.add(use.key)
      if (!isDefined(english, use.key)) {
        if (!englishMissing.has(use.key)) englishMissing.set(use.key, [])
        englishMissing.get(use.key).push({ file: use.file, line: use.line, fork })
      }
    } else {
      const id = dynamicId(use.file, use.expression)
      if (!dynamic.has(id)) dynamic.set(id, { file: use.file, expression: use.expression, lines: [] })
      dynamic.get(id).lines.push(use.line)
      const prefix = fork ? templatePrefix(use.expression) : null
      if (prefix) forkPrefixes.push(prefix)
    }
  }

  const { keys, missing } = missingByLanguage(trees)
  const translationMissing = new Map()
  for (const key of keys) {
    const languages = LANGUAGES.filter((language) => language !== 'en' && missing.get(language)?.has(key))
    if (languages.length === 0) continue
    const fork = forkKeys.has(key) || forkPrefixes.some((prefix) => key.startsWith(prefix))
    translationMissing.set(key, { languages, fork })
  }
  return { englishMissing, dynamic, translationMissing }
}

const place = (entry) => `${entry.file}:${entry.line}`

/**
 * Judges the measurements against the baselines. Returns `{ errors: string[], shrinkable: {...} }`; the check
 * fails when `errors` is not empty. `shrinkable` lists the baseline entries that are no longer needed.
 */
export function judge(measured, baselines) {
  const errors = []
  const { englishMissing, dynamic, translationMissing } = measured

  // Rule 1: keys English lacks.
  const knownEnglish = baselines.missingEnglish
  const staleEnglish = []
  for (const [key, where] of [...englishMissing].sort(([a], [b]) => a.localeCompare(b))) {
    const fork = where.filter((entry) => entry.fork)
    if (fork.length > 0) {
      for (const entry of fork) {
        errors.push(
          `${place(entry)}: key '${key}' is not defined in the English files. Add it (and its eight translations) ` +
            'to src/i18n/locales/partials/<lang>/*.json; a defaultValue does not excuse it.',
        )
      }
    } else if (!(key in knownEnglish)) {
      errors.push(
        `${place(where[0])}: key '${key}' is not defined in the English files` +
          (where.length > 1 ? ` (${where.length} uses)` : '') +
          '. Add it (and its eight translations); the baseline of FreeCut gaps may only shrink.',
      )
    }
  }
  for (const key of Object.keys(knownEnglish)) if (!englishMissing.has(key)) staleEnglish.push(key)
  for (const key of staleEnglish) {
    errors.push(`baseline i18n-missing-english.json: key '${key}' is defined or unused now. Remove it (--shrink-baseline).`)
  }

  // Rule 2: runtime keys.
  const listed = new Set(baselines.dynamic.map((entry) => dynamicId(entry.file, entry.expression)))
  for (const [id, entry] of [...dynamic].sort(([a], [b]) => a.localeCompare(b))) {
    if (!listed.has(id)) {
      errors.push(
        `${entry.file}:${entry.lines[0]}: runtime key (${entry.expression}) cannot be checked. If it is ` +
          'intended, add it with its reason to checks/baselines/i18n-dynamic-keys.json; otherwise use a literal key.',
      )
    }
  }
  const staleDynamic = baselines.dynamic.filter((entry) => !dynamic.has(dynamicId(entry.file, entry.expression)))
  for (const entry of staleDynamic) {
    errors.push(
      `baseline i18n-dynamic-keys.json: (${entry.expression}) in ${entry.file} is gone. Remove it (--shrink-baseline).`,
    )
  }

  // Rule 3: translations other languages lack.
  const knownTranslations = baselines.missingTranslations
  const staleTranslations = []
  for (const [key, { languages, fork }] of [...translationMissing].sort(([a], [b]) => a.localeCompare(b))) {
    if (fork) {
      errors.push(
        `key '${key}' is used by DroneClean code but missing in ${languages.join(', ')}. ` +
          'Add the translation to src/i18n/locales/partials/<lang>/*.json.',
      )
    } else {
      const known = knownTranslations[key] ?? []
      const fresh = languages.filter((language) => !known.includes(language))
      if (fresh.length > 0) {
        errors.push(
          `key '${key}' is missing in ${fresh.join(', ')}. Add the translation; the baseline of FreeCut gaps ` +
            'may only shrink.',
        )
      }
    }
  }
  for (const [key, known] of Object.entries(knownTranslations)) {
    const current = translationMissing.get(key)
    const stillMissing = current && !current.fork ? current.languages : []
    const fixed = known.filter((language) => !stillMissing.includes(language))
    if (fixed.length > 0) {
      staleTranslations.push({ key, fixed })
      errors.push(
        `baseline i18n-missing-translations.json: '${key}' is translated now in ${fixed.join(', ')} ` +
          '(or no longer exists). Remove it (--shrink-baseline).',
      )
    }
  }
  return { errors, shrinkable: { english: staleEnglish, dynamic: staleDynamic, translations: staleTranslations } }
}

/** The baselines with every stale entry removed; never adds one. */
export function shrunk(baselines, shrinkable) {
  const missingTranslations = {}
  for (const [key, known] of Object.entries(baselines.missingTranslations)) {
    const fixed = shrinkable.translations.find((entry) => entry.key === key)?.fixed ?? []
    const left = known.filter((language) => !fixed.includes(language))
    if (left.length > 0) missingTranslations[key] = left
  }
  return {
    dynamic: baselines.dynamic.filter((entry) => !shrinkable.dynamic.includes(entry)),
    missingEnglish: Object.fromEntries(
      Object.entries(baselines.missingEnglish).filter(([key]) => !shrinkable.english.includes(key)),
    ),
    missingTranslations,
  }
}

const COMMENT = 'May only shrink. See checks/i18n-keys.mjs.'

function writeBaselines(baselines, paths = {}) {
  const lines = (map) => Object.entries(map).map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)}`)
  const write = (file, body) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, body)
  }
  write(
    paths.dynamic ?? DYNAMIC_PATH,
    `{\n  "comment": ${JSON.stringify('Runtime keys the check cannot follow, each with why. A new one needs a conscious entry. See checks/i18n-keys.mjs.')},\n  "entries": [\n${baselines.dynamic
      .map((entry) => `    ${JSON.stringify(entry)}`)
      .join(',\n')}\n  ]\n}\n`,
  )
  write(
    paths.missingEnglish ?? MISSING_ENGLISH_PATH,
    `{\n  "comment": ${JSON.stringify(`${COMMENT} FreeCut keys used in code with no English text; value: the files using it.`)},\n  "keys": {\n${lines(baselines.missingEnglish).join(',\n')}\n  }\n}\n`,
  )
  write(
    paths.missingTranslations ?? MISSING_TRANSLATIONS_PATH,
    `{\n  "comment": ${JSON.stringify(`${COMMENT} FreeCut keys English defines that these languages lack.`)},\n  "keys": {\n${lines(baselines.missingTranslations).join(',\n')}\n  }\n}\n`,
  )
}

function main(argv) {
  let measured
  try {
    measured = measure(DEFAULT_ROOT)
  } catch (error) {
    console.error(`SETUP: ${error.message}`)
    return 2
  }
  if (argv.includes('--list')) {
    for (const [key, where] of measured.englishMissing) console.log(`english-missing  ${key}  ${place(where[0])}${where[0].fork ? '  (fork)' : ''}`)
    for (const entry of measured.dynamic.values()) console.log(`runtime-key      ${entry.file}:${entry.lines[0]}  ${entry.expression}`)
    for (const [key, { languages, fork }] of measured.translationMissing) console.log(`translation      ${key}  ${languages.join(',')}${fork ? '  (fork)' : ''}`)
    return 0
  }
  const baselines = readBaselines()
  const { errors, shrinkable } = judge(measured, baselines)
  if (argv.includes('--shrink-baseline')) {
    writeBaselines(shrunk(baselines, shrinkable))
    const count = shrinkable.english.length + shrinkable.dynamic.length + shrinkable.translations.length
    console.log(`i18n baselines: ${count} entr${count === 1 ? 'y' : 'ies'} removed.`)
    const remaining = errors.filter((message) => !message.startsWith('baseline '))
    for (const message of remaining) console.error(`  ${message}`)
    return remaining.length > 0 ? 1 : 0
  }
  const knownTranslations = Object.keys(baselines.missingTranslations).length
  console.log(
    `i18n keys: ${measured.englishMissing.size} key(s) without English text (${Object.keys(baselines.missingEnglish).length} in the baseline), ` +
      `${measured.dynamic.size} runtime key(s) (${baselines.dynamic.length} listed), ` +
      `${measured.translationMissing.size} key(s) lacking a translation (${knownTranslations} in the baseline).`,
  )
  if (errors.length === 0) {
    console.log('PASS: every key the code uses is defined, and no translation went missing.')
    return 0
  }
  console.error(`FAIL: ${errors.length} problem(s):`)
  for (const message of errors) console.error(`  ${message}`)
  return 1
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2))
