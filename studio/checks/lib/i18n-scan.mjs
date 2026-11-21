// Finding the translation keys the code uses, and the keys the language files define.
// Used by `checks/i18n-keys.mjs`; see that file for what is checked and why.
//
// Keys the scan finds (a "use"): the first argument of `t(...)`, `x.t(...)`, `i18n.t(...)`, the `i18nKey` of
// `<Trans>`, and any property named `...Key` whose string value starts with a top-level namespace of the English
// files (`labelKey: 'projects.settings.x'`, the pattern FreeCut uses for tables of labels). A use is either
// static (a string literal, or a template literal without `${}`) or dynamic (anything else).

import fs from 'node:fs'
import path from 'node:path'

export const LANGUAGES = ['en', 'de', 'es', 'fr', 'it', 'ja', 'ko', 'pt-BR', 'tr', 'zh']
const SCANNED_FOLDERS = ['src/', 'desktop/src/']
const CODE = /\.(?:[cm]?[jt]sx?)$/
const isTest = (file) =>
  /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) ||
  /(^|\/)__(tests|mocks|fixtures)__\//.test(file) ||
  /\.d\.ts$/.test(file) ||
  /\.fixture\.[cm]?[jt]sx?$/.test(file)
/** The i18n folder holds the loader and its own tests, not UI copy. */
const isScanned = (file) => CODE.test(file) && !isTest(file) && !file.startsWith('src/i18n/')

function walk(root, directory, out = []) {
  const base = path.join(root, directory)
  if (!fs.existsSync(base)) return out
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    const relative = `${directory}${entry.name}`
    if (entry.isDirectory()) walk(root, `${relative}/`, out)
    else if (entry.isFile()) out.push(relative)
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// Language files
// ---------------------------------------------------------------------------------------------------------------

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (isPlainObject(target[key]) && isPlainObject(value)) deepMerge(target[key], value)
    else target[key] = value
  }
}

/** The loader's own rule (src/i18n/index.ts): an `effects.json` without a root `effects` key is wrapped in one. */
function normalizePartial(file, slice) {
  return file.endsWith('/effects.json') && !isPlainObject(slice.effects) ? { effects: slice } : slice
}

/** The merged tree of one language, built as `src/i18n/index.ts` builds it: base file, then partials by name. */
export function loadTree(root, language) {
  const base = path.join(root, 'src/i18n/locales', `${language}.json`)
  const tree = fs.existsSync(base) ? JSON.parse(fs.readFileSync(base, 'utf8')) : {}
  const folder = path.join(root, 'src/i18n/locales/partials', language)
  if (fs.existsSync(folder)) {
    for (const name of fs.readdirSync(folder).filter((entry) => entry.endsWith('.json')).sort()) {
      const slice = JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'))
      deepMerge(tree, normalizePartial(`/${name}`, slice))
    }
  }
  return tree
}

/** The set of dotted paths of every leaf (a string, number, boolean or array) of a tree. */
function flatten(tree, prefix = '', out = new Set()) {
  for (const [key, value] of Object.entries(tree)) {
    const dotted = prefix ? `${prefix}.${key}` : key
    if (isPlainObject(value)) flatten(value, dotted, out)
    else out.add(dotted)
  }
  return out
}

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

/** The plural categories a language needs a form for, from the platform's own rules, never fewer than `other`. */
function requiredForms(language) {
  const categories = new Intl.PluralRules(language).resolvedOptions().pluralCategories
  // `many` (fr, es, pt) only applies to numbers of a million and up; the project's files carry one and other.
  return categories.filter((category) => category === 'one' || category === 'other')
}

/**
 * The keys a language file set defines, grouped the way i18next resolves them: a plain key, or a plural group
 * (`foo_one`, `foo_other`, ...) that `t('foo', { count })` finds. Returns `{ plain: Set, groups: Map<base, Set<form>> }`.
 */
export function definitions(tree) {
  const plain = new Set()
  const groups = new Map()
  for (const leaf of flatten(tree)) {
    const match = PLURAL_SUFFIX.exec(leaf)
    if (match) {
      const base = leaf.slice(0, match.index)
      if (!groups.has(base)) groups.set(base, new Set())
      groups.get(base).add(match[1])
    }
    plain.add(leaf)
  }
  return { plain, groups }
}

/** Is `key` defined, as itself or as a plural group? */
export function isDefined(defs, key) {
  return defs.plain.has(key) || defs.groups.has(key)
}

/**
 * The logical keys English defines (plain keys, and plural groups under their base name) and, for each language
 * other than English, the ones it lacks: `{ keys: string[], missing: Map<language, Set<key>> }`. A plural group is
 * complete in a language when it has `other`, and `one` where the language's rules have a singular.
 */
export function missingByLanguage(trees) {
  const english = definitions(trees.en)
  const keys = new Set()
  for (const leaf of english.plain) if (!PLURAL_SUFFIX.test(leaf)) keys.add(leaf)
  for (const base of english.groups.keys()) keys.add(base)
  const missing = new Map()
  for (const language of Object.keys(trees)) {
    if (language === 'en') continue
    const defs = definitions(trees[language])
    const lacking = new Set()
    for (const key of keys) {
      if (english.groups.has(key) && !english.plain.has(key)) {
        const forms = defs.groups.get(key) ?? new Set()
        if (defs.plain.has(key)) continue // a plain key stands for every form
        const needed = requiredForms(language)
        if (!needed.every((form) => forms.has(form))) lacking.add(key)
      } else if (!defs.plain.has(key) && !defs.groups.has(key)) {
        lacking.add(key)
      }
    }
    missing.set(language, lacking)
  }
  return { keys: [...keys].sort(), missing }
}

// ---------------------------------------------------------------------------------------------------------------
// Source scan
// ---------------------------------------------------------------------------------------------------------------

/**
 * Marks which characters of `source` are code: not in a comment, a string, the text of a template literal or a
 * regular expression. The expressions inside `${...}` of a template are code. Returns a Uint8Array of 0 and 1.
 */
function codeMask(source) {
  const mask = new Uint8Array(source.length)
  const length = source.length
  // The stack holds, for each open template literal, the brace depth of its current `${` expression.
  const templates = []
  let braces = 0
  let lastSignificant = ''
  let lastWord = ''
  let i = 0
  const regexAllowed = () =>
    lastSignificant === '' ||
    '(,=:[!&|?{};+-*%<>~^'.includes(lastSignificant) ||
    ['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'yield', 'await'].includes(lastWord)
  while (i < length) {
    const char = source[i]
    const next = source[i + 1]
    if (char === '/' && next === '/') {
      while (i < length && source[i] !== '\n') i++
      continue
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? length : end + 2
      continue
    }
    if (char === '"' || char === "'") {
      i++
      while (i < length && source[i] !== char && source[i] !== '\n') i += source[i] === '\\' ? 2 : 1
      i++
      lastSignificant = char
      lastWord = ''
      continue
    }
    if (char === '`') {
      // Read the template's text; stop at `${` (back to code) or the closing backtick.
      i++
      while (i < length && source[i] !== '`' && !(source[i] === '$' && source[i + 1] === '{')) i += source[i] === '\\' ? 2 : 1
      if (source[i] === '$') {
        templates.push(braces)
        braces = 0
        i += 2
        lastSignificant = '{'
        continue
      }
      i++
      lastSignificant = '`'
      lastWord = ''
      continue
    }
    if (char === '/' && regexAllowed()) {
      let j = i + 1
      let inClass = false
      while (j < length && source[j] !== '\n') {
        if (source[j] === '\\') j++
        else if (source[j] === '[') inClass = true
        else if (source[j] === ']') inClass = false
        else if (source[j] === '/' && !inClass) break
        j++
      }
      if (source[j] === '/') {
        i = j + 1
        lastSignificant = '/'
        lastWord = ''
        while (i < length && /[a-z]/.test(source[i])) i++
        continue
      }
    }
    if (char === '{') braces++
    if (char === '}') {
      if (braces === 0 && templates.length > 0) {
        // The `${...}` expression ends: continue the template's text.
        braces = templates.pop()
        i++
        while (i < length && source[i] !== '`' && !(source[i] === '$' && source[i + 1] === '{')) i += source[i] === '\\' ? 2 : 1
        if (source[i] === '$') {
          templates.push(braces)
          braces = 0
          i += 2
          lastSignificant = '{'
          continue
        }
        i++
        lastSignificant = '`'
        lastWord = ''
        continue
      }
      braces--
    }
    mask[i] = 1
    if (/\s/.test(char)) {
      i++
      continue
    }
    if (/[\w$]/.test(char)) {
      let j = i
      while (j < length && /[\w$]/.test(source[j])) j++
      lastWord = source.slice(i, j)
      for (let k = i; k < j; k++) mask[k] = 1
      lastSignificant = source[j - 1]
      i = j
      continue
    }
    lastSignificant = char
    lastWord = ''
    i++
  }
  return mask
}

function unescape(text) {
  return text.replace(/\\(u\{([0-9a-fA-F]+)\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|[\s\S])/g, (all, rest, braced, uni, hex) => {
    if (braced) return String.fromCodePoint(Number.parseInt(braced, 16))
    if (uni) return String.fromCharCode(Number.parseInt(uni, 16))
    if (hex) return String.fromCharCode(Number.parseInt(hex, 16))
    const map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }
    return rest in map ? map[rest] : rest
  })
}

/** Reads the string or template literal starting at `index`: `{ value, end, interpolated }`, or null. */
function readLiteral(source, index) {
  const quote = source[index]
  if (quote !== '"' && quote !== "'" && quote !== '`') return null
  let i = index + 1
  while (i < source.length && source[i] !== quote) {
    if (source[i] === '\\') i++
    else if (quote !== '`' && source[i] === '\n') return null
    i++
  }
  if (i >= source.length) return null
  const raw = source.slice(index + 1, i)
  return { value: unescape(raw), end: i + 1, interpolated: quote === '`' && raw.includes('${') }
}

function skipSpace(source, mask, index) {
  let i = index
  // Comments are not code: step over them as well as whitespace.
  while (i < source.length && (/\s/.test(source[i]) || (!mask[i] && isCommentAt(source, i)))) i++
  return i
}

function isCommentAt(source, index) {
  // Called only for characters outside code: a comment is the only non-code thing that can sit between tokens.
  return true && !/['"`]/.test(source[index])
}

/**
 * The text of the call argument that starts at `index` (up to the `,` or `)` that ends it at the top level),
 * whitespace collapsed.
 */
function readArgument(source, mask, index) {
  let depth = 0
  let i = index
  while (i < source.length) {
    if (mask[i]) {
      const char = source[i]
      if ('([{'.includes(char)) depth++
      else if (')]}'.includes(char)) {
        if (depth === 0) break
        depth--
      } else if (char === ',' && depth === 0) break
    }
    i++
  }
  return source.slice(index, i).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' ').replace(/\s+/g, ' ').trim()
}

function lineOf(source, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (source.charCodeAt(i) === 10) line++
  return line
}

/**
 * The names a call's options object passes for interpolation (`{ count, name: x }` gives count and name), or null
 * when they cannot be read: a variable, a spread, anything but an object literal. A nested object's own names are
 * counted too, which only ever lets a name through.
 */
function passedValues(expression) {
  if (!expression.startsWith('{') || expression.includes('...')) return null
  return [...expression.matchAll(/(?:^\{|,)\s*([A-Za-z_$][\w$]*)\s*(?=[:,}])/g)].map((match) => match[1])
}

/** The interpolation names of one string: `{{count}}` and `{{value, number}}` give count and value. */
function placeholdersOf(text) {
  return new Set([...String(text).matchAll(/\{\{\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g)].map((match) => match[1]))
}

/**
 * The interpolation names of a key in a merged tree: its string's, or the union over a plural group's forms; null
 * when the tree does not define it.
 */
export function keyPlaceholders(tree, key) {
  const parts = key.split('.')
  let node = tree
  for (const part of parts.slice(0, -1)) {
    node = isPlainObject(node) ? node[part] : undefined
    if (node === undefined) return null
  }
  if (!isPlainObject(node)) return null
  const leaf = parts.at(-1)
  const texts = Object.entries(node)
    .filter(([name, value]) => (name === leaf || (name.startsWith(`${leaf}_`) && PLURAL_SUFFIX.test(name))) && typeof value === 'string')
    .map(([, value]) => value)
  if (texts.length === 0) return null
  const names = new Set()
  for (const text of texts) for (const name of placeholdersOf(text)) names.add(name)
  return names
}

/** `foo?.t(`, `foo.t(`, `i18n.t(` and a bare `t(`; the lookbehind keeps `format(`, `Math.t(`-style names out. */
const CALL = /(?<![\w$])(?:[\w$]+\s*\??\.\s*)?t\s*\(/g
const TRANS_KEY = /\bi18nKey\s*=\s*/g
const KEY_PROPERTY = /(?<![\w$.])[\w$]*Key\s*:\s*/g

/**
 * Every use of a translation key in one source file: `{ line, kind: 'static' | 'dynamic', key?, values?, expression? }`;
 * `values` are the interpolation names a static call passes (`passedValues`): [] for none, null when unreadable.
 * `namespaces` are the top-level keys of the English files; a `...Key:` property only counts when its string
 * starts with one of them and a dot.
 */
export function scanSource(source, namespaces) {
  const mask = codeMask(source)
  const uses = []
  const record = (index, argumentStart) => {
    const start = skipSpace(source, mask, argumentStart)
    const literal = readLiteral(source, start)
    if (literal && !literal.interpolated) {
      const after = skipSpace(source, mask, literal.end)
      if (source[after] === ',' || source[after] === ')' || source[after] === '}') {
        const values = source[after] === ',' ? passedValues(readArgument(source, mask, skipSpace(source, mask, after + 1))) : []
        uses.push({ line: lineOf(source, index), kind: 'static', key: literal.value, values })
        return
      }
    }
    const expression = readArgument(source, mask, start)
    // `cond ? 'a.b' : 'a.c'`: both branches are static keys.
    const choice = /^[\s\S]+?\?\s*(['"`])([^'"`$\\]+)\1\s*:\s*(['"`])([^'"`$\\]+)\3$/.exec(expression)
    if (choice) {
      uses.push({ line: lineOf(source, index), kind: 'static', key: choice[2] })
      uses.push({ line: lineOf(source, index), kind: 'static', key: choice[4] })
      return
    }
    uses.push({ line: lineOf(source, index), kind: 'dynamic', expression })
  }
  for (const match of source.matchAll(CALL)) {
    if (!mask[match.index]) continue
    // `t(` must stand alone or be a member call: `.t(` after a word is fine, `x.get(`-style names never match `t(`.
    record(match.index, match.index + match[0].length)
  }
  for (const match of source.matchAll(TRANS_KEY)) {
    if (!mask[match.index]) continue
    let start = match.index + match[0].length
    // `i18nKey="x"` or `i18nKey={'x'}` or `i18nKey={expression}`
    if (source[start] === '{') {
      start = skipSpace(source, mask, start + 1)
      record(match.index, start)
    } else {
      const literal = readLiteral(source, start)
      if (literal) uses.push({ line: lineOf(source, match.index), kind: 'static', key: literal.value })
    }
  }
  const names = namespaces.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const prefix = new RegExp(`^(?:${names})\\.`)
  for (const match of source.matchAll(KEY_PROPERTY)) {
    if (!mask[match.index]) continue
    const literal = readLiteral(source, match.index + match[0].length)
    if (literal && !literal.interpolated && prefix.test(literal.value)) {
      uses.push({ line: lineOf(source, match.index), kind: 'static', key: literal.value })
    }
  }
  // `{ 'namespace.key': 'English text' }`: a table keyed by translation keys (the speed-curve panel's labels). The value must be a string: `'a.b': { ... }` is an event map.
  const tableKey = new RegExp(`(?:^|[{,])\\s*(['"])((?:${names})\\.[\\w.-]+)\\1\\s*:\\s*['"\\x60]`, 'gm')
  for (const match of source.matchAll(tableKey)) {
    uses.push({ line: lineOf(source, match.index + match[0].indexOf(match[1])), kind: 'static', key: match[2] })
  }
  return uses
}

/** Every use in the scanned folders: `{ file, line, kind, key?, expression? }`, in file and line order. */
export function collectUses(root, namespaces) {
  const uses = []
  for (const folder of SCANNED_FOLDERS) {
    for (const file of walk(root, folder).filter(isScanned).sort()) {
      const source = fs.readFileSync(path.join(root, file), 'utf8')
      for (const use of scanSource(source, namespaces)) uses.push({ file, ...use })
    }
  }
  return uses
}
