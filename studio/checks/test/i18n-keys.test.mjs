// Tests for the translation keys check (`checks/i18n-keys.mjs`): each way the check must fail is planted in a
// small tree and seen failing, with the message that names the file and the key.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { judge, measure, shrunk } from '../i18n-keys.mjs'
import { LANGUAGES, scanSource } from '../lib/i18n-scan.mjs'

const NO_BASELINES = { dynamic: [], missingEnglish: {}, missingTranslations: {} }

/** A tree with English `en` and the same `translations` in every other language, plus source files. */
function tree({ en, others = en, source = {}, upstream = [] }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'droneclean-i18n-'))
  const put = (file, content) => {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content))
  }
  for (const language of LANGUAGES) put(`src/i18n/locales/${language}.json`, language === 'en' ? en : others)
  for (const [file, content] of Object.entries(source)) put(file, content)
  put('UPSTREAM_CHANGES.md', upstream.map((file) => `| \`${file}\` | x | y |`).join('\n'))
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) }
}

function run(spec, baselines = NO_BASELINES) {
  const fixture = tree(spec)
  try {
    return judge(measure(fixture.root), baselines).errors
  } finally {
    fixture.cleanup()
  }
}

const EN = { presets: { mixed: 'Mixed' }, common: { ok: 'OK', items_one: '{{count}} item', items_other: '{{count}} items' } }

test('a tree where every key is defined and translated passes', () => {
  const errors = run({
    en: EN,
    source: {
      'src/studio/a.tsx': "t('presets.mixed'); t('common.items', { count: 2 }); <Trans i18nKey=\"common.ok\" />",
    },
  })
  assert.deepEqual(errors, [])
})

test('planted: a static key English does not define fails in fork code, with file and line', () => {
  const errors = run({ en: EN, source: { 'src/studio/a.tsx': "const x = 1\nt('presets.missing', { defaultValue: 'Nope' })" } })
  assert.equal(errors.length, 1)
  assert.match(errors[0], /src\/studio\/a\.tsx:2: key 'presets\.missing' is not defined in the English files/)
  assert.match(errors[0], /defaultValue does not excuse/)
})

test('planted: a file listed in UPSTREAM_CHANGES.md counts as fork code, another FreeCut file needs the baseline', () => {
  const source = { 'src/features/x.tsx': "t('presets.missing')" }
  assert.match(run({ en: EN, source, upstream: ['src/features/x.tsx'] })[0], /src\/features\/x\.tsx:1: key 'presets\.missing'/)
  assert.equal(run({ en: EN, source }).length, 1) // not in the baseline: still an error
  assert.deepEqual(run({ en: EN, source }, { ...NO_BASELINES, missingEnglish: { 'presets.missing': ['src/features/x.tsx'] } }), [])
})

test('planted: a key missing in one language fails when the fork uses it', () => {
  const others = { ...EN, presets: {} }
  const errors = run({ en: EN, others: EN, source: { 'src/studio/a.tsx': "t('presets.mixed')" } })
  assert.deepEqual(errors, [])
  const fixture = tree({ en: EN, source: { 'src/studio/a.tsx': "t('presets.mixed')" } })
  try {
    fs.writeFileSync(path.join(fixture.root, 'src/i18n/locales/ja.json'), JSON.stringify(others))
    const found = judge(measure(fixture.root), NO_BASELINES).errors
    assert.equal(found.length, 1)
    assert.match(found[0], /key 'presets\.mixed' is used by DroneClean code but missing in ja\./)
  } finally {
    fixture.cleanup()
  }
})

test('a FreeCut key missing in a language is accepted only while it is in the baseline, and the baseline may only shrink', () => {
  const fixture = tree({ en: EN, source: { 'src/features/x.tsx': "t('presets.mixed')" } })
  try {
    fs.writeFileSync(path.join(fixture.root, 'src/i18n/locales/de.json'), JSON.stringify({ ...EN, presets: {} }))
    const measured = measure(fixture.root)
    assert.match(judge(measured, NO_BASELINES).errors[0], /key 'presets\.mixed' is missing in de\./)
    const known = { ...NO_BASELINES, missingTranslations: { 'presets.mixed': ['de'] } }
    assert.deepEqual(judge(measured, known).errors, [])
    // once de has it, the entry is stale
    fs.writeFileSync(path.join(fixture.root, 'src/i18n/locales/de.json'), JSON.stringify(EN))
    const fixed = judge(measure(fixture.root), known)
    assert.match(fixed.errors[0], /baseline i18n-missing-translations\.json: 'presets\.mixed' is translated now in de/)
    assert.deepEqual(shrunk(known, fixed.shrinkable).missingTranslations, {})
  } finally {
    fixture.cleanup()
  }
})

test('plural groups: other and one are needed where the language has a singular, only other in ja', () => {
  const others = { ...EN, common: { ok: 'OK', items_other: '{{count}} x' } }
  const fixture = tree({ en: EN, source: { 'src/studio/a.tsx': "t('common.items', { count })" } })
  try {
    for (const language of LANGUAGES.filter((l) => l !== 'en')) {
      fs.writeFileSync(path.join(fixture.root, `src/i18n/locales/${language}.json`), JSON.stringify(others))
    }
    const errors = judge(measure(fixture.root), NO_BASELINES).errors
    assert.equal(errors.length, 1)
    assert.match(errors[0], /'common\.items' is used by DroneClean code but missing in de, es, fr, it, pt-BR, tr\./)
    assert.doesNotMatch(errors[0], /ja|ko|zh/)
  } finally {
    fixture.cleanup()
  }
})

test('planted: a new runtime key fails until it is listed with a reason; a listed key that is gone is stale', () => {
  const source = { 'src/studio/a.tsx': 't(`presets.${id}`)' }
  const errors = run({ en: EN, source })
  assert.ok(errors.some((message) => /src\/studio\/a\.tsx:1: runtime key \(`presets\.\$\{id\}`\) cannot be checked/.test(message)))
  const listed = { ...NO_BASELINES, dynamic: [{ file: 'src/studio/a.tsx', expression: '`presets.${id}`', reason: 'an enum' }] }
  assert.deepEqual(
    run({ en: EN, source }, listed).filter((message) => /runtime key/.test(message)),
    [],
  )
  const stale = run({ en: EN, source: { 'src/studio/a.tsx': 'export const a = 1' } }, listed)
  assert.match(stale[0], /baseline i18n-dynamic-keys\.json: \(`presets\.\$\{id\}`\) in src\/studio\/a\.tsx is gone/)
})

test('the fixed start of a runtime key in fork code makes every key under it a fork key', () => {
  const others = { ...EN, presets: { mixed: 'Mixed' } }
  const fixture = tree({ en: EN, source: { 'src/studio/a.tsx': 't(`presets.${id}`)' } })
  try {
    fs.writeFileSync(path.join(fixture.root, 'src/i18n/locales/fr.json'), JSON.stringify({ common: EN.common, presets: {} }))
    void others
    const errors = judge(measure(fixture.root), NO_BASELINES).errors
    assert.ok(errors.some((message) => /key 'presets\.mixed' is used by DroneClean code but missing in fr/.test(message)))
  } finally {
    fixture.cleanup()
  }
})

test('effects.json without a root effects key is wrapped as the loader wraps it', () => {
  const fixture = tree({ en: {}, source: { 'src/studio/a.tsx': "t('effects.panel.title')" } })
  try {
    for (const language of LANGUAGES) {
      const folder = path.join(fixture.root, 'src/i18n/locales/partials', language)
      fs.mkdirSync(folder, { recursive: true })
      fs.writeFileSync(path.join(folder, 'effects.json'), JSON.stringify({ panel: { title: 'Effects' } }))
    }
    assert.deepEqual(judge(measure(fixture.root), NO_BASELINES).errors, [])
  } finally {
    fixture.cleanup()
  }
})

const NAMESPACES = ['editor', 'common']
const keys = (source) => scanSource(source, NAMESPACES).filter((use) => use.kind === 'static').map((use) => use.key)

test('scan: finds literal keys in t(), member t(), i18n.t(), Trans and ...Key properties; ignores comments and strings', () => {
  const source = [
    "t('editor.a')",
    'params.t("editor.b", { count: 1 })',
    "i18n.t(`editor.c`)",
    '<Trans i18nKey="editor.d" /> <Trans i18nKey={\'editor.e\'} />',
    "const x = { labelKey: 'common.f', other: 'common.g' }",
    "const LABELS = { 'editor.h': 'Text', 'editor.event': { a: 1 } }",
    "// t('editor.comment')",
    "/* t('editor.block') */",
    "const s = \"t('editor.instring')\"",
    "cond ? t('editor.i') : 'x'",
    "t(isOn ? 'editor.j' : 'editor.k')",
  ].join('\n')
  assert.deepEqual(keys(source).sort(), ['common.f', 'editor.a', 'editor.b', 'editor.c', 'editor.d', 'editor.e', 'editor.h', 'editor.i', 'editor.j', 'editor.k'])
})

test('scan: a template with an expression, a variable or a concatenation is a runtime key', () => {
  const uses = scanSource("t(`editor.${a}`); t(key); t('editor.' + id); t(\n  // note\n  'editor.ok',\n)", NAMESPACES)
  assert.deepEqual(
    uses.map((use) => (use.kind === 'static' ? use.key : `dynamic:${use.expression}`)),
    ['dynamic:`editor.${a}`', 'dynamic:key', "dynamic:'editor.' + id", 'editor.ok'],
  )
})

test('scan: a regular expression or a template holding quotes does not hide the next call', () => {
  const source = "const r = /['\"]/g\nconst m = `it's ${x}`\nt('editor.after')"
  assert.deepEqual(keys(source), ['editor.after'])
})
